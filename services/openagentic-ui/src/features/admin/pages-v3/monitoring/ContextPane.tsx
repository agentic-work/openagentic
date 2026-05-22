import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  Dt,
  type DtCol,
  MetricChart,
  BarFill,
} from '../../primitives-v3'
import { useAdminQuery } from '../../hooks/useAdminQuery'

interface ContextMetricsRow {
  sessionId?: string
  userId?: string
  userEmail?: string
  userName?: string | null
  model?: string
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  contextUtilizationPct?: number | null
  contextLimit?: number
  messageCount?: number
  createdAt?: string
  updatedAt?: string
}

interface ContextStatistics {
  totalSessions?: number
  avgUtilization?: number | null
  sessionsOver90?: number
  sessionsOver70?: number
}

interface ContextResponse {
  sessions?: ContextMetricsRow[]
  statistics?: ContextStatistics
}

interface CompactionResponse {
  summary?: {
    totalCompactions?: number
    last24h?: number
  }
  contextUsageDistribution?: {
    under50?: number
    from50to70?: number
    from70to85?: number
    from85to95?: number
    over95?: number
  }
  byLevel?: {
    light?: number
    medium?: number
    aggressive?: number
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

const utilTone = (pct: number | null | undefined): 'ok' | 'warn' | 'err' | 'default' => {
  if (pct == null) return 'default'
  if (pct >= 90) return 'err'
  if (pct >= 70) return 'warn'
  return 'ok'
}

export const ContextPane: React.FC = () => {
  const ctxQ = useAdminQuery<ContextResponse>(
    ['context-metrics'],
    '/api/admin/context-metrics?limit=50&sortBy=utilization&sortOrder=desc',
    { staleTime: 30_000, refetchInterval: 60_000 },
  )
  const compQ = useAdminQuery<CompactionResponse>(
    ['context-metrics', 'compaction'],
    '/api/admin/context-metrics/compaction',
    { staleTime: 60_000, refetchInterval: 60_000 },
  )

  const sessions = ctxQ.data?.sessions ?? []
  const stats = ctxQ.data?.statistics ?? {}
  const comp = compQ.data ?? {}
  const dist = comp.contextUsageDistribution ?? {}

  const distChart = [
    { name: 'under 50%', value: dist.under50 ?? 0, color: 'ok' as const },
    { name: '50–70%', value: dist.from50to70 ?? 0, color: 'ok' as const },
    { name: '70–85%', value: dist.from70to85 ?? 0, color: 'warn' as const },
    { name: '85–95%', value: dist.from85to95 ?? 0, color: 'warn' as const },
    { name: 'over 95%', value: dist.over95 ?? 0, color: 'err' as const },
  ]
  const distTotal = distChart.reduce((a, b) => a + b.value, 0)

  const cols: DtCol<ContextMetricsRow>[] = [
    { key: 'user', label: 'user', className: 'name', render: (r) => r.userName ?? r.userEmail ?? '—' },
    { key: 'model', label: 'model', className: 'mono', render: (r) => r.model ?? '—' },
    {
      key: 'tok',
      label: 'tokens',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.totalTokens),
    },
    {
      key: 'limit',
      label: 'limit',
      align: 'right',
      className: 'num',
      render: (r) => fmtNum(r.contextLimit),
    },
    {
      key: 'util',
      label: 'utilization',
      width: '180px',
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <BarFill percent={r.contextUtilizationPct ?? 0} />
          <span
            style={{
              fontFamily: 'var(--font-v3-mono)',
              fontSize: 'var(--v3-t-meta)',
              color:
                utilTone(r.contextUtilizationPct) === 'err'
                  ? 'var(--err)'
                  : utilTone(r.contextUtilizationPct) === 'warn'
                    ? 'var(--warn)'
                    : 'var(--fg-1)',
              minWidth: 50,
              textAlign: 'right',
            }}
          >
            {r.contextUtilizationPct != null
              ? `${r.contextUtilizationPct.toFixed(1)}%`
              : '—'}
          </span>
        </span>
      ),
    },
    { key: 'msg', label: 'msgs', align: 'right', className: 'num', render: (r) => (r.messageCount ?? 0).toLocaleString() },
  ]

  return (
    <>
      <SectionBar title="context window utilization" />
      {ctxQ.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/context-metrics</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="sessions tracked"
          value={ctxQ.isLoading ? '…' : (stats.totalSessions ?? sessions.length).toLocaleString()}
          sub="active or recent"
        />
        <Kpi
          label="avg utilization"
          value={
            ctxQ.isLoading
              ? '…'
              : typeof stats.avgUtilization === 'number'
                ? `${stats.avgUtilization.toFixed(1)}%`
                : '—'
          }
          sub="across visible sessions"
          tone={
            typeof stats.avgUtilization === 'number'
              ? utilTone(stats.avgUtilization)
              : 'default'
          }
        />
        <Kpi
          label="over 90%"
          value={ctxQ.isLoading ? '…' : (stats.sessionsOver90 ?? 0).toLocaleString()}
          sub={`${(stats.sessionsOver70 ?? 0).toLocaleString()} over 70%`}
          tone={(stats.sessionsOver90 ?? 0) > 0 ? 'err' : 'default'}
        />
        <Kpi
          label="compactions (24h)"
          value={
            compQ.isLoading
              ? '…'
              : (comp.summary?.last24h ?? 0).toLocaleString()
          }
          sub={`${(comp.summary?.totalCompactions ?? 0).toLocaleString()} total · ${(comp.byLevel?.aggressive ?? 0).toLocaleString()} aggressive`}
        />
      </KpiGrid>

      <SectionBar title="usage distribution" />
      <Panel>
        <PanelHead title="sessions by utilization bucket" count={distTotal} />
        {compQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : compQ.isError ? (
          <EmptyInline pad>failed to fetch /api/admin/context-metrics/compaction</EmptyInline>
        ) : distTotal === 0 ? (
          <EmptyInline pad>no usage distribution data yet</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="bar-h"
              data={distChart}
              height={160}
              yFormat={(v) => v.toLocaleString()}
            />
          </div>
        )}
      </Panel>

      <SectionBar title="high-utilization sessions" />
      <Panel>
        <PanelHead title="top by utilization" count={sessions.length} />
        {ctxQ.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : sessions.length === 0 ? (
          <EmptyInline pad>no session metrics in the current window</EmptyInline>
        ) : (
          <Dt
            columns={cols}
            rows={sessions}
            rowKey={(r) => r.sessionId ?? `${r.userId}-${r.updatedAt ?? ''}`}
          />
        )}
      </Panel>
    </>
  )
}

export default ContextPane
