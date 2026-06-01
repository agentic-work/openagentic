import * as React from 'react'
import {
  Banner,
  Btn,
  Dt,
  type DtCol,
  EmptyInline,
  FormGrid,
  FormRow,
  Mini,
  MiniGrid,
  SectionBar,
  StatusDot,
} from '../../primitives-v3'
import {
  useUserPermissions,
  useEffectivePermissions,
  useUserTokens,
  useUserSessions,
  useUserAuditLogs,
  useAvailableLLMs,
  useAvailableMCPs,
  useSetUserPermissions,
  asLLMs,
  asMCPs,
  asSessions,
  type ApiUser,
  type ApiToken,
  type SessionRow,
  type UserAuditEntry,
} from '../../hooks/useUserManagement'
import { apiRequest } from '@/utils/api'
import { relativeTimeShort, roleOf } from './helpers'

// ============================================================
// Profile tab — read-only form
// ============================================================
export const ProfileTab: React.FC<{ user: ApiUser }> = ({ user }) => (
  <>
    <Banner level="info" label="read-only">
      profile editing — mutation wire-up pending. v2 page <span className="accent">/admin#users</span> still owns writes.
    </Banner>
    <FormGrid>
      <FormRow name="Display name">
        <ReadOnlyValue value={user.name ?? '(none set)'} />
      </FormRow>
      <FormRow name="Email" desc="Sign-in identity from SSO provider.">
        <ReadOnlyValue mono value={user.email} />
      </FormRow>
      <FormRow name="Role" desc="Admins can manage every leaf in this portal.">
        <ReadOnlyValue value={roleOf(user)} />
      </FormRow>
      <FormRow name="Groups" desc="Group memberships from SSO claims.">
        <ReadOnlyValue
          value={user.groups && user.groups.length > 0 ? user.groups.join(', ') : '(none)'}
        />
      </FormRow>
      <FormRow name="Created">
        <ReadOnlyValue mono value={fmtIso(user.created_at)} />
      </FormRow>
      <FormRow name="Last sign-in">
        <ReadOnlyValue mono value={user.last_login_at ? `${relativeTimeShort(user.last_login_at)} ago` : 'never'} />
      </FormRow>
      {user.is_locked && (
        <FormRow name="Locked reason" desc="Account auto-locked after repeated scope violations.">
          <ReadOnlyValue value={user.locked_reason || 'scope violations'} />
        </FormRow>
      )}
    </FormGrid>
  </>
)

const ReadOnlyValue: React.FC<{ value: React.ReactNode; mono?: boolean }> = ({ value, mono }) => (
  <span style={{
    fontFamily: mono ? 'var(--font-v3-mono)' : undefined,
    fontSize: 'var(--v3-t-row, 12.5px)',
    color: 'var(--fg-1)',
  }}>
    {value}
  </span>
)

