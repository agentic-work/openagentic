/**
 * V3MetricsRegistry — TDD spec (Phase 12 + Phase 13 add).
 *
 * The 22 V3-pipeline-specific prom-client metrics — 21 from Phase 12 (§13)
 * + 1 from Phase 13 (§15 advisory loop: v3_feedback_signals_total).
 *
 * Coverage:
 *  1. All 22 metric KEYS exist on the v3Metrics export.
 *  2. Each metric has the correct prom-client constructor type
 *     (Counter | Histogram).
 *  3. Each metric has the labelNames listed in the spec — sorted compare
 *     so author ordering doesn't break the test.
 *  4. The metrics auto-register against the default `register` so the
 *     existing /metrics endpoint at health.plugin.ts:40 exposes them
 *     without any extra wiring (uses register.getSingleMetric).
 *  5. After incrementing a Counter and observing a Histogram, the
 *     register.metrics() text-format output contains the metric name
 *     (proves they're scrape-visible end-to-end).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const EXPECTED_LABELS: Record<
  string,
  { type: 'Counter' | 'Histogram'; labels: string[] }
> = {
  v3_chat_turns_total: {
    type: 'Counter',
    // Phase E.7 (2026-05-10) — `audience` label dropped alongside the
    // ResponseFeedback.audience column rip.
    labels: ['intent', 'model'],
  },
  v3_chat_turn_duration_seconds: {
    type: 'Histogram',
    labels: ['intent'],
  },
  v3_tool_dispatches_total: {
    type: 'Counter',
    labels: ['tool_name', 'outcome'],
  },
  v3_tool_dispatch_duration_seconds: {
    type: 'Histogram',
    labels: ['tool_name'],
  },
  v3_envelope_overflow_total: {
    type: 'Counter',
    labels: ['tool_name'],
  },
  v3_compaction_triggers_total: {
    type: 'Counter',
    labels: ['trigger_point'],
  },
  v3_compaction_tokens_freed: {
    type: 'Histogram',
    labels: [],
  },
  v3_memory_injection_total: {
    type: 'Counter',
    labels: ['outcome'],
  },
  v3_memory_search_hits: {
    type: 'Histogram',
    labels: [],
  },
  v3_handoff_offers_total: {
    type: 'Counter',
    labels: ['trigger'],
  },
  v3_handoff_offers_accepted_total: {
    type: 'Counter',
    labels: [],
  },
  v3_hook_invocations_total: {
    type: 'Counter',
    labels: ['hook', 'outcome'],
  },
  v3_hook_duration_seconds: {
    type: 'Histogram',
    labels: ['hook'],
  },
  v3_hook_blocked_total: {
    type: 'Counter',
    labels: ['hook', 'reason'],
  },
  v3_subagent_dispatches_total: {
    type: 'Counter',
    labels: ['agent_name', 'outcome'],
  },
  v3_subagent_duration_seconds: {
    type: 'Histogram',
    labels: ['agent_name'],
  },
  v3_subagent_cost_usd: {
    type: 'Histogram',
    labels: [],
  },
  // Phase E.7 (2026-05-10) — v3_audience_routes_total RIPPED.
  v3_model_routes_total: {
    type: 'Counter',
    labels: ['model', 'intent'],
  },
  v3_model_input_tokens: {
    type: 'Histogram',
    labels: [],
  },
  v3_model_output_tokens: {
    type: 'Histogram',
    labels: [],
  },
  // Phase 13 — feedback advisory loop
  v3_feedback_signals_total: {
    type: 'Counter',
    labels: ['signal'],
  },
};

// Map metric-name → camelCase key (the export shape on v3Metrics).
const METRIC_KEYS: Record<string, string> = {
  v3_chat_turns_total: 'chatTurns',
  v3_chat_turn_duration_seconds: 'chatTurnDuration',
  v3_tool_dispatches_total: 'toolDispatches',
  v3_tool_dispatch_duration_seconds: 'toolDispatchDuration',
  v3_envelope_overflow_total: 'envelopeOverflow',
  v3_compaction_triggers_total: 'compactionTriggers',
  v3_compaction_tokens_freed: 'compactionTokensFreed',
  v3_memory_injection_total: 'memoryInjection',
  v3_memory_search_hits: 'memorySearchHits',
  v3_handoff_offers_total: 'handoffOffers',
  v3_handoff_offers_accepted_total: 'handoffOffersAccepted',
  v3_hook_invocations_total: 'hookInvocations',
  v3_hook_duration_seconds: 'hookDuration',
  v3_hook_blocked_total: 'hookBlocked',
  v3_subagent_dispatches_total: 'subagentDispatches',
  v3_subagent_duration_seconds: 'subagentDuration',
  v3_subagent_cost_usd: 'subagentCost',
  // Phase E.7 (2026-05-10) — audienceRoutes counter removed.
  v3_model_routes_total: 'modelRoutes',
  v3_model_input_tokens: 'modelInputTokens',
  v3_model_output_tokens: 'modelOutputTokens',
  v3_feedback_signals_total: 'feedbackSignals',
};

let v3Metrics: any;
let register: any;

beforeAll(async () => {
  // Side-effect import — the metric constructors register against the
  // default register at module load time.
  const promClient = await import('prom-client');
  register = promClient.register;
  const mod = await import('../V3MetricsRegistry.js');
  v3Metrics = mod.v3Metrics;
});

describe('V3MetricsRegistry — exports', () => {
  it('exports all 21 expected camelCase keys (Phase E.7 dropped audienceRoutes)', () => {
    const keys = Object.keys(v3Metrics).sort();
    const expected = Object.values(METRIC_KEYS).sort();
    expect(keys).toEqual(expected);
    expect(keys.length).toBe(21);
  });
});

describe('V3MetricsRegistry — types + labels per metric', () => {
  for (const [metricName, spec] of Object.entries(EXPECTED_LABELS)) {
    it(`${metricName} is a ${spec.type} with labels [${spec.labels.join(', ')}]`, () => {
      const camelKey = METRIC_KEYS[metricName];
      const m = v3Metrics[camelKey];
      expect(m).toBeDefined();
      // prom-client Counter/Histogram both expose constructor.name.
      expect(m.constructor.name).toBe(spec.type);
      expect((m.labelNames || []).slice().sort()).toEqual(spec.labels.slice().sort());
    });
  }
});

describe('V3MetricsRegistry — registered with default register', () => {
  for (const metricName of Object.keys(EXPECTED_LABELS)) {
    it(`${metricName} is queryable via register.getSingleMetric`, () => {
      const m: any = register.getSingleMetric(metricName);
      expect(m).toBeDefined();
      expect(m.name).toBe(metricName);
    });
  }
});

describe('V3MetricsRegistry — values appear in /metrics scrape output', () => {
  it('after inc on a Counter, register.metrics() text contains the metric name', async () => {
    // Exercise the chatTurns counter so it produces output.
    v3Metrics.chatTurns.inc({
      intent: 'chat',
      model: 'test-model',
    });
    const text = await register.metrics();
    expect(text).toContain('v3_chat_turns_total');
  });

  it('after observe on a Histogram, register.metrics() text contains the metric name', async () => {
    v3Metrics.chatTurnDuration.observe({ intent: 'chat' }, 1.23);
    const text = await register.metrics();
    expect(text).toContain('v3_chat_turn_duration_seconds');
  });
});
