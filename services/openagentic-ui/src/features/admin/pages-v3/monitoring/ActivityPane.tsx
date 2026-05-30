import * as React from 'react'
import {
  Banner,
  EmptyInline,
  Feed,
  FeedRow,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  StatusDot,
  type Status,
  BarList,
  SidePanel,
  Dt,
  type DtCol,
  Btn,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'

interface TopUserRow {
  userId: string
  email?: string
  name?: string | null
  isAdmin?: boolean
  totalTokens?: number
  totalCost?: number
  requestCount?: number
}

interface ActivitySummary {
  onlineCount?: number
  activeChatSessions?: number
  activeCodeSessions?: number
  totalUsers?: number
  newUsersToday?: number
  todayTokens?: {
    totalTokens?: number
    totalCost?: number
    requestCount?: number
    byProvider?: Array<{ provider: string; totalTokens: number; totalCost: number; requestCount: number }>
  }
  topUsers?: TopUserRow[]
}

interface LiveUser {
  userId: string
  email?: string
  name?: string | null
  isAdmin?: boolean
  lastAccessed?: string
  sessionCount?: number
  activityType?: string
  activeChatSessions?: Array<{ id: string; title: string; model: string; updatedAt: string }>
  codeMode?: { status?: string; podName?: string; lastAccessed?: string | null } | null
}

interface LiveResponse {
  users?: LiveUser[]
}

interface UserUsageResponse {
  user: {
    id: string
    email: string
    name: string | null
    isAdmin: boolean
    codeEnabled: boolean
    createdAt: string
    lastLoginAt: string | null
  }
  tokenUsage: {
    totalTokens: number
    totalCost: number
    requestCount: number
    byProvider?: Array<{ provider: string; totalTokens: number; totalCost: number; requestCount: number }>
    byModel?: Array<{ model: string; totalTokens: number; totalCost: number; requestCount: number }>
  }
  chatSessions: {
    total: number
    active: number
    recent: Array<{
      id: string
      title: string
      model: string
      isActive: boolean
      createdAt: string
      updatedAt: string
    }>
  }
  queryAudit?: {
    recent: Array<{
      id: string
      queryType: string
      intent: string | null
      mcpServer: string | null
      toolsCalled: string[]
      modelUsed: string | null
      tokensConsumed: number | null
      costEstimate: number | null
      success: boolean
      responseTimeMs: number | null
      errorMessage: string | null
      createdAt: string
    }>
  }
  mcpToolUsage?: Array<{ mcpServer: string; callCount: number; avgResponseTimeMs: number | null }>
  codeMode?: {
    status: string
    statusMessage: string | null
    environmentType: string | null
    nodeName: string | null
    podName: string | null
    storageQuotaMb: number | null
    storageUsedMb: number | null
    openagenticModel: string | null
    provisionedAt: string | null
    lastAccessedAt: string | null
    suspendedAt: string | null
    suspendedReason: string | null
    lastError: string | null
    errorCount: number
    createdAt: string
  } | null
}

const fmtTs = (ts: string | undefined | null): string => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

const fmtDate = (ts: string | undefined | null): string => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const mins = Math.floor(diffMs / 60_000)
    const hours = Math.floor(diffMs / 3_600_000)
    const days = Math.floor(diffMs / 86_400_000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  } catch {
    return '—'
  }
}

const fmtNum = (n: number | undefined | null): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

const fmtUsd = (n: number | undefined | null): string =>
  typeof n === 'number' ? `$${n.toFixed(n < 1 ? 4 : 2)}` : '—'

const userStatus = (u: LiveUser): Status => {
  const t = u.activityType?.toLowerCase() ?? ''
  if (t.includes('code')) return 'info'
  if (t.includes('chat')) return 'ok'
  if (u.codeMode?.status === 'running') return 'info'
  return 'idle'
}

// ──────────────────────────────────────────────────────────────────────────
// Per-user drill panel
// ──────────────────────────────────────────────────────────────────────────

