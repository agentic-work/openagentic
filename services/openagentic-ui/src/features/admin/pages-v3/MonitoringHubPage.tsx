import * as React from 'react'
import {
  PageHead,
  Subtabs,
  KpiGrid,
  Kpi,
  Btn,
  StatusDot,
  type Status,
} from '../primitives-v3'
import { useAdminQuery } from '../hooks/useAdminQuery'
import { useDashboardMetrics } from '../hooks/useDashboardMetrics'
import { usePromInstant, type PromSample } from '../hooks/useProm'
import { ActivityPane } from './monitoring/ActivityPane'
import { AnalyticsPane } from './monitoring/AnalyticsPane'
import { FeedbackPane } from './monitoring/FeedbackPane'
import { ErrorsPane } from './monitoring/ErrorsPane'
import { ContextPane } from './monitoring/ContextPane'
import { EmbeddingsPane } from './monitoring/EmbeddingsPane'
import { ClusterPane } from './monitoring/ClusterPane'
import { TestsPane } from './monitoring/TestsPane'

// ============================================================
// Tab vocabulary
// ============================================================
export type MonitoringTab =
  | 'activity'
  | 'analytics'
  | 'feedback'
  | 'errors'
  | 'context'
  | 'embeddings'
  | 'cluster'
  | 'tests'

const TAB_ORDER: MonitoringTab[] = [
  'activity',
  'analytics',
  'feedback',
  'errors',
  'context',
  'embeddings',
  'cluster',
  'tests',
]

const TABS = [
  { id: 'activity',   label: 'User Activity' },
  { id: 'analytics',  label: 'Usage Analytics' },
  { id: 'feedback',   label: 'Feedback' },
  { id: 'errors',     label: 'Errors' },
  { id: 'context',    label: 'Context Window' },
  { id: 'embeddings', label: 'Embeddings' },
  { id: 'cluster',    label: 'Cluster Health' },
  { id: 'tests',      label: 'Test Harness' },
]

// ============================================================
// Page-level KPI source shapes
// ============================================================
interface ActivitySummaryShape {
  onlineCount?: number
  activeChatSessions?: number
  activeCodeSessions?: number
  totalUsers?: number
  todayTokens?: { totalTokens?: number; totalCost?: number; requestCount?: number }
}

interface AuditStatsShape {
  admin?: { recent24h?: number; totalActions?: number }
  user?: { recent24h?: number; failedQueries24h?: number }
}

interface EmbeddingsResponseShape {
  success?: boolean
  embeddings?: {
    summary?: {
      totalRequests?: number
      totalTokens?: number
      totalCost?: number
      avgLatencyMs?: number
    }
  }
}

// ============================================================
// Helpers
// ============================================================
const fmtNum = (n: number | undefined | null): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

