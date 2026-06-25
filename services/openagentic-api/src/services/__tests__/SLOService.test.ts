/**
 * SLOService — TDD spec (Phase 12).
 *
 * In-memory CRUD on SLODefinition rows for the V3 metrics registry.
 * Phase 12 ships read + mutate; persistence to DB is a follow-up.
 *
 * Coverage:
 *  1. DEFAULT_SLOS contains entries (>= 8) covering each major V3 surface.
 *  2. listSLOs returns DEFAULT_SLOS on a fresh service instance.
 *  3. getSLO returns the matching row by metric name.
 *  4. upsertSLO inserts new and overwrites existing.
 *  5. toggleSLO flips the enabled flag in place.
 *  6. deleteSLO removes the row.
 *  7. Each default SLO references a metric that exists in V3MetricsRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SLOService,
  DEFAULT_SLOS,
  type SLODefinition,
} from '../SLOService.js';
import { v3Metrics } from '../V3MetricsRegistry.js';

describe('DEFAULT_SLOS', () => {
  it('contains >= 8 SLOs covering each major V3 surface', () => {
    expect(DEFAULT_SLOS.length).toBeGreaterThanOrEqual(8);
  });

  it('every default SLO references a metric that exists in V3MetricsRegistry', () => {
    const known = new Set(
      Object.values(v3Metrics).map((m: any) => m.name as string),
    );
    for (const slo of DEFAULT_SLOS) {
      expect(known.has(slo.metric)).toBe(true);
    }
  });

  it('every default SLO has a non-empty description and a sane window', () => {
    for (const slo of DEFAULT_SLOS) {
      expect(slo.description.length).toBeGreaterThan(0);
      expect(['1h', '6h', '24h', '7d']).toContain(slo.window);
      expect(['p99', 'error_rate', 'rps_floor']).toContain(slo.type);
      expect(typeof slo.threshold).toBe('number');
      expect(typeof slo.enabled).toBe('boolean');
    }
  });
});

describe('SLOService — CRUD', () => {
  let svc: SLOService;
  beforeEach(() => {
    svc = new SLOService();
  });

  it('listSLOs() returns the seeded defaults on a fresh instance', () => {
    const list = svc.listSLOs();
    expect(list.length).toBe(DEFAULT_SLOS.length);
    expect(list.map((s) => s.metric).sort()).toEqual(
      DEFAULT_SLOS.map((s) => s.metric).sort(),
    );
  });

  it('getSLO(metric) returns the matching row', () => {
    const sample = DEFAULT_SLOS[0];
    const got = svc.getSLO(sample.metric);
    expect(got).toBeDefined();
    expect(got!.metric).toBe(sample.metric);
  });

  it('getSLO(unknown) returns undefined', () => {
    expect(svc.getSLO('v3_nonexistent_metric')).toBeUndefined();
  });

  it('upsertSLO inserts a new SLO', () => {
    const slo: SLODefinition = {
      metric: 'v3_audience_routes_total',
      type: 'rps_floor',
      threshold: 0.1,
      window: '1h',
      description: 'audience routing must see >= 0.1 rps',
      enabled: true,
    };
    svc.upsertSLO(slo);
    const got = svc.getSLO('v3_audience_routes_total');
    expect(got).toEqual(slo);
  });

  it('upsertSLO overwrites an existing SLO', () => {
    const sample = DEFAULT_SLOS[0];
    const updated: SLODefinition = {
      ...sample,
      threshold: 999,
      description: 'updated',
    };
    svc.upsertSLO(updated);
    const got = svc.getSLO(sample.metric);
    expect(got!.threshold).toBe(999);
    expect(got!.description).toBe('updated');
  });

  it('toggleSLO flips enabled flag', () => {
    const sample = DEFAULT_SLOS[0];
    const before = svc.getSLO(sample.metric)!.enabled;
    const after = svc.toggleSLO(sample.metric)!;
    expect(after.enabled).toBe(!before);
    const again = svc.toggleSLO(sample.metric)!;
    expect(again.enabled).toBe(before);
  });

  it('toggleSLO returns undefined for unknown metric', () => {
    expect(svc.toggleSLO('v3_nonexistent_metric')).toBeUndefined();
  });

  it('deleteSLO removes the row and returns true', () => {
    const sample = DEFAULT_SLOS[0];
    expect(svc.deleteSLO(sample.metric)).toBe(true);
    expect(svc.getSLO(sample.metric)).toBeUndefined();
  });

  it('deleteSLO returns false for unknown metric', () => {
    expect(svc.deleteSLO('v3_nonexistent_metric')).toBe(false);
  });
});