interface UserDrillProps {
  userId: string
}

const CHAT_SESSION_COLS: DtCol<UserUsageResponse['chatSessions']['recent'][number]>[] = [
  {
    key: 'title',
    label: 'session',
    className: 'name',
    render: (s) => (
      <a
        href={`/chat?session=${encodeURIComponent(s.id)}`}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--accent)' }}
        title="open in chat"
      >
        {s.title || s.id.slice(0, 8)}
      </a>
    ),
  },
  {
    key: 'model',
    label: 'model',
    className: 'mono dim' as any,
    render: (s) => s.model || '—',
  },
  {
    key: 'updated',
    label: 'last activity',
    className: 'mono dim' as any,
    render: (s) => fmtDate(s.updatedAt),
  },
  {
    key: 'active',
    label: 'status',
    width: '70px',
    render: (s) => (
      <span style={{ color: s.isActive ? 'var(--ok)' : 'var(--fg-3)' }}>
        {s.isActive ? 'active' : 'idle'}
      </span>
    ),
  },
]

const QUERY_AUDIT_COLS: DtCol<NonNullable<UserUsageResponse['queryAudit']>['recent'][number]>[] = [
  { key: 'when', label: 'when', width: '90px', className: 'mono dim' as any, render: (a) => fmtDate(a.createdAt) },
  { key: 'type', label: 'type', width: '90px', className: 'mono' as any, render: (a) => a.queryType },
  { key: 'model', label: 'model', className: 'mono dim' as any, render: (a) => a.modelUsed || '—' },
  { key: 'tools', label: 'tools', className: 'mono dim' as any, render: (a) => Array.isArray(a.toolsCalled) ? a.toolsCalled.slice(0, 3).join(', ') : '—' },
  { key: 'tokens', label: 'tokens', className: 'num', width: '70px', render: (a) => fmtNum(a.tokensConsumed) },
  { key: 'cost', label: 'cost', className: 'num', width: '70px', render: (a) => fmtUsd(a.costEstimate) },
  { key: 'ms', label: 'ms', className: 'num', width: '60px', render: (a) => a.responseTimeMs != null ? a.responseTimeMs.toLocaleString() : '—' },
  {
    key: 'ok',
    label: 'ok',
    width: '50px',
    render: (a) => (
      <span style={{ color: a.success ? 'var(--ok)' : 'var(--err)' }}>{a.success ? '✓' : '✗'}</span>
    ),
  },
]

const MCP_TOOL_COLS: DtCol<NonNullable<UserUsageResponse['mcpToolUsage']>[number]>[] = [
  { key: 'server', label: 'mcp server', className: 'name', render: (m) => m.mcpServer },
  { key: 'calls', label: 'calls', className: 'num', width: '80px', render: (m) => m.callCount.toLocaleString() },
  { key: 'avgMs', label: 'avg ms', className: 'num', width: '80px', render: (m) => m.avgResponseTimeMs != null ? m.avgResponseTimeMs.toLocaleString() : '—' },
]

const MODEL_USAGE_COLS: DtCol<NonNullable<UserUsageResponse['tokenUsage']['byModel']>[number]>[] = [
  { key: 'model', label: 'model', className: 'name', render: (m) => m.model },
  { key: 'requests', label: 'requests', className: 'num', width: '80px', render: (m) => m.requestCount.toLocaleString() },
  { key: 'tokens', label: 'tokens', className: 'num', width: '90px', render: (m) => fmtNum(m.totalTokens) },
  { key: 'cost', label: 'cost', className: 'num', width: '80px', render: (m) => fmtUsd(m.totalCost) },
]

