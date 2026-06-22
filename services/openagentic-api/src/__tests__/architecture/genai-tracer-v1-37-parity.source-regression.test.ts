/**
 * GenAITracer v1.37 parity catalog — chatmode (this service) vs workflows-svc.
 *
 * Pins the current state of attribute + metric instrument coverage so any
 * future change to either tracer either:
 *   1. Maintains parity with the cataloged baseline, OR
 *   2. Closes a known gap (in which case bump the WORKFLOWS_HAS / CHATMODE_HAS
 *      set + delete the matching KNOWN_GAPS entry in the same PR).
 *
 * Convergence target = workflows-svc tracer (shipped 2026-05-13 with the
 * full v1.37 attribute set + the two REQUIRED metric instruments
 * `gen_ai.client.token.usage` and `gen_ai.client.operation.duration`).
 *
 * Chatmode tracer (this service's `services/observability/GenAITracer.ts`)
 * pre-dates the v1.37 spec rollout and uses a prom-client mirror in place
 * of OTel metric instruments. Chatmode is in active UAT so the test does
 * NOT enforce convergence — it documents the gap.
 *
 * Companion: services/shared/workflow-engine/src/observability/GenAITracer.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const CHATMODE_TRACER = join(
  REPO_ROOT,
  'services/openagentic-api/src/services/observability/GenAITracer.ts',
);
const WORKFLOWS_TRACER = join(
  REPO_ROOT,
  'services/shared/workflow-engine/src/observability/GenAITracer.ts',
);

const REQUIRED_V1_37_ATTRS = [
  'gen_ai.operation.name',
  'gen_ai.system',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.response.finish_reasons',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
] as const;

const CONDITIONAL_V1_37_ATTRS = [
  'gen_ai.request.max_tokens',
  'gen_ai.request.temperature',
  'gen_ai.request.top_p',
  'gen_ai.request.top_k',
  'gen_ai.response.id',
  'gen_ai.agent.id',
  'gen_ai.agent.name',
  'gen_ai.agent.description',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
] as const;

const REQUIRED_V1_37_METRIC_INSTRUMENTS = [
  'gen_ai.client.token.usage',
  'gen_ai.client.operation.duration',
] as const;

/**
 * Gaps chatmode tracer is intentionally missing today (chatmode-in-UAT,
 * touch carefully). Closing a gap = remove its entry here + add a real
 * assertion above. Keep this list short and audited; do not grow it.
 */
const CHATMODE_KNOWN_GAPS = {
  attrs: [
    // gen_ai.system — CLOSED 9d637449. chatmode now emits 'openagentic.chat'
    //   default when ChatSpanInput.providerSystem is undefined, mirroring
    //   workflows-svc's 'openagentic.platform' default.
    // gen_ai.response.finish_reasons — CLOSED in commit after 9d637449.
    //   startChat().end() accepts { finishReasons } meta; chatLoop passes
    //   [stopReason] when the turn terminates naturally.
    // gen_ai.response.model — tracer source CAN emit it (startChat().end()
    //   accepts meta.responseModel), but the chatLoop call site hardcodes
    //   providerType:'unknown' at recordCompletionMetrics:428 and doesn't
    //   yet know the response model. Tracker is capability-not-routing
    //   shaped — kept in the catalog (in baseline below) since the source
    //   string IS present; chatLoop threading is a follow-up.
    // gen_ai.request.{max_tokens,temperature,top_p,top_k} — CLOSED in commit
    //   after 19c92b47. ChatSpanInput now carries optional maxTokens /
    //   temperature / topP / topK; tracer emits each conditionally. Same
    //   capability-not-routing shape: chatLoop doesn't thread these today,
    //   but the source emits them so the catalog has them in baseline.
  ] as const,
  // Metric instruments — BOTH CLOSED in commit after 07903a96. The chatmode
  // tracer now builds the two REQUIRED v1.37 histograms via metrics.getMeter
  // alongside the existing prom-client mirror. startChat().end() records
  // gen_ai.client.operation.duration on every termination (success + error);
  // recordUsage records gen_ai.client.token.usage with token.type=input|output.
  metricInstruments: [] as readonly string[],
};

describe('GenAITracer v1.37 parity catalog', () => {
  const chatmode = readFileSync(CHATMODE_TRACER, 'utf8');
  const workflows = readFileSync(WORKFLOWS_TRACER, 'utf8');

  describe('workflows-svc tracer = v1.37 convergence target', () => {
    for (const attr of REQUIRED_V1_37_ATTRS) {
      it(`emits required attr ${attr}`, () => {
        expect(workflows).toMatch(new RegExp(`['"]${attr.replace(/\./g, '\\.')}['"]`));
      });
    }
    for (const attr of CONDITIONAL_V1_37_ATTRS) {
      it(`emits conditional attr ${attr}`, () => {
        expect(workflows).toMatch(new RegExp(`['"]${attr.replace(/\./g, '\\.')}['"]`));
      });
    }
    for (const inst of REQUIRED_V1_37_METRIC_INSTRUMENTS) {
      it(`declares required metric instrument ${inst}`, () => {
        expect(workflows).toMatch(new RegExp(`['"]${inst.replace(/\./g, '\\.')}['"]`));
      });
    }
  });

  describe('chatmode tracer = current baseline (gap-documented)', () => {
    // What chatmode ALREADY emits today — keep these green.
    const chatmodeBaseline = [
      'gen_ai.operation.name',
      'gen_ai.system',
      'gen_ai.request.model',
      'gen_ai.response.id',
      'gen_ai.usage.input_tokens',
      'gen_ai.usage.output_tokens',
      'gen_ai.usage.cache_read_input_tokens',
      'gen_ai.usage.cache_write_input_tokens',
      'gen_ai.tool.name',
      'gen_ai.tool.call.id',
      'gen_ai.agent.id',
      'gen_ai.agent.name',
      'gen_ai.agent.description',
      'gen_ai.system_instructions',
      'gen_ai.response.finish_reasons',
      'gen_ai.response.model',
      'gen_ai.request.max_tokens',
      'gen_ai.request.temperature',
      'gen_ai.request.top_p',
      'gen_ai.request.top_k',
    ];
    const chatmodeMetricInstrumentsBaseline = [
      'gen_ai.client.token.usage',
      'gen_ai.client.operation.duration',
    ];
    for (const inst of chatmodeMetricInstrumentsBaseline) {
      it(`declares metric instrument ${inst}`, () => {
        expect(chatmode).toMatch(new RegExp(`['"]${inst.replace(/\./g, '\\.')}['"]`));
      });
    }
    for (const attr of chatmodeBaseline) {
      it(`emits baseline attr ${attr}`, () => {
        expect(chatmode).toMatch(new RegExp(`['"]${attr.replace(/\./g, '\\.')}['"]`));
      });
    }

    // Gap inventory — closing one means deleting from KNOWN_GAPS and
    // adding the matching baseline assertion above.
    it('CHATMODE_KNOWN_GAPS catalogues the unconverged v1.37 attrs', () => {
      for (const attr of CHATMODE_KNOWN_GAPS.attrs) {
        expect(chatmode).not.toMatch(new RegExp(`['"]${attr.replace(/\./g, '\\.')}['"]`));
      }
    });
    it('CHATMODE_KNOWN_GAPS catalogues the unconverged v1.37 metric instruments', () => {
      for (const inst of CHATMODE_KNOWN_GAPS.metricInstruments) {
        expect(chatmode).not.toMatch(new RegExp(`['"]${inst.replace(/\./g, '\\.')}['"]`));
      }
    });
  });
});
