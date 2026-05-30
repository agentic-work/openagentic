/**
 * AgentProgressContext — the dependency-injection seam for publishing
 * sub-agent progress under a single conversation-level `turnId` with a
 * `(runId, parentRunId)` tree for within-turn nesting.
 *
 * Pattern: copied from Inngest AgentKit's `StreamingContext`
 * (packages/agent-kit/src/streaming.ts:359-412). Key properties:
 *   - `publish` is injected at the root; `createChild()` re-uses the
 *     same reference, which is what makes the same class work for both
 *     in-process (publish = AgentEventStore.publish) and out-of-process
 *     (publish = HTTP POST to /api/chat/agent-event) transports.
 *   - `seqCounter` is a SHARED mutable `{value:number}` so every emission
 *     in the parent + children tree gets a monotonically increasing
 *     seq. Clients can linearize a fan-out tree from the numbers alone.
 *
 * Why not inherit from `AgentEventStore.AgentProgressEvent`?
 *   The envelope emitted here is the canonical wire shape — thin and
 *   stable. The store's `AgentProgressEvent` has legacy-friendly
 *   optional fields (`roundId`, `agentId`, `agentRole`) that this
 *   context leaves to the caller to stuff into `payload` when relevant.
 *   Keeping them separate prevents the two concerns (payload shape vs.
 *   correlation tuple) from drifting again.
 *
 * See docs/research/2026-04-23-subagent-architecture-survey.md §2.6 +
 * §3.2 for the full reasoning.
 */

export interface AgentProgressEnvelope {
  /** Conversation-level id — the key every subscriber uses. */
  turnId: string;
  /** Run id for this emission (unique within the turn). */
  runId: string;
  /** Parent run id in the (runId, parentRunId) tree; null at the root. */
  parentRunId: string | null;
  /** Canonical event name (`agent_start`, `tool_executing`, …). */
  event: string;
  /** Opaque payload. The wire re-emits it verbatim. */
  payload: Record<string, unknown>;
  /** Monotonic sequence number shared with the parent/child tree. */
  seq: number;
  /** Epoch ms — stamped at emit(), not at construction. */
  ts: number;
}

/**
 * Shared mutable seq counter. Lives on the root context and is passed
 * by reference into `createChild()` so the entire turn tree gets a
 * single monotonic sequence space.
 */
export interface SeqCounter {
  value: number;
}

export interface AgentProgressContextOptions {
  publish: (envelope: AgentProgressEnvelope) => void | Promise<void>;
  turnId: string;
  runId: string;
  parentRunId?: string | null;
  /**
   * Internal. Used by `createChild()` to share the counter across the
   * tree. Callers constructing a root context should omit it; the
   * constructor will create a fresh counter starting at 0.
   */
  seqCounter?: SeqCounter;
}

export class AgentProgressContext {
  readonly turnId: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  private readonly publish: (envelope: AgentProgressEnvelope) => void | Promise<void>;
  private readonly seqCounter: SeqCounter;

  constructor(opts: AgentProgressContextOptions) {
    this.publish = opts.publish;
    this.turnId = opts.turnId;
    this.runId = opts.runId;
    this.parentRunId = opts.parentRunId ?? null;
    this.seqCounter = opts.seqCounter ?? { value: 0 };
  }

  /**
   * Emit a progress event. Stamps seq (monotonic, shared with the
   * parent/child tree) and ts (Date.now()) then fans it through the
   * injected `publish` callback.
   *
   * Return value is intentionally void — publish() may be async (HTTP),
   * but the orchestrator's caller shouldn't have to await every event.
   * The transport is responsible for its own durability.
   */
  emit(input: { event: string; payload?: Record<string, unknown> }): void {
    const envelope: AgentProgressEnvelope = {
      turnId: this.turnId,
      runId: this.runId,
      parentRunId: this.parentRunId,
      event: input.event,
      payload: input.payload ?? {},
      seq: this.seqCounter.value++,
      ts: Date.now(),
    };
    // Fire-and-forget. Any error from the publisher is swallowed at the
    // publisher layer (see AgentEventStore.publish / the HTTP POST
    // wrapper); re-catching here would double-swallow.
    const maybePromise = this.publish(envelope);
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
      (maybePromise as Promise<void>).catch(() => { /* swallow */ });
    }
  }

  /**
   * Fork a child context for a nested sub-agent run. Preserves `turnId`
   * + `publish` and SHARES the `seqCounter` so the whole turn has a
   * single monotonic sequence space.
   *
   * Mirrors `StreamingContext.createChildContext` in Inngest AgentKit.
   */
  createChild(childRunId: string): AgentProgressContext {
    return new AgentProgressContext({
      publish: this.publish,
      turnId: this.turnId,
      runId: childRunId,
      parentRunId: this.runId,
      seqCounter: this.seqCounter,
    });
  }
}
