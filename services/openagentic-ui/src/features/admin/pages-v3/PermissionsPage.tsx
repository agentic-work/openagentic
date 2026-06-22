import * as React from 'react'
import {
  PageHead,
  Banner,
  Panel,
  PanelHead,
  Btn,
  SectionBar,
  EmptyInline,
  Toggle,
} from '../primitives-v3'
import { useAdminQuery, useAdminInvalidate } from '../hooks/useAdminQuery'
import { apiRequest } from '@/utils/api'
import { useToast, ToastStack } from './_shared/mutationHelpers'

type Behavior = 'allow' | 'deny' | 'ask'

interface PermissionRule {
  source: string
  ruleBehavior: Behavior
  ruleValue: { toolName: string; ruleContent?: string }
}

interface PendingApproval {
  id: string
  toolName: string
  userId: string
  reason: string
  createdAt: number
  expiresAt: number
}

interface PermissionsApiResponse {
  success: boolean
  rules: PermissionRule[]
  pending: PendingApproval[]
}

// #790 — global READ-ONLY mode
interface ReadOnlyModeResponse {
  success: boolean
  readOnlyMode: boolean
}

// ---------------------------------------------------------------------------
// Helpers — convert between rule[] and three textarea blobs
// ---------------------------------------------------------------------------

function rulesToBlob(rules: PermissionRule[], behavior: Behavior): string {
  return rules
    .filter((r) => r.ruleBehavior === behavior)
    .map((r) => r.ruleValue.toolName)
    .join('\n')
}

function blobToRules(blob: string, behavior: Behavior, source: string): PermissionRule[] {
  return blob
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((toolName) => ({
      source,
      ruleBehavior: behavior,
      ruleValue: { toolName },
    }))
}

// ---------------------------------------------------------------------------
// Editor pane — one textarea per behavior
// ---------------------------------------------------------------------------

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 280,
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.5,
  background: 'var(--ctl-surf)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--ctl-radius-sm)',
  color: 'var(--fg-0)',
  outline: 'none',
  resize: 'vertical',
  boxSizing: 'border-box',
}

const RuleListEditor: React.FC<{
  title: string
  behavior: Behavior
  blob: string
  onChange: (next: string) => void
  isDirty: boolean
  hint: string
}> = ({ title, behavior, blob, onChange, isDirty, hint }) => {
  const count = blob.split('\n').filter((l) => l.trim().length > 0 && !l.trim().startsWith('#')).length
  const tone =
    behavior === 'allow' ? 'var(--ok)' : behavior === 'deny' ? 'var(--err)' : 'var(--accent)'

  return (
    <Panel>
      <PanelHead
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: tone,
              }}
            />
            {title}
            <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
              · {count} rule{count === 1 ? '' : 's'}
            </span>
            {isDirty && (
              <span style={{ color: 'var(--warn)', fontSize: 'var(--v3-t-meta)' }}>
                · unsaved
              </span>
            )}
          </span>
        }
        right={<span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>{hint}</span>}
      />
      <div style={{ padding: '12px 18px', background: 'var(--ctl-surf)' }}>
        <textarea
          value={blob}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={`one glob per line\n# comments allowed\nazure_list_*\nazure_get_*`}
          style={textareaStyle}
        />
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Pending approvals — simple list with toolName + age
// ---------------------------------------------------------------------------

