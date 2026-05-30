/**
 * anomaly_detect node — Phase E1 primitive contract.
 *
 * Public contract: pure-compute leave-one-out z-score detection. No HTTP.
 * Takes an upstream numeric array (or inline `node.data.series`) and returns
 * `{ hasAnomaly, anomalies[], stats:{count,mean,stddev}, threshold, method }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';

describe('anomaly_detect node — z-score outliers', () => {
  it('flags a clear outlier in a numeric series', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'an',
            type: 'anomaly_detect',
            data: {
              method: 'zscore',
              threshold: 3,
              series: [10, 11, 9, 10, 11, 10, 9, 1000],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'an' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.an as {
      hasAnomaly: boolean;
      anomalies: Array<{ index: number; value: number; zscore: number }>;
      stats: { count: number; mean: number; stddev: number };
      threshold: number;
      method: string;
    };
    expect(out.hasAnomaly).toBe(true);
    expect(out.method).toBe('zscore');
    expect(out.threshold).toBe(3);
    expect(out.anomalies.length).toBeGreaterThan(0);
    // The 1000 entry is the outlier
    expect(out.anomalies.some((a) => a.value === 1000)).toBe(true);
    expect(out.stats.count).toBe(8);
  });

  it('returns hasAnomaly:false on a uniform series', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'an',
            type: 'anomaly_detect',
            data: { method: 'zscore', threshold: 3, series: [5, 5, 5, 5, 5, 5] },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'an' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.an as { hasAnomaly: boolean; anomalies: unknown[] };
    expect(out.hasAnomaly).toBe(false);
    expect(out.anomalies).toEqual([]);
  });
});
