/**
 * Test B — ApprovalRegistry: in-process Deferred map + timeout.
 *
 * waitFor(auditId) resolves when submit() fires, or 'timed_out' on timeout.
 * Single-resolve guaranteed (no double-resolve race). Uses fake timers for
 * the timeout path.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApprovalRegistry } from '../ApprovalRegistry.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ApprovalRegistry.submit / waitFor', () => {
  it('submit(id, true) resolves waitFor to "approved"', async () => {
    const reg = new ApprovalRegistry();
    const p = reg.waitFor('a1', 10_000);
    expect(reg.submit('a1', true)).toBe(true);
    await expect(p).resolves.toBe('approved');
  });

  it('submit(id, false) resolves waitFor to "denied"', async () => {
    const reg = new ApprovalRegistry();
    const p = reg.waitFor('a2', 10_000);
    expect(reg.submit('a2', false)).toBe(true);
    await expect(p).resolves.toBe('denied');
  });

  it('submit on unknown id returns false', () => {
    const reg = new ApprovalRegistry();
    expect(reg.submit('does-not-exist', true)).toBe(false);
  });

  it('double-submit: second submit returns false (idempotent)', async () => {
    const reg = new ApprovalRegistry();
    const p = reg.waitFor('a3', 10_000);
    expect(reg.submit('a3', true)).toBe(true);
    expect(reg.submit('a3', true)).toBe(false);
    await expect(p).resolves.toBe('approved');
  });
});

describe('ApprovalRegistry timeout', () => {
  it('resolves "timed_out" after timeoutMs and clears the entry', async () => {
    vi.useFakeTimers();
    const reg = new ApprovalRegistry();
    const p = reg.waitFor('t1', 50);
    expect(reg.has('t1')).toBe(true);
    vi.advanceTimersByTime(50);
    await expect(p).resolves.toBe('timed_out');
    expect(reg.has('t1')).toBe(false);
  });

  it('timeout-then-submit race: submit after timeout returns false (no double-resolve)', async () => {
    vi.useFakeTimers();
    const reg = new ApprovalRegistry();
    const p = reg.waitFor('t2', 50);
    vi.advanceTimersByTime(50);
    await expect(p).resolves.toBe('timed_out');
    expect(reg.submit('t2', true)).toBe(false);
  });
});
