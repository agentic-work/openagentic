/**
 * #503 — natural printout pacer.
 *
 * Reference contract: mocks/UX/mock.html lines 378-409. Char-by-char reveal
 * at fixed cadence. NOT the existing useSmoothStreaming — that one cheats
 * with adaptive 3x speed when 500+ chars behind, which produces janky bursts.
 *
 * Cadence defaults match the mock:
 *   - prose: 15ms/char  (~67 chars/sec)
 *   - tool:  20ms/char  (~50 chars/sec)
 *
 * Hook contract: given an `incomingContent` string that may grow over time,
 * return `{ displayed, done }`. When `incomingContent` is `undefined`/empty,
 * displayed is `''` and done is `true`. When `enabled === false`, display
 * is identity (immediate, full content).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTextPacer } from '../useTextPacer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTextPacer — #503 natural printout cadence', () => {
  it('starts empty before any tick', () => {
    const { result } = renderHook(() => useTextPacer('hello world', { intervalMs: 15 }));
    expect(result.current.displayed).toBe('');
    expect(result.current.done).toBe(false);
  });

  it('reveals one char per interval at the requested cadence', () => {
    const { result } = renderHook(() => useTextPacer('abcd', { intervalMs: 15 }));

    act(() => { vi.advanceTimersByTime(15); });
    expect(result.current.displayed).toBe('a');

    act(() => { vi.advanceTimersByTime(15); });
    expect(result.current.displayed).toBe('ab');

    act(() => { vi.advanceTimersByTime(15); });
    expect(result.current.displayed).toBe('abc');

    act(() => { vi.advanceTimersByTime(15); });
    expect(result.current.displayed).toBe('abcd');
    expect(result.current.done).toBe(true);
  });

  it('honors a different intervalMs (tool cadence = 20ms)', () => {
    const { result } = renderHook(() => useTextPacer('xyz', { intervalMs: 20 }));

    act(() => { vi.advanceTimersByTime(19); });
    expect(result.current.displayed).toBe(''); // not yet

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.displayed).toBe('x');

    act(() => { vi.advanceTimersByTime(40); });
    expect(result.current.displayed).toBe('xyz');
    expect(result.current.done).toBe(true);
  });

  it('keeps revealing as incoming content grows', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useTextPacer(s, { intervalMs: 15 }),
      { initialProps: { s: 'ab' } }
    );

    act(() => { vi.advanceTimersByTime(45); });
    expect(result.current.displayed).toBe('ab');
    expect(result.current.done).toBe(true);

    rerender({ s: 'abcde' });
    expect(result.current.done).toBe(false);

    act(() => { vi.advanceTimersByTime(15); });
    expect(result.current.displayed).toBe('abc');

    act(() => { vi.advanceTimersByTime(30); });
    expect(result.current.displayed).toBe('abcde');
    expect(result.current.done).toBe(true);
  });

  it('shows the full string immediately when enabled=false (bypass)', () => {
    const { result } = renderHook(() =>
      useTextPacer('full text right away', { intervalMs: 15, enabled: false })
    );
    expect(result.current.displayed).toBe('full text right away');
    expect(result.current.done).toBe(true);
  });

  it('resets to empty when content shrinks (replaced, not appended)', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useTextPacer(s, { intervalMs: 15 }),
      { initialProps: { s: 'longer text' } }
    );

    act(() => { vi.advanceTimersByTime(15 * 11); });
    expect(result.current.displayed).toBe('longer text');

    rerender({ s: 'short' });
    // After shrink, the displayed must not be longer than the new target
    expect(result.current.displayed.length).toBeLessThanOrEqual('short'.length);
  });

  it('handles empty/undefined input as immediately done', () => {
    const a = renderHook(() => useTextPacer('', { intervalMs: 15 }));
    expect(a.result.current.displayed).toBe('');
    expect(a.result.current.done).toBe(true);

    const b = renderHook(() => useTextPacer(undefined, { intervalMs: 15 }));
    expect(b.result.current.displayed).toBe('');
    expect(b.result.current.done).toBe(true);
  });

  it('clears its timer on unmount (no leaks)', () => {
    const { unmount } = renderHook(() => useTextPacer('abcd', { intervalMs: 15 }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
