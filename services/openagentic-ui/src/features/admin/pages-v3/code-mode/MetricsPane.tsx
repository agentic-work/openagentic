import * as React from 'react'
import {
  Panel,
  PanelHead,
  MetricChart,
  Banner,
  EmptyInline,
  KpiGrid,
  Kpi,
  SectionBar,
} from '../../primitives-v3'
import {
  useDashboardMetrics,
  useCodeModeSessions,
  type TimeSeriesPoint,
  type CodeModeSessionRow,
} from '../../hooks/useDashboardMetrics'

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

function pointsToSeries(points: TimeSeriesPoint[] | undefined): {
  data: number[]
  labels: string[]
} {
  const arr = points ?? []
  return {
    data: arr.map((p) => Number.isFinite(p.value) ? p.value : 0),
    labels: arr.map((p) => {
      const d = new Date(p.timestamp)
      const z = (n: number) => String(n).padStart(2, '0')
      return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
    }),
  }
}

export const MetricsPane: React.FC = () => {
  const metrics = useDashboardMetrics('24h')
  const sessions = useCodeModeSessions()

  const summary = metrics.data?.summary
  const ts = metrics.data?.timeSeries
  const tok = pointsToSeries(ts?.codeTokenUsage)
  const ses = pointsToSeries(ts?.codeSessions)

  // Top model usage from live sessions (no dedicated openagentic-metrics
  // endpoint; this gives a present-tense snapshot rather than 24h).
  const modelBars = React.useMemo(() => {
    const arr: CodeModeSessionRow[] = sessions.data?.sessions ?? []
    const tally = new Map<string, number>()
    for (const s of arr) {
      const k = s.model ?? '—'
      tally.set(k, (tally.get(k) ?? 0) + 1)
    }
    return Array.from(tally.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [sessions.data])

  return (
    <>
      <SectionBar
        title="code mode kpis (24h)"
        right={<span style={{ color: 'var(--fg-3)' }}>/api/admin/dashboard/metrics</span>}
      />
      {metrics.isError && (
        <Banner level="err" label="error">
          failed to load <span className="accent">/api/admin/dashboard/metrics</span>
        </Banner>
      )}
      <KpiGrid cols={4}>
        <Kpi
          label="sessions"
          value={metrics.isLoading ? '…' : fmtNum(summary?.totalCodeSessions)}
          sub="last 24h"
        />
        <Kpi
          label="messages"
          value={metrics.isLoading ? '…' : fmtNum(summary?.totalCodeMessages)}
          sub="last 24h"
        />
        <Kpi
          label="tokens"
          value={metrics.isLoading ? '…' : fmtNum(summary?.totalCodeTokens)}
          sub="last 24h"
        />
        <Kpi
          label="cost"
          value={metrics.isLoading ? '…' : fmtUsd(summary?.totalCodeCost)}
          sub="last 24h"
        />
      </KpiGrid>

      <SectionBar title="time series" />
      <Panel>
        <PanelHead title="Code-mode tokens" count={`${tok.data.length} pts`} />
        {metrics.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : tok.data.length === 0 ? (
          <EmptyInline pad>no code-mode token activity in the last 24h</EmptyInline>
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
        <PanelHead title="Code-mode sessions" count={`${ses.data.length} pts`} />
        {metrics.isLoading ? (
          <EmptyInline pad>loading…</EmptyInline>
        ) : ses.data.length === 0 ? (
          <EmptyInline pad>no code-mode session activity in the last 24h</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="area"
              series={[{ name: 'sessions', data: ses.data, color: 'ok' }]}
              xLabels={ses.labels}
              height={180}
            />
          </div>
        )}
      </Panel>

      <SectionBar
        title="model mix"
        right={<span style={{ color: 'var(--fg-3)' }}>live sessions · not 24h</span>}
      />
      <Panel>
        <PanelHead title="Sessions by model" count={modelBars.length} />
        {sessions.isLoading ? (
          <EmptyInline pad>loading sessions…</EmptyInline>
        ) : sessions.isError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/code/sessions</span>
          </Banner>
        ) : modelBars.length === 0 ? (
          <EmptyInline pad>no live sessions to bin by model</EmptyInline>
        ) : (
          <div style={{ padding: '8px 12px' }}>
            <MetricChart
              variant="bar-h"
              data={modelBars.map((b) => ({ name: b.name, value: b.value, color: 'accent' }))}
              height={Math.max(120, modelBars.length * 24)}
            />
          </div>
        )}
      </Panel>
    </>
  )
}
