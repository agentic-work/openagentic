/**
 * loop node — executor tests.
 *
 * The loop executor resolves the iteration source (input or {{template}})
 * into an array of items, then delegates per-item subgraph execution to the
 * `ctx.iterateOver` hook. The engine wires iterateOver to per-iteration
 * executeNode calls binding the item under `${itemVariable}` in the input.
 *
 * Covers:
 *   1. iterates over input array directly
 *   2. resolves iterateOver template against input → array
 *   3. resolves iterateOver template that returns a JSON-stringified array
 *   4. when ctx.iterateOver is present, the executor calls it with items + var
 *   5. result.iterations is an array (typically the per-iteration outputs)
 *   6. wraps a non-array source into a single-element array
 *   7. defaults: itemVariable='item'
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(
  iterateImpl?: (
    nodeId: string,
    items: ReadonlyArray<unknown>,
    itemVariable: string,
    input: unknown,
  ) => Promise<unknown[]>,
): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-loop-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const parts = k.trim().split('.');
            let v: any = { input };
            for (const p of parts) v = v?.[p];
            return v !== undefined && typeof v !== 'object' ? String(v) : v ?? '';
          })
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    iterateOver:
      iterateImpl ??
      vi.fn(async (_id, items, _var, _input) => items.map((it, i) => ({ idx: i, it }))),
  };
}

const loopNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_loop',
  type: 'loop',
  data,
});

describe('loop/executor (Task #45 — schema-driven plugin shape)', () => {
  it('iterates over array input directly when iterateOver is unset', async () => {
    const ctx = makeCtx();
    const out: any = await execute(loopNode({}), [10, 20, 30], ctx);
    expect(ctx.iterateOver).toHaveBeenCalledWith('n_loop', [10, 20, 30], 'item', [10, 20, 30]);
    expect(out.iterations).toHaveLength(3);
  });

  it('resolves iterateOver template against input → array', async () => {
    // Use a stub interpolateTemplate that returns the underlying array
    // unchanged (engine real impl passes non-string values through).
    const ctrl = new AbortController();
    const iterateImpl = vi.fn(async (_id: string, items: ReadonlyArray<unknown>) =>
      [...items].map((it, i) => ({ idx: i, it })),
    );
    const ctx: NodeExecutionContext = {
      signal: ctrl.signal,
      executionId: 'exec-loop-1',
      apiUrl: 'http://api',
      interpolateTemplate: (_t: string, input: any) => input?.list,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      iterateOver: iterateImpl,
    };
    await execute(
      loopNode({ iterateOver: 'input.list', itemVariable: 'row' }),
      { list: ['a', 'b', 'c'] },
      ctx,
    );
    expect(iterateImpl).toHaveBeenCalled();
    const callArgs: any = iterateImpl.mock.calls[0];
    expect(callArgs[1]).toEqual(['a', 'b', 'c']);
    expect(callArgs[2]).toBe('row');
  });

  it('resolves iterateOver template that returns a JSON-stringified array', async () => {
    const customCtx: NodeExecutionContext = {
      ...makeCtx(),
      // Force the template to return a string of a JSON array.
      interpolateTemplate: () => '["x","y"]',
    };
    await execute(loopNode({ iterateOver: 'input.json' }), {}, customCtx);
    const callArgs: any = (customCtx.iterateOver as any).mock.calls[0];
    expect(callArgs[1]).toEqual(['x', 'y']);
  });

  it('wraps a non-array source into a single-element array', async () => {
    const ctx = makeCtx();
    await execute(loopNode({}), 'singleton', ctx);
    const callArgs: any = (ctx.iterateOver as any).mock.calls[0];
    expect(callArgs[1]).toEqual(['singleton']);
  });

  it('returns iterations array with at least one element when items present', async () => {
    const ctx = makeCtx(async (_id, items) => items.map(it => ({ result: it })));
    const out: any = await execute(loopNode({}), [1, 2], ctx);
    expect(Array.isArray(out.iterations)).toBe(true);
    expect(out.iterations.length).toBeGreaterThan(0);
  });

  it('defaults itemVariable to "item"', async () => {
    const ctx = makeCtx();
    await execute(loopNode({}), [1], ctx);
    const callArgs: any = (ctx.iterateOver as any).mock.calls[0];
    expect(callArgs[2]).toBe('item');
  });

  it('throws when iterateOver hook is unwired', async () => {
    const ctrl = new AbortController();
    const ctx: NodeExecutionContext = {
      signal: ctrl.signal,
      executionId: 'exec-loop-1',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    await expect(execute(loopNode({}), [1], ctx)).rejects.toThrow(/iterateOver/);
  });
});
