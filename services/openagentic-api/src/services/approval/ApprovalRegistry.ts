import { EventEmitter } from 'node:events';

export type ApprovalOutcome = 'approved' | 'denied' | 'timed_out';

interface PendingEntry {
  resolve: (outcome: ApprovalOutcome) => void;
  timer: NodeJS.Timeout;
}

/**
 * In-process approval registry. Keyed by auditId (== the tool_call_audit_log
 * row id). SINGLE-REPLICA ONLY (Helm runs api single-replica) — the awaited
 * Deferred lives in this process. The approve/deny route resolves it via
 * submit(); on timeout it auto-resolves 'timed_out' (→ deny).
 */
export class ApprovalRegistry {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<string, PendingEntry>();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /** Await a human decision for `auditId`. Resolves on submit() or timeout. */
  waitFor(auditId: string, timeoutMs: number): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(auditId)) resolve('timed_out');
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(auditId, { resolve, timer });
    });
  }

  /**
   * Resolve a pending approval. Returns true if a waiter existed (idempotent —
   * a second call is a no-op). Called by the approve/deny route.
   */
  submit(auditId: string, approved: boolean): boolean {
    const entry = this.pending.get(auditId);
    if (!entry) return false;
    this.pending.delete(auditId);
    clearTimeout(entry.timer);
    entry.resolve(approved ? 'approved' : 'denied');
    return true;
  }

  has(auditId: string): boolean {
    return this.pending.has(auditId);
  }
}

let singleton: ApprovalRegistry | null = null;
export function getApprovalRegistry(): ApprovalRegistry {
  if (!singleton) singleton = new ApprovalRegistry();
  return singleton;
}
