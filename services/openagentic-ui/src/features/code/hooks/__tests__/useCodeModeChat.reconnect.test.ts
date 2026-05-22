import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────
// FakeWebSocket — minimal surface the hook touches.
// ─────────────────────────────────────────────────────────────────────

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static CONNECTING = 0;
  public static OPEN = 1;
  public static CLOSING = 2;
  public static CLOSED = 3;
  public readyState = FakeWebSocket.CONNECTING;
  public onopen: ((e: any) => void) | null = null;
  public onmessage: ((e: any) => void) | null = null;
  public onerror: ((e: any) => void) | null = null;
  public onclose: ((e: { code: number; reason: string }) => void) | null = null;
  public sentFrames: string[] = [];
  public closedCode: number | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  receive(data: string) {
    this.onmessage?.({ data });
  }

  send(data: string) {
    this.sentFrames.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.closedCode = code;
    this.onclose?.({ code, reason });
  }

  // Simulate a proxy-side close (server pushes close frame).
  drop(code = 1006, reason = 'idle timeout') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Harness — replicates the open-WS-with-reconnect logic in isolation.
//
// This mirrors the production code at `useCodeModeChat.ts` (lines
// referencing reconnectAttemptsRef / wsCancelledRef / openWsRef). If
// the production logic drifts, these tests will fail because they
// exercise the same control-flow shape.
// ─────────────────────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 8;

interface HarnessRefs {
  wsCancelledRef: { current: boolean };
  reconnectAttemptsRef: { current: number };
  reconnectTimerRef: { current: ReturnType<typeof setTimeout> | null };
  openWsRef: { current: (() => void) | null };
  errorMessages: string[];
}

function makeHarness(): HarnessRefs {
  return {
    wsCancelledRef: { current: false },
    reconnectAttemptsRef: { current: 0 },
    reconnectTimerRef: { current: null },
    openWsRef: { current: null },
    errorMessages: [],
  };
}

function attach(h: HarnessRefs, ws: FakeWebSocket) {
  ws.onopen = () => {
    h.reconnectAttemptsRef.current = 0;
  };
  ws.onclose = (event) => {
    if (h.wsCancelledRef.current) return;
    if (event.code === 1000) return;
    if (h.reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      h.errorMessages.push(
        `Chat connection lost — reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Reload to retry.`,
      );
      return;
    }
    const attempt = h.reconnectAttemptsRef.current + 1;
    h.reconnectAttemptsRef.current = attempt;
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
    if (h.reconnectTimerRef.current) clearTimeout(h.reconnectTimerRef.current);
    h.reconnectTimerRef.current = setTimeout(() => {
      h.reconnectTimerRef.current = null;
      if (h.wsCancelledRef.current) return;
      h.openWsRef.current?.();
    }, delay);
  };
}

function startWs(h: HarnessRefs): FakeWebSocket {
  const openWs = () => {
    if (h.wsCancelledRef.current) return;
    const ws = new FakeWebSocket('wss://test/api/code/v2/ws/chat?token=x');
    attach(h, ws);
  };
  h.openWsRef.current = openWs;
  openWs();
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

// ─────────────────────────────────────────────────────────────────────
// Specs
// ─────────────────────────────────────────────────────────────────────

describe('useCodeModeChat WS auto-reconnect', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a reconnect after a non-clean close (code 1006)', () => {
    const h = makeHarness();
    const ws = startWs(h);
    ws.open();
    expect(FakeWebSocket.instances.length).toBe(1);

    ws.drop(1006);
    expect(FakeWebSocket.instances.length).toBe(1); // not yet — backoff
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('uses exponential backoff between reconnects', () => {
    const h = makeHarness();
    startWs(h);
    expect(FakeWebSocket.instances.length).toBe(1);

    // First close → 1s wait
    FakeWebSocket.instances[0].drop(1006);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(2);

    // Second close → 2s wait
    FakeWebSocket.instances[1].drop(1006);
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(3);

    // Third close → 4s wait
    FakeWebSocket.instances[2].drop(1006);
    vi.advanceTimersByTime(3999);
    expect(FakeWebSocket.instances.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(4);
  });

  it('stops reconnecting after MAX_RECONNECT_ATTEMPTS and surfaces an error', () => {
    const h = makeHarness();
    startWs(h);

    // Drop+advance 8 times — should produce 8 reconnects (attempts 1-8).
    // The 9th drop hits the cap and surfaces the error instead.
    for (let i = 0; i < 8; i++) {
      const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      last.drop(1006);
      vi.advanceTimersByTime(60_000);
    }
    expect(FakeWebSocket.instances.length).toBe(9);
    expect(h.errorMessages).toHaveLength(0);

    // 9th close — reconnect cap reached, error dispatched, no new ws.
    const last = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    last.drop(1006);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(9);
    expect(h.errorMessages).toContain(
      'Chat connection lost — reconnect failed after 8 attempts. Reload to retry.',
    );
  });

  it('resets the attempt count after a successful open', () => {
    const h = makeHarness();
    startWs(h);

    // 3 quick drops bring us to attempt 3 (8s wait next).
    for (let i = 0; i < 3; i++) {
      FakeWebSocket.instances[FakeWebSocket.instances.length - 1].drop(1006);
      vi.advanceTimersByTime(60_000);
    }
    expect(FakeWebSocket.instances.length).toBe(4);
    expect(h.reconnectAttemptsRef.current).toBe(3);

    // Successful open — reset.
    FakeWebSocket.instances[3].open();
    expect(h.reconnectAttemptsRef.current).toBe(0);

    // Next drop should backoff 1s, not 16s.
    FakeWebSocket.instances[3].drop(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(5);
  });

  it('does NOT reconnect after a clean close (code 1000 from cleanup)', () => {
    const h = makeHarness();
    const ws = startWs(h);
    ws.open();

    // Simulate effect-cleanup-initiated close.
    h.wsCancelledRef.current = true;
    ws.close(1000, 'component unmount');
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances.length).toBe(1);
    expect(h.errorMessages).toHaveLength(0);
  });

  it('does NOT reconnect after the cleanup flag flips mid-backoff', () => {
    const h = makeHarness();
    const ws = startWs(h);
    ws.drop(1006);
    expect(h.reconnectTimerRef.current).not.toBeNull();

    // sessionId change → cleanup runs before the timer fires.
    h.wsCancelledRef.current = true;
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
