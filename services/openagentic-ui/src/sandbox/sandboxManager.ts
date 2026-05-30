/**
 * Singleton sandbox mediator (task #158).
 *
 * Owns one Pyodide worker and one-shot JS iframes. The chat stream's
 * `browser_exec_request` handler calls `sandboxManager.execute(req)`;
 * we dispatch to the right backend and resolve with a `BrowserExecResult`.
 *
 *   Python  →  `pyodideWorker.ts` (Web Worker, 6 MiB wasm lazy-load)
 *   JavaScript →  `jsIframeSandbox.ts` (ephemeral sandbox=allow-scripts iframe)
 *
 * Timeout enforcement is HERE, not in the worker/iframe — we want a
 * single watchdog path. On timeout we `worker.terminate()` or clear the
 * iframe `src`; both kill the realm immediately and we resolve the
 * pending promise with `{timedOut: true, errorCode: 'TIMEOUT'}`.
 *
 * Output accumulation / capping is also HERE. Workers post raw
 * stdout/stderr chunks; we splice them onto the pending record and
 * apply `SANDBOX_LIMITS` caps at finalization.
 *
 * Lifecycle: the worker boots on first Python call and stays resident
 * so the second call starts in ~30 ms instead of ~3 s. `dispose()`
 * tears it down and is wired into `useChatStream`'s cleanup.
 */

import {
  SANDBOX_LIMITS,
  type BrowserExecRequest,
  type BrowserExecResult,
  type WorkerOutboundMessage,
} from './types';
import {
  createJsSandbox,
  type JsSandboxHandle,
  iframeLoadFailedResult,
} from './jsIframeSandbox';

interface PendingRun {
  req: BrowserExecRequest;
  stdout: string;
  stderr: string;
  resolve: (r: BrowserExecResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
}

/**
 * Factory for the Pyodide worker. Split out so tests can mock it — the
 * real implementation uses Vite's `?worker` syntax at the `create`
 * site, but we don't want to eagerly construct the worker in tests.
 */
export interface WorkerFactory {
  (): Worker;
}

/** Factory for the JS sandbox — swap in tests for a stub handle. */
export interface JsSandboxFactory {
  (): JsSandboxHandle;
}

export class SandboxManager {
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private pending = new Map<string, PendingRun>();
  // One iframe per JS run — cheap and guarantees isolation between
  // adjacent snippets. Keyed by requestId so the message listener can
  // route chunks back.
  private jsHandles = new Map<string, JsSandboxHandle>();

  constructor(
    private workerFactory: WorkerFactory,
    private jsSandboxFactory: JsSandboxFactory = createJsSandbox,
  ) {}

  /**
   * Run a snippet and return the result envelope the UI posts back to
   * /api/chat/sandbox-result.
   */
  async execute(req: BrowserExecRequest): Promise<BrowserExecResult> {
    const timeoutMs = Math.min(
      req.timeoutMs ?? SANDBOX_LIMITS.DEFAULT_TIMEOUT_MS,
      SANDBOX_LIMITS.MAX_TIMEOUT_MS,
    );
    if (req.language === 'python') {
      return this.runPython(req, timeoutMs);
    }
    if (req.language === 'javascript') {
      return this.runJs(req, timeoutMs);
    }
    return this.errorResult(req, 'UNKNOWN', `unsupported language: ${String((req as { language?: unknown }).language)}`);
  }

  /**
   * Kill everything. Called from useChatStream's unmount path. Safe to
   * call repeatedly.
   */
  dispose(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    this.workerReady = null;
    for (const handle of this.jsHandles.values()) handle.dispose();
    this.jsHandles.clear();
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.resolve({
        requestId: p.req.requestId,
        ok: false,
        stdout: p.stdout,
        stderr: p.stderr,
        durationMs: Date.now() - p.startedAt,
        errorCode: 'ABORTED',
        sessionId: p.req.sessionId,
        messageId: p.req.messageId,
      });
    }
    this.pending.clear();
  }

  // ---------------------------------------------------------------
  // Python path
  // ---------------------------------------------------------------

