/**
 * F2-followup (2026-06-01) — GenAITracer Prom MIRROR.
 *
 * The OTel-span behavior is covered by GenAITracer.semconv.test.ts. THIS
 * spec pins the prom-client counters/histograms the dashboard actually reads
 * via PromQL (services/openagentic-ui/.../llm-performance/promQueries.ts):
 *
 *   - gen_ai_agent_invocations_total{agent_id,outcome}  ← withAgentSpan
 *       (panel: agentInvocationsRateByAgent / agentErrorPercent)
 *   - gen_ai_usage_cache_read_input_tokens{model} (histogram _sum/_count)
 *       ← recordUsage, label `model` MUST be the real model (was 'unknown'
 *         because OTel Span exposes no .attributes — the dashboard groups
 *         `by (model)` and could not attribute cache hits).
 *       (panel: cacheReadTokensRateByModel)
 *
 * Each test builds a GenAITracer against a fresh prom Registry so the
 * series are isolated from the process-default register.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from 'prom-client';
import * as promClient from 'prom-client';
import { trace } from '@opentelemetry/api';
import { GenAITracer } from '../GenAITracer.js';

// Use the @opentelemetry/api no-op tracer (the OTel SDK trace exporters are
// not a dependency of this service — prod also runs no-op spans unless an
// OTLP endpoint is configured). The prom MIRROR increments inside the
// GenAITracer wrapper regardless of whether spans export, which is exactly
// the seam under test.
function makeTracer(register: Registry): GenAITracer {
  return new GenAITracer(trace.getTracer('test'), {
    register,
    promClient: promClient as unknown as typeof import('prom-client'),
  });
}

describe('GenAITracer prom mirror — gen_ai_agent_invocations_total', () => {
  let register: Registry;
  let tracer: GenAITracer;
  beforeEach(() => {
    register = new Registry();
    tracer = makeTracer(register);
  });

  it('increments {agent_id, outcome=ok} on a successful sub-agent dispatch', async () => {
    await tracer.withAgentSpan(
      { agentId: 'cloud_operations', agentName: 'Cloud Ops', agentDescription: '', callId: 'toolu_1' },
      async () => {},
    );
    const m: any = register.getSingleMetric('gen_ai_agent_invocations_total');
    expect(m).toBeDefined();
    const snap: any = await m.get();
    const row = snap.values.find(
      (v: any) => v.labels.agent_id === 'cloud_operations' && v.labels.outcome === 'ok',
    );
    expect(row).toBeDefined();
    expect(row.value).toBe(1);
  });

  it('increments {outcome=error} when the sub-agent body throws', async () => {
    await expect(
      tracer.withAgentSpan(
        { agentId: 'data_analysis', agentName: 'DA', agentDescription: '', callId: 'toolu_2' },
        async () => {
          throw new Error('sub-agent failed');
        },
      ),
    ).rejects.toThrow('sub-agent failed');

    const m: any = register.getSingleMetric('gen_ai_agent_invocations_total');
    const snap: any = await m.get();
    const row = snap.values.find(
      (v: any) => v.labels.agent_id === 'data_analysis' && v.labels.outcome === 'error',
    );
    expect(row).toBeDefined();
    expect(row.value).toBe(1);
  });
});

describe('GenAITracer prom mirror — gen_ai_usage_cache_read_input_tokens', () => {
  let register: Registry;
  let tracer: GenAITracer;
  beforeEach(() => {
    register = new Registry();
    tracer = makeTracer(register);
  });

  it('observes cache-read tokens labelled by the REAL model (not "unknown")', async () => {
    // startChat().recordUsage is the live streaming-chat seam — it always
    // threads the model through otelLabels.model. Drive it and assert the
    // histogram _sum carries the real model label so the dashboard's
    // `sum by (model) (rate(gen_ai_usage_cache_read_input_tokens_sum[...]))`
    // can attribute prompt-cache hits per model.
    const handle = tracer.startChat({ model: 'claude-sonnet-4-6' });
    handle.recordUsage({ input: 1000, output: 200, cacheRead: 768 });
    handle.end();

    const m: any = register.getSingleMetric('gen_ai_usage_cache_read_input_tokens');
    expect(m).toBeDefined();
    const snap: any = await m.get();
    const sumRow = snap.values.find(
      (v: any) =>
        v.metricName === 'gen_ai_usage_cache_read_input_tokens_sum' &&
        v.labels.model === 'claude-sonnet-4-6',
    );
    expect(sumRow).toBeDefined();
    expect(sumRow.value).toBe(768);
    // The buggy old behavior bucketed everything under model='unknown'.
    const unknownRow = snap.values.find(
      (v: any) =>
        v.metricName === 'gen_ai_usage_cache_read_input_tokens_sum' &&
        v.labels.model === 'unknown',
    );
    expect(unknownRow).toBeUndefined();
  });

  it('elides cache-read when the provider never reported it (Ollama path)', async () => {
    const handle = tracer.startChat({ model: 'gpt-oss:20b' });
    handle.recordUsage({ input: 50, output: 10 }); // no cacheRead
    handle.end();

    const m: any = register.getSingleMetric('gen_ai_usage_cache_read_input_tokens');
    const snap: any = await m.get();
    const countRow = snap.values.find(
      (v: any) => v.metricName === 'gen_ai_usage_cache_read_input_tokens_count',
    );
    // No observation → no series for this model.
    expect(countRow).toBeUndefined();
  });
});
