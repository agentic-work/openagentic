/**
 * SandboxResultStore — task #158 unit tests.
 *
 * Mirrors the PendingApprovalStore test pattern. The store has to:
 *   - resolve pending awaits when the UI posts the matching result
 *   - synthesize a TIMEOUT envelope when nothing arrives in time
 *   - report `has()` / `size` correctly
 *   - reject orphan `resolve()` calls (return false)
 *   - clear all pending on shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SandboxResultStore, setSandboxResultStoreForTest } from '../services/SandboxResultStore.js';

describe('SandboxResultStore', () => {
  beforeEach(() => {
    setSandboxResultStoreForTest(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves awaitResult when a matching envelope is posted', async () => {
    const store = new SandboxResultStore();
    const p = store.awaitResult('req-a', 10_000);
    expect(store.has('req-a')).toBe(true);
    const resolved = store.resolve('req-a', {
      requestId: 'req-a',
      ok: true,
      stdout: 'hi',
      stderr: '',
      durationMs: 42,
    });
    expect(resolved).toBe(true);
    const env = await p;
    expect(env.ok).toBe(true);
    expect(env.stdout).toBe('hi');
    expect(store.has('req-a')).toBe(false);
  });

  it('synthesizes a TIMEOUT envelope when no result arrives', async () => {
    const store = new SandboxResultStore();
    const p = store.awaitResult('req-t', 500);
    await vi.advanceTimersByTimeAsync(501);
    const env = await p;
    expect(env.ok).toBe(false);
    expect(env.timedOut).toBe(true);
    expect(env.errorCode).toBe('TIMEOUT');
  });

  it('returns false when resolve() targets an unknown request id', () => {
    const store = new SandboxResultStore();
    const ok = store.resolve('unknown', {
      requestId: 'unknown',
      ok: true,
      stdout: '',
      stderr: '',
      durationMs: 0,
    });
    expect(ok).toBe(false);
  });

  it('clear() resolves all pending awaits with ABORTED', async () => {
    const store = new SandboxResultStore();
    const p1 = store.awaitResult('r1', 10_000);
    const p2 = store.awaitResult('r2', 10_000);
    store.clear();
    const [e1, e2] = await Promise.all([p1, p2]);
    expect(e1.ok).toBe(false);
    expect(e1.errorCode).toBe('ABORTED');
    expect(e2.errorCode).toBe('ABORTED');
    expect(store.size).toBe(0);
  });

  it('size reflects the number of outstanding awaits', () => {
    const store = new SandboxResultStore();
    expect(store.size).toBe(0);
    store.awaitResult('a', 10_000);
    store.awaitResult('b', 10_000);
    expect(store.size).toBe(2);
    store.resolve('a', {
      requestId: 'a',
      ok: true,
      stdout: '',
      stderr: '',
      durationMs: 0,
    });
    expect(store.size).toBe(1);
  });
});