const UserDrill: React.FC<UserDrillProps> = ({ userId }) => {
  const usageQ = useAdminQuery<UserUsageResponse>(
    ['user-activity', 'usage', userId],
    `/api/admin/user-activity/${encodeURIComponent(userId)}/usage`,
    { staleTime: 30_000 },
  )

  if (usageQ.isLoading) return <EmptyInline pad>loading user activity…</EmptyInline>
  if (usageQ.isError || !usageQ.data) {
    return (
      <Banner level="err" label="error">
        failed to load <span className="accent">/api/admin/user-activity/{userId}/usage</span>
      </Banner>
    )
  }

  const d = usageQ.data
  const recent = d.chatSessions?.recent ?? []
  const audits = d.queryAudit?.recent ?? []
  const mcps = d.mcpToolUsage ?? []
  const byModel = d.tokenUsage?.byModel ?? []

  return (
    <>
      <KpiGrid cols={4}>
        <Kpi label="total tokens" value={fmtNum(d.tokenUsage.totalTokens)} sub={`${d.tokenUsage.requestCount} reqs`} />
        <Kpi label="total cost" value={fmtUsd(d.tokenUsage.totalCost)} sub={d.user.isAdmin ? 'admin' : 'user'} />
        <Kpi label="chat sessions" value={d.chatSessions.total.toLocaleString()} sub={`${d.chatSessions.active} active`} />
        <Kpi
          label="code mode"
          value={d.codeMode?.status ?? '—'}
          sub={d.codeMode?.podName ?? (d.user.codeEnabled ? 'enabled' : 'disabled')}
          tone={d.codeMode?.status === 'running' ? 'ok' : d.codeMode?.status === 'failed' ? 'err' : undefined}
        />
      </KpiGrid>

      <SectionBar title={`recent chat sessions (${recent.length})`} />
      <Panel>
        <PanelHead title="click title to open in chat" count={recent.length} />
        {recent.length === 0 ? (
          <EmptyInline pad>no chat sessions for this user</EmptyInline>
        ) : (
          <Dt columns={CHAT_SESSION_COLS} rows={recent} rowKey={(s) => s.id} />
        )}
      </Panel>

      {byModel.length > 0 && (
        <>
          <SectionBar title={`tokens by model (${byModel.length})`} />
          <Panel>
            <PanelHead title="model usage" count={byModel.length} />
            <Dt columns={MODEL_USAGE_COLS} rows={byModel} rowKey={(m) => m.model} />
          </Panel>
        </>
      )}

      {audits.length > 0 && (
        <>
          <SectionBar title={`query audit (${audits.length})`} />
          <Panel>
            <PanelHead title="recent audit events" count={audits.length} />
            <Dt columns={QUERY_AUDIT_COLS} rows={audits} rowKey={(a) => a.id} />
          </Panel>
        </>
      )}

      {mcps.length > 0 && (
        <>
          <SectionBar title={`MCP tool usage (${mcps.length})`} />
          <Panel>
            <PanelHead title="per-server call counts" count={mcps.length} />
            <Dt columns={MCP_TOOL_COLS} rows={mcps} rowKey={(m) => m.mcpServer} />
          </Panel>
        </>
      )}

      {d.codeMode && (
        <>
          <SectionBar title="code mode session" />
          <Panel>
            <PanelHead title={d.codeMode.podName ?? 'no pod'} count={d.codeMode.status} />
            <div style={{ padding: '12px 14px', fontFamily: 'var(--font-v3-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
              <div>environment: {d.codeMode.environmentType ?? '—'}</div>
              <div>node: {d.codeMode.nodeName ?? '—'}</div>
              <div>storage: {d.codeMode.storageUsedMb ?? 0} / {d.codeMode.storageQuotaMb ?? 0} MB</div>
              <div>model: {d.codeMode.openagenticModel ?? '—'}</div>
              <div>provisioned: {d.codeMode.provisionedAt ? fmtDate(d.codeMode.provisionedAt) : '—'}</div>
              <div>last accessed: {d.codeMode.lastAccessedAt ? fmtDate(d.codeMode.lastAccessedAt) : '—'}</div>
              {d.codeMode.lastError && <div style={{ color: 'var(--err)' }}>last error: {d.codeMode.lastError}</div>}
              {d.codeMode.errorCount > 0 && <div style={{ color: 'var(--warn)' }}>error count: {d.codeMode.errorCount}</div>}
            </div>
          </Panel>
        </>
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Pane
// ──────────────────────────────────────────────────────────────────────────

export const ActivityPane: React.FC = () => {
  const summaryQ = useAdminQuery<ActivitySummary>(
    ['user-activity', 'summary', 'pane'],
    '/api/admin/user-activity/summary',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
  const liveQ = useAdminQuery<LiveResponse>(
    ['user-activity', 'live'],
    '/api/admin/user-activity/live',
    { staleTime: 10_000, refetchInterval: 15_000 },
  )

  // SSE / NDJSON live stream — best-effort. Mirror the v2 behavior: try
  // the stream, drop to the existing polling cadence on failure.
  const [streamUsers, setStreamUsers] = React.useState<LiveUser[] | null>(null)
  const [sseStatus, setSseStatus] = React.useState<'idle' | 'open' | 'error' | 'unauth'>('idle')

  // Per-user drill panel state. Either a userId from the top-users bar
  // (click) or the live presence feed (click).
  const [drillUserId, setDrillUserId] = React.useState<string | null>(null)
  const [drillUserLabel, setDrillUserLabel] = React.useState<string>('')

  React.useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('auth_token') : ''
    if (!token) {
      setSseStatus('unauth')
      return
    }
    const abort = new AbortController()
    setSseStatus('idle')

    const url = `/api/admin/user-activity/stream?token=${encodeURIComponent(token)}`
    void (async () => {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/x-ndjson' },
          credentials: 'include',
          signal: abort.signal,
        })
        if (!resp.ok || !resp.body) {
          setSseStatus('error')
          return
        }
        setSseStatus('open')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        while (!abort.signal.aborted) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line) continue
            try {
              const ev: any = JSON.parse(line)
              if (ev?.type === 'presence_update' && Array.isArray(ev.users)) {
                setStreamUsers(ev.users as LiveUser[])
              }
            } catch {
              // ignore parse errors — keep reading
            }
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return
        setSseStatus('error')
      }
    })()
    return () => abort.abort()
  }, [])

  const summary = summaryQ.data ?? {}
  const liveUsers: LiveUser[] = streamUsers ?? liveQ.data?.users ?? []

  const topUsers = (summary.topUsers ?? []).slice(0, 10)
  const topUserBars = topUsers.map((u) => ({
    name: u.name ?? u.email ?? u.userId,
    value: u.totalTokens ?? 0,
    display: fmtNum(u.totalTokens),
  }))

  const drillUser = (userId: string, label: string) => {
    setDrillUserId(userId)
    setDrillUserLabel(label)
  }

  return (
    <>
      <SectionBar
        title="real-time presence"
        right={
          <span style={{ color: 'var(--fg-3)' }}>
            <StatusDot
              status={
                sseStatus === 'open' ? 'ok' : sseStatus === 'error' ? 'warn' : 'idle'
              }
            />
            <span style={{ marginLeft: 6 }}>
              {sseStatus === 'open'
                ? 'live · ndjson'
                : sseStatus === 'error'
                  ? '15s poll (stream disconnected)'
                  : sseStatus === 'unauth'
                    ? '15s poll (no stream token)'
                    : 'idle'}
            </span>
          </span>
        }
      />

      {summaryQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/user-activity/summary</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="online now"
          value={summaryQ.isLoading ? '…' : (summary.onlineCount ?? 0).toLocaleString()}
          sub={`${(summary.totalUsers ?? 0).toLocaleString()} total users`}
        />
        <Kpi
          label="active chats"
          value={summaryQ.isLoading ? '…' : (summary.activeChatSessions ?? 0).toLocaleString()}
          sub="open conversation threads"
        />
        <Kpi
          label="active code sessions"
          value={summaryQ.isLoading ? '…' : (summary.activeCodeSessions ?? 0).toLocaleString()}
          sub="running pods (per user)"
        />
        <Kpi
          label="today requests"
          value={summaryQ.isLoading ? '…' : fmtNum(summary.todayTokens?.requestCount)}
          sub={`${fmtNum(summary.todayTokens?.totalTokens)} tokens · $${(summary.todayTokens?.totalCost ?? 0).toFixed(2)}`}
        />
      </KpiGrid>

      <SectionBar title="top users (by tokens)" right={<span style={{ color: 'var(--fg-3)' }}>click a name to drill in</span>} />
      <Panel>
        <PanelHead title="top 10" count={topUsers.length} />
        {summaryQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : topUsers.length === 0 ? (
          <EmptyInline pad>no per-user usage in the current window</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            {topUsers.map((u) => {
              const label = u.name ?? u.email ?? u.userId
              return (
                <div
                  key={u.userId}
                  onClick={() => drillUser(u.userId, label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 4px',
                    borderBottom: '1px solid var(--line-1)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-v3-mono)',
                    fontSize: 12,
                  }}
                  title="open user drill panel"
                >
                  <span style={{ flex: 1, color: 'var(--fg-1)' }}>{label}</span>
                  {u.isAdmin && <span style={{ color: 'var(--warn)', fontSize: 9 }}>ADMIN</span>}
                  <span style={{ color: 'var(--fg-3)' }}>{fmtNum(u.totalTokens)} tok</span>
                  <span style={{ color: 'var(--fg-3)' }}>{fmtUsd(u.totalCost)}</span>
                  <span style={{ color: 'var(--accent)' }}>{u.requestCount ?? 0} reqs ›</span>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <SectionBar title="live presence" right={<span style={{ color: 'var(--fg-3)' }}>click a user to drill in</span>} />
      <Panel>
        <PanelHead title="users active now" count={liveUsers.length} />
        {liveQ.isLoading && liveUsers.length === 0 ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : liveQ.isError && liveUsers.length === 0 ? (
          <EmptyInline pad>failed to fetch /api/admin/user-activity/live</EmptyInline>
        ) : liveUsers.length === 0 ? (
          <EmptyInline pad>no users active right now</EmptyInline>
        ) : (
          <Feed>
            {liveUsers.slice(0, 100).map((u) => (
              <div
                key={u.userId}
                onClick={() => drillUser(u.userId, u.name ?? u.email ?? u.userId)}
                style={{ cursor: 'pointer' }}
                title="open user drill panel"
              >
                <FeedRow
                  ts={fmtTs(u.lastAccessed)}
                  status={userStatus(u)}
                  who={u.name ?? u.email ?? u.userId}
                  act={
                    <>
                      <span className="accent">{u.activityType ?? 'active'}</span>
                      {u.activeChatSessions && u.activeChatSessions.length > 0 && (
                        <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                          · {u.activeChatSessions.length} chat
                          {u.activeChatSessions.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {u.codeMode?.status && (
                        <span style={{ color: 'var(--fg-3)', marginLeft: 6 }}>
                          · code:{u.codeMode.status}
                        </span>
                      )}
                    </>
                  }
                  right={
                    <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
                      {(u.sessionCount ?? 0).toLocaleString()} sess ›
                    </span>
                  }
                />
              </div>
            ))}
          </Feed>
        )}
      </Panel>

      <SidePanel
        open={drillUserId != null}
        onClose={() => setDrillUserId(null)}
        title={drillUserLabel}
        meta={drillUserId ? `userId · ${drillUserId.slice(0, 12)}` : ''}
        tabs={undefined}
      >
        {drillUserId && <UserDrill userId={drillUserId} />}
      </SidePanel>
    </>
  )
}

export default ActivityPane
