/**
 * Promql query taxonomy for the LLM Performance dashboard tab — TDD spec.
 *
 * The dashboard pulls live gen_ai.* metrics through the existing
 * /api/admin/prom proxy. These query strings are the contract between
 * the metrics emitted in services/openagentic-api/src/metrics/index.ts
 * (commit edb4bf9c) and the chart panels.
 *
 * Tests assert:
 *  1. Window mapping (1h/6h/12h/24h/7d/30d/90d) → reasonable PromQL rate window
 *  2. Each query references the right gen_ai_* metric name + label set
 *  3. Cache-hit-rate handles the empty-traffic case (no div-by-zero)
 *  4. Error-percent same div-by-zero guard
 */
import { describe, it, expect } from 'vitest';
import {
  rateWindowFor,
  ttftQuantile,
  tpotQuantile,
  operationDurationQuantile,
  requestRate,
  requestRateByModel,
  tokensRateByType,
  tokensRateByModel,
  cacheHitRate,
  finishReasonRate,
  errorRateByClass,
  errorPercent,
} from '../promQueries.js';

describe('rateWindowFor', () => {
  it('maps short windows to 5m', () => {
    expect(rateWindowFor('1h')).toBe('5m');
    expect(rateWindowFor('6h')).toBe('5m');
  });
  it('maps medium windows to 15m', () => {
    expect(rateWindowFor('12h')).toBe('15m');
    expect(rateWindowFor('24h')).toBe('15m');
  });
  it('maps multi-day windows to 1h or 6h', () => {
    expect(rateWindowFor('7d')).toBe('1h');
    expect(rateWindowFor('30d')).toBe('6h');
    expect(rateWindowFor('90d')).toBe('6h');
  });
});

describe('latency quantile queries', () => {
  it('ttftQuantile uses gen_ai_server_time_to_first_token_seconds_bucket + histogram_quantile', () => {
    const q = ttftQuantile('24h', 0.95);
    expect(q).toContain('histogram_quantile(0.95');
    expect(q).toContain('gen_ai_server_time_to_first_token_seconds_bucket');
    expect(q).toContain('rate(');
    expect(q).toContain('[15m]');
    // Must keep provider+model labels so the panel can split per-model
    expect(q).toContain('sum by (le, provider, model)');
  });

  it('tpotQuantile uses gen_ai_server_time_per_output_token_seconds_bucket', () => {
    const q = tpotQuantile('1h', 0.99);
    expect(q).toContain('gen_ai_server_time_per_output_token_seconds_bucket');
    expect(q).toContain('histogram_quantile(0.99');
    expect(q).toContain('[5m]');
  });

  it('operationDurationQuantile uses gen_ai_client_operation_duration_seconds_bucket', () => {
    const q = operationDurationQuantile('7d', 0.5);
    expect(q).toContain('gen_ai_client_operation_duration_seconds_bucket');
    expect(q).toContain('histogram_quantile(0.5');
    expect(q).toContain('[1h]');
  });
});

describe('throughput queries', () => {
  it('requestRate sums rate of operation_duration_seconds_count', () => {
    const q = requestRate('1h');
    expect(q).toContain('sum(rate(gen_ai_client_operation_duration_seconds_count[5m]))');
  });
  it('requestRateByModel splits by provider + model', () => {
    const q = requestRateByModel('24h');
    expect(q).toContain('sum by (provider, model)');
    expect(q).toContain('gen_ai_client_operation_duration_seconds_count');
    expect(q).toContain('[15m]');
  });
});

describe('token-economics queries', () => {
  it('tokensRateByType groups by token_type', () => {
    const q = tokensRateByType('1h');
    expect(q).toContain('sum by (token_type)');
    expect(q).toContain('gen_ai_client_token_usage_total');
    expect(q).toContain('[5m]');
  });
  it('tokensRateByModel groups by provider+model', () => {
    const q = tokensRateByModel('24h');
    expect(q).toContain('sum by (provider, model)');
  });
  it('cacheHitRate is a percent expression with epsilon guard', () => {
    const q = cacheHitRate('1h');
    expect(q).toContain('token_type="cached"');
    expect(q).toContain('token_type=~"cached|input"');
    expect(q).toContain('* 100');
    expect(q).toContain('+ 1e-9');
  });
});

describe('reliability + quality queries', () => {
  it('finishReasonRate groups by finish_reason', () => {
    const q = finishReasonRate('24h');
    expect(q).toContain('sum by (finish_reason)');
    expect(q).toContain('gen_ai_finish_reasons_total');
  });
  it('errorRateByClass groups by error_class', () => {
    const q = errorRateByClass('1h');
    expect(q).toContain('sum by (error_class)');
    expect(q).toContain('gen_ai_errors_total');
  });
  it('errorPercent is a percent expression with epsilon guard', () => {
    const q = errorPercent('24h');
    expect(q).toContain('gen_ai_errors_total');
    expect(q).toContain('gen_ai_client_operation_duration_seconds_count');
    expect(q).toContain('* 100');
    expect(q).toContain('+ 1e-9');
  });
});