function fmtIso(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

// ============================================================
// Permissions tab — effective scope + LLM/MCP access tables
// ============================================================
type AccessState = 'allowed' | 'denied' | 'inherit' | 'implicit-deny'

export const PermissionsTab: React.FC<{ user: ApiUser }> = ({ user }) => {
  const perms = useUserPermissions(user.id)
  const eff = useEffectivePermissions(user.id)
  const llms = useAvailableLLMs()
  const mcps = useAvailableMCPs()
  const save = useSetUserPermissions(user.id)

  const allLLMs = asLLMs(llms.data)
  const allMCPs = asMCPs(mcps.data)

  // Source: prefer `permissions.permissions` wrapper, else top-level.
  const cp = (perms.data?.permissions ?? perms.data ?? {}) as Record<string, any>
  const remoteAllowedLlm: string[] = cp.allowedLlmProviders ?? user.customPermissions?.allowedLlmProviders ?? []
  const remoteDeniedLlm: string[]  = cp.deniedLlmProviders  ?? user.customPermissions?.deniedLlmProviders  ?? []
  const remoteAllowedMcp: string[] = cp.allowedMcpServers   ?? user.customPermissions?.allowedMcpServers   ?? []
  const remoteDeniedMcp: string[]  = cp.deniedMcpServers    ?? user.customPermissions?.deniedMcpServers    ?? []
  const source: string = (cp.source ?? user.customPermissions?.source ?? 'default')

  // Local draft — initialized from the remote state every time the
  // server data changes. Operators stage edits client-side then click
  // `save` once to PUT the entire diff.
  const [allowedLlm, setAllowedLlm] = React.useState<string[]>(remoteAllowedLlm)
  const [deniedLlm, setDeniedLlm] = React.useState<string[]>(remoteDeniedLlm)
  const [allowedMcp, setAllowedMcp] = React.useState<string[]>(remoteAllowedMcp)
  const [deniedMcp, setDeniedMcp] = React.useState<string[]>(remoteDeniedMcp)

  // Reset draft whenever the user OR the remote payload changes —
  // protects against stale state when an operator switches users mid-edit.
  React.useEffect(() => {
    setAllowedLlm(remoteAllowedLlm)
    setDeniedLlm(remoteDeniedLlm)
    setAllowedMcp(remoteAllowedMcp)
    setDeniedMcp(remoteDeniedMcp)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user.id,
    perms.dataUpdatedAt,
  ])

  const dirty = !sameSet(allowedLlm, remoteAllowedLlm)
    || !sameSet(deniedLlm, remoteDeniedLlm)
    || !sameSet(allowedMcp, remoteAllowedMcp)
    || !sameSet(deniedMcp, remoteDeniedMcp)

  const cycleLlm = (id: string) => cycleState(id, allowedLlm, deniedLlm, setAllowedLlm, setDeniedLlm)
  const cycleMcp = (id: string) => cycleState(id, allowedMcp, deniedMcp, setAllowedMcp, setDeniedMcp)

  const llmRows = allLLMs.map((p) => ({
    id: p.id,
    name: p.display_name || p.name,
    type: p.provider_type,
    state: classify(p.id, allowedLlm, deniedLlm) as AccessState,
  }))
  const mcpRows = allMCPs.map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.description ?? '',
    state: classify(m.id, allowedMcp, deniedMcp) as AccessState,
  }))

  const effPerms = eff.data?.effectivePermissions ?? {}
  const tier = eff.data?.effectiveRateLimits?.tier ?? '—'
  const dailyTokenLimit = pickValue(effPerms, 'daily_token_limit')
  const monthlyTokenLimit = pickValue(effPerms, 'monthly_token_limit')

  const onSave = () => {
    save.mutate({
      allowedLlmProviders: allowedLlm,
      deniedLlmProviders: deniedLlm,
      allowedMcpServers: allowedMcp,
      deniedMcpServers: deniedMcp,
    })
  }

  const onRevert = () => {
    setAllowedLlm(remoteAllowedLlm)
    setDeniedLlm(remoteDeniedLlm)
    setAllowedMcp(remoteAllowedMcp)
    setDeniedMcp(remoteDeniedMcp)
    save.reset()
  }

  return (
    <>
      {save.isError && (
        <Banner level="err" label="error">
          {save.error?.message ?? 'failed to save permissions'}
        </Banner>
      )}
      {save.isSuccess && !dirty && (
        <Banner level="ok" label="ok">
          permissions saved
        </Banner>
      )}
      <Banner level="info" label="how to edit">
        click any access pill to cycle <span className="accent">inherit → allowed → denied → inherit</span>.
        save commits all changes via <span className="accent">PUT /api/admin/user-management/{user.id}/permissions</span>.
      </Banner>

      {dirty && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderBottom: '1px solid var(--line-1)',
          background: 'var(--bg-1)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--v3-t-meta)',
            color: 'var(--warn)',
          }}>unsaved changes</span>
          <span style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onRevert} disabled={save.isPending}>revert</Btn>
          <Btn variant="primary" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? 'saving…' : 'save'}
          </Btn>
        </div>
      )}

      <SectionBar title="effective scope" right={<span>source: {source}</span>} />
      <MiniGrid cols={4}>
        <Mini
          label="rate tier"
          value={String(tier).toLowerCase()}
          tone={eff.isLoading ? 'dim' : 'default'}
        />
        <Mini
          label="llm providers allowed"
          value={countLabel(allowedLlm.length, deniedLlm.length, allLLMs.length)}
          tone={deniedLlm.length > 0 ? 'warn' : 'default'}
        />
        <Mini
          label="mcp servers allowed"
          value={countLabel(allowedMcp.length, deniedMcp.length, allMCPs.length)}
          tone={deniedMcp.length > 0 ? 'warn' : 'default'}
        />
        <Mini
          label="daily token limit"
          value={fmtLimit(dailyTokenLimit)}
          sub={monthlyTokenLimit != null ? `month: ${fmtLimit(monthlyTokenLimit)}` : undefined}
        />
      </MiniGrid>

      <SectionBar title={`llm access (${allLLMs.length})`} />
      {llms.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : llms.isError ? (
        <EmptyInline pad>failed to load /api/admin/permissions/available-llms</EmptyInline>
      ) : (
        <Dt
          rows={llmRows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', label: 'provider', className: 'name', render: (r) => r.name },
            { key: 'type', label: 'type', className: 'mono', render: (r) => r.type },
            {
              key: 'state',
              label: 'access',
              width: '160px',
              render: (r) => (
                <AccessPill state={r.state} onClick={() => cycleLlm(r.id)} />
              ),
            },
          ]}
          rowDataAttrs={(r: any) => ({
            'provider-type': String(r.type ?? '').toLowerCase(),
            status: r.state === 'allow' ? 'ok'
              : r.state === 'deny' ? 'err'
              : 'idle',
          })}
          empty={<EmptyInline pad>no providers configured</EmptyInline>}
        />
      )}

      <SectionBar title={`mcp access (${allMCPs.length})`} />
      {mcps.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : mcps.isError ? (
        <EmptyInline pad>failed to load /api/admin/permissions/available-mcps</EmptyInline>
      ) : (
        <Dt
          rows={mcpRows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', label: 'server', className: 'name', render: (r) => r.name },
            { key: 'desc', label: 'desc', className: 'dim', render: (r) => r.desc || '—' },
            {
              key: 'state',
              label: 'access',
              width: '160px',
              render: (r) => (
                <AccessPill state={r.state} onClick={() => cycleMcp(r.id)} />
              ),
            },
          ]}
          rowDataAttrs={(r: any) => ({
            status: r.state === 'allow' ? 'ok'
              : r.state === 'deny' ? 'err'
              : 'idle',
          })}
          empty={<EmptyInline pad>no MCP servers configured</EmptyInline>}
        />
      )}

      <SectionBar title="prompt template" />
      <div style={{ padding: '8px 14px', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--v3-t-meta)' }}>
        TODO — render assigned templates from
        <span className="accent"> /api/admin/prompts/users/{user.id}/templates</span>
      </div>
    </>
  )
}

