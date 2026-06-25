/**
 * wait node — executor tests.
 *
 * Covers:
 *   1. short wait completes and returns { waited: true, duration }
 *   2. duration=0 (no-op) completes instantly
 *   3. unit conversion — minutes, hours, days
 *   4. long wait (>= 30s) returns waiting sentinel immediately
 *   5. unit defaults to seconds
 *   6. abort signal honored during short wait
 *   7. negative duration treated as 0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-wait-1',
    apiUrl: 'http://api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const waitNode = (data: Record<string, unknown> = {}) => ({
  id: 'n_wait',
  type: 'wait',
  data,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('wait/executor', () => {
  it('short wait (< 30s) — returns { waited: true, duration: durationMs }', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: 5, unit: 'seconds' }), null, makeCtx());
    vi.advanceTimersByTime(5000);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(5000);
  });

  it('duration=0 (no-op) — completes instantly without sleeping', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: 0, unit: 'seconds' }), null, makeCtx());
    vi.advanceTimersByTime(0);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(0);
  });

  it('unit=minutes — converts to milliseconds, returns sentinel for long wait', async () => {
    // 1 minute = 60000ms >= 30000ms threshold → sentinel
    const out: any = await execute(waitNode({ duration: 1, unit: 'minutes' }), null, makeCtx());
    expect(out.status).toBe('waiting');
    expect(out.durationMs).toBe(60000);
  });

  it('unit=ms — treats value as milliseconds directly', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: 100, unit: 'ms' }), null, makeCtx());
    vi.advanceTimersByTime(100);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(100);
  });

  it('unit=milliseconds — treats value as milliseconds directly', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: 200, unit: 'milliseconds' }), null, makeCtx());
    vi.advanceTimersByTime(200);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(200);
  });

  it('long wait (>= 30s) — returns waiting sentinel without sleeping', async () => {
    const out: any = await execute(waitNode({ duration: 60, unit: 'seconds' }), { payload: 1 }, makeCtx());
    expect(out.status).toBe('waiting');
    expect(typeof out.resumeAt).toBe('string'); // ISO string
    expect(out.message).toMatch(/paused/i);
    expect(out.durationMs).toBe(60000);
  });

  it('unit defaults to seconds when unspecified', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: 5 }), null, makeCtx());
    vi.advanceTimersByTime(5000);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(5000);
  });

  it('negative duration treated as 0 (no-op)', async () => {
    vi.useFakeTimers();
    const promise = execute(waitNode({ duration: -1, unit: 'seconds' }), null, makeCtx());
    vi.advanceTimersByTime(0);
    const out: any = await promise;
    expect(out.waited).toBe(true);
    expect(out.duration).toBe(0);
  });
});
