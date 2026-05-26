/**
 * LLM Performance pane — live gen_ai.* metrics from the existing
 * /api/admin/prom proxy. Wires into Dashboard as a new top-level
 * Subtab. Every chart is real-time (30s refetch) and reads PromQL
 * queries from ./promQueries — single source of truth.
 *
 * Sections (DC3-numbered):
 *   01 SLOs            — TTFT p95 / TPOT p95 / req/s / error % big numbers
 *   02 Latency         — TTFT + TPOT p50/p95/p99 over time per model
 *   03 Throughput      — req/s by model + token rate by model (stacked)
 *   04 Reliability     — finish_reason distribution + error class breakdown
 *   05 Operations      — chat turns + tool dispatch + sub-agent invocations
 *                        (F2 / 2026-05-12 — OTel GenAI v1.37 semconv)
 */
import * as React from 'react'
import {
  SectionBar,
  Panel,
  PanelHead,
  ScoringStrip,
  Score,
  KpiGrid,
  Kpi,
  Banner,
  EmptyInline,
  MetricChart,
  Grid,
} from '../../primitives-v3'
import { usePromInstant, usePromRange, type PromSample } from '../../hooks/useProm'
import {
  type TimeWindow,
  ttftQuantile,
  tpotQuantile,
  operationDurationQuantile,
  requestRate,
  requestRateByModel,
  tokensRateByType,
  cacheHitRate,
  finishReasonRate,
  errorRateByClass,
  errorPercent,
  chatTurnsRateByModel,
  toolCallsRateByTool,
  topToolsByCount,
  toolErrorPercent,
  agentInvocationsRateByAgent,
  agentErrorPercent,
  avgInputTokensByModel,
  avgOutputTokensByModel,
  cacheReadTokensRateByModel,
} from './promQueries'

interface Props {
  timeRange: TimeWindow
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const fmtMs = (s: number | null): string =>
  s == null || !Number.isFinite(s) ? '—' : `${Math.round(s * 1000)}ms`
const fmtPct = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}%`
const fmtRate = (n: number | null, unit: string = '/s'): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}${unit}`

