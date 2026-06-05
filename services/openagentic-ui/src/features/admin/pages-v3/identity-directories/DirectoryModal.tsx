/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  OpenAgentic Enterprise — Runtime Identity Directory (SSO) registry
 *  Copyright © Agenticwork™ LLC. All rights reserved.
 *
 *  ENTERPRISE SOFTWARE — licensed ONLY under the OpenAgentic Enterprise License
 *  (/ee/LICENSE), NOT the repository's Apache-2.0 license. A paid Agenticwork LLC
 *  subscription is required to use this in production. Reading the source grants no
 *  license. Using, selling, hosting as a service, redistributing, or modifying it
 *  without a subscription — or removing the license gate — is a breach of
 *  /ee/LICENSE §4 and an infringement of Agenticwork's copyright.
 *  Licensing: licensing@agenticwork.io
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import * as React from 'react'
import { SidePanel, Banner, Btn, FormGrid, FormRow } from '../../primitives-v3'
import { apiRequest } from '@/utils/api'
import type { ToastApi } from '../_shared/mutationHelpers'
import { useAdminInvalidate } from '../../hooks/useAdminQuery'
import {
  type DirectoryRow,
  type DirectoryType,
  DIRECTORY_TYPES,
  DIRECTORY_TYPE_META,
  normalizeType,
} from './types'

export interface DirectoryModalProps {
  open: boolean
  onClose: () => void
  /** When provided, the modal opens in edit mode for this row. */
  editing: DirectoryRow | null
  toast: ToastApi
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 28,
  padding: '0 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  background: 'var(--ctl-surf)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--ctl-radius-sm)',
  color: 'var(--fg-0)',
  outline: 'none',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 64,
  padding: 8,
  resize: 'vertical',
}

interface FormState {
  name: string
  displayName: string
  type: DirectoryType
  priority: number
  enabled: boolean
  tenantId: string
  authority: string
  issuer: string
  clientId: string
  clientSecret: string
  allowedDomains: string
  groupClaim: string
  authorizedGroups: string
  adminGroups: string
  externalAdminEmails: string
  groupRoleMappings: string
  allowAllAuthenticated: boolean
}

const blankState = (): FormState => ({
  name: '',
  displayName: '',
  type: 'azure-ad',
  priority: 1,
  enabled: true,
  tenantId: '',
  authority: '',
  issuer: '',
  clientId: '',
  clientSecret: '',
  allowedDomains: '',
  groupClaim: 'groups',
  authorizedGroups: '',
  adminGroups: '',
  externalAdminEmails: '',
  groupRoleMappings: '{}',
  allowAllAuthenticated: false,
})

const listToText = (xs?: string[]): string => (xs ?? []).join(', ')
const textToList = (s: string): string[] =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)

function fromRow(row: DirectoryRow): FormState {
  return {
    name: row.name,
    displayName: row.displayName ?? row.name,
    type: normalizeType(row.type),
    priority: row.priority ?? 1,
    enabled: row.enabled !== false,
    tenantId: row.tenantId ?? '',
    authority: row.authority ?? '',
    issuer: row.issuer ?? '',
    // clientId is write-mostly — the API only tells us if one EXISTS
    // (hasClientId), never the value. Leave blank; a blank on save means
    // "keep existing".
    clientId: '',
    // clientSecret is write-ONLY — never prefilled.
    clientSecret: '',
    allowedDomains: listToText(row.allowedDomains),
    groupClaim: row.groupClaim ?? 'groups',
    authorizedGroups: listToText(row.authorizedGroups),
    adminGroups: listToText(row.adminGroups),
    externalAdminEmails: listToText(row.externalAdminEmails),
    groupRoleMappings: JSON.stringify(row.groupRoleMappings ?? {}, null, 0),
    allowAllAuthenticated: row.allowAllAuthenticated ?? false,
  }
}

/** Best-effort callback URL preview before the row is saved (the API
 *  derives the exact URL from PUBLIC_BASE_URL + the created id). */
const previewCallbackUrl = (id?: string): string => {
  const base =
    typeof window !== 'undefined' && window.location ? window.location.origin : ''
  return `${base}/api/auth/sso/${id ?? '<id>'}/callback`
}

const CopyButton: React.FC<{ value: string; toast: ToastApi }> = ({ value, toast }) => (
  <Btn
    variant="ghost"
    onClick={() => {
      try {
        void navigator.clipboard?.writeText(value)
        toast.show('ok', 'copied', 'callback URL copied to clipboard')
      } catch {
        toast.show('err', 'copy', 'clipboard unavailable — copy manually')
      }
    }}
  >
    copy
  </Btn>
)

