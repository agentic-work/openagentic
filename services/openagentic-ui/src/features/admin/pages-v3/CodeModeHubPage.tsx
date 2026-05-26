import * as React from 'react'
import {
  PageHead,
  Subtabs,
  Banner,
  KpiGrid,
  Kpi,
  Btn,
  EmptyInline,
} from '../primitives-v3'
import {
  useDashboardMetrics,
  useCodeModeSessions,
  type CodeModeSessionRow,
} from '../hooks/useDashboardMetrics'
import { SettingsPane } from './code-mode/SettingsPane'
import { GlobalPane } from './code-mode/GlobalPane'
import { McpPane } from './code-mode/McpPane'
import { SkillsPane } from './code-mode/SkillsPane'
import { UsersPane } from './code-mode/UsersPane'
import { MetricsPane } from './code-mode/MetricsPane'

// Allowed sub-tab keys. Mirrors the v2 leaf ids minus the `cm-` prefix
// so AdminPortalHostV3 can pass leaf.id.replace('cm-', '') directly.
export type CodeModeTab =
  | 'settings'
  | 'global'
  | 'mcp'
  | 'skills'
  | 'users'
  | 'metrics'

const TAB_ORDER: CodeModeTab[] = ['settings', 'global', 'mcp', 'skills', 'users', 'metrics']

const TABS = [
  { id: 'settings', label: 'Settings' },
  { id: 'global',   label: 'Global' },
  { id: 'mcp',      label: 'MCP Servers' },
  { id: 'skills',   label: 'Skills & Plugins' },
  { id: 'users',    label: 'Users & Sessions' },
  { id: 'metrics',  label: 'Metrics' },
]

const fmtNum = (n: number | undefined): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)
const fmtUsd = (n: number | undefined): string =>
  typeof n === 'number' ? `$${n.toFixed(2)}` : '—'

/** Average duration (createdAt → lastActivity) across the running sessions. */
function avgSessionMs(sessions: CodeModeSessionRow[]): number {
  if (!sessions.length) return 0
  let total = 0
  let n = 0
  for (const s of sessions) {
    if (!s.createdAt) continue
    const start = new Date(s.createdAt).getTime()
    const end = s.lastActivity ? new Date(s.lastActivity).getTime() : Date.now()
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      total += end - start
      n += 1
    }
  }
  return n === 0 ? 0 : total / n
}

const fmtDur = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export interface CodeModeHubPageProps {
  initialTab?: CodeModeTab | string
}

export const CodeModeHubPage: React.FC<CodeModeHubPageProps> = ({
  initialTab = 'settings',
}) => {
  const safeInitial: CodeModeTab = (TAB_ORDER as string[]).includes(initialTab as string)
    ? (initialTab as CodeModeTab)
    : 'settings'

  const [tab, setTab] = React.useState<CodeModeTab>(safeInitial)
  const [pending, setPending] = React.useState<string | null>(null)

  // Honor leaf-driven re-mounts: AdminPortalHostV3 passes a fresh
  // initialTab when the operator clicks a different cm-* leaf.
  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  const showPending = React.useCallback((label: string) => {
    setPending(label)
    window.setTimeout(() => setPending(null), 4000)
  }, [])

  const metrics = useDashboardMetrics('24h')
  const sessionsQ = useCodeModeSessions()

  const sessions: CodeModeSessionRow[] = sessionsQ.data?.sessions ?? []
  const summary = metrics.data?.summary

  // Users in last 24h: distinct userIds in /code/sessions. We can't
  // pull this from /dashboard/metrics — the per-user usage there is
  // chat-scoped, not code-mode-scoped.
  const usersIn24h = React.useMemo(() => {
    const set = new Set<string>()
    const cutoff = Date.now() - 86_400_000
    for (const s of sessions) {
      const t = s.lastActivity ?? s.createdAt
      if (!t) continue
      if (new Date(t).getTime() >= cutoff) set.add(s.userId)
    }
    return set.size
  }, [sessions])

  const activeSessions = sessions.filter(
    (s) => s.status === 'running' || s.status === 'idle',
  ).length
  const avgMs = React.useMemo(() => avgSessionMs(sessions), [sessions])

  const onRefresh = () => {
    sessionsQ.refetch?.()
    // useDashboardMetrics returns a narrowed state; its 30s refetchInterval
    // keeps it fresh. The button refreshes the data the operator sees most.
  }

  const metaLine =
    metrics.isLoading || sessionsQ.isLoading
      ? 'loading…'
      : `${activeSessions} active · ${usersIn24h} users (24h) · ${fmtNum(summary?.totalCodeTokens)} tokens · ${fmtUsd(summary?.totalCodeCost)} spent`

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "Code Mode"}
        meta={metaLine}
        actions={<Btn variant="ghost" onClick={onRefresh}>refresh</Btn>}
      />
      <Subtabs items={TABS} active={tab} onChange={(id) => setTab(id as CodeModeTab)} />

      {pending && (
        <Banner level="info" label="pending">
          mutation wire-up pending — &quot;{pending}&quot; is read-only in the v3 native page.
          Use the v2 fallback (<span className="accent">?v3=0</span>) to write.
        </Banner>
      )}
      {sessionsQ.isError && (
        <Banner level="warn" label="warn">
          /api/admin/code/sessions unreachable — KPIs and Users tab will be empty
        </Banner>
      )}

      <KpiGrid cols={5}>
        <Kpi
          label="active sessions"
          value={sessionsQ.isLoading ? '…' : String(activeSessions)}
          sub={`${sessions.length} total tracked`}
        />
        <Kpi
          label="users (24h)"
          value={sessionsQ.isLoading ? '…' : String(usersIn24h)}
          sub="distinct in last 24h"
        />
        <Kpi
          label="tokens (24h)"
          value={metrics.isLoading ? '…' : fmtNum(summary?.totalCodeTokens)}
          sub={`${fmtNum(summary?.totalCodeMessages)} msgs`}
        />
        <Kpi
          label="cost (24h)"
          value={metrics.isLoading ? '…' : fmtUsd(summary?.totalCodeCost)}
          sub={fmtNum(summary?.totalCodeSessions) + ' sessions / 24h'}
        />
        <Kpi
          label="avg session"
          value={sessionsQ.isLoading ? '…' : fmtDur(avgMs)}
          sub="created → last activity"
        />
      </KpiGrid>

      {tab === 'settings' && <SettingsPane />}
      {tab === 'global' && <GlobalPane />}
      {tab === 'mcp' && <McpPane />}
      {tab === 'skills' && <SkillsPane onAdd={showPending} />}
      {tab === 'users' && <UsersPane onStub={showPending} />}
      {tab === 'metrics' && <MetricsPane />}
      {!TAB_ORDER.includes(tab) && (
        <EmptyInline pad>unknown sub-tab: {String(tab)}</EmptyInline>
      )}
    </>
  )
}

export default CodeModeHubPage
