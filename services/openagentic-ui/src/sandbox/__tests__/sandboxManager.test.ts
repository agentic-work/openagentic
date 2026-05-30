/**
 * SandboxManager unit tests (task #158).
 *
 * We stub the Pyodide worker + JS iframe factories so the tests stay
 * in jsdom — no real Web Worker / iframe / Pyodide boot. The fakes
 * implement the same protocol as the real harness so the manager's
 * dispatch, timeout, and cleanup paths are exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SandboxManager } from '../sandboxManager';
import type {
  WorkerFactory,
  JsSandboxFactory,
} from '../sandboxManager';
import type {
  JsSandboxHandle,
} from '../jsIframeSandbox';

/**
 * Stub Worker with a controllable `ready` + message round-trip.
 * Implements the narrow subset of the DOM Worker API the manager uses:
 *   - postMessage
 *   - addEventListener('message', listener)
 *   - removeEventListener
 *   - terminate
 */
class FakeWorker {
  private listeners = new Set<(ev: MessageEvent) => void>();
  public terminated = false;
  public posted: unknown[] = [];

  constructor(private autoReady = true) {}

  postMessage(msg: unknown): void {
    this.posted.push(msg);
    const m = msg as { type?: string; requestId?: string; code?: string };
    if (m.type === 'init' && this.autoReady) {
      // Fire "ready" asynchronously to mimic the Pyodide boot sequence.
      queueMicrotask(() =>
        this.emit({ type: 'ready', version: 'test-pyodide' }),
      );
    }
    if (m.type === 'run') {
      // Mirror a successful run — stdout + result.
      queueMicrotask(() => {
        this.emit({
          type: 'stdout',
          requestId: m.requestId,
          chunk: `ran: ${m.code}\n`,
        });
        this.emit({
          type: 'result',
          requestId: m.requestId,
          ok: true,
          returnValue: '42',
        });
      });
    }
  }

  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: 'message', listener: (ev: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }

  // Internal — emit a fake MessageEvent to every registered listener.
  emit(data: unknown): void {
    const evt = { data } as MessageEvent;
    this.listeners.forEach((l) => l(evt));
  }
}

function makeWorkerFactory(hangOnRun = false, emitLoadFailed = false): {
  factory: WorkerFactory;
  last: () => FakeWorker | null;
} {
  let last: FakeWorker | null = null;
  const factory: WorkerFactory = () => {
    const w = new FakeWorker(!emitLoadFailed);
    if (emitLoadFailed) {
      queueMicrotask(() => w.emit({ type: 'load_failed', error: 'fake CDN 500' }));
    }
    if (hangOnRun) {
      w.postMessage = ((msg: unknown) => {
        (w as unknown as { posted: unknown[] }).posted.push(msg);
        const m = msg as { type?: string };
        if (m.type === 'init') {
          queueMicrotask(() => w.emit({ type: 'ready', version: 'test-pyodide' }));
        }
        // Silently drop `run` so the manager hits its timeout watchdog.
      }) as FakeWorker['postMessage'];
    }
    last = w;
    return w as unknown as Worker;
  };
  return { factory, last: () => last };
}

function makeJsSandboxFactory(): {
  factory: JsSandboxFactory;
  last: () => FakeJsHandle | null;
} {
  let last: FakeJsHandle | null = null;
  const factory: JsSandboxFactory = () => {
    const h = new FakeJsHandle();
    last = h;
    return h as unknown as JsSandboxHandle;
  };
  return { factory, last: () => last };
}

