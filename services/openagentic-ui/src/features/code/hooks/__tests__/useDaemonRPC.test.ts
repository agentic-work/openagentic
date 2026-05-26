import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useDaemonRPC } from '../useDaemonRPC';

afterEach(() => {
  vi.useRealTimers();
});

describe('useDaemonRPC — call shape', () => {
  it('emits a daemon_request frame with uuid request_id, method, and args', () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let _promise: Promise<unknown> | null = null;
    act(() => {
      _promise = result.current.call('list_skills', { limit: 5 });
    });

    expect(sendWsFrame).toHaveBeenCalledTimes(1);
    const frame = sendWsFrame.mock.calls[0][0] as {
      type: string;
      request_id: string;
      method: string;
      args: Record<string, unknown>;
    };
    expect(frame.type).toBe('daemon_request');
    expect(typeof frame.request_id).toBe('string');
    expect(frame.request_id.length).toBeGreaterThan(0);
    expect(frame.method).toBe('list_skills');
    expect(frame.args).toEqual({ limit: 5 });

    // Silence the unhandled rejection from the un-resolved promise.
    _promise?.catch(() => {});
  });

  it('passes an empty args object when none supplied', () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let _promise: Promise<unknown> | null = null;
    act(() => {
      _promise = result.current.call('ping');
    });

    const frame = sendWsFrame.mock.calls[0][0] as { args: Record<string, unknown> };
    expect(frame.args).toEqual({});

    _promise?.catch(() => {});
  });

  it('uses unique request_ids across multiple calls', () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let p1: Promise<unknown> | null = null;
    let p2: Promise<unknown> | null = null;
    act(() => {
      p1 = result.current.call('a');
      p2 = result.current.call('b');
    });
    const id1 = (sendWsFrame.mock.calls[0][0] as { request_id: string }).request_id;
    const id2 = (sendWsFrame.mock.calls[1][0] as { request_id: string }).request_id;
    expect(id1).not.toBe(id2);

    p1?.catch(() => {});
    p2?.catch(() => {});
  });
});

describe('useDaemonRPC — onResponse correlation', () => {
  it('resolves the matching pending promise with the result payload on ok:true', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('list_skills');
    });
    const requestId = (sendWsFrame.mock.calls[0][0] as { request_id: string })
      .request_id;

    act(() => {
      result.current.onResponse({
        request_id: requestId,
        ok: true,
        result: { skills: [{ name: 'simplify' }] },
      });
    });

    await expect(promise!).resolves.toEqual({ skills: [{ name: 'simplify' }] });
  });

  it('rejects the matching pending promise with the error message on ok:false', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('list_skills');
    });
    const requestId = (sendWsFrame.mock.calls[0][0] as { request_id: string })
      .request_id;

    act(() => {
      result.current.onResponse({
        request_id: requestId,
        ok: false,
        error: 'permission denied',
      });
    });

    await expect(promise!).rejects.toThrow('permission denied');
  });

  it('rejects with a default message when ok:false carries no error string', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('foo');
    });
    const requestId = (sendWsFrame.mock.calls[0][0] as { request_id: string })
      .request_id;

    act(() => {
      result.current.onResponse({ request_id: requestId, ok: false });
    });

    await expect(promise!).rejects.toThrow(/daemon error/i);
  });

  it('ignores responses for unknown request_ids without throwing', () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    expect(() => {
      act(() => {
        result.current.onResponse({
          request_id: 'never-issued',
          ok: true,
          result: 42,
        });
      });
    }).not.toThrow();
  });

  it('does not double-resolve when a duplicate response arrives', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('foo');
    });
    const requestId = (sendWsFrame.mock.calls[0][0] as { request_id: string })
      .request_id;

    act(() => {
      result.current.onResponse({ request_id: requestId, ok: true, result: 1 });
      // duplicate frame — should be ignored cleanly
      result.current.onResponse({ request_id: requestId, ok: true, result: 2 });
    });

    await expect(promise!).resolves.toBe(1);
  });
});

describe('useDaemonRPC — timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('rejects the pending promise after 30 seconds', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('list_skills');
    });

    // Attach the catch BEFORE advancing timers so the unhandled-rejection
    // tracker sees a handler in time.
    const settled = promise!.catch((e) => e);

    await act(async () => {
      vi.advanceTimersByTime(30_001);
    });

    const err = await settled;
    expect((err as Error).message).toMatch(/timeout/i);
    expect((err as Error).message).toMatch(/list_skills/);
  });

  it('does not fire the timeout when a response arrives in time', async () => {
    const sendWsFrame = vi.fn();
    const { result } = renderHook(() => useDaemonRPC(sendWsFrame));

    let promise: Promise<unknown> | null = null;
    act(() => {
      promise = result.current.call('list_skills');
    });
    const requestId = (sendWsFrame.mock.calls[0][0] as { request_id: string })
      .request_id;

    act(() => {
      result.current.onResponse({
        request_id: requestId,
        ok: true,
        result: { skills: [] },
      });
    });

    await expect(promise!).resolves.toEqual({ skills: [] });

    // Advance past the would-be timeout — the cleanup must have removed
    // the entry, so no double-resolve / late rejection.
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
  });
});

describe('useDaemonRPC — unmount cleanup', () => {
  it('rejects every still-pending promise when the hook unmounts', async () => {
    const sendWsFrame = vi.fn();
    const { result, unmount } = renderHook(() => useDaemonRPC(sendWsFrame));

    let p1: Promise<unknown> | null = null;
    let p2: Promise<unknown> | null = null;
    act(() => {
      p1 = result.current.call('a');
      p2 = result.current.call('b');
    });

    // Catch BEFORE unmount so we don't trip unhandled-rejection.
    const settled1 = p1!.catch((e) => e);
    const settled2 = p2!.catch((e) => e);

    unmount();

    const e1 = await settled1;
    const e2 = await settled2;
    expect((e1 as Error).message).toMatch(/closed|channel/i);
    expect((e2 as Error).message).toMatch(/closed|channel/i);
  });
});
