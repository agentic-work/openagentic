/**
 * Tier-1 Prometheus emit from LLMMetricsService.logRequest (2026-05-08).
 *
 * The dashboard "LLM Performance" tab reads PromQL via the existing
 * /api/admin/prom/* proxy. For that to be live for chat traffic, every
 * call to `LLMMetricsService.logRequest()` must emit the gen_ai.* counters
 * + histograms in addition to the LLMRequestLog DB row.
 *
 * This spec covers the seam: when logRequest is called with a complete
 * LLMRequestMetrics object, the corresponding gen_ai_* metrics get
 * incremented with the right labels. Prisma is mocked so the test stays
 * a unit test (no DB).
 *
 * Coverage:
 *  1. Happy path — operation_duration + token splits + finish_reason
 *  2. Error path — gen_ai_errors_total with error_class
 *  3. Embedding requestType maps to operation='embedding'
 *  4. Failure to write the DB row does NOT prevent Prom emission (best-effort)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock prisma BEFORE importing the service under test so the mock is in
// place when LLMMetricsService binds its `prisma` reference.
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    lLMRequestLog: {
      create: vi.fn(async ({ data }) => ({ id: 'mock-record-id', ...data })),
    },
  },
}));

import { LLMMetricsService } from '../LLMMetricsService.js';
import {
  register,
  genAiClientOperationDurationSeconds,
  genAiServerTimeToFirstTokenSeconds,
  genAiServerTimePerOutputTokenSeconds,
  genAiClientTokenUsageTotal,
  genAiFinishReasonsTotal,
  genAiErrorsTotal,
} from '../../metrics/index.js';
import { prisma } from '../../utils/prisma.js';

beforeEach(() => {
  genAiClientOperationDurationSeconds.reset();
  genAiServerTimeToFirstTokenSeconds.reset();
  genAiServerTimePerOutputTokenSeconds.reset();
  genAiClientTokenUsageTotal.reset();
  genAiFinishReasonsTotal.reset();
  genAiErrorsTotal.reset();
  // Reset the prisma mock invocation count between tests.
  (prisma.lLMRequestLog.create as any).mockClear();
});

describe('LLMMetricsService.logRequest emits gen_ai.* Prom metrics', () => {
  it('happy path — token splits + finish_reason', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      providerType: 'anthropic',
      model: 'claude-sonnet-4',
      requestType: 'chat',
      promptTokens: 1000,
      completionTokens: 400,
      cachedTokens: 600,
      reasoningTokens: 50,
      totalDurationMs: 3200,
      timeToFirstTokenMs: 480,
      finishReason: 'end_turn',
      status: 'success',
    });

    // operation_duration histogram observed
    const dur: any = register.getSingleMetric('gen_ai_client_operation_duration_seconds');
    const durSnap: any = await dur.get();
    const sum = durSnap.values.find((v: any) => v.metricName === 'gen_ai_client_operation_duration_seconds_sum');
    expect(sum.value).toBeCloseTo(3.2, 2);
    expect(sum.labels).toEqual(
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        operation: 'chat',
        status: 'success',
      }),
    );

    // TTFT observed
    const ttft: any = register.getSingleMetric('gen_ai_server_time_to_first_token_seconds');
    const ttftSnap: any = await ttft.get();
    const ttftSum = ttftSnap.values.find((v: any) => v.metricName === 'gen_ai_server_time_to_first_token_seconds_sum');
    expect(ttftSum.value).toBeCloseTo(0.48, 2);

    // 4 token-type rows
    const tok: any = register.getSingleMetric('gen_ai_client_token_usage_total');
    const tokSnap: any = await tok.get();
    const byType = new Map<string, number>();
    for (const v of tokSnap.values) byType.set(v.labels.token_type, v.value);
    expect(byType.get('input')).toBe(1000);
    expect(byType.get('output')).toBe(400);
    expect(byType.get('cached')).toBe(600);
    expect(byType.get('reasoning')).toBe(50);

    // finish_reason
    const fr: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    const frSnap: any = await fr.get();
    expect(frSnap.values).toHaveLength(1);
    expect(frSnap.values[0].labels.finish_reason).toBe('end_turn');
    expect(frSnap.values[0].value).toBe(1);

    // errors NOT incremented
    const err: any = register.getSingleMetric('gen_ai_errors_total');
    const errSnap: any = await err.get();
    expect(errSnap.values).toHaveLength(0);
  });

  it('error path — emits gen_ai_errors_total with error_class', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      providerType: 'azure-openai',
      model: 'gpt-4o',
      requestType: 'chat',
      promptTokens: 0,
      completionTokens: 0,
      totalDurationMs: 200,
      status: 'rate_limited',
      errorCode: '429',
      errorClass: 'rate_limit',
    });

    const err: any = register.getSingleMetric('gen_ai_errors_total');
    const errSnap: any = await err.get();
    expect(errSnap.values).toHaveLength(1);
    expect(errSnap.values[0].labels.error_class).toBe('rate_limit');
    expect(errSnap.values[0].labels.provider).toBe('azure-openai');
    expect(errSnap.values[0].value).toBe(1);

    // finish_reason NOT incremented on error
    const fr: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    const frSnap: any = await fr.get();
    expect(frSnap.values).toHaveLength(0);
  });

  it('embedding requestType maps to operation="embedding"', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      providerType: 'azure-openai',
      model: 'text-embedding-3-large',
      requestType: 'embedding',
      promptTokens: 80,
      completionTokens: 0,
      totalDurationMs: 120,
      status: 'success',
    });

    const dur: any = register.getSingleMetric('gen_ai_client_operation_duration_seconds');
    const durSnap: any = await dur.get();
    const sum = durSnap.values.find((v: any) => v.metricName === 'gen_ai_client_operation_duration_seconds_sum');
    expect(sum.labels.operation).toBe('embedding');
  });

  it('still emits Prom even when DB write fails (best-effort)', async () => {
    (prisma.lLMRequestLog.create as any).mockRejectedValueOnce(new Error('db down'));

    const svc = LLMMetricsService.getInstance();
    const id = await svc.logRequest({
      providerType: 'ollama',
      model: 'gpt-oss:20b',
      requestType: 'chat',
      promptTokens: 100,
      completionTokens: 30,
      totalDurationMs: 1500,
      finishReason: 'stop',
      status: 'success',
    });
    // logRequest swallows DB errors and returns null
    expect(id).toBeNull();

    // Prom counter SHOULD still have ticked despite the DB failure —
    // operations dashboard depends on Prom even when Postgres is hot.
    const fr: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    const frSnap: any = await fr.get();
    expect(frSnap.values.length).toBeGreaterThan(0);
    expect(frSnap.values[0].labels.finish_reason).toBe('stop');
  });
});
