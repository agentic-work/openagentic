/**
 * AnalyticsPanes — real Prometheus-backed time-series panes for the V3
 * dashboard. Replaces the old "Detailed time-series analytics … aren't
 * available yet" placeholders.
 *
 * Each pane runs PromQL range queries (via usePromRange → /api/admin/prom)
 * against the gen_ai.* / http_* / openagentic_* metrics the api emits
 * (see api/src/metrics) and renders them with the theme-aware <MetricChart>.
 * Queries live in ./llm-performance/promQueries.ts (single source of truth).
 *
 * Charts that have no samples yet (a metric whose activity hasn't happened
 * on this deployment) render a neutral "awaiting data" state inside the
 * chart frame — never a "feature missing" placeholder. They populate live
 * as traffic flows. All colors come from theme ColorTokens (no literals).
 */
import * as React from 'react'
import {
  Panel,
  PanelHead,
  SectionBar,
  EmptyInline,
  MetricChart,
  type ColorToken,
} from '../primitives-v3'
import { usePromRange, usePromInstant, type PromSample } from '../hooks/useProm'
import * as Q from './llm-performance/promQueries'
import type { TimeWindow } from './llm-performance/promQueries'

// ── window → minutes for usePromRange ───────────────────────────────────────
const WINDOW_MIN: Record<TimeWindow, number> = {
  '1h': 60, '6h': 360, '12h': 720, '24h': 1440, '7d': 10080, '30d': 43200, '90d': 129600,
}

// Series colors cycled across multi-series charts.
const PALETTE: ColorToken[] = ['accent', 'info', 'ok', 'warn', 'err', 'fg-2']

