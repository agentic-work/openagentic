/**
 * V3 Metrics Registry — Phase 12 of V3 enterprise chatmode plan.
 *
 * 21 prom-client metrics covering every meaningful seam in the V3 chat
 * pipeline. Defined here as a single module-level object so callers
 * import `v3Metrics` and reach for the metric they need by camelCase
 * key — no scattered `new Counter(...)` calls across runChat + chatLoop.
 *
 * IMPORTANT: every metric is constructed with `registers: [register]`
 * pointing at the prom-client DEFAULT register. The /metrics handler
 * at health.plugin.ts:40 reads from that same register, so these
 * metrics are scraped by Prometheus the moment this module loads —
 * no extra wiring required.
 *
 * The 22 metrics map 1:1 to spec/2026-05-09-v3-enterprise-chatmode-design.md
 * §13–§15 (Phase 13 added v3_feedback_signals_total for the advisory loop).
 * Don't add a 23rd here without amending the spec; the architecture
 * test at __tests__/architecture/v3-metrics-source-regression.test.ts
 * pins this list.
 *
 * Bucket choices:
 *  - DURATION_BUCKETS — 50ms → 120s — covers fast meta-tool dispatches
 *    (50ms compose_visual) up through long sub-agent runs (120s).
 *  - COST_BUCKETS — $0.001 → $5 — covers cheap meta-tool turns up through
 *    expensive Sonnet sub-agent dispatches that pull GraphRAG context.
 *  - TOKEN_BUCKETS — 100 → 100k — covers single-line completions up through
 *    full-tier prompts with retrieved context.
 */

import { Counter, Histogram, register } from 'prom-client';

const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120];
const COST_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5];
const TOKEN_BUCKETS = [100, 500, 1000, 2000, 5000, 10000, 50000, 100000];
// Compaction frees on the order of thousands of tokens — same scale as
// model token usage so we re-use TOKEN_BUCKETS.
const COMPACTION_TOKEN_BUCKETS = TOKEN_BUCKETS;
// Memory search returns a small int (typically 0-10 hits per turn).
const MEMORY_HIT_BUCKETS = [0, 1, 2, 3, 5, 10, 25];