const AccessPill: React.FC<{ state: string; onClick?: () => void }> = ({ state, onClick }) => {
  const tone: Record<string, { color: string; bg: string; label: string }> = {
    allowed:        { color: 'var(--ok)',    bg: 'var(--bg-2)', label: 'allowed' },
    denied:         { color: 'var(--err)',   bg: 'var(--bg-2)', label: 'denied' },
    'implicit-deny':{ color: 'var(--warn)',  bg: 'var(--bg-2)', label: 'not in allow-list' },
    inherit:        { color: 'var(--fg-3)',  bg: 'transparent', label: 'inherit' },
  }
  const v = tone[state] ?? tone.inherit
  const inner = (
    <span style={{
      padding: '1px 6px',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--v3-t-meta, 10px)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      border: '1px solid var(--line-1)',
      color: v.color,
      background: v.bg,
      whiteSpace: 'nowrap',
    }}>{v.label}</span>
  )
  if (!onClick) return inner
  return (
    <button
      type="button"
      onClick={onClick}
      title="click to cycle access state"
      style={{
        background: 'none',
        border: 0,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {inner}
    </button>
  )
}

function classify(id: string, allow: string[], deny: string[]): string {
  if (deny.includes(id)) return 'denied'
  if (allow.length === 0) return 'inherit'
  return allow.includes(id) ? 'allowed' : 'implicit-deny'
}

/**
 * Set-equality on two unsorted id arrays. Cheap (n^2) — list sizes
 * for LLMs/MCPs are tiny so a Set round-trip would be overkill.
 */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (const x of a) if (!b.includes(x)) return false
  return true
}