// ── helpers ─────────────────────────────────────────────────────────────────
const num = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const hhmm = (t: number): string => {
  const d = new Date(t * 1000)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`
}

/** Build a unified time axis across all series, aligning each to it (gap → 0). */
function toAlignedSeries(
  samples: PromSample[] | undefined,
  nameOf: (s: PromSample, i: number) => string,
  opts: { scale?: number; colors?: ColorToken[] } = {},
): { series: Array<{ name: string; data: number[]; color: ColorToken }>; xLabels: string[]; hasData: boolean } {
  const arr = (samples ?? []).filter((s) => (s.values?.length ?? 0) > 0)
  const scale = opts.scale ?? 1
  const colors = opts.colors ?? PALETTE
  if (arr.length === 0) return { series: [], xLabels: [], hasData: false }

  const tsSet = new Set<number>()
  for (const s of arr) for (const [t] of s.values ?? []) tsSet.add(t)
  const ts = [...tsSet].sort((a, b) => a - b)
  const xLabels = ts.map(hhmm)

  const series = arr.map((s, i) => {
    const m = new Map<number, number>((s.values ?? []).map(([t, v]) => [t, num(v) * scale]))
    return {
      name: nameOf(s, i),
      color: colors[i % colors.length],
      data: ts.map((t) => m.get(t) ?? 0),
    }
  })
  const hasData = series.some((s) => s.data.some((v) => v !== 0))
  return { series, xLabels, hasData }
}

const labelName = (...keys: string[]) => (s: PromSample, i: number): string => {
  for (const k of keys) {
    const v = s.metric?.[k]
    if (v) return shortModel(v)
  }
  return `series ${i + 1}`
}
// Trim verbose provider/model ids → last dotted segment for legend readability.
const shortModel = (v: string): string => {
  const last = v.split('.').pop() ?? v
  return last.replace(/-v\d+:\d+$/, '').slice(0, 28)
}

// ── RangeChart — one PromQL range query → one themed chart, with states ──────
interface RangeChartProps {
  title: string
  hint?: string
  query: string
  window: TimeWindow
  variant?: 'line' | 'area' | 'stacked-area'
  nameOf?: (s: PromSample, i: number) => string
  colors?: ColorToken[]
  yFormat?: 'ms' | 'tok' | 'usd' | 'pct'
  scale?: number
  height?: number
  showLegend?: boolean
  /**
   * Metric noun for the calm present-but-zero note (e.g. "errors"). When the
   * series IS present but every sample is zero, this is a legitimately-quiet
   * healthy window — we render the chart as a flat ZERO LINE with a
   * "no <metric> in this window" note instead of the misleading
   * "awaiting data" placeholder (which should only mean the metric is ABSENT).
   * Set on charts that are healthy when zero (errors, failures).
   */
  zeroMetric?: string
}
// Cards on the analytics page fill their grid row; a taller chart fills the
// card so it is never a small letterboxed strip in a big frame.
const RANGE_CHART_HEIGHT = 340

const RangeChart: React.FC<RangeChartProps> = ({
  title, hint, query, window, variant = 'area', nameOf = labelName('model', 'provider'),
  colors, yFormat, scale, height = RANGE_CHART_HEIGHT, showLegend = true, zeroMetric,
}) => {
  const q = usePromRange(query, { minutes: WINDOW_MIN[window] })
  const { series, xLabels, hasData } = toAlignedSeries(q.data, nameOf, { scale, colors })

  // Distinguish the two empty cases:
  //   • metricPresent === false → the metric has NO samples at all (absent)
  //     → "awaiting data" (it populates as that activity first happens).
  //   • metricPresent === true && !hasData → present but every value is zero
  //     → for healthy-when-zero metrics (zeroMetric set) draw a flat ZERO
  //       LINE with a calm note; otherwise fall back to "awaiting data".
  const metricPresent = series.length > 0
  const presentButZero = metricPresent && !hasData
  const renderZeroLine = presentButZero && !!zeroMetric

  const chartNote =
    !hasData && zeroMetric ? `no ${zeroMetric} in this window` : undefined

  return (
    <Panel glass>
      <PanelHead
        title={title}
        right={
          (hint || chartNote) ? (
            <span style={{ color: 'var(--fg-3)', fontSize: 11 }}>{chartNote ?? hint}</span>
          ) : undefined
        }
      />
      {q.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : q.isError ? (
        <EmptyInline pad>prom query failed</EmptyInline>
      ) : hasData || renderZeroLine ? (
        <div className="aw-chart-body" style={{ padding: '8px 12px' }}>
          <MetricChart
            variant={variant}
            series={series}
            xLabels={xLabels}
            yFormat={yFormat}
            height={height}
            showLegend={showLegend}
            expandTitle={title}
          />
        </div>
      ) : (
        <EmptyInline pad>awaiting data — populates as activity flows</EmptyInline>
      )}
    </Panel>
  )
}

// ── RankChart — instant top-N query → horizontal bar rank list ───────────────
const RankChart: React.FC<{ title: string; query: string; nameKey: string; color?: ColorToken }> = ({
  title, query, nameKey, color = 'accent',
}) => {
  const q = usePromInstant(query)
  const data = (q.data ?? [])
    .map((s) => ({ name: shortModel(s.metric?.[nameKey] ?? '—'), value: num(s.value?.[1]), color }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
  return (
    <Panel glass>
      <PanelHead title={title} />
      {q.isLoading ? (
        <EmptyInline pad>loading…</EmptyInline>
      ) : data.length === 0 ? (
        <EmptyInline pad>awaiting data — populates as activity flows</EmptyInline>
      ) : (
        <div className="aw-chart-body" style={{ padding: '8px 12px' }}>
          <MetricChart variant="bar-h" data={data} height={Math.max(240, data.length * 30)} />
        </div>
      )}
    </Panel>
  )
}

const Stack: React.FC<{ children: React.ReactNode; minRow?: number }> = ({ children, minRow = 400 }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
      // Rows are tall enough that the taller chart fills its glass card and the
      // card never collapses to a small letterboxed strip. The panel stretches
      // to the row height (aw-panel--glass { height: 100% }) so the chart body
      // fills the remaining space under the header.
      gridAutoRows: `minmax(${minRow}px, auto)`,
      alignItems: 'stretch',
      gap: 16,
    }}
  >
    {children}
  </div>
)

// Raw queries for metrics not in promQueries.ts (http_* / openagentic_* / v3_*).
const rw = (w: TimeWindow) => Q.rateWindowFor(w)

// ════════════════════════════════════════════════════════════════════════════
// Section panes
// ════════════════════════════════════════════════════════════════════════════

export const UsageCostPane: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="usage & cost" />
    <Stack>
      <RangeChart title="tokens / sec by type" window={window} variant="stacked-area"
        query={Q.tokensRateByType(window)} nameOf={labelName('token_type')} yFormat="tok" />
      <RangeChart title="tokens / sec by model" window={window} variant="stacked-area"
        query={Q.tokensRateByModel(window)} nameOf={labelName('model', 'provider')} yFormat="tok" />
      <RangeChart title="subagent cost ($/sec)" window={window} variant="area"
        query={`sum(rate(v3_subagent_cost_usd_sum[${rw(window)}]))`} nameOf={() => 'cost'} yFormat="usd" colors={['ok']} />
      <RangeChart title="cache-read tokens / sec by model" window={window} variant="area"
        query={Q.cacheReadTokensRateByModel(window)} nameOf={labelName('model')} yFormat="tok" />
    </Stack>
  </>
)

export const LLMRouterPane: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="llm & router" />
    <Stack>
      <RangeChart title="operation latency p95 (ms) by model" window={window} variant="line" yFormat="ms" scale={1000}
        query={Q.operationDurationQuantile(window, 0.95)} nameOf={labelName('model', 'provider')} />
      <RangeChart title="request rate by model" window={window} variant="stacked-area"
        query={Q.requestRateByModel(window)} nameOf={labelName('model', 'provider')} />
      <RangeChart title="time-per-output-token p95 (ms)" window={window} variant="line" yFormat="ms" scale={1000}
        query={Q.tpotQuantile(window, 0.95)} nameOf={labelName('model')} />
      <RangeChart title="finish reasons / sec" window={window} variant="stacked-area"
        query={Q.finishReasonRate(window)} nameOf={labelName('finish_reason')}
        zeroMetric="completions" />
      <RangeChart title="errors / sec by class" window={window} variant="area"
        query={Q.errorRateByClass(window)} nameOf={labelName('error_class')} colors={['err', 'warn']}
        zeroMetric="errors" />
      <RangeChart title="router decision latency (ms)" window={window} variant="line"
        query={`histogram_quantile(0.95, sum by (le) (rate(openagentic_router_route_request_duration_ms_bucket[${rw(window)}])))`}
        nameOf={() => 'p95'} colors={['accent']} />
    </Stack>
  </>
)

export const FlowsAgentsPane: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="flows & agents" />
    <Stack>
      <RangeChart title="chat turns / sec by model" window={window} variant="stacked-area"
        query={Q.chatTurnsRateByModel(window)} nameOf={labelName('model')} />
      <RangeChart title="agent invocations / sec" window={window} variant="area"
        query={Q.agentInvocationsRateByAgent(window)} nameOf={labelName('agent_id')} />
      <RangeChart title="concurrent sub-agent dispatch" window={window} variant="area"
        query={`max(openagentic_subagent_concurrent_dispatch_count)`} nameOf={() => 'concurrent'} colors={['info']} />
      <RangeChart title="compaction tokens freed / sec" window={window} variant="area"
        query={`sum(rate(v3_compaction_tokens_freed_sum[${rw(window)}]))`} nameOf={() => 'freed'} yFormat="tok" colors={['ok']} />
    </Stack>
  </>
)

export const MCPToolsPane: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="mcp & tools" />
    <Stack>
      <RankChart title="top tools (by call rate)" query={Q.topToolsByCount(window)} nameKey="tool_name" />
      <RangeChart title="tool calls / sec by outcome" window={window} variant="stacked-area"
        query={`sum by (outcome) (rate(gen_ai_tool_calls_total[${rw(window)}]))`} nameOf={labelName('outcome')}
        colors={['ok', 'err']} zeroMetric="tool calls" />
    </Stack>
  </>
)

export const InfraPerfPane: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="infra & perf" />
    <Stack>
      <RangeChart title="http requests / sec" window={window} variant="area"
        query={`sum(rate(http_requests_total[${rw(window)}]))`} nameOf={() => 'req/s'} colors={['accent']} />
      <RangeChart title="http latency p95 (ms)" window={window} variant="line" yFormat="ms" scale={1000}
        query={`histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[${rw(window)}])))`}
        nameOf={() => 'p95'} colors={['warn']} />
      <RangeChart title="http requests / sec by status" window={window} variant="stacked-area"
        query={`sum by (status_code) (rate(http_requests_total[${rw(window)}]))`} nameOf={labelName('status_code', 'status')} />
      <RangeChart title="hitl wait p95 (s)" window={window} variant="line"
        query={`histogram_quantile(0.95, sum by (le) (rate(openagentic_hitl_wait_seconds_bucket[${rw(window)}])))`}
        nameOf={() => 'p95'} colors={['info']} />
    </Stack>
  </>
)

// Compact analytics strip for the Overview tab (request rate + latency + errors).
export const OverviewAnalytics: React.FC<{ window: TimeWindow }> = ({ window }) => (
  <>
    <SectionBar title="analytics" />
    <Stack minRow={300}>
      <RangeChart title="request rate" window={window} variant="area"
        query={Q.requestRate(window)} nameOf={() => 'req/s'} colors={['accent']} height={240} />
      <RangeChart title="operation latency p95 (ms)" window={window} variant="line" yFormat="ms" scale={1000}
        query={Q.operationDurationQuantile(window, 0.95)} nameOf={labelName('model')} height={240} />
      <RangeChart title="error rate (%)" window={window} variant="area" yFormat="pct"
        query={`(${Q.errorPercent(window)}) / 100`} nameOf={() => 'error %'} colors={['err']} height={240}
        zeroMetric="errors" />
    </Stack>
  </>
)
