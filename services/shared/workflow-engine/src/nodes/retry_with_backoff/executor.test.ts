/**
 * retry_with_backoff/executor.test.ts — TDD for the exponential-backoff retry node.
 *
 * Contract:
 *  - data: { maxRetries (default 3), baseDelayMs (default 500), maxDelayMs (default 30000),
 *            backoffFactor (default 2), jitter (default true) }
 *  - drives the downstream operation via ctx.runSubStep (production) or
 *    data._attemptForTests (tests)
 *  - returns { ok:true, attempts, retries, totalDelayMs, result } on first success
 *  - throws a clear error naming the last failure when retries are exhausted
 *  - refuses to run when no operation is wired (no runSubStep + no injected attempt)
 *  - abort-signal aware during backoff sleeps
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext, WorkflowNode } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-retry-1',
    tenantId: 'tenant-a',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: 'n_retry', type: 'retry_with_backoff', data }) as any;

describe('retry_with_backoff/executor', () => {
  it('returns immediately on first-attempt success without retrying', async () => {
    const attempt = vi.fn(async () => ({ value: 'ok' }));
    const out: any = await execute(
      mk({ _attemptForTests: attempt, baseDelayMs: 0, jitter: false }),
      {},
      makeCtx(),
    );
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(1);
    expect(out.retries).toBe(0);
    expect(out.totalDelayMs).toBe(0);
    expect(out.result).toEqual({ value: 'ok' });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries on failure then succeeds, reporting attempt count', async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error(`transient ${calls}`);
      return { value: 'recovered' };
    });
    const out: any = await execute(
      mk({ _attemptForTests: attempt, maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitter: false }),
      {},
      makeCtx(),
    );
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(3);
    expect(out.retries).toBe(2);
    expect(out.result).toEqual({ value: 'recovered' });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('throws a clear error after exhausting retries, naming the last failure', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('always boom');
    });
    await expect(
      execute(
        mk({ _attemptForTests: attempt, maxRetries: 2, baseDelayMs: 0, jitter: false }),
        {},
        makeCtx(),
      ),
    ).rejects.toThrow(/retry_with_backoff.*3 attempt.*always boom/i);
    // 1 initial + 2 retries
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('honors maxRetries=0 (single attempt, no retry)', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(
      execute(mk({ _attemptForTests: attempt, maxRetries: 0, jitter: false }), {}, makeCtx()),
    ).rejects.toThrow(/1 attempt/i);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('grows the backoff delay exponentially and caps it at maxDelayMs', async () => {
    const attempt = vi.fn(async () => {
      throw new Error('boom');
    });
    const out = execute(
      mk({
        _attemptForTests: attempt,
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 25,
        backoffFactor: 2,
        jitter: false,
      }),
      {},
      makeCtx(),
    );
    // delays (no jitter): 10, 20, min(40,25)=25 → total 55
    await expect(out).rejects.toThrow(/55ms total backoff/);
  });

  it('drives ctx.runSubStep when no test attempt is injected', async () => {
    const runSubStep = vi.fn(async (_id: string, _input: unknown) => ({ via: 'subgraph' }));
    const out: any = await execute(
      mk({ baseDelayMs: 0, jitter: false }),
      { seed: 1 },
      makeCtx({ runSubStep }),
    );
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ via: 'subgraph' });
    expect(runSubStep).toHaveBeenCalledWith('n_retry', { seed: 1 });
  });

  it('refuses to run when no operation is wired (no runSubStep, no injected attempt)', async () => {
    await expect(execute(mk({}), {}, makeCtx())).rejects.toThrow(
      /no operation to retry|runSubStep/i,
    );
  });

  it('aborts promptly when the signal fires before execution', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx = makeCtx({ signal: ctrl.signal });
    await expect(
      execute(mk({ _attemptForTests: async () => ({}) }), {}, ctx),
    ).rejects.toThrow(/aborted/i);
  });
});