/** Read the first PromSample's instant value as a number. */
function firstInstantNumber(rows: PromSample[] | undefined): number | null {
  if (!rows || rows.length === 0) return null
  const v = rows[0]?.value?.[1]
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Sum across instant samples (for "total req/s"). */
function sumInstantNumbers(rows: PromSample[] | undefined): number | null {
  if (!rows || rows.length === 0) return null
  let total = 0
  for (const r of rows) {
    const n = Number(r?.value?.[1] ?? 'NaN')
    if (Number.isFinite(n)) total += n
  }
  return total
}

/** Convert a range-query series into MetricChart-compatible {data,labels}. */
function rangeToSeries(rows: PromSample[] | undefined): {
  series: Array<{ name: string; data: number[]; color: 'accent' | 'ok' | 'warn' | 'err' | 'info' }>
  xLabels: string[]
} {
  if (!rows || rows.length === 0) return { series: [], xLabels: [] }
  // Use the first row's timestamps as the x axis (assume aligned step).
  const first = rows[0]
  const xs = first?.values ?? []
  const xLabels = xs.map(([ts]) => {
    const d = new Date(ts * 1000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const PALETTE: Array<'accent' | 'ok' | 'warn' | 'err' | 'info'> = ['accent', 'ok', 'warn', 'err', 'info']
  const series = rows.slice(0, 5).map((r, i) => {
    const data = (r.values ?? []).map(([, v]) => Number(v) || 0)
    const labelMeta = r.metric
    const name =
      labelMeta.model ?? labelMeta.token_type ?? labelMeta.finish_reason ?? labelMeta.error_class ?? `series ${i + 1}`
    return { name, data, color: PALETTE[i % PALETTE.length] }
  })
  return { series, xLabels }
}

const OUTCOME_PALETTE: Array<'accent' | 'ok' | 'warn' | 'info'> = ['accent', 'ok', 'warn', 'info']

/**
 * Range query → stacked series keyed by `${labelField} · ${outcome}`.
 * Error outcomes paint red regardless of palette position so users can
 * eyeball failure spikes against the success baseline.
 */
function buildSeriesByOutcome(
  rows: PromSample[] | undefined,
  labelField: 'tool_name' | 'agent_id',
  maxSeries: number,
): {
  series: Array<{ name: string; data: number[]; color: 'accent' | 'ok' | 'warn' | 'err' | 'info' }>
  xLabels: string[]
} {
  if (!rows || rows.length === 0) return { series: [], xLabels: [] }
  const xs = rows[0]?.values ?? []
  const xLabels = xs.map(([ts]) => {
    const d = new Date(ts * 1000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const series = rows.slice(0, maxSeries).map((r, i) => {
    const data = (r.values ?? []).map(([, v]) => Number(v) || 0)
    const label = String(r.metric[labelField] ?? 'unknown')
    const outcome = String(r.metric.outcome ?? 'success')
    const color: 'accent' | 'ok' | 'warn' | 'err' | 'info' =
      outcome === 'error' ? 'err' : OUTCOME_PALETTE[i % OUTCOME_PALETTE.length]
    return { name: `${label} · ${outcome}`, data, color }
  })
  return { series, xLabels }
}

// ──────────────────────────────────────────────────────────────────────────
// Pane
// ──────────────────────────────────────────────────────────────────────────

export const LLMPerformancePane: React.FC<Props> = ({ timeRange }) => {
  // INSTANT (big-number tiles)
  const ttftP95 = usePromInstant(ttftQuantile(timeRange, 0.95))
  const tpotP95 = usePromInstant(tpotQuantile(timeRange, 0.95))
  const totalReqRate = usePromInstant(requestRate(timeRange))
  const cacheHit = usePromInstant(cacheHitRate(timeRange))
  const errPct = usePromInstant(errorPercent(timeRange))

  // RANGE (over-time charts) — windowed to the dashboard's selector.
  const minutes = (() => {
    switch (timeRange) {
      case '1h':  return 60
      case '6h':  return 360
      case '12h': return 720
      case '24h': return 1440
      case '7d':  return 7 * 1440
      case '30d': return 30 * 1440
      case '90d': return 90 * 1440
    }
  })()

  const ttftRange = usePromRange(ttftQuantile(timeRange, 0.95), { minutes })
  const tpotRange = usePromRange(tpotQuantile(timeRange, 0.95), { minutes })
  const opDurRange = usePromRange(operationDurationQuantile(timeRange, 0.95), { minutes })
  const reqByModel = usePromRange(requestRateByModel(timeRange), { minutes })
  const tokByType = usePromRange(tokensRateByType(timeRange), { minutes })
  const finReason = usePromRange(finishReasonRate(timeRange), { minutes })
  const errByClass = usePromRange(errorRateByClass(timeRange), { minutes })

  // F2 — operations: chat / tool / agent counters
  // Coerce null → 0 via `OR on() vector(0)` so a freshly-deployed api pod
  // that hasn't seen a chat / tool / agent event yet still shows 0.00/s
  // instead of a dash. Without the OR, an absent metric series collapses
  // the whole expression to no-data — the user reads dashes and assumes
  // the dashboard is broken (2026-05-25 audit).
  const chatTurnsInst = usePromInstant(`sum(rate(gen_ai_chat_turns_total[5m])) OR on() vector(0)`)
  const toolCallsInst = usePromInstant(`sum(rate(gen_ai_tool_calls_total[5m])) OR on() vector(0)`)
  const agentInvInst = usePromInstant(`sum(rate(gen_ai_agent_invocations_total[5m])) OR on() vector(0)`)
  const toolErrInst = usePromInstant(toolErrorPercent(timeRange))
  const agentErrInst = usePromInstant(agentErrorPercent(timeRange))
  const chatTurnsRange = usePromRange(chatTurnsRateByModel(timeRange), { minutes })
  const toolCallsRange = usePromRange(toolCallsRateByTool(timeRange), { minutes })
  const topToolsInst = usePromInstant(topToolsByCount(timeRange))
  const agentInvRange = usePromRange(agentInvocationsRateByAgent(timeRange), { minutes })
  const avgInRange = usePromRange(avgInputTokensByModel(timeRange), { minutes })
  const avgOutRange = usePromRange(avgOutputTokensByModel(timeRange), { minutes })
  const cacheReadRange = usePromRange(cacheReadTokensRateByModel(timeRange), { minutes })

  const anyError = [ttftP95, tpotP95, totalReqRate, cacheHit, errPct].some((q) => q.isError)
  const ttftP95Val = firstInstantNumber(ttftP95.data)
  const tpotP95Val = firstInstantNumber(tpotP95.data)
  const totalReqRateVal = sumInstantNumbers(totalReqRate.data)
  const cacheHitVal = firstInstantNumber(cacheHit.data)
  const errPctVal = firstInstantNumber(errPct.data)

  // tone bias for SLO tiles
  const ttftTone: 'ok' | 'warn' | 'err' | 'default' =
    ttftP95Val == null ? 'default' : ttftP95Val > 5 ? 'err' : ttftP95Val > 2 ? 'warn' : 'ok'
  const errTone: 'ok' | 'warn' | 'err' | 'default' =
    errPctVal == null ? 'default' : errPctVal > 5 ? 'err' : errPctVal > 1 ? 'warn' : 'ok'

  const ttftSeries = rangeToSeries(ttftRange.data)
  const tpotSeries = rangeToSeries(tpotRange.data)
  const opDurSeries = rangeToSeries(opDurRange.data)
  const reqByModelSeries = rangeToSeries(reqByModel.data)
  const tokByTypeSeries = rangeToSeries(tokByType.data)
  const finReasonSeries = rangeToSeries(finReason.data)
  const errByClassSeries = rangeToSeries(errByClass.data)

  // F2 (2026-05-12) derived
  const chatTurnsVal = sumInstantNumbers(chatTurnsInst.data)
  const toolCallsVal = sumInstantNumbers(toolCallsInst.data)
  const agentInvVal = sumInstantNumbers(agentInvInst.data)
  const toolErrVal = firstInstantNumber(toolErrInst.data)
  const agentErrVal = firstInstantNumber(agentErrInst.data)
  const chatTurnsSeries = rangeToSeries(chatTurnsRange.data)
  const avgInSeries = rangeToSeries(avgInRange.data)
  const avgOutSeries = rangeToSeries(avgOutRange.data)
  const cacheReadSeries = rangeToSeries(cacheReadRange.data)
  const toolErrTone: 'ok' | 'warn' | 'err' | 'default' =
    toolErrVal == null ? 'default' : toolErrVal > 10 ? 'err' : toolErrVal > 2 ? 'warn' : 'ok'
  const agentErrTone: 'ok' | 'warn' | 'err' | 'default' =
    agentErrVal == null ? 'default' : agentErrVal > 10 ? 'err' : agentErrVal > 2 ? 'warn' : 'ok'
  const toolCallsSeries = buildSeriesByOutcome(toolCallsRange.data, 'tool_name', 8)
  const agentInvSeries = buildSeriesByOutcome(agentInvRange.data, 'agent_id', 5)
  // top tools instant rows (descending by rate)
  const topToolRows = (topToolsInst.data ?? [])
    .map((r) => ({ name: String(r.metric.tool_name ?? 'unknown'), rate: Number(r?.value?.[1] ?? 'NaN') }))
    .filter((r) => Number.isFinite(r.rate) && r.rate > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10)

  return (
    <>
      {anyError && (
        <Banner level="err" label="error">
          /api/admin/prom unreachable — values below may be stale
        </Banner>
      )}

      <SectionBar title="01 · service-level objectives" right={<span style={{ color: 'var(--fg-3)' }}>live · 30s refresh · {timeRange}</span>} />
      <ScoringStrip cols={5}>
        <Score
          label="TTFT p95"
          value={fmtMs(ttftP95Val)}
          tone={ttftTone}
          tip="Time To First Token (p95) — 95% of chat requests start streaming within this many ms after send. Lower is snappier UX. Anything > 2s feels sluggish; > 5s gets the error tone."
        />
        <Score
          label="TPOT p95"
          value={fmtMs(tpotP95Val)}
          tone={tpotP95Val != null && tpotP95Val > 0.25 ? 'err' : tpotP95Val != null && tpotP95Val > 0.1 ? 'warn' : 'ok'}
          tip="Time Per Output Token (p95) — average ms between tokens once the model starts generating. Inverse of tokens/sec. Lower = faster decode; > 250ms/tok is sluggish, > 100ms warn."
        />
        <Score
          label="req/sec"
          value={fmtRate(totalReqRateVal)}
          tip="Requests per second across all models in the selected window. Computed as rate(gen_ai_client_operation_duration_seconds_count)."
        />
        <Score
          label="cache hit"
          value={fmtPct(cacheHitVal)}
          tone={cacheHitVal != null && cacheHitVal > 30 ? 'ok' : cacheHitVal != null && cacheHitVal > 10 ? 'warn' : 'default'}
          tip="Anthropic prompt-cache hit rate = cached_tokens / (cached + input). Only Anthropic-family providers (Sonnet via Bedrock/AIF) support cache_control markers. Ollama / OpenAI-direct paths do not — they'll always show — / 0%."
        />
        <Score
          label="error %"
          value={fmtPct(errPctVal)}
          tone={errTone}
          tip="Share of requests that ended in an error class (timeout / rate_limit / 4xx / 5xx / network). Computed as errors_total / (requests + errors) × 100. Healthy is < 1%; warn at 1–5%; error tone above 5%."
        />
      </ScoringStrip>

      <SectionBar title="02 · latency over time" right={<span style={{ color: 'var(--fg-3)' }}>p95 across {timeRange}</span>} />
      <Grid cols={3}>
        <Panel>
          <PanelHead title="TTFT p95 by model" count={`${ttftSeries.series.length} series`} />
          {ttftRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : ttftSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => `${Math.round(v * 1000)}ms`} xLabels={ttftSeries.xLabels} series={ttftSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="TPOT p95 by model" count={`${tpotSeries.series.length} series`} />
          {tpotRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : tpotSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => `${(v * 1000).toFixed(1)}ms/tok`} xLabels={tpotSeries.xLabels} series={tpotSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="Request duration p95 by model" count={`${opDurSeries.series.length} series`} />
          {opDurRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : opDurSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => `${v.toFixed(1)}s`} xLabels={opDurSeries.xLabels} series={opDurSeries.series} showLegend />
            </div>
          )}
        </Panel>
      </Grid>

      <SectionBar title="03 · throughput" right={<span style={{ color: 'var(--fg-3)' }}>req/s + tokens/s · stacked by model</span>} />
      <Grid cols={2}>
        <Panel>
          <PanelHead title="Request rate by model" count={`${reqByModelSeries.series.length} models`} />
          {reqByModel.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : reqByModelSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={reqByModelSeries.xLabels} series={reqByModelSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="Token rate by direction" count={`${tokByTypeSeries.series.length} types`} right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>input · output · cached · reasoning</span>} />
          {tokByType.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : tokByTypeSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(0)} xLabels={tokByTypeSeries.xLabels} series={tokByTypeSeries.series} showLegend />
            </div>
          )}
        </Panel>
      </Grid>

      <SectionBar title="04 · reliability + quality" right={<span style={{ color: 'var(--fg-3)' }}>finish_reason · error class</span>} />
      <Grid cols={2}>
        <Panel>
          <PanelHead title="finish_reason distribution" count={`${finReasonSeries.series.length} reasons`} />
          {finReason.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : finReasonSeries.series.length === 0 ? (
            <EmptyInline pad>no traffic in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={finReasonSeries.xLabels} series={finReasonSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="errors by class" count={`${errByClassSeries.series.length} classes`} />
          {errByClass.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : errByClassSeries.series.length === 0 ? (
            <EmptyInline pad>no errors in window — good</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={errByClassSeries.xLabels} series={errByClassSeries.series} showLegend />
            </div>
          )}
        </Panel>
      </Grid>

      <SectionBar title="05 · operations" right={<span style={{ color: 'var(--fg-3)' }}>chat · tool · agent · OTel GenAI v1.37</span>} />
      <ScoringStrip cols={5}>
        <Score
          label="chat turns/s"
          value={fmtRate(chatTurnsVal)}
          tone={chatTurnsVal != null && chatTurnsVal > 0 ? 'ok' : 'default'}
          tip="Provider-stream completions per second. One increment per chatLoop turn (gen_ai_chat_turns_total). Doesn't count tool dispatches — see tool calls/s for those."
        />
        <Score
          label="tool calls/s"
          value={fmtRate(toolCallsVal)}
          tone={toolCallsVal != null && toolCallsVal > 0 ? 'ok' : 'default'}
          tip="OTel execute_tool spans per second across all tools (MCP + meta tools like tool_search, compose_visual, Task). gen_ai_tool_calls_total{outcome=ok|error}."
        />
        <Score
          label="agents/s"
          value={fmtRate(agentInvVal)}
          tone={agentInvVal != null && agentInvVal > 0 ? 'ok' : 'default'}
          tip="OTel invoke_agent spans per second — every sub-agent dispatch via the Task meta tool. gen_ai_agent_invocations_total{agent_id, outcome}."
        />
        <Score
          label="tool err %"
          value={fmtPct(toolErrVal)}
          tone={toolErrTone}
          tip="Share of tool dispatches that ended with outcome=error (vs ok). High = MCP server / network / permission issues. Healthy < 2%; warn at 2-10%; error at > 10%."
        />
        <Score
          label="agent err %"
          value={fmtPct(agentErrVal)}
          tone={agentErrTone}
          tip="Share of sub-agent invocations that ended with outcome=error. Reflects Task tool / sub-agent runtime failures. Healthy < 2%; warn 2-10%; error > 10%."
        />
      </ScoringStrip>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="chat turns by model" count={`${chatTurnsSeries.series.length} models`} />
          {chatTurnsRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : chatTurnsSeries.series.length === 0 ? (
            <EmptyInline pad>no chat turns in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={chatTurnsSeries.xLabels} series={chatTurnsSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="top tools by call rate" count={`${topToolRows.length} tools`} right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>topk(10)</span>} />
          {topToolsInst.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : topToolRows.length === 0 ? (
            <EmptyInline pad>no tool dispatches in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <table className="aw-inline-table" style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--fg-3)' }}>tool</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--fg-3)' }}>calls/s</th>
                    <th style={{ width: '40%', padding: '4px 8px', color: 'var(--fg-3)' }}>relative</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const max = topToolRows[0]?.rate ?? 1
                    return topToolRows.map((r) => (
                      <tr key={r.name}>
                        <td style={{ padding: '4px 8px', fontFamily: 'var(--font-mono, ui-monospace)' }}>{r.name}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.rate.toFixed(3)}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.max(2, (r.rate / max) * 100)}%`, background: 'var(--accent)' }} />
                          </div>
                        </td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Grid>
      <Grid cols={2}>
        <Panel>
          <PanelHead title="tool dispatch rate by name + outcome" count={`${toolCallsSeries.series.length} series`} />
          {toolCallsRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : toolCallsSeries.series.length === 0 ? (
            <EmptyInline pad>no tool dispatches in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={toolCallsSeries.xLabels} series={toolCallsSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="sub-agent invocations by agent + outcome" count={`${agentInvSeries.series.length} series`} />
          {agentInvRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : agentInvSeries.series.length === 0 ? (
            <EmptyInline pad>no agent invocations in window</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(2)} xLabels={agentInvSeries.xLabels} series={agentInvSeries.series} showLegend />
            </div>
          )}
        </Panel>
      </Grid>
      <Grid cols={3}>
        <Panel>
          <PanelHead title="avg input tokens / turn" count={`${avgInSeries.series.length} models`} />
          {avgInRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : avgInSeries.series.length === 0 ? (
            <EmptyInline pad>awaiting usage</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(0)} xLabels={avgInSeries.xLabels} series={avgInSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="avg output tokens / turn" count={`${avgOutSeries.series.length} models`} />
          {avgOutRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : avgOutSeries.series.length === 0 ? (
            <EmptyInline pad>awaiting usage</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(0)} xLabels={avgOutSeries.xLabels} series={avgOutSeries.series} showLegend />
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHead title="cache-read tokens / s" count={`${cacheReadSeries.series.length} models`} right={<span style={{ color: 'var(--fg-3)', fontSize: 11 }}>Anthropic prompt cache</span>} />
          {cacheReadRange.isLoading ? (
            <EmptyInline pad>loading…</EmptyInline>
          ) : cacheReadSeries.series.length === 0 ? (
            <EmptyInline pad>no cache reads</EmptyInline>
          ) : (
            <div style={{ padding: 8 }}>
              <MetricChart variant="area" yFormat={(v) => v.toFixed(0)} xLabels={cacheReadSeries.xLabels} series={cacheReadSeries.series} showLegend />
            </div>
          )}
        </Panel>
      </Grid>
    </>
  )
}

export default LLMPerformancePane