/**
 * Cycle a single id through allow/deny/inherit. Mutates the two
 * setState callbacks in lockstep so an id is never simultaneously
 * present in both lists.
 *
 *   inherit          → allowed   (push to allow)
 *   allowed          → denied    (move from allow to deny)
 *   denied           → inherit   (drop from deny)
 *   implicit-deny    → allowed   (push to allow — promotes the row)
 */
function cycleState(
  id: string,
  allow: string[],
  deny: string[],
  setAllow: (next: string[]) => void,
  setDeny: (next: string[]) => void,
): void {
  const inAllow = allow.includes(id)
  const inDeny = deny.includes(id)
  if (inDeny) {
    setDeny(deny.filter((x) => x !== id))
    return
  }
  if (inAllow) {
    setAllow(allow.filter((x) => x !== id))
    setDeny([...deny, id])
    return
  }
  setAllow([...allow, id])
}
function pickValue(eff: Record<string, { value: any; source: string }>, key: string): any {
  const v = eff[key]
  return v ? v.value : null
}
function countLabel(allowed: number, denied: number, total: number): string {
  if (allowed === 0 && denied === 0) return `all ${total}`
  if (denied > 0 && allowed === 0) return `${total - denied} of ${total}`
  return `${allowed} of ${total}`
}
function fmtLimit(n: any): string {
  if (n == null || n === '') return 'unlimited'
  const v = Number(n)
  if (!Number.isFinite(v)) return 'unlimited'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

// ============================================================
// Tokens tab — list user's API tokens. Revoke flows through the same
// admin endpoint the System > Tokens pane uses; revoking from here
// invalidates both query keys so both panes refresh.
// ============================================================
export const TokensTab: React.FC<{ user: ApiUser }> = ({ user }) => {
  const q = useUserTokens(user.id)
  const tokens = q.data?.tokens ?? []
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [lastErr, setLastErr] = React.useState<string | null>(null)

  // useAdminMutation needs the endpoint at hook-creation time but our
  // tokenId varies per-row — work around with a tiny wrapper.
  const revokeFn = async (tokenId: string) => {
    setLastErr(null)
    setPendingId(tokenId)
    try {
      const res = await apiRequest(`/api/admin/tokens/${tokenId}`, { method: 'DELETE' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`DELETE failed: ${res.status} - ${text}`)
      }
      await q.refetch()
    } catch (err: any) {
      setLastErr(err?.message ?? 'failed to revoke')
    } finally {
      setPendingId(null)
    }
  }

  const cols: DtCol<ApiToken>[] = [
    { key: 'name', label: 'name', className: 'name', render: (r) => r.name || '(unnamed)' },
    { key: 'tier', label: 'tier', className: 'mono', width: '90px', render: (r) => r.rateLimitTier ?? '—' },
    {
      key: 'lastUsed',
      label: 'last used',
      className: 'mono',
      width: '90px',
      render: (r) => r.lastUsedAt ? relativeTimeShort(r.lastUsedAt) : 'never',
    },
    {
      key: 'expires',
      label: 'expires',
      className: 'mono',
      width: '110px',
      render: (r) => {
        if (!r.expiresAt) return 'never'
        return r.isExpired ? 'expired' : relativeTimeShort(r.expiresAt) + ' left'
      },
    },
    {
      key: 'state',
      label: 'state',
      width: '90px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.isExpired ? 'err' : r.isActive ? 'ok' : 'idle'} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--v3-t-meta, 11px)',
            color: 'var(--fg-2)',
          }}>{r.isExpired ? 'expired' : r.isActive ? 'active' : 'inactive'}</span>
        </span>
      ),
    },
    {
      key: 'revoke',
      label: 'revoke',
      width: '90px',
      render: (r) => (
        r.isActive && !r.isExpired ? (
          <Btn
            variant="ghost"
            disabled={pendingId === r.id}
            onClick={() => {
              if (window.confirm(`Revoke token "${r.name || r.id.slice(0, 8)}"?`)) {
                revokeFn(r.id)
              }
            }}
          >
            {pendingId === r.id ? 'revoking…' : 'revoke'}
          </Btn>
        ) : (
          <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>—</span>
        )
      ),
    },
  ]

  if (q.isLoading) return <EmptyInline pad>loading tokens…</EmptyInline>
  if (q.isError) return <EmptyInline pad>failed to load /api/admin/tokens</EmptyInline>

  return (
    <>
      {lastErr && (
        <Banner level="err" label="error">{lastErr}</Banner>
      )}
      <Dt
        rows={tokens}
        rowKey={(t) => t.id}
        columns={cols}
        empty={<EmptyInline pad>no api tokens issued for this user</EmptyInline>}
      />
    </>
  )
}

