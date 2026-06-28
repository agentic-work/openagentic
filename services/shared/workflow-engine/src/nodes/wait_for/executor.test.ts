/**
 * wait_for — executor unit tests (RED first per TDD).
 *
 * Covers:
 *  - immediate satisfy on truthy first poll
 *  - polls multiple times when initially falsy then satisfies
 *  - timeout returns satisfied=false + timedOut=true
 *  - failOnTimeout=true raises node_error
 *  - missing condition raises a clear error
 *  - aborted signal stops the poll loop
 */

import { describe, it, expect, vi } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-wf-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as NodeExecutionContext;
}

const mk = (data: Record<string, unknown>) => ({
  id: 'n_wf',
  type: 'wait_for',
  data,
});

describe('wait_for/executor', () => {
  it('returns satisfied immediately when condition is truthy on first poll', async () => {
    const out = await execute(
      mk({ condition: 'input.status === "done"' }),
      { status: 'done' },
      makeCtx(),
    );
    expect(out.satisfied).toBe(true);
    expect(out.polls).toBe(1);
    expect(out.timedOut).toBe(false);
    expect(out.lastValue).toBe(true);
  });

  it('times out when condition stays falsy', async () => {
    const out = await execute(
      mk({ condition: 'input.status === "done"', pollIntervalSeconds: 1, timeoutSeconds: 2 }),
      { status: 'pending' },
      makeCtx(),
    );
    expect(out.satisfied).toBe(false);
    expect(out.timedOut).toBe(true);
    // 2-second timeout with 1-second polls = ~2 polls
    expect(out.polls).toBeGreaterThanOrEqual(2);
    expect(out.durationMs).toBeGreaterThanOrEqual(1000);
  });

  it('failOnTimeout=true raises node_error', async () => {
    await expect(
      execute(
        mk({ condition: 'input.x', pollIntervalSeconds: 1, timeoutSeconds: 1, failOnTimeout: true }),
        { x: false },
        makeCtx(),
      ),
    ).rejects.toThrow(/wait_for.*falsy.*polls/);
  });

  it('rejects empty condition', async () => {
    await expect(
      execute(mk({ condition: '' }), {}, makeCtx()),
    ).rejects.toThrow(/condition.*required/i);
  });

  it('aborts cleanly when ctx.signal fires mid-poll', async () => {
    const ctrl = new AbortController();
    const ctx: NodeExecutionContext = {
      signal: ctrl.signal,
      executionId: 'exec-abort',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    } as unknown as NodeExecutionContext;
    const p = execute(
      mk({ condition: 'input.never', pollIntervalSeconds: 5, timeoutSeconds: 30 }),
      { never: false },
      ctx,
    );
    setTimeout(() => ctrl.abort(), 100);
    await expect(p).rejects.toThrow(/aborted/);
  });
});
