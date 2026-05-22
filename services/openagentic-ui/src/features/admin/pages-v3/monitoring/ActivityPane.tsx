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

const fmtTs = (ts: string | undefined): string => {
  if (!ts) return '—'
  try {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
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

const userStatus = (u: LiveUser): Status => {
  const t = u.activityType?.toLowerCase() ?? ''
  if (t.includes('code')) return 'info'
  if (t.includes('chat')) return 'ok'
  if (u.codeMode?.status === 'running') return 'info'
  return 'idle'
}

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

      <SectionBar title="top users (by tokens)" />
      <Panel>
        <PanelHead title="top 10" count={topUsers.length} />
        {summaryQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : topUsers.length === 0 ? (
          <EmptyInline pad>no per-user usage in the current window</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <BarList items={topUserBars} />
          </div>
        )}
      </Panel>

      <SectionBar title="live presence" />
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
              <FeedRow
                key={u.userId}
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
                    {(u.sessionCount ?? 0).toLocaleString()} sess
                  </span>
                }
              />
            ))}
          </Feed>
        )}
      </Panel>
    </>
  )
}

export default ActivityPane
