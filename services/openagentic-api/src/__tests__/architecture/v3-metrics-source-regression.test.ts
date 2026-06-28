/**
 * V3 metrics source-regression — Phase 12.
 *
 * Pins the wiring so a future refactor can't silently rip the
 * V3MetricsRegistry imports out of runChat + chatLoop. Without these
 * imports the metrics module never loads at runtime (the metric
 * constructors register against the default register at module load
 * time), so /metrics ends up exposing zero V3 rows and SLO evaluation
 * silently always returns met=true.
 *
 * Pins:
 *  1. V3MetricsRegistry.ts contains all 21 expected metric NAMES
 *     (the strings — `name: 'v3_chat_turns_total'` etc).
 *  2. runChat.ts imports v3Metrics from V3MetricsRegistry.
 *  3. chatLoop.ts imports v3Metrics from V3MetricsRegistry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REGISTRY_PATH = resolve(
  __dirname,
  '../../services/V3MetricsRegistry.ts',
);
const RUN_CHAT_V3_PATH = resolve(
  __dirname,
  '../../routes/chat/pipeline/chat/runChat.ts',
);
const CHAT_LOOP_PATH = resolve(
  __dirname,
  '../../routes/chat/pipeline/chat/chatLoop.ts',
);

const EXPECTED_METRIC_NAMES = [
  'v3_chat_turns_total',
  'v3_chat_turn_duration_seconds',
  'v3_tool_dispatches_total',
  'v3_tool_dispatch_duration_seconds',
  'v3_envelope_overflow_total',
  'v3_compaction_triggers_total',
  'v3_compaction_tokens_freed',
  'v3_memory_injection_total',
  'v3_memory_search_hits',
  'v3_handoff_offers_total',
  'v3_handoff_offers_accepted_total',
  'v3_hook_invocations_total',
  'v3_hook_duration_seconds',
  'v3_hook_blocked_total',
  'v3_subagent_dispatches_total',
  'v3_subagent_duration_seconds',
  'v3_subagent_cost_usd',
  // Phase E.7 (2026-05-10) — v3_audience_routes_total RIPPED.
  'v3_model_routes_total',
  'v3_model_input_tokens',
  'v3_model_output_tokens',
  // Phase 13 — feedback advisory loop
  'v3_feedback_signals_total',
];

describe('V3MetricsRegistry source — all post-E.7 metric names present', () => {
  const src = readFileSync(REGISTRY_PATH, 'utf8');
  for (const name of EXPECTED_METRIC_NAMES) {
    it(`contains metric name: ${name}`, () => {
      expect(src).toContain(`'${name}'`);
    });
  }

  it('exactly 21 metric names total (Phase E.7 dropped v3_audience_routes_total)', () => {
    expect(EXPECTED_METRIC_NAMES.length).toBe(21);
  });
});

describe('V3 pipeline imports v3Metrics', () => {
  it('runChat.ts imports v3Metrics from V3MetricsRegistry', () => {
    const src = readFileSync(RUN_CHAT_V3_PATH, 'utf8');
    // Match either named import or barrel import — both reach the same singleton.
    expect(
      /import\s*\{[^}]*\bv3Metrics\b[^}]*\}\s*from\s*['"][^'"]*V3MetricsRegistry/.test(src),
    ).toBe(true);
  });

  it('chatLoop.ts imports v3Metrics from V3MetricsRegistry', () => {
    const src = readFileSync(CHAT_LOOP_PATH, 'utf8');
    expect(
      /import\s*\{[^}]*\bv3Metrics\b[^}]*\}\s*from\s*['"][^'"]*V3MetricsRegistry/.test(src),
    ).toBe(true);
  });
});
