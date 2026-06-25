/**
 * filter_data — executor unit tests.
 *
 * Covers all 12 operators + boundary cases. The harness-level test under
 * services/openagentic-workflows/test/harness/primitives/filter_data.test.ts
 * runs the same executor through the full WorkflowExecutionEngine to
 * verify {{trigger.*}} substitution + node_complete frame contract.
 */

import { describe, it, expect } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-filter-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_filter',
  type: 'filter_data',
  data,
});

describe('filter_data/executor', () => {
  const pods = [
    { name: 'api', status: 'Running', restarts: 0 },
    { name: 'workflows', status: 'Pending', restarts: 8 },
    { name: 'ui', status: 'Running', restarts: 0 },
  ];

  it('eq — exact match keeps matching rows', async () => {
    const out = await execute(
      mk({ field: 'status', operator: 'eq', value: 'Running' }),
      pods,
      makeCtx(),
    );
    expect(out.filtered).toHaveLength(2);
    expect(out.droppedCount).toBe(1);
    expect(out.totalCount).toBe(3);
  });

  it('neq — inverse match', async () => {
    const out = await execute(
      mk({ field: 'status', operator: 'neq', value: 'Running' }),
      pods,
      makeCtx(),
    );
    expect(out.filtered).toHaveLength(1);
  });

  it('gt / gte / lt / lte — numeric comparisons', async () => {
    expect(
      (await execute(mk({ field: 'restarts', operator: 'gt', value: 0 }), pods, makeCtx())).filtered.length,
    ).toBe(1);
    expect(
      (await execute(mk({ field: 'restarts', operator: 'gte', value: 8 }), pods, makeCtx())).filtered.length,
    ).toBe(1);
    expect(
      (await execute(mk({ field: 'restarts', operator: 'lt', value: 8 }), pods, makeCtx())).filtered.length,
    ).toBe(2);
    expect(
      (await execute(mk({ field: 'restarts', operator: 'lte', value: 0 }), pods, makeCtx())).filtered.length,
    ).toBe(2);
  });

  it('contains — substring match for strings', async () => {
    const out = await execute(
      mk({ field: 'name', operator: 'contains', value: 'work' }),
      pods,
      makeCtx(),
    );
    expect(out.filtered).toHaveLength(1);
  });

  it('exists — keeps rows where field is defined and non-null', async () => {
    const items = [{ ip: '1.2.3.4' }, { ip: null }, {}];
    const out = await execute(mk({ field: 'ip', operator: 'exists' }), items, makeCtx());
    expect(out.filtered).toHaveLength(1);
  });

  it('starts_with / ends_with — prefix/suffix match', async () => {
    const items = [{ host: 'foo.io' }, { host: 'bar.com' }];
    expect(
      (await execute(mk({ field: 'host', operator: 'ends_with', value: '.io' }), items, makeCtx())).filtered.length,
    ).toBe(1);
    expect(
      (await execute(mk({ field: 'host', operator: 'starts_with', value: 'bar' }), items, makeCtx())).filtered.length,
    ).toBe(1);
  });

  it('in / not_in — membership tests', async () => {
    const out = await execute(
      mk({ field: 'status', operator: 'in', value: ['Pending', 'Failed'] }),
      pods,
      makeCtx(),
    );
    expect(out.filtered).toHaveLength(1);
    const notOut = await execute(
      mk({ field: 'status', operator: 'not_in', value: ['Running'] }),
      pods,
      makeCtx(),
    );
    expect(notOut.filtered).toHaveLength(1);
  });

  it('matches_regex — pattern match against string field', async () => {
    const out = await execute(
      mk({ field: 'name', operator: 'matches_regex', value: '^(api|ui)$' }),
      pods,
      makeCtx(),
    );
    expect(out.filtered).toHaveLength(2);
  });

  it('throws on unsupported operator', async () => {
    await expect(
      execute(mk({ field: 'status', operator: 'wat', value: 'x' }), pods, makeCtx()),
    ).rejects.toThrow(/unsupported operator/i);
  });

  it('throws when items resolves to non-array', async () => {
    await expect(
      execute(mk({ field: 'status', operator: 'eq', value: 'Running' }), { x: 1 }, makeCtx()),
    ).rejects.toThrow(/must resolve to an array/i);
  });
});
