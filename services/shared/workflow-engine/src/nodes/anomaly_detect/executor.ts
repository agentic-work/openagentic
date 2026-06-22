/**
 * anomaly_detect node executor.
 *
 * v1: z-score (mean + standard deviation). Each point's absolute z-score
 * is compared to the configured threshold (default 3-sigma); points
 * above the threshold are flagged. Output exposes a top-level
 * `hasAnomaly` boolean so downstream condition nodes can branch
 * cleanly.
 *
 * Series source resolution order:
 *   1. `input` parameter (from the connected upstream node's output)
 *   2. `node.data.series` (literal fallback for standalone nodes)
 *
 * Object series: when the input is an array of objects, set
 * `node.data.field` to the numeric field name. The flagged anomaly
 * records carry the original object back to the caller for downstream
 * context (timestamp, label, etc.).
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

interface Anomaly {
  index: number;
  value: number;
  zscore: number;
  record?: unknown;
}

interface AnomalyResult {
  hasAnomaly: boolean;
  anomalies: Anomaly[];
  stats: { count: number; mean: number; stddev: number };
  threshold: number;
  method: string;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  _ctx: NodeExecutionContext,
): Promise<AnomalyResult> {
  const data = node.data as Record<string, any>;
  const method: string = data.method ?? 'zscore';
  const threshold: number = typeof data.threshold === 'number' ? data.threshold : 3;
  const field: string | undefined = data.field;

  if (method !== 'zscore') {
    throw new Error(`anomaly_detect: unsupported method '${method}' — v1 only supports 'zscore'`);
  }

  // Resolve series: connected input wins; fall back to inline node.data.series.
  const rawSeries: unknown = Array.isArray(input) ? input : data.series;
  if (!Array.isArray(rawSeries) || rawSeries.length === 0) {
    throw new Error('anomaly_detect: series is required (connect an upstream array or set the inline series)');
  }
  if (rawSeries.length < 2) {
    throw new Error('anomaly_detect: series must have at least 2 points to compute stddev');
  }

  // Project to numeric values (carry the original record alongside for object series).
  const points: Array<{ value: number; record?: unknown }> = rawSeries.map((row, i) => {
    if (typeof row === 'number' && Number.isFinite(row)) return { value: row };
    if (row !== null && typeof row === 'object') {
      const v = field ? (row as Record<string, unknown>)[field] : undefined;
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, record: row };
    }
    throw new Error(
      `anomaly_detect: series[${i}] is not a finite number${field ? ` and field '${field}' is missing or non-numeric` : ''}`,
    );
  });

  const values = points.map(p => p.value);
  const n = values.length;
  const totalSum = values.reduce((s, v) => s + v, 0);
  const totalSumSq = values.reduce((s, v) => s + v * v, 0);
  const populationMean = totalSum / n;
  const populationVariance = totalSumSq / n - populationMean * populationMean;
  const populationStddev = Math.sqrt(Math.max(0, populationVariance));

  // Leave-one-out z-score: the standard formulation for outlier
  // detection. For each candidate point i, recompute mean/stddev over
  // the OTHER N-1 points so the outlier doesn't drag its own baseline.
  // Naive z-score has a hard ceiling of sqrt(N-1) per point — a single
  // value of 1000 in a series of 7 normals never exceeds 3σ at N=8.
  // Operator intuition ("is this point unusual vs the rest?") matches
  // leave-one-out, not the population z-score.
  const anomalies: Anomaly[] = [];
  if (populationStddev > 0) {
    for (let i = 0; i < n; i++) {
      const looMean = (totalSum - values[i]) / (n - 1);
      const looVar = (totalSumSq - values[i] * values[i]) / (n - 1) - looMean * looMean;
      const looStddev = Math.sqrt(Math.max(0, looVar));

      let z: number;
      if (looStddev === 0) {
        // Flat baseline: all other points identical. Either the candidate
        // matches the baseline (z = 0, no anomaly) or it differs by ANY
        // amount (infinite sigmas, definite anomaly).
        z = values[i] === looMean ? 0 : Infinity;
      } else {
        z = Math.abs((values[i] - looMean) / looStddev);
      }

      if (z > threshold) {
        const a: Anomaly = { index: i, value: values[i], zscore: z };
        if (points[i].record !== undefined) a.record = points[i].record;
        anomalies.push(a);
      }
    }
  }

  return {
    hasAnomaly: anomalies.length > 0,
    anomalies,
    // stats expose the *population* mean/stddev (what an operator
    // sees on a dashboard); the leave-one-out values are an
    // implementation detail of the scoring loop.
    stats: { count: n, mean: populationMean, stddev: populationStddev },
    threshold,
    method,
  };
}