const PendingTable: React.FC<{ pending: PendingApproval[] }> = ({ pending }) => {
  if (pending.length === 0) {
    return <EmptyInline>no pending approvals</EmptyInline>
  }
  const fmtAge = (createdAt: number) => {
    const ms = Date.now() - createdAt
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      <thead>
        <tr style={{ background: 'var(--ctl-surf)', borderBottom: '1px solid var(--glass-border)' }}>
          <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>tool</th>
          <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>user</th>
          <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>age</th>
          <th style={{ textAlign: 'left', padding: '6px 12px', fontWeight: 600 }}>reason</th>
        </tr>
      </thead>
      <tbody>
        {pending.map((p) => (
          <tr key={p.id} style={{ borderBottom: '1px solid var(--line-2)' }}>
            <td style={{ padding: '6px 12px', color: 'var(--accent)' }}>{p.toolName}</td>
            <td style={{ padding: '6px 12px' }}>{p.userId}</td>
            <td style={{ padding: '6px 12px' }}>{fmtAge(p.createdAt)}</td>
            <td style={{ padding: '6px 12px', color: 'var(--fg-2)' }}>{p.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const PermissionsPage: React.FC = () => {
  const query = useAdminQuery<PermissionsApiResponse>(['permissions'], '/api/admin/permissions', {
    refetchInterval: 10_000, // refresh pending approvals every 10s
  })
  // #790 — global READ-ONLY mode toggle
  const readOnlyQuery = useAdminQuery<ReadOnlyModeResponse>(
    ['permissions', 'read-only-mode'],
    '/api/admin/permissions/read-only-mode',
  )
  const toast = useToast()
  const invalidate = useAdminInvalidate()

  const readOnlyMode = readOnlyQuery.data?.readOnlyMode ?? false
  const [savingReadOnly, setSavingReadOnly] = React.useState(false)

  const handleReadOnlyToggle = async (next: boolean) => {
    setSavingReadOnly(true)
    try {
      const res = await apiRequest('/api/admin/permissions/read-only-mode', {
        method: 'PUT',
        body: JSON.stringify({ readOnlyMode: next }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'toggle failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show(
        'ok',
        next ? 'READ-ONLY ON' : 'READ-ONLY OFF',
        next
          ? 'all CRUD blocked platform-wide; model notified via system prompt'
          : 'normal per-rule cascade restored',
      )
      invalidate(['permissions', 'read-only-mode'])
    } catch (err: any) {
      toast.show('err', 'toggle failed', err?.message ?? 'unknown')
    } finally {
      setSavingReadOnly(false)
    }
  }

  // Snapshot the saved blobs the first time data lands; treat further edits
  // as dirty until save / discard.
  const savedRules = query.data?.rules ?? []
  const pending = query.data?.pending ?? []

  const savedAllow = React.useMemo(() => rulesToBlob(savedRules, 'allow'), [savedRules])
  const savedDeny = React.useMemo(() => rulesToBlob(savedRules, 'deny'), [savedRules])
  const savedAsk = React.useMemo(() => rulesToBlob(savedRules, 'ask'), [savedRules])

  const [allowBlob, setAllowBlob] = React.useState('')
  const [denyBlob, setDenyBlob] = React.useState('')
  const [askBlob, setAskBlob] = React.useState('')
  const [hydrated, setHydrated] = React.useState(false)

  // Hydrate the editor with saved blobs on first data arrival.
  React.useEffect(() => {
    if (!hydrated && query.data) {
      setAllowBlob(savedAllow)
      setDenyBlob(savedDeny)
      setAskBlob(savedAsk)
      setHydrated(true)
    }
  }, [hydrated, query.data, savedAllow, savedDeny, savedAsk])

  const allowDirty = hydrated && allowBlob !== savedAllow
  const denyDirty = hydrated && denyBlob !== savedDeny
  const askDirty = hydrated && askBlob !== savedAsk
  const anyDirty = allowDirty || denyDirty || askDirty

  const [saving, setSaving] = React.useState(false)
  const [resetting, setResetting] = React.useState(false)

  const handleDiscard = () => {
    setAllowBlob(savedAllow)
    setDenyBlob(savedDeny)
    setAskBlob(savedAsk)
  }

  const handleSave = async () => {
    if (!anyDirty) return
    setSaving(true)
    try {
      const newRules: PermissionRule[] = [
        ...blobToRules(allowBlob, 'allow', 'userSettings'),
        ...blobToRules(denyBlob, 'deny', 'userSettings'),
        ...blobToRules(askBlob, 'ask', 'userSettings'),
      ]
      const res = await apiRequest('/api/admin/permissions', {
        method: 'PUT',
        body: JSON.stringify({ rules: newRules }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'save failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'saved', `applied ${newRules.length} rule${newRules.length === 1 ? '' : 's'}`)
      invalidate(['permissions'])
    } catch (err: any) {
      toast.show('err', 'save failed', err?.message ?? 'unknown')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    try {
      const res = await apiRequest('/api/admin/permissions/reset', { method: 'POST' })
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText)
        toast.show('err', 'reset failed', t.slice(0, 200) || `HTTP ${res.status}`)
        return
      }
      toast.show('ok', 'reset', 'rules reset to seeded defaults')
      // Force re-hydrate from server
      setHydrated(false)
      invalidate(['permissions'])
    } catch (err: any) {
      toast.show('err', 'reset failed', err?.message ?? 'unknown')
    } finally {
      setResetting(false)
    }
  }

  const ruleCount = savedRules.length
  const dirtyCount = (allowDirty ? 1 : 0) + (denyDirty ? 1 : 0) + (askDirty ? 1 : 0)

  return (
    <>
      <PageHead
        title="Tool Permissions"
        meta={
          <>
            Claude-Code-style allow/deny/ask glob rules<span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
            <span>{ruleCount} rule{ruleCount === 1 ? '' : 's'}</span>
            <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
            <span>{pending.length} pending</span>
            {anyDirty && (
              <>
                <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
                <span style={{ color: 'var(--warn)' }}>
                  {dirtyCount} pane{dirtyCount === 1 ? '' : 's'} edited
                </span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Btn variant="ghost" onClick={handleDiscard} disabled={!anyDirty || saving}>
              {anyDirty ? `discard (${dirtyCount})` : 'discard'}
            </Btn>
            <Btn variant="ghost" onClick={handleReset} disabled={resetting || saving}>
              {resetting ? 'resetting…' : 'reset to defaults'}
            </Btn>
            <Btn
              variant="primary"
              onClick={handleSave}
              disabled={!anyDirty || saving || resetting}
            >
              {saving ? 'saving…' : 'save & apply'}
            </Btn>
          </>
        }
      />

      <ToastStack api={toast} />

      {query.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/permissions</span>
        </Banner>
      )}

      <Banner level="info" label="how it works">
        Rules are evaluated in priority order: <strong>deny</strong> beats{' '}
        <strong>allow</strong> beats <strong>ask</strong> on a tie; more-specific globs win over
        broader ones. The default fall-through is <strong>ask</strong> (UI prompts the user).
        Globs use <code className="mono">*</code> as a wildcard — e.g.{' '}
        <code className="mono">azure_list_*</code> or <code className="mono">*_delete_*</code>.
      </Banner>

      {/* #790 — global READ-ONLY mode toggle (kill-switch) */}
      <SectionBar title="global READ-ONLY mode" />
      {readOnlyMode && (
        <Banner level="warn" label="active">
          READ-ONLY mode is on. All tools resolve to <strong>deny</strong> except matches
          against the explicit <strong>allow.list</strong> below. The model is notified via
          system prompt and will avoid emitting write tool calls.
        </Banner>
      )}
      <Panel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              READ-ONLY mode (block all CRUD platform-wide)
            </span>
            <span style={{ color: 'var(--fg-3)', fontSize: 'var(--v3-t-meta)' }}>
              Master kill-switch. When ON, only allow-listed read operations execute —
              everything else is denied regardless of the per-rule cascade below. The chat
              model is informed via system prompt so it stops attempting mutations.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>
              {savingReadOnly ? 'saving…' : readOnlyMode ? 'ON' : 'OFF'}
            </span>
            <Toggle
              on={readOnlyMode}
              onChange={handleReadOnlyToggle}
              label="Toggle global READ-ONLY mode"
            />
          </div>
        </div>
      </Panel>

      {/* Editor — three side-by-side panes */}
      <SectionBar
        title="rule editor"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            one glob per line · blank lines + <code className="mono">#</code> comments ignored
          </span>
        }
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
          padding: '12px 18px',
        }}
      >
        <RuleListEditor
          title="allow.list"
          behavior="allow"
          blob={allowBlob}
          onChange={setAllowBlob}
          isDirty={allowDirty}
          hint="auto-approved · no prompt"
        />
        <RuleListEditor
          title="deny.list"
          behavior="deny"
          blob={denyBlob}
          onChange={setDenyBlob}
          isDirty={denyDirty}
          hint="auto-denied · no execution"
        />
        <RuleListEditor
          title="ask.list"
          behavior="ask"
          blob={askBlob}
          onChange={setAskBlob}
          isDirty={askDirty}
          hint="prompts user · explicit ask rules"
        />
      </div>

      {/* Pending approvals */}
      <SectionBar
        title="pending approvals"
        count={pending.length}
        right={<span style={{ color: 'var(--fg-3)' }}>refreshed every 10s</span>}
      />
      <Panel>
        <PendingTable pending={pending} />
      </Panel>
    </>
  )
}

export default PermissionsPage
