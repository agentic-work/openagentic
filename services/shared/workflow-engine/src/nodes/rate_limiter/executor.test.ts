/**
 * rate_limiter node executor — fixed-window throttle.
 *
 * Public contract:
 *  - settings: { key (required, templated), maxCalls (default 10), windowSeconds (default 60), onLimit ('block'|'drop'|'error', default 'block') }
 *  - per-call: increments counter for the (key, windowStart) bucket
 *  - when counter exceeds maxCalls within the window:
 *      onLimit=block  → sleep until window resets, then allow
 *      onLimit=drop   → return { limited:true, throttled:true } without sleeping
 *      onLimit=error  → throw
 *  - output: { allowed, limited, key, calls, maxCalls, windowSeconds, waitedMs }
 *
 * Scope: in-memory per-process counter map. Single-replica accurate; multi-
 * replica buckets diverge by replica count. Future V1.1: redis-backed scope.
 *
 * TDD: write failing first, implement minimal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute, _resetForTests } from './executor.js';
import type { NodeExecutionContext, WorkflowNode } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-rl-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>): WorkflowNode => ({
  id: 'n_rl',
  type: 'rate_limiter',
  data,
}) as any;

beforeEach(() => {
  _resetForTests();
});

describe('rate_limiter/executor', () => {
  it('allows the first N calls within the window without delay', async () => {
    const ctx = makeCtx();
    const start = Date.now();
    for (let i = 0; i < 3; i++) {
      const out: any = await execute(
        mk({ key: 'api:openai', maxCalls: 5, windowSeconds: 60, onLimit: 'drop' }),
        {},
        ctx,
      );
      expect(out.allowed).toBe(true);
      expect(out.limited).toBe(false);
      expect(out.calls).toBe(i + 1);
    }
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('drops the call when over the limit if onLimit=drop', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 2; i++) {
      await execute(mk({ key: 'api:foo', maxCalls: 2, windowSeconds: 60, onLimit: 'drop' }), {}, ctx);
    }
    const out: any = await execute(
      mk({ key: 'api:foo', maxCalls: 2, windowSeconds: 60, onLimit: 'drop' }),
      {},
      ctx,
    );
    expect(out.allowed).toBe(false);
    expect(out.limited).toBe(true);
    expect(out.calls).toBe(3);
  });

  it('throws when over the limit if onLimit=error', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 2; i++) {
      await execute(mk({ key: 'api:err', maxCalls: 2, windowSeconds: 60, onLimit: 'error' }), {}, ctx);
    }
    await expect(
      execute(mk({ key: 'api:err', maxCalls: 2, windowSeconds: 60, onLimit: 'error' }), {}, ctx),
    ).rejects.toThrow(/rate.*limit|throttled|exceeded/i);
  });

  it('blocks (sleeps) until window reset when onLimit=block', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 2; i++) {
      await execute(mk({ key: 'api:block', maxCalls: 2, windowSeconds: 1, onLimit: 'block' }), {}, ctx);
    }
    const start = Date.now();
    const out: any = await execute(
      mk({ key: 'api:block', maxCalls: 2, windowSeconds: 1, onLimit: 'block' }),
      {},
      ctx,
    );
    const elapsed = Date.now() - start;
    expect(out.allowed).toBe(true);
    expect(out.waitedMs).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThan(100);
    expect(elapsed).toBeLessThan(2000);
  }, 5000);

  it('isolates buckets by key (different keys don\'t share counters)', async () => {
    const ctx = makeCtx();
    await execute(mk({ key: 'api:a', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' }), {}, ctx);
    const out: any = await execute(
      mk({ key: 'api:b', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' }),
      {},
      ctx,
    );
    expect(out.allowed).toBe(true);
    expect(out.calls).toBe(1);
  });

  it('isolates buckets by tenant (cross-tenant counters do not collide)', async () => {
    const ctxA = makeCtx();
    const ctxB = { ...makeCtx(), tenantId: 'tenant-b' } as NodeExecutionContext;
    await execute(mk({ key: 'shared', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' }), {}, ctxA);
    const out: any = await execute(
      mk({ key: 'shared', maxCalls: 1, windowSeconds: 60, onLimit: 'drop' }),
      {},
      ctxB,
    );
    expect(out.allowed).toBe(true);
  });

  it('rejects missing key', async () => {
    await expect(
      execute(mk({ key: '', maxCalls: 1, windowSeconds: 60 }), {}, makeCtx()),
    ).rejects.toThrow(/key|required/i);
  });
});
