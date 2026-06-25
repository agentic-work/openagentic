/**
 * Sub-task 5b — LLMMetricsService MUST emit `llm_*` Prom series so the
 * admin "LLM & Router" page (~200 `POST /api/admin/prom/query{,_range}`
 * calls per load) returns non-empty result sets.
 *
 * Per the task spec:
 *  - llm_requests_total          (Counter,  labels: model, provider, status)
 *  - llm_ttft_ms                 (Histogram, labels: model, provider, status)
 *  - llm_tpot_ms                 (Histogram, labels: model, provider, status)
 *  - llm_request_duration_ms     (Histogram, labels: model, provider, status)
 *
 * Sibling to LLMMetricsService.tier1Prom.test.ts (which covers the
 * `gen_ai_*` OTel series). This spec is the cage for the `llm_*` series
 * exposed at the `/metrics` endpoint that the admin LLM&Router PromQL
 * targets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    lLMRequestLog: {
      create: vi.fn(async ({ data }: any) => ({ id: 'mock-record-id', ...data })),
    },
  },
}));

import { register } from 'prom-client';
import { LLMMetricsService } from '../LLMMetricsService.js';

beforeEach(() => {
  // Reset the four llm_* singletons between cases so counters/buckets
  // don't accumulate cross-test.
  for (const name of [
    'llm_requests_total',
    'llm_ttft_ms',
    'llm_tpot_ms',
    'llm_request_duration_ms',
  ]) {
    const m: any = register.getSingleMetric(name);
    if (m && typeof m.reset === 'function') m.reset();
  }
});

describe('LLMMetricsService.logRequest emits llm_* Prom series', () => {
  it('exposes llm_requests_total + ttft + tpot + duration after one happy-path call', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      providerType: 'anthropic',
      model: 'claude-sonnet-4',
      requestType: 'chat',
      promptTokens: 1000,
      completionTokens: 42,
      totalDurationMs: 4567,
      timeToFirstTokenMs: 123,
      status: 'success',
    });

    const text = await register.metrics();

    // 1) llm_requests_total counter present + incremented for this label set
    expect(text).toMatch(
      /llm_requests_total\{[^}]*model="claude-sonnet-4"[^}]*provider="anthropic"[^}]*status="success"[^}]*\}\s+1/,
    );

    // 2) llm_ttft_ms histogram present (sum + bucket lines)
    expect(text).toContain('llm_ttft_ms_bucket{');
    expect(text).toMatch(
      /llm_ttft_ms_bucket\{[^}]*model="claude-sonnet-4"[^}]*provider="anthropic"[^}]*status="success"/,
    );
    // The TTFT sample is 123ms so the +Inf bucket must include it
    expect(text).toMatch(
      /llm_ttft_ms_sum\{[^}]*model="claude-sonnet-4"[^}]*\}\s+123/,
    );

    // 3) llm_tpot_ms histogram present (4567ms / 42 completion tokens ≈ 108.74 ms/token)
    expect(text).toContain('llm_tpot_ms_bucket{');
    expect(text).toMatch(
      /llm_tpot_ms_bucket\{[^}]*model="claude-sonnet-4"[^}]*provider="anthropic"[^}]*status="success"/,
    );

    // 4) llm_request_duration_ms histogram present + observed at 4567ms
    expect(text).toContain('llm_request_duration_ms_bucket{');
    expect(text).toMatch(
      /llm_request_duration_ms_bucket\{[^}]*model="claude-sonnet-4"[^}]*provider="anthropic"[^}]*status="success"/,
    );
    expect(text).toMatch(
      /llm_request_duration_ms_sum\{[^}]*model="claude-sonnet-4"[^}]*\}\s+4567/,
    );
  });

  it('defaults unknown label values to "unknown" (never empty)', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      // model present but providerType empty + status omitted
      providerType: '',
      model: 'gpt-oss:20b',
      requestType: 'chat',
      promptTokens: 10,
      completionTokens: 5,
      totalDurationMs: 200,
      timeToFirstTokenMs: 50,
    });

    const text = await register.metrics();
    // The Counter must still tick — empty labels would otherwise leave the
    // series invisible to PromQL aggregations.
    expect(text).toMatch(
      /llm_requests_total\{[^}]*model="gpt-oss:20b"[^}]*provider="unknown"[^}]*status="success"[^}]*\}\s+1/,
    );
  });

  it('skips ttft/tpot/duration observes when their inputs are missing/negative', async () => {
    const svc = LLMMetricsService.getInstance();
    await svc.logRequest({
      providerType: 'ollama',
      model: 'minimal-test-model',
      requestType: 'chat',
      // intentionally omit timeToFirstTokenMs, totalDurationMs, completionTokens
      promptTokens: 1,
      status: 'success',
    });

    const text = await register.metrics();
    // The Counter still ticks (it's the cardinal series)
    expect(text).toMatch(
      /llm_requests_total\{[^}]*model="minimal-test-model"[^}]*\}\s+1/,
    );
    // But there should be no sum row for ttft/tpot/duration for this model
    expect(text).not.toMatch(/llm_ttft_ms_sum\{[^}]*model="minimal-test-model"/);
    expect(text).not.toMatch(/llm_tpot_ms_sum\{[^}]*model="minimal-test-model"/);
    expect(text).not.toMatch(/llm_request_duration_ms_sum\{[^}]*model="minimal-test-model"/);
  });
});
