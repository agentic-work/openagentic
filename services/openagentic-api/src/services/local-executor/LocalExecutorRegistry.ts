/**
 * LocalExecutorRegistry — in-process rendezvous between the chat tool-dispatch
 * loop and an EXTERNAL local executor (the VS Code "local executor" extension).
 *
 * Direction: the platform CALLS IN. An external client subscribes (one per user),
 * registering its `workspace_*` tools. When the chat agent calls one of those
 * tools, `dispatch()` pushes a `tool_executing` frame to that client and awaits
 * the result the client POSTs back (`submitResult`). On timeout or disconnect the
 * awaited call resolves to an error so the chat loop never hangs.
 *
 * Mirrors the in-process patterns already used here: ApprovalRegistry (the
 * pending-Deferred map + auto-resolving timeout) and AgentEventStore (push to a
 * connected subscriber + module singleton). SINGLE-REPLICA ONLY — the Deferred
 * lives in this process (the api runs single-replica, same constraint as the
 * approval gate). Pipeline-agnostic by design: tool defs are opaque and results
 * are a minimal `{content, isError}` the dispatch arm adapts to its ToolResult.
 */

export interface ExecutorToolDef {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

/** Payload pushed to the connected client (matches the platform NDJSON frame). */
export interface DispatchFrame {
  name: string;
  tool_use_id: string;
  input: unknown;
}

export interface ExecutorResult {
  content: string;
  isError: boolean;
}

type PushFn = (frame: DispatchFrame) => void;

interface Connection {
  push: PushFn;
  tools: ExecutorToolDef[];
}

interface PendingCall {
  userId: string;
  resolve: (r: ExecutorResult) => void;
  timer: NodeJS.Timeout;
}

export class LocalExecutorRegistry {
  private readonly conns = new Map<string, Connection>();
  private readonly pending = new Map<string, PendingCall>();

  /**
   * Register a connected executor for `userId` (latest-wins). Returns a
   * disconnect function that removes the connection and fails any of that
   * user's in-flight dispatches.
   */
  connect(userId: string, tools: ExecutorToolDef[], push: PushFn): () => void {
    const conn: Connection = { push, tools };
    this.conns.set(userId, conn);
    return () => {
      // Only tear down if this exact connection is still the active one (a
      // reconnect may have replaced it — don't clobber the newer session).
      if (this.conns.get(userId) === conn) {
        this.conns.delete(userId);
        this.failUserCalls(userId, 'local executor disconnected');
      }
    };
  }

  isConnected(userId: string): boolean {
    return this.conns.has(userId);
  }

  /** Connected executor's tool defs for tool-advertisement, or null. */
  getTools(userId: string): ExecutorToolDef[] | null {
    return this.conns.get(userId)?.tools ?? null;
  }

  /**
   * Dispatch a tool call to the user's connected executor and await its result.
   * Resolves (never rejects) to an error result if no executor is connected, the
   * push fails, the client times out, or the client disconnects mid-flight.
   */
  dispatch(userId: string, callFrame: DispatchFrame, timeoutMs: number): Promise<ExecutorResult> {
    const conn = this.conns.get(userId);
    if (!conn) {
      return Promise.resolve({ content: 'no local executor connected for this user', isError: true });
    }
    return new Promise<ExecutorResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(callFrame.tool_use_id)) {
          resolve({ content: `local executor timed out after ${timeoutMs}ms`, isError: true });
        }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(callFrame.tool_use_id, { userId, resolve, timer });
      try {
        conn.push(callFrame);
      } catch (e) {
        const entry = this.pending.get(callFrame.tool_use_id);
        if (entry) {
          this.pending.delete(callFrame.tool_use_id);
          clearTimeout(entry.timer);
          resolve({ content: `failed to reach local executor: ${(e as Error).message}`, isError: true });
        }
      }
    });
  }

  /**
   * Resolve a pending dispatch with the client's result. Returns true if a waiter
   * existed (idempotent — a second/late call is a no-op). Called by the route.
   */
  submitResult(toolUseId: string, result: ExecutorResult): boolean {
    const entry = this.pending.get(toolUseId);
    if (!entry) return false;
    this.pending.delete(toolUseId);
    clearTimeout(entry.timer);
    entry.resolve(result);
    return true;
  }

  private failUserCalls(userId: string, reason: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.userId === userId) {
        this.pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve({ content: reason, isError: true });
      }
    }
  }

  /** Test-only. */
  __clear(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
    this.conns.clear();
  }
}

let singleton: LocalExecutorRegistry | null = null;
export function getLocalExecutorRegistry(): LocalExecutorRegistry {
  if (!singleton) singleton = new LocalExecutorRegistry();
  return singleton;
}
