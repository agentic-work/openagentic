import * as React from 'react'
import {
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  Panel,
  PanelHead,
  SectionBar,
  MetricChart,
  BarList,
} from '../../primitives-v3'
import {
  useDashboardMetrics,
  type TimeSeriesPoint,
} from '../../hooks/useDashboardMetrics'

const fmtNum = (n: number | undefined | null): string =>
  typeof n !== 'number'
    ? '—'
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}K`
        : String(n)

const fmtUsd = (n: number | undefined | null): string =>
  typeof n === 'number' ? `$${n.toFixed(2)}` : '—'

function pointsToSeries(points: TimeSeriesPoint[] | undefined): {
  data: number[]
  labels: string[]
} {
  const arr = points ?? []
  return {
    data: arr.map((p) => (Number.isFinite(p.value) ? p.value : 0)),
    labels: arr.map((p) => {
      const d = new Date(p.timestamp)
      const z = (n: number) => String(n).padStart(2, '0')
      return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
    }),
  }
}

export const AnalyticsPane: React.FC = () => {
  // useDashboardMetrics now maps /api/admin/dashboard/counts → summary shape
  const dash = useDashboardMetrics('24h')
  const summary = dash.data?.summary
  const ts = dash.data?.timeSeries

  const tok = pointsToSeries(ts?.tokenUsage)
  const sess = pointsToSeries(ts?.sessions)
  const msg = pointsToSeries(ts?.messages)

  const modelBars = (dash.data?.modelUsage ?? [])
    .slice(0, 10)
    .map((m) => ({
      name: m.model,
      value: m.tokens,
      display: fmtNum(m.tokens),
    }))

  return (
    <>
      <SectionBar
        title="usage analytics"
        right={<span style={{ color: 'var(--fg-3)' }}>/api/admin/dashboard/counts</span>}
      />

      {dash.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/dashboard/counts</span>
        </Banner>
      )}

      <KpiGrid cols={4}>
        <Kpi
          label="sessions"
          value={dash.isLoading ? '…' : fmtNum(summary?.totalSessions)}
          sub={`${(summary?.activeUsers ?? 0).toLocaleString()} active users`}
        />
        <Kpi
          label="messages"
          value={dash.isLoading ? '…' : fmtNum(summary?.totalMessages)}
          sub={`${(summary?.totalApiRequests ?? 0).toLocaleString()} api reqs`}
        />
        <Kpi
          label="tokens"
          value={dash.isLoading ? '…' : fmtNum(summary?.totalTokens)}
          sub="prompt + completion"
        />
        <Kpi
          label="cost"
          value={dash.isLoading ? '…' : fmtUsd(summary?.totalCost)}
          sub={`${(summary?.totalMcpCalls ?? 0).toLocaleString()} mcp calls`}
        />
      </KpiGrid>

      <SectionBar title="token usage over time" />
      <Panel>
        <PanelHead title="tokens (24h)" count={`${tok.data.length} pts`} />
        {dash.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : tok.data.length === 0 ? (
          <EmptyInline pad>no token activity in the last 24h</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="area"
              series={[{ name: 'tokens', data: tok.data, color: 'accent' }]}
              xLabels={tok.labels}
              yFormat="tok"
              height={180}
            />
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead title="sessions + messages (24h)" count={`${sess.data.length} pts`} />
        {dash.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : sess.data.length === 0 && msg.data.length === 0 ? (
          <EmptyInline pad>no session activity in the last 24h</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="area"
              series={[
                { name: 'sessions', data: sess.data, color: 'ok' },
                { name: 'messages', data: msg.data, color: 'info' },
              ]}
              xLabels={sess.labels.length ? sess.labels : msg.labels}
              showLegend
              height={180}
            />
          </div>
        )}
      </Panel>

      <SectionBar title="top models by tokens" />
      <Panel>
        <PanelHead title="model mix" count={modelBars.length} />
        {dash.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : modelBars.length === 0 ? (
          <EmptyInline pad>no per-model usage in the current window</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <BarList items={modelBars} />
          </div>
        )}
      </Panel>
    </>
  )
}

export default AnalyticsPane
