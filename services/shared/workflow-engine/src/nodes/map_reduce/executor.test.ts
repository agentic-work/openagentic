/**
 * map_reduce/executor.test.ts — TDD for the fan-out + reduce node.
 *
 * Contract:
 *  - data: { items (template/array), itemVariable (default 'item'),
 *            concurrency (default 1), reduce ('collect'|'concat'|'sum'|'avg'|'min'|'max'|'count') }
 *  - MAP: runs the downstream subgraph per item via ctx.iterateOver(id, items, var, input, concurrency)
 *  - REDUCE: folds per-item results per the strategy
 *  - empty collection → reduce identity, no subgraph run
 *  - non-collection input with no items → throws a clear error
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext, WorkflowNode } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-mr-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    // default iterateOver: identity map (returns each item verbatim)
    iterateOver: vi.fn(async (_id, items) => items.map((it) => it)),
    ...overrides,
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: 'n_mr', type: 'map_reduce', data }) as any;

describe('map_reduce/executor', () => {
  it('maps over the upstream input array (items unset) and collects results', async () => {
    const ctx = makeCtx();
    const out: any = await execute(mk({ reduce: 'collect' }), [1, 2, 3], ctx);
    expect(out.itemCount).toBe(3);
    expect(out.mapped).toEqual([1, 2, 3]);
    expect(out.output).toEqual([1, 2, 3]);
    expect(ctx.iterateOver).toHaveBeenCalledWith('n_mr', [1, 2, 3], 'item', [1, 2, 3], 1);
  });

  it('passes the configured concurrency limit to iterateOver', async () => {
    const ctx = makeCtx();
    await execute(mk({ concurrency: 5 }), ['a', 'b'], ctx);
    expect(ctx.iterateOver).toHaveBeenCalledWith('n_mr', ['a', 'b'], 'item', ['a', 'b'], 5);
  });

  it('reduces with sum over numeric per-item results', async () => {
    const ctx = makeCtx({ iterateOver: vi.fn(async () => [10, 20, 30]) });
    const out: any = await execute(mk({ reduce: 'sum' }), [1, 2, 3], ctx);
    expect(out.output).toBe(60);
    expect(out.reduceStrategy).toBe('sum');
  });

  it('reduces with count', async () => {
    const ctx = makeCtx({ iterateOver: vi.fn(async () => ['x', 'y', 'z', 'w']) });
    const out: any = await execute(mk({ reduce: 'count' }), [1, 2, 3, 4], ctx);
    expect(out.output).toBe(4);
  });

  it('reduces with concat by flattening per-item arrays', async () => {
    const ctx = makeCtx({ iterateOver: vi.fn(async () => [[1, 2], [3], [4, 5]]) });
    const out: any = await execute(mk({ reduce: 'concat' }), [1, 2, 3], ctx);
    expect(out.output).toEqual([1, 2, 3, 4, 5]);
  });

  it('reduces with avg / min / max', async () => {
    const make = (vals: number[]) => makeCtx({ iterateOver: vi.fn(async () => vals) });
    const avg: any = await execute(mk({ reduce: 'avg' }), [1, 2], make([2, 4, 6]));
    expect(avg.output).toBe(4);
    const min: any = await execute(mk({ reduce: 'min' }), [1, 2], make([9, 3, 7]));
    expect(min.output).toBe(3);
    const max: any = await execute(mk({ reduce: 'max' }), [1, 2], make([9, 3, 7]));
    expect(max.output).toBe(9);
  });

  it('resolves a JSON-string items field into an array', async () => {
    const ctx = makeCtx();
    const out: any = await execute(mk({ items: '[1,2,3,4]', reduce: 'count' }), {}, ctx);
    expect(out.output).toBe(4);
    expect(ctx.iterateOver).toHaveBeenCalledWith('n_mr', [1, 2, 3, 4], 'item', {}, 1);
  });

  it('empty collection returns the reduce identity with no subgraph run', async () => {
    const iterateOver = vi.fn(async () => []);
    const ctx = makeCtx({ iterateOver });
    const collect: any = await execute(mk({ items: '[]', reduce: 'collect' }), {}, ctx);
    expect(collect.itemCount).toBe(0);
    expect(collect.output).toEqual([]);
    const sum: any = await execute(mk({ items: '[]', reduce: 'sum' }), {}, ctx);
    expect(sum.output).toBe(0);
    const count: any = await execute(mk({ items: '[]', reduce: 'count' }), {}, ctx);
    expect(count.output).toBe(0);
    expect(iterateOver).not.toHaveBeenCalled();
  });

  it('throws a clear error when input is not a collection and items is unset', async () => {
    await expect(execute(mk({}), { notAnArray: true }, makeCtx())).rejects.toThrow(
      /no collection to map over|not an array/i,
    );
  });

  it('throws a clear error when items does not resolve to an array', async () => {
    await expect(
      execute(mk({ items: 'not json and not an array' }), {}, makeCtx()),
    ).rejects.toThrow(/did not resolve to an array/i);
  });

  it('rejects an unknown reduce strategy', async () => {
    await expect(
      execute(mk({ items: '[1]', reduce: 'bogus' }), {}, makeCtx()),
    ).rejects.toThrow(/unknown reduce strategy/i);
  });

  it('throws when iterateOver hook is missing (engine not wired)', async () => {
    const ctx = makeCtx({ iterateOver: undefined });
    await expect(execute(mk({ items: '[1,2]' }), {}, ctx)).rejects.toThrow(/iterateOver/i);
  });
});
