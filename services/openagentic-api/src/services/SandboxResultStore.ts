/**
 * Task #158 — in-process store for browser-sandbox results.
 *
 * Mirrors `PendingApprovalStore` but for Python/JS exec results from
 * the UI. When the chat pipeline emits a `browser_exec_request` NDJSON
 * frame it creates a pending entry via `awaitResult(requestId, timeoutMs)`
 * and awaits the returned promise. The UI POSTs the
 * `browser_exec_result` envelope to `/api/chat/sandbox-result`, which
 * calls `resolve(requestId, envelope)` — the promise settles and the
 * pipeline injects the envelope as a `tool_result` message back into
 * the model's next turn.
 *
 * Timeout defaults to 60 s. If the user dismisses the sandbox card or
 * never presses run, the promise resolves with an `ok: false`,
 * `errorCode: 'TIMEOUT'` envelope so the model can move on gracefully
 * instead of hanging the turn forever.
 *
 * Keep this module dependency-free — imported from both the chat
 * pipeline and the sandbox-result route. Two consumers → one store.
 */

export interface SandboxResultEnvelope {
  requestId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  returnValue?: string;
  images?: Array<{ mime: string; base64: string }>;
  timedOut?: boolean;
  durationMs: number;
  errorCode?: string;
  sessionId?: string;
  messageId?: string;
  /** Server timestamp stamped at receive-time; absent on synthetic timeouts. */
  receivedAt?: number;
}

interface PendingEntry {
  resolve: (env: SandboxResultEnvelope) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

export class SandboxResultStore {
  private pending = new Map<string, PendingEntry>();

  /**
   * Register a pending request and return a promise that settles when
   * `resolve(...)` is called with the matching `requestId` — or when
   * the timeout fires, in which case we synthesize an envelope with
   * `ok: false, timedOut: true`.
   */
  awaitResult(
    requestId: string,
    timeoutMs = 60_000,
  ): Promise<SandboxResultEnvelope> {
    return new Promise<SandboxResultEnvelope>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          requestId,
          ok: false,
          stdout: '',
          stderr: 'sandbox execution timed out on server',
          durationMs: timeoutMs,
          timedOut: true,
          errorCode: 'TIMEOUT',
        });
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve,
        timer,
        createdAt: Date.now(),
      });
    });
  }

  /**
   * Settle the pending entry for `requestId`. Returns true when an
   * entry existed, false when the id was unknown (orphan POST).
   */
  resolve(requestId: string, envelope: SandboxResultEnvelope): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(envelope);
    return true;
  }

  /** Whether a given request id is still pending. */
  has(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /** Number of outstanding awaits. Used for health metrics. */
  get size(): number {
    return this.pending.size;
  }

  /** Cancel all pending awaits — e.g. on process shutdown. */
  clear(): void {
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        requestId,
        ok: false,
        stdout: '',
        stderr: 'sandbox store cleared',
        durationMs: Date.now() - entry.createdAt,
        errorCode: 'ABORTED',
      });
    }
    this.pending.clear();
  }
}

let _instance: SandboxResultStore | null = null;
export function getSandboxResultStore(): SandboxResultStore {
  if (!_instance) _instance = new SandboxResultStore();
  return _instance;
}

/** Test hook. Reset between cases. */
export function setSandboxResultStoreForTest(store: SandboxResultStore | null): void {
  _instance = store;
}