  private async runPython(
    req: BrowserExecRequest,
    timeoutMs: number,
  ): Promise<BrowserExecResult> {
    try {
      await this.ensureWorker();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(req, 'LOAD_FAILED', `pyodide load failed: ${msg}`);
    }
    const worker = this.worker;
    if (!worker) {
      return this.errorResult(req, 'LOAD_FAILED', 'worker unavailable');
    }

    return new Promise<BrowserExecResult>((resolve) => {
      const record: PendingRun = {
        req,
        stdout: '',
        stderr: '',
        resolve,
        timer: null,
        startedAt: Date.now(),
      };
      this.pending.set(req.requestId, record);

      // Watchdog — terminate the whole worker on timeout. That's
      // aggressive but it's the only way to unstick a runaway Python
      // interpreter; the next run will re-init Pyodide (~3 s) which is
      // acceptable given timeouts should be rare.
      record.timer = setTimeout(() => {
        this.finalizeWithTimeout(req.requestId);
      }, timeoutMs);

      worker.postMessage({
        type: 'run',
        requestId: req.requestId,
        code: req.code,
        timeoutMs,
      });
    });
  }

  private ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return this.workerReady;
    this.worker = this.workerFactory();
    this.worker.addEventListener(
      'message',
      this.onWorkerMessage as EventListener,
    );

    this.workerReady = new Promise<void>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('worker not created'));
        return;
      }
      const onReady = (ev: MessageEvent<WorkerOutboundMessage>) => {
        if (ev.data?.type === 'ready') {
          this.worker?.removeEventListener('message', onReady);
          resolve();
        } else if (ev.data?.type === 'load_failed') {
          this.worker?.removeEventListener('message', onReady);
          reject(new Error(ev.data.error));
        }
      };
      this.worker.addEventListener('message', onReady);
      // Kick the init — the worker boots pyodide on this message.
      this.worker.postMessage({ type: 'init' });
    });
    return this.workerReady;
  }

  private onWorkerMessage = (ev: MessageEvent<WorkerOutboundMessage>): void => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'stdout':
      case 'stderr': {
        const rec = this.pending.get(msg.requestId);
        if (!rec) return;
        if (msg.type === 'stdout') rec.stdout += msg.chunk;
        else rec.stderr += msg.chunk;
        break;
      }
      case 'result': {
        const rec = this.pending.get(msg.requestId);
        if (!rec) return;
        if (rec.timer) clearTimeout(rec.timer);
        this.pending.delete(msg.requestId);
        rec.resolve(
          this.assembleResult(rec, {
            ok: msg.ok,
            returnValue: msg.returnValue,
            images: msg.images,
            errorCode: msg.errorCode,
          }),
        );
        break;
      }
      default:
        break;
    }
  };

  private finalizeWithTimeout(requestId: string): void {
    const rec = this.pending.get(requestId);
    if (!rec) return;
    this.pending.delete(requestId);
    if (rec.timer) clearTimeout(rec.timer);
    // Kill the realm — for Python this means terminate the worker and
    // drop our reference so the next run re-initialises Pyodide.
    if (rec.req.language === 'python') {
      if (this.worker) {
        try {
          this.worker.terminate();
        } catch {
          /* ignore */
        }
        this.worker = null;
        this.workerReady = null;
      }
    } else {
      const handle = this.jsHandles.get(requestId);
      if (handle) {
        handle.dispose();
        this.jsHandles.delete(requestId);
      }
    }
    rec.resolve({
      requestId,
      ok: false,
      stdout: rec.stdout,
      stderr: rec.stderr,
      durationMs: Date.now() - rec.startedAt,
      timedOut: true,
      errorCode: 'TIMEOUT',
      sessionId: rec.req.sessionId,
      messageId: rec.req.messageId,
    });
  }

  // ---------------------------------------------------------------
  // JavaScript path
  // ---------------------------------------------------------------

  private runJs(
    req: BrowserExecRequest,
    timeoutMs: number,
  ): Promise<BrowserExecResult> {
    return new Promise<BrowserExecResult>((resolve) => {
      let handle: JsSandboxHandle;
      try {
        handle = this.jsSandboxFactory();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resolve(iframeLoadFailedResult(req.requestId, msg, req.sessionId, req.messageId));
        return;
      }
      this.jsHandles.set(req.requestId, handle);

      const record: PendingRun = {
        req,
        stdout: '',
        stderr: '',
        resolve,
        timer: null,
        startedAt: Date.now(),
      };
      this.pending.set(req.requestId, record);

      // Wait for the iframe bootstrap to say `ready`, THEN kick the
      // run. The timeout starts at `ready` so we don't count the
      // iframe-boot latency against the user's 5 s budget.
      let readyFired = false;
      const unsubscribe = handle.onMessage((msg) => {
        if (msg.type === 'ready' && !readyFired) {
          readyFired = true;
          record.timer = setTimeout(() => {
            unsubscribe();
            this.finalizeWithTimeout(req.requestId);
          }, timeoutMs);
          handle.run(req.requestId, req.code);
          return;
        }
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          if (msg.requestId !== req.requestId) return;
          if (msg.type === 'stdout') record.stdout += msg.chunk;
          else record.stderr += msg.chunk;
          return;
        }
        if (msg.type === 'result') {
          if (msg.requestId !== req.requestId) return;
          if (record.timer) clearTimeout(record.timer);
          unsubscribe();
          handle.dispose();
          this.jsHandles.delete(req.requestId);
          this.pending.delete(req.requestId);
          resolve(
            this.assembleResult(record, {
              ok: msg.ok,
              returnValue: msg.returnValue,
              images: msg.images,
              errorCode: msg.errorCode,
            }),
          );
        }
      });
    });
  }

  // ---------------------------------------------------------------
  // Common assembly
  // ---------------------------------------------------------------

  private assembleResult(
    record: PendingRun,
    final: {
      ok: boolean;
      returnValue?: string;
      images?: Array<{ mime: string; base64: string }>;
      errorCode?: BrowserExecResult['errorCode'];
    },
  ): BrowserExecResult {
    const stdout = record.stdout.slice(-SANDBOX_LIMITS.STDOUT_CAP);
    const stderr = record.stderr.slice(-SANDBOX_LIMITS.STDERR_CAP);
    const images = capImagesByBytes(final.images ?? [], SANDBOX_LIMITS.IMAGE_CAP_BYTES);
    return {
      requestId: record.req.requestId,
      ok: final.ok,
      stdout,
      stderr,
      returnValue: final.returnValue,
      images,
      durationMs: Date.now() - record.startedAt,
      errorCode: final.errorCode,
      sessionId: record.req.sessionId,
      messageId: record.req.messageId,
    };
  }

  private errorResult(
    req: BrowserExecRequest,
    code: BrowserExecResult['errorCode'],
    stderr: string,
  ): BrowserExecResult {
    return {
      requestId: req.requestId,
      ok: false,
      stdout: '',
      stderr,
      durationMs: 0,
      errorCode: code,
      sessionId: req.sessionId,
      messageId: req.messageId,
    };
  }
}

