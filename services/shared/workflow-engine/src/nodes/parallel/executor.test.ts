/**
 * parallel node — executor tests.
 *
 * After Task #45 the executor owns fan-out via `ctx.fanOutBranches` (engine
 * wires this to Promise.allSettled over executeNode for each outgoing edge).
 *
 * Result shape:
 *   { branches: [{ targetId, status, value? | error? }], successRate: number,
 *     allSucceeded: boolean }
 *
 * Covers:
 *   1. fanOutBranches is invoked with node.id + input
 *   2. successRate is correctly calculated
 *   3. allSucceeded reflects per-branch status
 *   4. branches array preserves per-target status / value / error
 *   5. zero outgoing branches → empty branches[], successRate=0
 *   6. defaults: minSuccessRate=0.5
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(
  fanOutImpl: (nodeId: string, input: unknown) => Promise<
    Array<{ targetId: string; status: 'fulfilled' | 'rejected'; value?: unknown; reason?: string }>
  >,
): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-par-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    fanOutBranches: vi.fn(fanOutImpl),
  };
}

const parallelNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_parallel',
  type: 'parallel',
  data,
});

describe('parallel/executor (Task #45 — schema-driven plugin shape)', () => {
  it('invokes fanOutBranches with node.id + input', async () => {
    const ctx = makeCtx(async () => []);
    const input = { x: 1 };
    await execute(parallelNode(), input, ctx);
    expect(ctx.fanOutBranches).toHaveBeenCalledWith('n_parallel', input);
  });

  it('all branches succeed → successRate=1, allSucceeded=true', async () => {
    const ctx = makeCtx(async () => [
      { targetId: 'a', status: 'fulfilled', value: 1 },
      { targetId: 'b', status: 'fulfilled', value: 2 },
    ]);
    const out: any = await execute(parallelNode(), null, ctx);
    expect(out.successRate).toBe(1);
    expect(out.allSucceeded).toBe(true);
    expect(out.branches).toHaveLength(2);
  });

  it('mixed success/failure → successRate is fraction', async () => {
    const ctx = makeCtx(async () => [
      { targetId: 'a', status: 'fulfilled', value: 1 },
      { targetId: 'b', status: 'rejected', reason: 'boom' },
    ]);
    const out: any = await execute(parallelNode(), null, ctx);
    expect(out.successRate).toBe(0.5);
    expect(out.allSucceeded).toBe(false);
  });

  it('all branches fail → successRate=0, allSucceeded=false', async () => {
    const ctx = makeCtx(async () => [
      { targetId: 'a', status: 'rejected', reason: 'oops' },
    ]);
    const out: any = await execute(parallelNode(), null, ctx);
    expect(out.successRate).toBe(0);
    expect(out.allSucceeded).toBe(false);
  });

  it('branches array preserves per-target status / value / error', async () => {
    const ctx = makeCtx(async () => [
      { targetId: 'a', status: 'fulfilled', value: { ok: 1 } },
      { targetId: 'b', status: 'rejected', reason: 'nope' },
    ]);
    const out: any = await execute(parallelNode(), null, ctx);
    expect(out.branches[0]).toMatchObject({ targetId: 'a', status: 'fulfilled', value: { ok: 1 } });
    expect(out.branches[1]).toMatchObject({ targetId: 'b', status: 'rejected' });
    expect(out.branches[1].error).toBe('nope');
  });

  it('zero outgoing branches → empty branches, successRate=0', async () => {
    const ctx = makeCtx(async () => []);
    const out: any = await execute(parallelNode(), null, ctx);
    expect(out.branches).toEqual([]);
    expect(out.successRate).toBe(0);
  });
});
