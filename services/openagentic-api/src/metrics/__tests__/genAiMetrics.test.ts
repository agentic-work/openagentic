/**
 * gen_ai.* Prometheus metrics — TDD spec (2026-05-08)
 *
 * OTel GenAI Semantic Conventions ([spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/))
 * mapped to native prom-client primitives so the existing PromQL proxy
 * (/api/admin/prom/*) and the dashboard's `usePromInstant` /
 * `usePromRange` hooks read them without any new pipe.
 *
 * Coverage:
 *  1. The 6 new gen_ai metrics export from ../index with correct types
 *  2. trackLLMRequest helper increments operation_duration histogram +
 *     token_usage counter with input/output/cached/reasoning splits +
 *     finish_reasons counter, AND time_to_first_token + time_per_output_token
 *     when those fields are present.
 *  3. Error path increments gen_ai_errors_total instead of finish_reasons.
 *  4. Provider/model/operation labels round-trip through getSingleMetric.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  register,
  genAiClientOperationDurationSeconds,
  genAiServerTimeToFirstTokenSeconds,
  genAiServerTimePerOutputTokenSeconds,
  genAiClientTokenUsageTotal,
  genAiFinishReasonsTotal,
  genAiErrorsTotal,
  trackLLMRequest,
} from '../index.js';

beforeEach(() => {
  // Reset only the gen_ai_* metrics so other tests' state doesn't bleed.
  genAiClientOperationDurationSeconds.reset();
  genAiServerTimeToFirstTokenSeconds.reset();
  genAiServerTimePerOutputTokenSeconds.reset();
  genAiClientTokenUsageTotal.reset();
  genAiFinishReasonsTotal.reset();
  genAiErrorsTotal.reset();
});

describe('gen_ai.* Prometheus metrics — exports + types', () => {
  it('genAiClientOperationDurationSeconds is a Histogram with the spec labels', () => {
    const m: any = (register.getSingleMetric('gen_ai_client_operation_duration_seconds') as any);
    expect(m).toBeDefined();
    expect(m.constructor.name).toBe('Histogram');
    expect(m.labelNames.sort()).toEqual(
      ['model', 'operation', 'provider', 'status'].sort(),
    );
  });

  it('genAiServerTimeToFirstTokenSeconds is a Histogram', () => {
    const m: any = register.getSingleMetric('gen_ai_server_time_to_first_token_seconds');
    expect(m).toBeDefined();
    expect(m.labelNames.sort()).toEqual(['model', 'provider'].sort());
  });

  it('genAiServerTimePerOutputTokenSeconds is a Histogram', () => {
    const m: any = register.getSingleMetric('gen_ai_server_time_per_output_token_seconds');
    expect(m).toBeDefined();
    expect(m.labelNames.sort()).toEqual(['model', 'provider'].sort());
  });

  it('genAiClientTokenUsageTotal is a Counter with token_type label', () => {
    const m: any = register.getSingleMetric('gen_ai_client_token_usage_total');
    expect(m).toBeDefined();
    expect(m.labelNames.sort()).toEqual(
      ['model', 'provider', 'token_type'].sort(),
    );
  });

  it('genAiFinishReasonsTotal is a Counter', () => {
    const m: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    expect(m).toBeDefined();
    expect(m.labelNames.sort()).toEqual(
      ['finish_reason', 'model', 'provider'].sort(),
    );
  });

  it('genAiErrorsTotal is a Counter with error_class label', () => {
    const m: any = register.getSingleMetric('gen_ai_errors_total');
    expect(m).toBeDefined();
    expect(m.labelNames.sort()).toEqual(
      ['error_class', 'model', 'provider'].sort(),
    );
  });
});

describe('trackLLMRequest — happy path increments', () => {
  it('writes operation_duration + token splits + finish_reason for a normal completion', async () => {
    trackLLMRequest({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      operation: 'chat',
      status: 'success',
      durationMs: 4_300,
      ttftMs: 540,
      tokensPerSecond: 95,
      promptTokens: 1200,
      completionTokens: 480,
      cachedTokens: 800,
      reasoningTokens: 100,
      finishReason: 'end_turn',
    });

    // operation_duration histogram observed at 4.3s — sum > 0
    const dur: any = register.getSingleMetric('gen_ai_client_operation_duration_seconds');
    const durSnap: any = await dur.get();
    const durValues = durSnap.values.filter((v: any) => v.metricName === 'gen_ai_client_operation_duration_seconds_sum');
    expect(durValues.length).toBeGreaterThan(0);
    expect(durValues[0].value).toBeCloseTo(4.3, 2);

    // TTFT observed at 0.54s
    const ttft: any = register.getSingleMetric('gen_ai_server_time_to_first_token_seconds');
    const ttftSnap: any = await ttft.get();
    const ttftSum = ttftSnap.values.find((v: any) => v.metricName === 'gen_ai_server_time_to_first_token_seconds_sum');
    expect(ttftSum.value).toBeCloseTo(0.54, 2);

    // TPOT observed = 1 / 95 ≈ 0.0105s
    const tpot: any = register.getSingleMetric('gen_ai_server_time_per_output_token_seconds');
    const tpotSnap: any = await tpot.get();
    const tpotSum = tpotSnap.values.find((v: any) => v.metricName === 'gen_ai_server_time_per_output_token_seconds_sum');
    expect(tpotSum.value).toBeCloseTo(1 / 95, 3);

    // token_usage counter — 4 distinct token_type rows (input/output/cached/reasoning)
    const tok: any = register.getSingleMetric('gen_ai_client_token_usage_total');
    const tokSnap: any = await tok.get();
    const tokByType = new Map<string, number>();
    for (const v of tokSnap.values) {
      tokByType.set(v.labels.token_type, v.value);
    }
    expect(tokByType.get('input')).toBe(1200);
    expect(tokByType.get('output')).toBe(480);
    expect(tokByType.get('cached')).toBe(800);
    expect(tokByType.get('reasoning')).toBe(100);

    // finish_reasons counter — one row for end_turn
    const fr: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    const frSnap: any = await fr.get();
    expect(frSnap.values.length).toBe(1);
    expect(frSnap.values[0].labels.finish_reason).toBe('end_turn');
    expect(frSnap.values[0].value).toBe(1);

    // errors counter NOT incremented
    const err: any = register.getSingleMetric('gen_ai_errors_total');
    const errSnap: any = await err.get();
    expect(errSnap.values.length).toBe(0);
  });

  it('skips token_type rows that are zero or undefined', async () => {
    trackLLMRequest({
      provider: 'ollama',
      model: 'gpt-oss:20b',
      operation: 'chat',
      status: 'success',
      durationMs: 1500,
      promptTokens: 200,
      completionTokens: 50,
      // cachedTokens: undefined, reasoningTokens: 0 — both should be elided
      finishReason: 'stop',
    });

    const tok: any = register.getSingleMetric('gen_ai_client_token_usage_total');
    const tokSnap: any = await tok.get();
    const types = tokSnap.values.map((v: any) => v.labels.token_type);
    expect(types).toContain('input');
    expect(types).toContain('output');
    expect(types).not.toContain('cached');
    expect(types).not.toContain('reasoning');
  });
});

describe('trackLLMRequest — error path', () => {
  it('increments gen_ai_errors_total with error_class label', async () => {
    trackLLMRequest({
      provider: 'azure-openai',
      model: 'gpt-4o',
      operation: 'chat',
      status: 'error',
      durationMs: 800,
      errorClass: 'rate_limit',
    });

    const err: any = register.getSingleMetric('gen_ai_errors_total');
    const errSnap: any = await err.get();
    expect(errSnap.values.length).toBe(1);
    expect(errSnap.values[0].labels.error_class).toBe('rate_limit');
    expect(errSnap.values[0].labels.provider).toBe('azure-openai');
    expect(errSnap.values[0].value).toBe(1);

    // operation_duration STILL observed (we still log the failed request's
    // wall-clock duration so PromQL can compute error-latency separately)
    const dur: any = register.getSingleMetric('gen_ai_client_operation_duration_seconds');
    const durSnap: any = await dur.get();
    const errStatusRow = durSnap.values.find(
      (v: any) =>
        v.metricName === 'gen_ai_client_operation_duration_seconds_count' &&
        v.labels.status === 'error',
    );
    expect(errStatusRow).toBeDefined();
    expect(errStatusRow.value).toBe(1);

    // finish_reasons NOT incremented on error
    const fr: any = register.getSingleMetric('gen_ai_finish_reasons_total');
    const frSnap: any = await fr.get();
    expect(frSnap.values.length).toBe(0);
  });
});

describe('trackLLMRequest — label round-trip', () => {
  it('preserves provider + model + operation labels through Prom registry', async () => {
    trackLLMRequest({
      provider: 'google-vertex',
      model: 'gemini-2.5-flash',
      operation: 'chat',
      status: 'success',
      durationMs: 800,
      promptTokens: 100,
      completionTokens: 30,
      finishReason: 'STOP',
    });

    const dur: any = register.getSingleMetric('gen_ai_client_operation_duration_seconds');
    const snap: any = await dur.get();
    const sumRow = snap.values.find(
      (v: any) => v.metricName === 'gen_ai_client_operation_duration_seconds_sum',
    );
    expect(sumRow.labels).toEqual(
      expect.objectContaining({
        provider: 'google-vertex',
        model: 'gemini-2.5-flash',
        operation: 'chat',
        status: 'success',
      }),
    );
  });
});