function firstScalar(samples: PromSample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null
  const v = samples[0]?.value?.[1]
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ============================================================
// Props
// ============================================================
export interface MonitoringHubPageProps {
  /** Sub-tab to land on. Mapped from leaf id by AdminPortalHostV3. */
  initialTab?: MonitoringTab | string
}

export const MonitoringHubPage: React.FC<MonitoringHubPageProps> = ({
  initialTab = 'activity',
}) => {
  const safeInitial: MonitoringTab = (TAB_ORDER as string[]).includes(initialTab as string)
    ? (initialTab as MonitoringTab)
    : 'activity'

  const [tab, setTab] = React.useState<MonitoringTab>(safeInitial)

  // Honor leaf-driven re-mounts: AdminPortalHostV3 passes a fresh
  // initialTab when the operator clicks a different monitoring leaf.
  React.useEffect(() => {
    setTab(safeInitial)
  }, [safeInitial])

  // ============================================================
  // Page-level KPI data — pulled at the page level so the KPI strip
  // stays consistent across tab switches (rather than re-fetching
  // when each pane mounts). Each pane owns deeper queries.
  // ============================================================
  const activity = useAdminQuery<ActivitySummaryShape>(
    ['user-activity', 'summary'],
    '/api/admin/user-activity/summary',
    { staleTime: 15_000, refetchInterval: 15_000 },
  )
  const dash = useDashboardMetrics('24h')
  const auditStats = useAdminQuery<{ success?: boolean } & AuditStatsShape>(
    ['audit-logs', 'stats'],
    '/api/admin/audit-logs/stats',
    { staleTime: 30_000, refetchInterval: 30_000 },
  )
  const emb = useAdminQuery<EmbeddingsResponseShape>(
    ['analytics', 'embeddings'],
    '/api/admin/analytics/embeddings',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )

  // Cluster health — single instant Prom query per dimension, summed
  // server-side. Pending pods + failed pods drive the cluster status.
  const podsRunning = usePromInstant('sum(kube_pod_status_phase{phase="Running"})')
  const podsPending = usePromInstant('sum(kube_pod_status_phase{phase="Pending"})')
  const podsFailed = usePromInstant('sum(kube_pod_status_phase{phase="Failed"})')

  // ============================================================
  // Derived KPI values
  // ============================================================
  const onlineCount = activity.data?.onlineCount ?? 0
  const failed24h = auditStats.data?.user?.failedQueries24h ?? 0
  const adminActions24h = auditStats.data?.admin?.recent24h ?? 0
  const totalErrors24h = failed24h + (dash.data?.summary?.apiErrorRate ? 0 : 0) // user-query failures are the load-bearing signal
  const p95Latency = dash.data?.summary?.apiAvgResponseTime // closest available — no separate p95 series
  const embeddingsCount = emb.data?.embeddings?.summary?.totalRequests
  const running = firstScalar(podsRunning.data) ?? 0
  const pending = firstScalar(podsPending.data) ?? 0
  const failed = firstScalar(podsFailed.data) ?? 0

  const clusterStatus: Status =
    podsRunning.isError || podsRunning.isLoading
      ? 'idle'
      : failed > 0
        ? 'err'
        : pending > 0
          ? 'warn'
          : 'ok'

  const clusterLabel: string =
    podsRunning.isLoading
      ? '…'
      : podsRunning.isError
        ? 'unknown'
        : failed > 0
          ? 'degraded'
          : pending > 0
            ? 'pending'
            : 'healthy'

  const onRefresh = React.useCallback(() => {
    activity.refetch?.()
    auditStats.refetch?.()
    emb.refetch?.()
    podsRunning.refetch?.()
    podsPending.refetch?.()
    podsFailed.refetch?.()
  }, [activity, auditStats, emb, podsRunning, podsPending, podsFailed])

  // ============================================================
  // Meta line — incidents count + live state + cluster status
  // ============================================================
  const meta = (
    <>
      <span style={{ marginRight: 8 }}>
        {failed24h > 0
          ? `${failed24h.toLocaleString()} incidents (24h)`
          : 'no incidents (24h)'}
      </span>
      <span style={{ color: 'var(--fg-3)' }}>·</span>
      <span style={{ marginLeft: 6 }}>live</span>
      <span style={{ margin: '0 8px', color: 'var(--fg-3)' }}>·</span>
      <StatusDot status={clusterStatus} />
      <span style={{ marginLeft: 6 }}>cluster {clusterLabel}</span>
    </>
  )

  return (
    <>
      <PageHead
        title={TABS.find((t) => t.id === tab)?.label ?? "Monitoring"}
        meta={meta}
        actions={<Btn variant="ghost" onClick={onRefresh}>refresh</Btn>}
      />

      <Subtabs
        items={TABS}
        active={tab}
        onChange={(id) => setTab(id as MonitoringTab)}
      />

      <KpiGrid cols={5}>
        <Kpi
          label="active users (now)"
          value={activity.isLoading ? '…' : onlineCount.toLocaleString()}
          sub={
            activity.isLoading
              ? ''
              : `${(activity.data?.activeChatSessions ?? 0).toLocaleString()} chats · ${(activity.data?.activeCodeSessions ?? 0).toLocaleString()} code`
          }
        />
        <Kpi
          label="errors (24h)"
          value={
            auditStats.isLoading
              ? '…'
              : (totalErrors24h).toLocaleString()
          }
          sub={`${adminActions24h.toLocaleString()} admin actions`}
          tone={totalErrors24h > 0 ? 'err' : 'default'}
        />
        <Kpi
          label="avg latency"
          value={
            dash.isLoading
              ? '…'
              : typeof p95Latency === 'number'
                ? `${Math.round(p95Latency)}ms`
                : '—'
          }
          sub="api avg response time"
        />
        <Kpi
          label="cluster"
          value={clusterLabel}
          sub={
            podsRunning.isLoading
              ? '…'
              : `${running.toLocaleString()} running · ${pending.toLocaleString()} pending · ${failed.toLocaleString()} failed`
          }
          tone={clusterStatus === 'err' ? 'err' : clusterStatus === 'warn' ? 'warn' : 'ok'}
        />
        <Kpi
          label="embeddings"
          value={emb.isLoading ? '…' : fmtNum(embeddingsCount)}
          sub="requests, last window"
        />
      </KpiGrid>

      {tab === 'activity'   && <ActivityPane />}
      {tab === 'analytics'  && <AnalyticsPane />}
      {tab === 'feedback'   && <FeedbackPane />}
      {tab === 'errors'     && <ErrorsPane />}
      {tab === 'context'    && <ContextPane />}
      {tab === 'embeddings' && <EmbeddingsPane />}
      {tab === 'cluster'    && <ClusterPane />}
      {tab === 'tests'      && <TestsPane />}
    </>
  )
}

export default MonitoringHubPage