export const DirectoryModal: React.FC<DirectoryModalProps> = ({
  open,
  onClose,
  editing,
  toast,
}) => {
  const invalidate = useAdminInvalidate()
  const isEdit = editing != null
  const [form, setForm] = React.useState<FormState>(blankState)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<
    { ok: boolean; message: string } | null
  >(null)
  const [callback, setCallback] = React.useState<{ url: string; instructions: string } | null>(
    null,
  )

  // Reset on open
  React.useEffect(() => {
    if (!open) return
    setErr(null)
    setTestResult(null)
    setForm(editing ? fromRow(editing) : blankState())
    // For an existing row, fetch the exact callback URL the IdP must register.
    if (editing) {
      setCallback({
        url: editing.redirectUri || previewCallbackUrl(editing.id),
        instructions: DIRECTORY_TYPE_META[normalizeType(editing.type)].callbackInstructions,
      })
      void apiRequest(`/api/admin/identity-directories/${editing.id}/callback-url`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.callbackUrl) {
            setCallback({ url: d.callbackUrl, instructions: d.instructions ?? '' })
          }
        })
        .catch(() => {})
    } else {
      setCallback(null)
    }
  }, [open, editing])

  const meta = DIRECTORY_TYPE_META[form.type]

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }))

  const validate = (): string | null => {
    if (!form.name.trim()) return 'name is required (lowercase, kebab-case)'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.name.trim()))
      return 'name must be lowercase letters/digits/dashes only'
    if (!form.displayName.trim()) return 'display name is required'
    if (meta.needsTenant && !form.tenantId.trim() && !form.authority.trim())
      return 'Azure directories need a tenant ID or a full authority URL'
    if (meta.needsIssuer && !form.issuer.trim())
      return 'generic-oidc directories require an issuer URL'
    if (!isEdit && !form.clientId.trim()) return 'client ID is required'
    if (!isEdit && !form.clientSecret.trim()) return 'client secret is required'
    if (form.groupRoleMappings.trim()) {
      try {
        const parsed = JSON.parse(form.groupRoleMappings)
        if (typeof parsed !== 'object' || Array.isArray(parsed))
          return 'group → role mappings must be a JSON object'
      } catch {
        return 'group → role mappings must be valid JSON (e.g. {"<group>":"role"})'
      }
    }
    return null
  }

  const buildPayload = (): Record<string, any> => {
    const payload: Record<string, any> = {
      name: form.name.trim(),
      displayName: form.displayName.trim(),
      type: form.type,
      priority: form.priority,
      enabled: form.enabled,
      groupClaim: form.groupClaim.trim() || 'groups',
      authorizedGroups: textToList(form.authorizedGroups),
      adminGroups: textToList(form.adminGroups),
      externalAdminEmails: textToList(form.externalAdminEmails),
      allowedDomains: textToList(form.allowedDomains),
      allowAllAuthenticated: form.allowAllAuthenticated,
      groupRoleMappings: form.groupRoleMappings.trim()
        ? JSON.parse(form.groupRoleMappings)
        : {},
    }
    if (meta.needsTenant) payload.tenantId = form.tenantId.trim() || undefined
    if (meta.needsAuthority) payload.authority = form.authority.trim() || undefined
    if (meta.needsIssuer) payload.issuer = form.issuer.trim() || undefined
    // clientId/clientSecret: send only when non-blank. Blank on edit =
    // "keep existing" (the API merges onto the decrypted bag).
    if (form.clientId.trim()) payload.clientId = form.clientId.trim()
    if (form.clientSecret.trim()) payload.clientSecret = form.clientSecret.trim()
    return payload
  }

  const handleSave = async () => {
    const v = validate()
    if (v) {
      setErr(v)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const payload = buildPayload()
      const url = isEdit
        ? `/api/admin/identity-directories/${editing!.id}`
        : '/api/admin/identity-directories'
      const res = await apiRequest(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        let parsed: any
        try {
          parsed = JSON.parse(t)
        } catch {
          // not JSON
        }
        const msg = parsed?.message || parsed?.error || t || `HTTP ${res.status}`
        setErr(msg.slice(0, 240))
        return
      }
      const data = await res.json().catch(() => ({}))
      // Surface the exact callback URL the IdP must register (returned on create).
      if (!isEdit && data?.callbackUrl) {
        setCallback({
          url: data.callbackUrl,
          instructions: meta.callbackInstructions,
        })
      }
      toast.show(
        'ok',
        'saved',
        `directory "${payload.displayName}" ${isEdit ? 'updated' : 'created'}`,
      )
      invalidate(['identity-directories'])
      onClose()
    } catch (e: any) {
      setErr(e?.message ?? 'unexpected error')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!isEdit) {
      setTestResult({
        ok: false,
        message: 'save the directory first — Test validates the persisted config.',
      })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await apiRequest(
        `/api/admin/identity-directories/${editing!.id}/test`,
        { method: 'POST' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTestResult({
          ok: false,
          message: data?.message || data?.error || `HTTP ${res.status}`,
        })
        return
      }
      const overall = data?.overall as string | undefined
      const discovery = data?.checks?.discovery
      const detail =
        discovery?.error ||
        discovery?.note ||
        (discovery?.issuer ? `issuer ${discovery.issuer}` : '') ||
        ''
      setTestResult({
        ok: overall === 'pass' || overall === 'partial',
        message: `${overall ?? 'unknown'}${detail ? ` — ${detail}` : ''}`,
      })
    } catch (e: any) {
      setTestResult({ ok: false, message: e?.message ?? 'test failed' })
    } finally {
      setTesting(false)
    }
  }

  const cbUrl = callback?.url ?? previewCallbackUrl(editing?.id)
  const cbInstructions = callback?.instructions || meta.callbackInstructions

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit · ${editing!.displayName ?? editing!.name}` : 'Add Directory'}
      meta={isEdit ? `${meta.label}` : 'configure an SSO identity provider'}
    >
      {err && (
        <Banner level="err" label="error">
          {err}
        </Banner>
      )}

      {/* ---- Step 1: type ---- */}
      <FormGrid>
        <FormRow name="Provider type" desc={meta.hint}>
          <select
            value={form.type}
            disabled={isEdit}
            onChange={(e) =>
              setForm((s) => ({ ...s, type: e.target.value as DirectoryType }))
            }
            className="glass-field"
            style={inputStyle}
          >
            {DIRECTORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DIRECTORY_TYPE_META[t].label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow name="Name" desc="lowercase id, used in URLs and audit logs">
          <input
            type="text"
            value={form.name}
            disabled={isEdit}
            onChange={(e) => set('name', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder="e.g. corp-entra"
          />
        </FormRow>
        <FormRow name="Display name" desc="shown on the login button">
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder="e.g. Sign in with Microsoft"
          />
        </FormRow>
        <FormRow name="Priority" desc="login-button order (lower = first)">
          <input
            type="number"
            min={0}
            value={form.priority}
            onChange={(e) => set('priority', Number(e.target.value))}
            className="glass-field"
            style={inputStyle}
          />
        </FormRow>
        <FormRow name="Enabled">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
        </FormRow>
      </FormGrid>

      {/* ---- Step 2: endpoint identity (type-specific) ---- */}
      <FormGrid>
        {meta.needsTenant && (
          <FormRow name="Tenant ID *" configKey="tenant_id" desc="Entra directory (tenant) GUID">
            <input
              type="text"
              value={form.tenantId}
              onChange={(e) => set('tenantId', e.target.value)}
              className="glass-field"
              style={inputStyle}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </FormRow>
        )}
        {meta.needsAuthority && (
          <FormRow
            name="Authority"
            configKey="authority"
            desc="optional — overrides the tenant-derived authority URL"
          >
            <input
              type="text"
              value={form.authority}
              onChange={(e) => set('authority', e.target.value)}
              className="glass-field"
              style={inputStyle}
              placeholder="https://login.microsoftonline.com/<tenant>"
            />
          </FormRow>
        )}
        {meta.needsIssuer && (
          <FormRow
            name="Issuer *"
            configKey="issuer"
            desc="OIDC issuer base — .well-known/openid-configuration is validated on save"
          >
            <input
              type="text"
              value={form.issuer}
              onChange={(e) => set('issuer', e.target.value)}
              className="glass-field"
              style={inputStyle}
              placeholder="https://example.okta.com"
            />
          </FormRow>
        )}
      </FormGrid>

      {/* ---- Step 3: client credentials ---- */}
      <FormGrid>
        <FormRow
          name={`Client ID${isEdit ? '' : ' *'}`}
          configKey="auth_config.clientId"
          desc={isEdit && editing?.hasClientId ? 'leave blank to keep the stored client ID' : undefined}
        >
          <input
            type="text"
            value={form.clientId}
            onChange={(e) => set('clientId', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder={isEdit && editing?.hasClientId ? '•••• (stored — leave blank to keep)' : 'application (client) ID'}
          />
        </FormRow>
        <FormRow
          name={`Client secret${isEdit ? '' : ' *'}`}
          configKey="auth_config.clientSecret"
          desc={isEdit ? 'write-only — leave blank to keep the stored secret' : 'encrypted at rest'}
        >
          <input
            type="password"
            value={form.clientSecret}
            onChange={(e) => set('clientSecret', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder={isEdit && editing?.hasSecret ? '•••• (stored — leave blank to keep)' : 'client secret value'}
            autoComplete="new-password"
          />
        </FormRow>
      </FormGrid>

      {/* ---- Step 4: access gating + group → role mapping ---- */}
      <FormGrid>
        <FormRow name="Allowed domains" configKey="allowed_domains" desc="comma-separated email domains permitted to sign in (Google hd / email gate)">
          <input
            type="text"
            value={form.allowedDomains}
            onChange={(e) => set('allowedDomains', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder="example.com, corp.example.com"
          />
        </FormRow>
        <FormRow name="Group claim" configKey="group_claim" desc="token claim that carries group membership">
          <input
            type="text"
            value={form.groupClaim}
            onChange={(e) => set('groupClaim', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder="groups"
          />
        </FormRow>
        <FormRow name="Authorized groups" configKey="authorized_groups" desc="login gate — members of any of these may sign in (group GUIDs or names)">
          <textarea
            value={form.authorizedGroups}
            onChange={(e) => set('authorizedGroups', e.target.value)}
            className="glass-field"
            style={textareaStyle}
            placeholder="comma- or newline-separated"
          />
        </FormRow>
        <FormRow name="Admin groups" configKey="admin_groups" desc="members of these groups are granted admin">
          <textarea
            value={form.adminGroups}
            onChange={(e) => set('adminGroups', e.target.value)}
            className="glass-field"
            style={textareaStyle}
            placeholder="comma- or newline-separated"
          />
        </FormRow>
        <FormRow name="External admin emails" configKey="external_admin_emails" desc="explicit admin overrides outside any group">
          <input
            type="text"
            value={form.externalAdminEmails}
            onChange={(e) => set('externalAdminEmails', e.target.value)}
            className="glass-field"
            style={inputStyle}
            placeholder="alice@example.com, bob@example.com"
          />
        </FormRow>
        <FormRow name="Group → role mappings" configKey="group_role_mappings" desc='JSON object mapping group id/name → role, e.g. {"<group>":"editor"}'>
          <textarea
            value={form.groupRoleMappings}
            onChange={(e) => set('groupRoleMappings', e.target.value)}
            className="glass-field"
            style={{ ...textareaStyle, fontFamily: 'var(--font-mono)' }}
            placeholder='{"f1d2...":"editor"}'
          />
        </FormRow>
        <FormRow name="Allow all authenticated" desc="skip group validation — any successfully authenticated user is admitted">
          <input
            type="checkbox"
            checked={form.allowAllAuthenticated}
            onChange={(e) => set('allowAllAuthenticated', e.target.checked)}
          />
        </FormRow>
      </FormGrid>

      {/* ---- Callback URL to register ---- */}
      <div
        className="glass-surface"
        style={{ padding: 12, marginTop: 12, borderRadius: 'var(--ctl-radius, 8px)' }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-accent)',
            marginBottom: 6,
          }}
        >
          Redirect URI to register
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <code
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--fg-0)',
              background: 'var(--ctl-surf)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--ctl-radius-sm, 4px)',
              padding: '4px 8px',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {cbUrl}
          </code>
          <CopyButton value={cbUrl} toast={toast} />
        </div>
        {!isEdit && (
          <div style={{ fontSize: 10, color: 'var(--fg-3)', marginTop: 4 }}>
            the exact URL (with the assigned directory id) is shown again after you save.
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--fg-2)', marginTop: 8 }}>
          {cbInstructions}
        </div>
      </div>

      {/* ---- Test result ---- */}
      {testResult && (
        <div style={{ marginTop: 10 }}>
          <Banner level={testResult.ok ? 'ok' : 'err'} label={testResult.ok ? 'test' : 'test failed'}>
            {testResult.message}
          </Banner>
        </div>
      )}

      {/* ---- Actions ---- */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '14px 0 4px',
          justifyContent: 'flex-end',
          borderTop: '1px solid var(--line-1)',
          marginTop: 12,
        }}
      >
        <Btn variant="ghost" onClick={onClose} disabled={saving}>
          cancel
        </Btn>
        <Btn variant="ghost" onClick={handleTest} disabled={testing || saving}>
          {testing ? 'testing…' : 'test'}
        </Btn>
        <Btn variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'saving…' : isEdit ? 'save changes' : 'create directory'}
        </Btn>
      </div>
    </SidePanel>
  )
}

export default DirectoryModal