export const v3Metrics = {
  // ── V3 chat-loop primitives ─────────────────────────────────────────
  chatTurns: new Counter({
    name: 'v3_chat_turns_total',
    help: 'V3 chat turns completed (one per provider stream end_turn or short-circuit stop reason)',
    // Phase E.7 (2026-05-10) — `audience` label removed alongside the
    // ResponseFeedback.audience column rip. Role discrimination at chat
    // time is now encoded purely via system-prompt selection
    // (chat-system-{admin,member}.md), so the audience label was
    // redundant with `model` cardinality and added no signal.
    labelNames: ['intent', 'model'] as const,
    registers: [register],
  }),
  chatTurnDuration: new Histogram({
    name: 'v3_chat_turn_duration_seconds',
    help: 'V3 chat turn end-to-end duration in seconds (entry to terminal frame)',
    labelNames: ['intent'] as const,
    buckets: DURATION_BUCKETS,
    registers: [register],
  }),
  toolDispatches: new Counter({
    name: 'v3_tool_dispatches_total',
    help: 'V3 tool dispatches by tool_name and outcome (ok|error)',
    labelNames: ['tool_name', 'outcome'] as const,
    registers: [register],
  }),
  toolDispatchDuration: new Histogram({
    name: 'v3_tool_dispatch_duration_seconds',
    help: 'V3 tool dispatch wall time in seconds',
    labelNames: ['tool_name'] as const,
    buckets: DURATION_BUCKETS,
    registers: [register],
  }),
  envelopeOverflow: new Counter({
    name: 'v3_envelope_overflow_total',
    help: 'V3 tool result triggered envelope splitter overflow path (Phase 4)',
    labelNames: ['tool_name'] as const,
    registers: [register],
  }),

  // ── Compaction (Phase 8) ────────────────────────────────────────────
  compactionTriggers: new Counter({
    name: 'v3_compaction_triggers_total',
    help: 'V3 ContextManagementService.compactContext fires by trigger_point (preloop|midloop)',
    labelNames: ['trigger_point'] as const,
    registers: [register],
  }),
  compactionTokensFreed: new Histogram({
    name: 'v3_compaction_tokens_freed',
    help: 'Tokens reclaimed by a single compaction pass',
    buckets: COMPACTION_TOKEN_BUCKETS,
    registers: [register],
  }),

  // ── Memory injection (Phase 9) ──────────────────────────────────────
  memoryInjection: new Counter({
    name: 'v3_memory_injection_total',
    help: 'V3 memory injection outcome (hit|miss) per turn-start recall',
    labelNames: ['outcome'] as const,
    registers: [register],
  }),
  memorySearchHits: new Histogram({
    name: 'v3_memory_search_hits',
    help: 'Number of memory hits returned by AgentMemoryService.recall per turn',
    buckets: MEMORY_HIT_BUCKETS,
    registers: [register],
  }),

  // ── Handoff offers (Phase 10) ───────────────────────────────────────
  handoffOffers: new Counter({
    name: 'v3_handoff_offers_total',
    help: 'V3 model_handoff_offer NDJSON frames emitted by trigger (preloop|midloop)',
    labelNames: ['trigger'] as const,
    registers: [register],
  }),
  handoffOffersAccepted: new Counter({
    name: 'v3_handoff_offers_accepted_total',
    help: 'User-accepted handoff offers (UI POSTs back when the operator clicks the offer chip)',
    registers: [register],
  }),

  // ── Hooks (Phase 3) ─────────────────────────────────────────────────
  hookInvocations: new Counter({
    name: 'v3_hook_invocations_total',
    help: 'V3 HookRunner invocations by hook name and outcome (ok|fail)',
    labelNames: ['hook', 'outcome'] as const,
    registers: [register],
  }),
  hookDuration: new Histogram({
    name: 'v3_hook_duration_seconds',
    help: 'V3 hook execution wall time in seconds',
    labelNames: ['hook'] as const,
    buckets: DURATION_BUCKETS,
    registers: [register],
  }),
  hookBlocked: new Counter({
    name: 'v3_hook_blocked_total',
    help: 'V3 hook fired a block decision (DLP block, HITL deny, etc.) by hook name + reason',
    labelNames: ['hook', 'reason'] as const,
    registers: [register],
  }),

  // ── Sub-agent (Phase 6) ─────────────────────────────────────────────
  subagentDispatches: new Counter({
    name: 'v3_subagent_dispatches_total',
    help: 'V3 sub-agent dispatches via openagentic-proxy by agent_name and outcome (ok|error)',
    labelNames: ['agent_name', 'outcome'] as const,
    registers: [register],
  }),
  subagentDuration: new Histogram({
    name: 'v3_subagent_duration_seconds',
    help: 'V3 sub-agent execution wall time in seconds (openagentic-proxy round-trip)',
    labelNames: ['agent_name'] as const,
    buckets: DURATION_BUCKETS,
    registers: [register],
  }),
  subagentCost: new Histogram({
    name: 'v3_subagent_cost_usd',
    help: 'V3 sub-agent run cost in USD (sum of per-turn provider cost reported by openagentic-proxy)',
    buckets: COST_BUCKETS,
    registers: [register],
  }),

  // ── Audience routing — REMOVED (Phase E.7, 2026-05-10) ──────────────
  // The v3_audience_routes_total counter labeled chat turns by
  // 'admin'|'non_admin'. Role discrimination at chat time is now done
  // entirely via system-prompt selection (chat-system-{admin,member}.md).
  // The counter added no signal beyond the model/intent split that
  // chatTurns already covers; ripped to keep the V3 metric surface
  // aligned with the rev-2 chatmode-rip plan.

  // ── Phase 13 — feedback advisory loop ───────────────────────────────
  feedbackSignals: new Counter({
    name: 'v3_feedback_signals_total',
    help: 'V3 user feedback signals captured by signal (positive|negative)',
    labelNames: ['signal'] as const,
    registers: [register],
  }),

  // ── Models (general) ────────────────────────────────────────────────
  modelRoutes: new Counter({
    name: 'v3_model_routes_total',
    help: 'V3 model selection by model id and intent',
    labelNames: ['model', 'intent'] as const,
    registers: [register],
  }),
  modelInputTokens: new Histogram({
    name: 'v3_model_input_tokens',
    help: 'Per-turn provider input token count reported by streamProvider usage',
    buckets: TOKEN_BUCKETS,
    registers: [register],
  }),
  modelOutputTokens: new Histogram({
    name: 'v3_model_output_tokens',
    help: 'Per-turn provider output token count reported by streamProvider usage',
    buckets: TOKEN_BUCKETS,
    registers: [register],
  }),
} as const;

export type V3Metrics = typeof v3Metrics;

/**
 * Side-effect-only helper for callers that don't want to handle thrown
 * label-cardinality errors. Wraps a metric op in a try/catch so a bad
 * label value (e.g. undefined coerced to 'undefined') never breaks the
 * calling code path.
 */
export function safeIncCounter(
  counter: { inc: ((labels: Record<string, string>, value?: number) => void) & ((value: number) => void) } | any,
  labels?: Record<string, string>,
  value: number = 1,
): void {
  try {
    if (labels) counter.inc(labels, value);
    else counter.inc(value);
  } catch {
    /* swallow — never break a chat turn on a metrics emit */
  }
}

export function safeObserveHistogram(
  hist: { observe: (labelsOrValue: any, value?: number) => void },
  labels: Record<string, string> | number,
  value?: number,
): void {
  try {
    if (typeof labels === 'number') hist.observe(labels);
    else hist.observe(labels, value as number);
  } catch {
    /* swallow */
  }
}
