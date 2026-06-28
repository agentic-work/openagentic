/**
 * anomaly_detect node — executor tests.
 *
 * Keystone AIOps capability per AUDIT-2026-05-03 #3 — statistical anomaly
 * detection over a time-series window. Other AIOps capabilities
 * (policy_guard, change_correlation, runbook_executor) compose off its
 * verdict frame, so the contract is load-bearing.
 *
 * Method v1: z-score (mean + stddev). Threshold defaults to 3.0
 * (3-sigma). Operators get the index, the value, the z-score, and a
 * top-level `hasAnomaly` boolean for downstream branch nodes.
 *
 * Out of scope for v1 (deferred):
 *   • IQR / MAD methods
 *   • EWMA / streaming windows
 *   • Seasonal decomposition
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  return {
    signal: new AbortController().signal,
    executionId: 'exec-anom',
    apiUrl: 'http://stub-api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
    ...overrides,
  } as NodeExecutionContext;
}

const node = (data: Record<string, unknown>) => ({
  id: 'n_anom',
  type: 'anomaly_detect',
  data,
});

describe('anomaly_detect/executor', () => {
  // --------------------------------------------------------------------
  // Numeric series — input is array of numbers
  // --------------------------------------------------------------------

  it('flags a clear outlier in a numeric series', async () => {
    const series = [10, 11, 9, 10, 12, 11, 10, 100]; // 100 is the outlier
    const out: any = await execute(node({ method: 'zscore', threshold: 3 }), series, makeCtx());
    expect(out.hasAnomaly).toBe(true);
    expect(out.anomalies).toHaveLength(1);
    expect(out.anomalies[0].index).toBe(7);
    expect(out.anomalies[0].value).toBe(100);
    expect(out.anomalies[0].zscore).toBeGreaterThan(3);
  });

  it('returns hasAnomaly=false on a tight cluster', async () => {
    const series = [10, 10, 10, 10, 10, 10, 10, 10];
    const out: any = await execute(node({ method: 'zscore', threshold: 3 }), series, makeCtx());
    expect(out.hasAnomaly).toBe(false);
    expect(out.anomalies).toEqual([]);
  });

  it('returns reasonable stats (mean / stddev / count)', async () => {
    const series = [2, 4, 6, 8, 10];
    const out: any = await execute(node({ method: 'zscore', threshold: 3 }), series, makeCtx());
    expect(out.stats.count).toBe(5);
    expect(out.stats.mean).toBeCloseTo(6, 5);
    expect(out.stats.stddev).toBeGreaterThan(2.8);
    expect(out.stats.stddev).toBeLessThan(3.2);
  });

  // --------------------------------------------------------------------
  // Object series — input is array of {timestamp, value} (typical AIOps shape)
  // --------------------------------------------------------------------

  it('extracts numeric field via `field` setting', async () => {
    const series = [
      { ts: 't1', cpu: 10 }, { ts: 't2', cpu: 11 }, { ts: 't3', cpu: 9 },
      { ts: 't4', cpu: 10 }, { ts: 't5', cpu: 12 }, { ts: 't6', cpu: 11 },
      { ts: 't7', cpu: 95 },
    ];
    const out: any = await execute(node({ method: 'zscore', threshold: 3, field: 'cpu' }), series, makeCtx());
    expect(out.hasAnomaly).toBe(true);
    expect(out.anomalies[0].index).toBe(6);
    expect(out.anomalies[0].value).toBe(95);
    // anomaly carries back the original record for downstream context
    expect(out.anomalies[0].record).toMatchObject({ ts: 't7', cpu: 95 });
  });

  // --------------------------------------------------------------------
  // Series source: input vs node.data.series
  // --------------------------------------------------------------------

  it('falls back to node.data.series when input is null', async () => {
    const out: any = await execute(
      node({ method: 'zscore', threshold: 3, series: [1, 1, 1, 1, 99] }),
      null,
      makeCtx(),
    );
    expect(out.hasAnomaly).toBe(true);
    expect(out.anomalies[0].value).toBe(99);
  });

  // --------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------

  it('throws a clean error when no series is provided', async () => {
    await expect(execute(node({ method: 'zscore' }), null, makeCtx())).rejects.toThrow(
      /series.*required|no series/i,
    );
  });

  it('throws when series has fewer than 2 points (no stddev possible)', async () => {
    await expect(execute(node({ method: 'zscore' }), [42], makeCtx())).rejects.toThrow(
      /at least 2|minimum/i,
    );
  });

  it('throws on unsupported method', async () => {
    await expect(
      execute(node({ method: 'iqr' }), [1, 2, 3, 4, 5], makeCtx()),
    ).rejects.toThrow(/method.*supported|unsupported method/i);
  });

  it('handles series with zero variance (all values equal) gracefully', async () => {
    const out: any = await execute(node({ method: 'zscore' }), [5, 5, 5, 5, 5], makeCtx());
    expect(out.hasAnomaly).toBe(false);
    expect(out.stats.stddev).toBe(0);
    expect(out.anomalies).toEqual([]);
  });

  it('default threshold is 3 when not provided', async () => {
    // Noisy baseline (stddev~1) with a mild outlier sitting at ~2.5σ
    // from the others — should NOT be flagged at default threshold=3.
    // Leave-one-out z-score for the 13 against {10,11,9,10,11,9}:
    //   loo mean = 10, loo stddev ≈ 0.89, z = |13-10|/0.89 ≈ 3.35
    // Wait — that exceeds 3. Use a tighter outlier:
    const series = [10, 11, 9, 10, 11, 9, 12]; // 12 is the candidate
    const out: any = await execute(node({ method: 'zscore' }), series, makeCtx());
    expect(out.threshold).toBe(3);
    expect(out.hasAnomaly).toBe(false);
  });

  it('honors a custom (lower) threshold', async () => {
    // Same series — the 12 sits at ~2.2σ; threshold=2 flags it,
    // threshold=3 doesn't. Demonstrates threshold sensitivity.
    const series = [10, 11, 9, 10, 11, 9, 12];
    const out: any = await execute(node({ method: 'zscore', threshold: 2 }), series, makeCtx());
    expect(out.threshold).toBe(2);
    expect(out.hasAnomaly).toBe(true);
  });
});
