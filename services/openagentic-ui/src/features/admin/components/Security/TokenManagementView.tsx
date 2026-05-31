/**
 * TokenManagementView — Admin > Security > API Tokens (Archetype B · Resource list)
 *
 * Replaces the "still wired into v1" placeholder for the `tokens` slug. Wraps
 * the already-shipped /api/admin/tokens/* backend (see
 * services/openagentic-api/src/routes/admin-api-tokens.ts) in the universal
 * admin chrome: PageHeader + ResourceTable + EmptyState, with a SlideInPanel
 * create-form and a one-time plaintext display after creation.
 *
 * Notes on the contract (read from the route file, not assumed):
 *   - GET  /admin/tokens             → { success, tokens: [...], count }
 *   - POST /admin/tokens             → { success, message, token: { id, ..., apiKey } }
 *                                      apiKey is the plaintext value, returned ONCE.
 *   - DELETE /admin/tokens/:tokenId  → soft-revoke (sets is_active=false)
 *   - GET  /admin/tokens/users/available → { success, users: [...] }
 *
 * The list response does NOT include a `prefix` field. The backend keeps the
 * plaintext token only at create-time and stores a bcrypt hash thereafter, so
 * we synthesise a prefix locally from the first 8 chars of the apiKey at
 * create-time and otherwise show the token name only.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCw, Trash2 } from '@/shared/icons'
import { apiRequest } from '@/utils/api'
import { useConfirm } from '@/shared/hooks/useConfirm'
import {
  EmptyState,
  PageHeader,
  Pill,
  ResourceTable,
  type PillTone,
  type ResourceTableColumn,
} from '../../primitives-v2'
import {
  SlideInPanel,
  SlideInPanelField,
  SlideInPanelFooter,
  SlideInPanelSection,
} from '@/shared/components/SlideInPanel'

// ---------------------------------------------------------------------------
// Types — mirror the response shapes from admin-api-tokens.ts
// ---------------------------------------------------------------------------

interface ApiTokenRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  isAdmin?: boolean
  name: string
  lastUsedAt: string | null
  expiresAt: string | null
  isActive: boolean
  isExpired: boolean
  createdAt: string
  rateLimitTier?: string
  rateLimitPerMinute?: number | null
  rateLimitPerHour?: number | null
  rateLimitBurst?: number | null
}

interface AvailableUser {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
  displayName: string
  createdAt: string
}

interface CreatedTokenResult {
  id: string
  userId: string
  userName: string
  userEmail: string
  name: string
  apiKey: string // plaintext — only present on creation
  expiresAt: string | null
  isActive: boolean
  createdAt: string
  rateLimitTier?: string
}

type RateLimitTier = 'free' | 'pro' | 'enterprise' | 'custom'

const TIER_OPTIONS: Array<{ value: RateLimitTier; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
  { value: 'custom', label: 'Custom' },
]

function tierToTone(tier?: string): PillTone {
  switch (tier) {
    case 'pro':
      return 'info'
    case 'enterprise':
      return 'warn'
    case 'custom':
      return 'idle'
    case 'free':
    default:
      return 'ok'
  }
}

function formatDate(iso: string | null | undefined, fallback = 'Never'): string {
  if (!iso) return fallback
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return fallback
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function tokenPrefix(apiKey: string): string {
  // Backend prefix is `oa_` (user keys) or `oa_sys_` (system/inter-service
  // tokens) — show the first 8 chars + ellipsis.
  if (!apiKey) return ''
  return `${apiKey.slice(0, 8)}…`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TokenManagementView: React.FC = () => {
  const confirm = useConfirm()
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  const [users, setUsers] = useState<AvailableUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create-form state
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formUserId, setFormUserId] = useState('')
  const [formName, setFormName] = useState('')
  const [formExpiresInDays, setFormExpiresInDays] = useState<number | ''>(90)
  const [formTier, setFormTier] = useState<RateLimitTier>('free')
  const [formError, setFormError] = useState<string | null>(null)

  // Plaintext-on-create state — shown ONCE in a dedicated read-only panel.
  const [createdToken, setCreatedToken] = useState<CreatedTokenResult | null>(null)
  const [copied, setCopied] = useState(false)

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const fetchTokens = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await apiRequest('/admin/tokens')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTokens(Array.isArray(data?.tokens) ? data.tokens : [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load API tokens')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await apiRequest('/admin/tokens/users/available')
      if (!res.ok) return
      const data = await res.json()
      setUsers(Array.isArray(data?.users) ? data.users : [])
    } catch {
      // Non-fatal: the create form will simply show an empty user list.
    }
  }, [])

  useEffect(() => {
    fetchTokens()
    fetchUsers()
  }, [fetchTokens, fetchUsers])

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const resetForm = useCallback(() => {
    setFormUserId('')
    setFormName('')
    setFormExpiresInDays(90)
    setFormTier('free')
    setFormError(null)
  }, [])

  const handleCreate = useCallback(async () => {
    setFormError(null)
    if (!formUserId) {
      setFormError('Pick a user.')
      return
    }
    if (!formName.trim()) {
      setFormError('Give the token a name.')
      return
    }
    try {
      setSubmitting(true)
      const body: Record<string, unknown> = {
        userId: formUserId,
        name: formName.trim(),
        rateLimitTier: formTier,
      }
      if (typeof formExpiresInDays === 'number' && formExpiresInDays > 0) {
        body.expiresInDays = formExpiresInDays
      }
      const res = await apiRequest('/admin/tokens', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.token) {
        throw new Error(data?.message || `HTTP ${res.status}`)
      }
      setCreatedToken(data.token as CreatedTokenResult)
      setCreateOpen(false)
      resetForm()
      fetchTokens()
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create API token')
    } finally {
      setSubmitting(false)
    }
  }, [formUserId, formName, formExpiresInDays, formTier, fetchTokens, resetForm])

  const handleRevoke = useCallback(
    async (token: ApiTokenRow) => {
      const ok = await confirm(
        `Revoke API token "${token.name}"? The owner will lose access immediately.`,
        { title: 'Revoke API token', confirmText: 'Revoke', variant: 'danger' },
      )
      if (!ok) return
      try {
        const res = await apiRequest(`/admin/tokens/${encodeURIComponent(token.id)}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.message || `HTTP ${res.status}`)
        }
        fetchTokens()
      } catch (err: any) {
        setError(err?.message || 'Failed to revoke API token')
      }
    },
    [confirm, fetchTokens],
  )

  const handleCopyToken = useCallback(async () => {
    if (!createdToken?.apiKey) return
    try {
      await navigator.clipboard.writeText(createdToken.apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (e.g. insecure context) — silently ignore.
    }
  }, [createdToken])

  // -------------------------------------------------------------------------
  // Table model
  // -------------------------------------------------------------------------

  const columns: ResourceTableColumn[] = useMemo(
    () => [
      { id: 'name', label: 'Token / User' },
      { id: 'prefix', label: 'Prefix', width: 160 },
      { id: 'tier', label: 'Tier', width: 120 },
      { id: 'expires', label: 'Expires', width: 140 },
      { id: 'lastUsed', label: 'Last Used', width: 140 },
      { id: 'actions', label: '', width: 96 },
    ],
    [],
  )

  const rows = useMemo(
    () =>
      tokens.map(t => ({
        id: t.id,
        cells: {
          name: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--ap-fg-0, var(--fg-0))', fontWeight: 500 }}>
                {t.name}
              </span>
              <span
                style={{
                  color: 'var(--ap-fg-2, var(--fg-2))',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                }}
              >
                {t.userName}
                {t.userEmail && t.userEmail !== t.userName ? ` · ${t.userEmail}` : ''}
              </span>
            </div>
          ),
          prefix: (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--ap-fg-2, var(--fg-2))',
              }}
            >
              oa_…
            </span>
          ),
          tier: <Pill tone={tierToTone(t.rateLimitTier)}>{t.rateLimitTier || 'free'}</Pill>,
          expires: (
            <span style={{ fontSize: 12 }}>
              {t.expiresAt ? formatDate(t.expiresAt, '—') : 'Never'}
            </span>
          ),
          lastUsed: (
            <span style={{ fontSize: 12, color: 'var(--ap-fg-2, var(--fg-2))' }}>
              {t.lastUsedAt ? formatDate(t.lastUsedAt, '—') : 'Never'}
            </span>
          ),
          actions: (
            <button
              type="button"
              onClick={() => handleRevoke(t)}
              disabled={!t.isActive}
              aria-label={`Revoke ${t.name}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: t.isActive
                  ? 'var(--ap-err, var(--err))'
                  : 'var(--ap-fg-3, var(--fg-3))',
                cursor: t.isActive ? 'pointer' : 'not-allowed',
                opacity: t.isActive ? 1 : 0.5,
              }}
            >
              <Trash2 size={12} />
              Revoke
            </button>
          ),
        },
      })),
    [tokens, handleRevoke],
  )

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      <PageHeader
        crumbs={['Admin', 'Security', 'API Tokens']}
        title="API Token Management"
        explainer="Issue, list, and revoke long-lived API tokens that let users authenticate to /api/* programmatically. Tokens are hashed at rest — the plaintext value is shown exactly once at creation."
        actions={[
          { label: 'Refresh', onClick: fetchTokens },
          { label: '+ Create Token', primary: true, onClick: () => setCreateOpen(true) },
        ]}
      />

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            borderRadius: 3,
            border: '1px solid var(--ap-err, var(--err))',
            background: 'var(--ap-err-soft, var(--err-soft))',
            color: 'var(--ap-err, var(--err))',
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {/* One-time plaintext token display — shown ONCE, immediately after create. */}
      {createdToken && (
        <div
          data-testid="created-token-banner"
          style={{
            padding: '14px 16px',
            borderRadius: 3,
            border: '1px solid var(--ap-warn, var(--warn))',
            background: 'var(--ap-warn-soft, var(--warn-soft))',
            color: 'var(--ap-fg-0, var(--fg-0))',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                Token created — copy it now
              </div>
              <div
                style={{
                  fontSize: 12,
                  marginTop: 2,
                  color: 'var(--ap-fg-1, var(--fg-1))',
                }}
              >
                This is the only time the plaintext token will be shown. After
                you dismiss this banner it will be hidden forever — there is no
                recovery.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCreatedToken(null)}
              style={{
                background: 'transparent',
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                borderRadius: 3,
                padding: '4px 10px',
                fontSize: 11,
                color: 'var(--ap-fg-1, var(--fg-1))',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              readOnly
              value={createdToken.apiKey}
              aria-label="Plaintext API token (shown once)"
              onFocus={e => e.currentTarget.select()}
              style={{
                flex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                padding: '6px 10px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: 'var(--ap-fg-0, var(--fg-0))',
              }}
            />
            <button
              type="button"
              onClick={handleCopyToken}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 3,
                border: '1px solid var(--ap-accent, var(--accent))',
                background: 'var(--ap-accent, var(--accent))',
                color: 'var(--ap-fg-on-accent, white)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Copy size={12} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--ap-fg-2, var(--fg-2))',
            }}
          >
            Prefix: {tokenPrefix(createdToken.apiKey)} · Owner: {createdToken.userEmail}
          </div>
        </div>
      )}

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 48,
          }}
        >
          <RefreshCw
            size={20}
            className="animate-spin"
            style={{ color: 'var(--ap-accent, var(--accent))' }}
          />
        </div>
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          emptyState={
            <EmptyState
              title="No API tokens"
              hint="Click + Create Token to issue one."
              cta="+ Create Token"
              onCta={() => setCreateOpen(true)}
            />
          }
        />
      )}

      {/* Create form — slide-in drawer */}
      <SlideInPanel
        isOpen={createOpen}
        onClose={() => {
          if (submitting) return
          setCreateOpen(false)
          resetForm()
        }}
        title="Create API Token"
        subtitle="Issue a long-lived token on behalf of a user."
        width="md"
        testId="create-token-panel"
        footer={
          <SlideInPanelFooter
            onCancel={() => {
              setCreateOpen(false)
              resetForm()
            }}
            onSubmit={handleCreate}
            submitText="Create token"
            isSubmitting={submitting}
            isSubmitDisabled={!formUserId || !formName.trim()}
          />
        }
      >
        <SlideInPanelSection>
          {formError && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                borderRadius: 3,
                border: '1px solid var(--ap-err, var(--err))',
                background: 'var(--ap-err-soft, var(--err-soft))',
                color: 'var(--ap-err, var(--err))',
                fontSize: 12,
              }}
            >
              {formError}
            </div>
          )}

          <SlideInPanelField label="User" required>
            <select
              value={formUserId}
              onChange={e => setFormUserId(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: 'var(--ap-fg-0, var(--fg-0))',
                fontSize: 13,
              }}
            >
              <option value="">— Select a user —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </SlideInPanelField>

          <SlideInPanelField
            label="Token name"
            required
            hint="A short label to help admins recognise this token in the list."
          >
            <input
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Looker reverse-ETL"
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: 'var(--ap-fg-0, var(--fg-0))',
                fontSize: 13,
              }}
            />
          </SlideInPanelField>

          <SlideInPanelField
            label="Expires in (days)"
            hint="Leave empty for a non-expiring token. 1–365 otherwise."
          >
            <input
              type="number"
              min={1}
              max={365}
              value={formExpiresInDays === '' ? '' : formExpiresInDays}
              onChange={e => {
                const v = e.target.value
                setFormExpiresInDays(v === '' ? '' : Number(v))
              }}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: 'var(--ap-fg-0, var(--fg-0))',
                fontSize: 13,
              }}
            />
          </SlideInPanelField>

          <SlideInPanelField label="Rate-limit tier">
            <select
              value={formTier}
              onChange={e => setFormTier(e.target.value as RateLimitTier)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 3,
                border: '1px solid var(--ap-ln-2, var(--ln-2))',
                background: 'var(--ap-bg-1, var(--bg-1))',
                color: 'var(--ap-fg-0, var(--fg-0))',
                fontSize: 13,
              }}
            >
              {TIER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SlideInPanelField>
        </SlideInPanelSection>
      </SlideInPanel>
    </div>
  )
}

export default TokenManagementView
