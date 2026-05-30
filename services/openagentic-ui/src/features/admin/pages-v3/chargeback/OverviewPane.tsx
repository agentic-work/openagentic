import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  Banner,
  MetricChart,
  type ChartSeries,
  SectionBar,
} from '../../primitives-v3'
import {
  type DashboardMetricsCostShape,
  type UsageSummary,
  type UsageByUserRow,
  type UsageByGroupRow,
  fmtUsd,
  fmtNum,
} from './hooks'

const PALETTE: ChartSeries['color'][] = ['accent', 'ok', 'warn', 'info', 'err']

export interface OverviewPaneProps {
  usage?: UsageSummary
  usageLoading: boolean
  usageError: boolean
  dashboard?: DashboardMetricsCostShape
  dashboardLoading: boolean
  dashboardError: boolean
}

export const OverviewPane: React.FC<OverviewPaneProps> = ({
  usage,
  usageLoading,
  usageError,
  dashboard,
  dashboardLoading,
  dashboardError,
}) => {
  // Build the stacked-area series from costByModel — top 5 models, each
  // its own colored band. Time labels are the bucket timestamps.
  const { series, xLabels } = React.useMemo(() => {
    const cbm = dashboard?.costByModel ?? []
    if (cbm.length === 0) return { series: [], xLabels: [] as string[] }
    // Pick the top 5 by sum, drop the rest — we don't draw 30 bands.
    const summed = cbm.map((s) => ({
      model: s.model,
      total: s.data.reduce((a, p) => a + (p.value ?? 0), 0),
      data: s.data,
    }))
    summed.sort((a, b) => b.total - a.total)
    const top = summed.slice(0, 5).filter((s) => s.total > 0)
    if (top.length === 0) return { series: [], xLabels: [] }
    const labels = top[0].data.map((p) => {
      try {
        const d =
          typeof p.timestamp === 'string'
            ? new Date(p.timestamp)
            : new Date(p.timestamp)
        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      } catch {
        return String(p.timestamp)
      }
    })
    const out: ChartSeries[] = top.map((s, i) => ({
      name: s.model.length > 28 ? `${s.model.slice(0, 25)}…` : s.model,
      color: PALETTE[i % PALETTE.length],
      stackId: '1',
      data: s.data.map((p) => p.value ?? 0),
    }))
    return { series: out, xLabels: labels }
  }, [dashboard])

  // Top-N users / groups — prefer chargeback/usage; fall back to dashboard.
  const topUsers: UsageByUserRow[] = React.useMemo(() => {
    const direct = usage?.byUser
    if (direct && direct.length) {
      return [...direct].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 10)
    }
    const fallback = dashboard?.perUserUsage
    if (!fallback) return []
    return fallback
      .map((u) => ({
        userId: u.userId,
        email: u.email,
        name: u.displayName ?? u.name ?? u.email,
        cost: u.cost ?? 0,
        tokens: u.tokens ?? 0,
        requests: 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
  }, [usage, dashboard])

  const topGroups: UsageByGroupRow[] = React.useMemo(() => {
    const direct = usage?.byGroup
    if (!direct) return []
    return [...direct].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 10)
  }, [usage])

  const userCols: DtCol<UsageByUserRow>[] = [
    {
      key: 'name',
      label: 'USER',
      className: 'name',
      render: (r) => (
        <>
          <div style={{ color: 'var(--fg-0)' }}>{r.name}</div>
          {r.email && r.email !== r.name && (
            <div style={{ color: 'var(--fg-3)', fontSize: 10, fontFamily: 'var(--font-v3-mono)' }}>
              {r.email}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'cost',
      label: 'COST',
      className: 'num',
      render: (r) => fmtUsd(r.cost),
    },
    {
      key: 'tokens',
      label: 'TOKENS',
      className: 'num',
      render: (r) => fmtNum(r.tokens),
    },
    {
      key: 'requests',
      label: 'REQ',
      className: 'num',
      render: (r) => (r.requests ? fmtNum(r.requests) : '—'),
    },
  ]

  const groupCols: DtCol<UsageByGroupRow>[] = [
    {
      key: 'name',
      label: 'GROUP',
      className: 'name',
      render: (r) => r.name,
    },
    {
      key: 'cost',
      label: 'COST',
      className: 'num',
      render: (r) => fmtUsd(r.cost),
    },
    {
      key: 'tokens',
      label: 'TOKENS',
      className: 'num',
      render: (r) => fmtNum(r.tokens),
    },
  ]

  return (
    <>
      {usageError && dashboardError && (
        <Banner level="err" label="error">
          both <span className="accent">/api/admin/chargeback/usage</span> and{' '}
          <span className="accent">/api/admin/dashboard/counts</span> unreachable — overview
          will be empty
        </Banner>
      )}

      <SectionBar title="cost trend (30d)" />
      <Panel>
        <PanelHead
          title="cost by model · stacked"
          count={series.length ? `${series.length} models` : ''}
          right={
            <span style={{ color: 'var(--fg-3)' }}>
              data · /api/admin/dashboard/counts?timeRange=30d
            </span>
          }
        />
        {dashboardLoading ? (
          <EmptyInline pad>loading 30-day cost timeseries…</EmptyInline>
        ) : dashboardError ? (
          <Banner level="err" label="error">
            failed to load /api/admin/dashboard/counts
          </Banner>
        ) : series.length === 0 ? (
          <EmptyInline pad>
            no cost-by-model data in the trailing 30 days
          </EmptyInline>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <MetricChart
              variant="area"
              series={series}
              xLabels={xLabels}
              yFormat="usd"
              height={220}
              showLegend
            />
          </div>
        )}
      </Panel>

      <SectionBar title="top users (by cost)" count={topUsers.length} />
      <Panel>
        <PanelHead title="users" count={topUsers.length} />
        {usageLoading && dashboardLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : topUsers.length === 0 ? (
          <EmptyInline pad>no per-user cost data in the current window</EmptyInline>
        ) : (
          <Dt columns={userCols} rows={topUsers} rowKey={(r) => r.userId} />
        )}
      </Panel>

      <SectionBar title="top groups (by cost)" count={topGroups.length} />
      <Panel>
        <PanelHead title="groups" count={topGroups.length} />
        {usageLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : topGroups.length === 0 ? (
          <EmptyInline pad>
            no per-group cost data — /api/admin/chargeback/usage returned no byGroup
          </EmptyInline>
        ) : (
          <Dt columns={groupCols} rows={topGroups} rowKey={(r) => r.groupId} />
        )}
      </Panel>
    </>
  )
}
