/**
 * PromQL queries for the LLM Performance dashboard tab. Single source of
 * truth — the panel components import from here so the queries are easy
 * to unit-test (no React rendering needed) and easy to drift-check
 * against the gen_ai.* metrics emitted by api/src/metrics/index.ts.
 *
 * Style: keep the queries readable. provider/model/finish_reason all
 * stay as labels so the panels can `sum by (model)`, `topk(10, ...)`,
 * etc. without server-side roll-up.
 */
export type TimeWindow = '1h' | '6h' | '12h' | '24h' | '7d' | '30d' | '90d'

/** Map dashboard time-window selector → PromQL `[Nm/h/d]` rate window. */
export function rateWindowFor(window: TimeWindow): string {
  // Keep it short enough to react to recent activity but long enough that
  // a single 30s refresh doesn't show a flat-zero on a freshly idle pod.
  switch (window) {
    case '1h':  return '5m'
    case '6h':  return '5m'
    case '12h': return '15m'
    case '24h': return '15m'
    case '7d':  return '1h'
    case '30d': return '6h'
    case '90d': return '6h'
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Latency
// ──────────────────────────────────────────────────────────────────────────

/** TTFT pNN seconds — `histogram_quantile` over the bucket. */
export function ttftQuantile(window: TimeWindow, q: 0.5 | 0.95 | 0.99): string {
  const w = rateWindowFor(window)
  return `histogram_quantile(${q}, sum by (le, provider, model) (rate(gen_ai_server_time_to_first_token_seconds_bucket[${w}])))`
}

/** TPOT pNN seconds. */
export function tpotQuantile(window: TimeWindow, q: 0.5 | 0.95 | 0.99): string {
  const w = rateWindowFor(window)
  return `histogram_quantile(${q}, sum by (le, provider, model) (rate(gen_ai_server_time_per_output_token_seconds_bucket[${w}])))`
}

/** Total operation duration pNN seconds. */
export function operationDurationQuantile(window: TimeWindow, q: 0.5 | 0.95 | 0.99): string {
  const w = rateWindowFor(window)
  return `histogram_quantile(${q}, sum by (le, provider, model) (rate(gen_ai_client_operation_duration_seconds_bucket[${w}])))`
}

// ──────────────────────────────────────────────────────────────────────────
// Throughput
// ──────────────────────────────────────────────────────────────────────────

/** Requests / second — sum across all completions. */
export function requestRate(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum(rate(gen_ai_client_operation_duration_seconds_count[${w}]))`
}

/** Requests / second by model — for stacked area. */
export function requestRateByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (provider, model) (rate(gen_ai_client_operation_duration_seconds_count[${w}]))`
}

// ──────────────────────────────────────────────────────────────────────────
// Token economics
// ──────────────────────────────────────────────────────────────────────────

/** Tokens / second by token_type (input | output | cached | reasoning). */
export function tokensRateByType(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (token_type) (rate(gen_ai_client_token_usage_total[${w}]))`
}

/** Tokens / second by model — for stacked area. */
export function tokensRateByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (provider, model) (rate(gen_ai_client_token_usage_total[${w}]))`
}

/** Cache hit rate (cached / (input + cached)) — single percent. */
export function cacheHitRate(window: TimeWindow): string {
  const w = rateWindowFor(window)
  // Add 1e-9 in the denominator to avoid div-by-zero when no input traffic.
  return `(
  sum(rate(gen_ai_client_token_usage_total{token_type="cached"}[${w}]))
  /
  (sum(rate(gen_ai_client_token_usage_total{token_type=~"cached|input"}[${w}])) + 1e-9)
) * 100`.trim()
}

// ──────────────────────────────────────────────────────────────────────────
// Reliability + Quality
// ──────────────────────────────────────────────────────────────────────────

/** finish_reason rate by class — for stacked area / pie. */
export function finishReasonRate(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (finish_reason) (rate(gen_ai_finish_reasons_total[${w}]))`
}

/** Error rate by class. */
export function errorRateByClass(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (error_class) (rate(gen_ai_errors_total[${w}]))`
}

/** Error % across all requests = errors / (requests + errors). */
export function errorPercent(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `(
  sum(rate(gen_ai_errors_total[${w}]))
  /
  (sum(rate(gen_ai_client_operation_duration_seconds_count[${w}])) + 1e-9)
) * 100`.trim()
}

// ──────────────────────────────────────────────────────────────────────────
// F2 (2026-05-12) — Chat / Tool / Agent operation counters
// Emitted by GenAITracer (services/observability/GenAITracer.ts) with OTel
// GenAI v1.37 semconv. Drives the "Chat operations" + "Tool dispatch" +
// "Sub-agent invocations" panels.
// ──────────────────────────────────────────────────────────────────────────

/** Chat turns / second by model — one increment per provider stream end. */
export function chatTurnsRateByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (model) (rate(gen_ai_chat_turns_total[${w}]))`
}

/** Tool dispatches / second by tool_name + outcome. */
export function toolCallsRateByTool(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (tool_name, outcome) (rate(gen_ai_tool_calls_total[${w}]))`
}

/** Top-N tools by dispatch count (for the leaderboard / pie). */
export function topToolsByCount(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `topk(10, sum by (tool_name) (rate(gen_ai_tool_calls_total[${w}])))`
}

/** Tool error % across all dispatches. */
export function toolErrorPercent(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `(
  sum(rate(gen_ai_tool_calls_total{outcome="error"}[${w}]))
  /
  (sum(rate(gen_ai_tool_calls_total[${w}])) + 1e-9)
) * 100`.trim()
}

/** Sub-agent invocations / second by agent_id + outcome. */
export function agentInvocationsRateByAgent(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (agent_id, outcome) (rate(gen_ai_agent_invocations_total[${w}]))`
}

/** Sub-agent error % across all invocations. */
export function agentErrorPercent(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `(
  sum(rate(gen_ai_agent_invocations_total{outcome="error"}[${w}]))
  /
  (sum(rate(gen_ai_agent_invocations_total[${w}])) + 1e-9)
) * 100`.trim()
}

/** Average input tokens per chat turn (histogram avg via sum/count). */
export function avgInputTokensByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (model) (rate(gen_ai_usage_input_tokens_sum[${w}])) / (sum by (model) (rate(gen_ai_usage_input_tokens_count[${w}])) + 1e-9)`
}

/** Average output tokens per chat turn. */
export function avgOutputTokensByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (model) (rate(gen_ai_usage_output_tokens_sum[${w}])) / (sum by (model) (rate(gen_ai_usage_output_tokens_count[${w}])) + 1e-9)`
}

/** Cache-read tokens / second by model (Anthropic prompt-cache hit indicator). */
export function cacheReadTokensRateByModel(window: TimeWindow): string {
  const w = rateWindowFor(window)
  return `sum by (model) (rate(gen_ai_usage_cache_read_input_tokens_sum[${w}]))`
}