// ============================================================
// Sessions tab
// ============================================================
export const SessionsTab: React.FC<{ user: ApiUser }> = ({ user }) => {
  const q = useUserSessions(user.id)
  const sessions = asSessions(q.data)

  const cols: DtCol<SessionRow>[] = [
    { key: 'title', label: 'title', className: 'name', render: (r) => r.title || `session ${r.id.slice(0, 8)}` },
    { key: 'msgs', label: 'msgs', className: 'num', width: '60px', render: (r) => r.messages?.length ?? r.message_count ?? '—' },
    {
      key: 'last',
      label: 'last activity',
      className: 'mono',
      width: '110px',
      render: (r) => relativeTimeShort(r.last_activity_at ?? r.created_at),
    },
    {
      key: 'created',
      label: 'created',
      className: 'mono',
      width: '110px',
      render: (r) => relativeTimeShort(r.created_at),
    },
  ]

  if (q.isLoading) return <EmptyInline pad>loading sessions…</EmptyInline>
  if (q.isError) return <EmptyInline pad>failed to load /api/admin/audit-logs/sessions</EmptyInline>

  return (
    <Dt
      rows={sessions}
      rowKey={(s) => s.id}
      columns={cols}
      empty={<EmptyInline pad>no chat sessions captured for this user</EmptyInline>}
    />
  )
}

// ============================================================
// Activity tab
// ============================================================
export const ActivityTab: React.FC<{ user: ApiUser }> = ({ user }) => {
  const q = useUserAuditLogs(user.id, 25)
  const logs: UserAuditEntry[] = q.data?.logs ?? []

  const cols: DtCol<UserAuditEntry>[] = [
    {
      key: 'time',
      label: 'when',
      className: 'mono',
      width: '90px',
      render: (r) => relativeTimeShort(r.timestamp),
    },
    {
      key: 'action',
      label: 'action',
      className: 'name',
      render: (r) => r.action || r.type || '—',
    },
    {
      key: 'resource',
      label: 'resource',
      className: 'mono',
      render: (r) => [r.resourceType, r.resourceId].filter(Boolean).join(' · ') || '—',
    },
    {
      key: 'state',
      label: 'state',
      width: '70px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <StatusDot status={r.success === false ? 'err' : 'ok'} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--v3-t-meta, 11px)',
            color: 'var(--fg-2)',
          }}>{r.success === false ? 'fail' : 'ok'}</span>
        </span>
      ),
    },
  ]

  if (q.isLoading) return <EmptyInline pad>loading audit log…</EmptyInline>
  if (q.isError) return <EmptyInline pad>failed to load /api/admin/audit-logs</EmptyInline>

  return (
    <Dt
      rows={logs}
      rowKey={(l) => l.id}
      columns={cols}
      empty={<EmptyInline pad>no audit-log entries for this user</EmptyInline>}
    />
  )
}