class FakeJsHandle {
  public iframe = document.createElement('iframe');
  public disposed = false;
  private listeners = new Set<(msg: unknown) => void>();
  public runArgs: Array<{ requestId: string; code: string }> = [];
  constructor() {
    // Simulate the `ready` ping the bootstrap posts on load.
    queueMicrotask(() => this.emit({ type: 'ready', version: 'js-iframe' }));
  }
  onMessage(cb: (msg: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  run(requestId: string, code: string): void {
    this.runArgs.push({ requestId, code });
    queueMicrotask(() => {
      this.emit({ type: 'stdout', requestId, chunk: 'hello js\n' });
      this.emit({
        type: 'result',
        requestId,
        ok: true,
        returnValue: '"ok"',
      });
    });
  }
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
  emit(msg: unknown): void {
    this.listeners.forEach((cb) => cb(msg));
  }
}

describe('SandboxManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches Python request through the worker and assembles the result', async () => {
    const { factory, last } = makeWorkerFactory();
    const jsFactory = makeJsSandboxFactory().factory;
    const mgr = new SandboxManager(factory, jsFactory);

    const promise = mgr.execute({
      requestId: 'req-1',
      language: 'python',
      code: 'print("hi")',
    });
    // Let the microtasks flush so the worker emits ready + result.
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('ran: print("hi")');
    expect(result.returnValue).toBe('42');
    expect(result.requestId).toBe('req-1');
    expect(last()?.terminated).toBe(false);
  });

  it('dispatches JS request through the iframe factory', async () => {
    const { factory, last } = makeWorkerFactory();
    const js = makeJsSandboxFactory();
    const mgr = new SandboxManager(factory, js.factory);

    const promise = mgr.execute({
      requestId: 'req-js',
      language: 'javascript',
      code: 'return 1 + 1',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('hello js');
    expect(js.last()?.disposed).toBe(true);
    // Worker should NOT boot for JS runs — we only create it on python.
    expect(last()).toBeNull();
  });

  it('kills the worker on 5 s timeout and returns TIMEOUT envelope', async () => {
    const { factory, last } = makeWorkerFactory(/* hangOnRun */ true);
    const mgr = new SandboxManager(factory, makeJsSandboxFactory().factory);

    const promise = mgr.execute({
      requestId: 'req-hang',
      language: 'python',
      code: 'while True: pass',
      timeoutMs: 5000,
    });
    // Advance past the 5 s timeout.
    await vi.advanceTimersByTimeAsync(5001);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(last()?.terminated).toBe(true);
  });

  it('returns LOAD_FAILED when the worker signals load_failed before ready', async () => {
    const { factory } = makeWorkerFactory(false, /* emitLoadFailed */ true);
    const mgr = new SandboxManager(factory, makeJsSandboxFactory().factory);

    const promise = mgr.execute({
      requestId: 'req-load',
      language: 'python',
      code: 'x = 1',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('LOAD_FAILED');
  });

  it('dispose() terminates the worker and resolves pending runs with ABORTED', async () => {
    // hangOnRun = true with a huge timeout so the watchdog never fires
    // before dispose(). That isolates the ABORTED path.
    const { factory, last } = makeWorkerFactory(/* hangOnRun */ true);
    const mgr = new SandboxManager(factory, makeJsSandboxFactory().factory);

    const promise = mgr.execute({
      requestId: 'req-abort',
      language: 'python',
      code: 'noop',
      timeoutMs: 30_000, // long enough we dispose before watchdog
    });
    // Let init's "ready" microtask fire so the run gets dispatched.
    await vi.advanceTimersByTimeAsync(1);
    // Now tear down — dispose() must settle pending promises with ABORTED.
    mgr.dispose();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('ABORTED');
    expect(last()?.terminated).toBe(true);
  });

  it('caps an oversized stdout to SANDBOX_LIMITS.STDOUT_CAP', async () => {
    // Custom factory that floods stdout then reports success.
    const flood: WorkerFactory = () => {
      const w = new FakeWorker(true);
      const orig = w.postMessage.bind(w);
      w.postMessage = ((msg: unknown) => {
        const m = msg as { type?: string; requestId?: string };
        if (m.type === 'run') {
          // Emit a huge string then the result.
          queueMicrotask(() => {
            w.emit({ type: 'stdout', requestId: m.requestId, chunk: 'x'.repeat(50_000) });
            w.emit({ type: 'result', requestId: m.requestId, ok: true });
          });
        } else {
          orig(msg);
        }
      }) as FakeWorker['postMessage'];
      return w as unknown as Worker;
    };
    const mgr = new SandboxManager(flood, makeJsSandboxFactory().factory);

    const promise = mgr.execute({
      requestId: 'req-big',
      language: 'python',
      code: 'print("x" * 50000)',
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    // SANDBOX_LIMITS.STDOUT_CAP is 32_000 — the 50_000-char flood must be
    // truncated from the head so the tail (most recent output) survives.
    expect(result.stdout.length).toBeLessThanOrEqual(32_000);
  });

  it('rejects unsupported languages with an UNKNOWN error code', async () => {
    const mgr = new SandboxManager(
      makeWorkerFactory().factory,
      makeJsSandboxFactory().factory,
    );
    const result = await mgr.execute({
      requestId: 'req-oops',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      language: 'haskell' as any,
      code: '',
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN');
  });
});