/**
 * Drop images from the end of the list until total base64 size fits.
 * Keeps the first N figures which tend to be the intended output; the
 * tail (usually debug renders) gets truncated first.
 */
function capImagesByBytes(
  images: Array<{ mime: string; base64: string }>,
  cap: number,
): Array<{ mime: string; base64: string }> {
  let total = 0;
  const out: Array<{ mime: string; base64: string }> = [];
  for (const img of images) {
    const size = img.base64.length;
    if (total + size > cap) break;
    out.push(img);
    total += size;
  }
  return out;
}

// ---------------------------------------------------------------
// Singleton bootstrap — the chat hook imports `getSandboxManager()`.
// ---------------------------------------------------------------

let _singleton: SandboxManager | null = null;

/**
 * Default worker factory using Vite's `?worker&url` syntax. We load the
 * worker URL lazily so tests (which run under jsdom without Vite's worker
 * plumbing) can substitute a stub by calling `setSandboxManagerForTest`.
 */
function defaultWorkerFactory(): Worker {
  // The `new URL(..., import.meta.url)` pattern is what Vite rewrites
  // to a worker chunk at build time. The `{type: 'module'}` part is
  // required because our worker uses ESM imports.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — Vite resolves this at build time; TS doesn't need to.
  return new Worker(new URL('./pyodideWorker.ts', import.meta.url), {
    type: 'module',
    name: 'pyodide-sandbox',
  });
}

export function getSandboxManager(): SandboxManager {
  if (!_singleton) {
    _singleton = new SandboxManager(defaultWorkerFactory, createJsSandbox);
  }
  return _singleton;
}

/** Test helper — install a stub manager for vitest. */
export function setSandboxManagerForTest(stub: SandboxManager | null): void {
  _singleton = stub;
}
