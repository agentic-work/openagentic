/**
 * AgentProgressContext — openagentic-proxy-side port of the api-side class in
 * services/openagentic-api/src/services/AgentProgressContext.ts.
 *
 * Why duplicate it here instead of importing? openagentic-proxy is a separate
 * npm package (CommonJS, no pnpm-workspace link — see pnpm-workspace.yaml)
 * and has its own deploy lifecycle. The contract is what matters, not
 * the import path: both sides emit the same `AgentProgressEnvelope`
 * shape so the callback wire is symmetric.
 *
 * Pattern: Inngest AgentKit's `StreamingContext`
 * (packages/agent-kit/src/streaming.ts:359-412). Key properties:
 *  - `publish` injected at construction; inherited by `createChild()`.
 *    Out-of-proc here means publish() is an HTTP POST to the api-side
 *    /api/chat/agent-event route. See `createHttpPublisher` below.
 *  - `seqCounter` is a SHARED mutable {value:number} across the parent
 *    + child tree so clients can linearize the fan-out from seq alone.
 *
 * See the design notes §2.6 for
 * the full reasoning.
 */

export interface AgentProgressEnvelope {
  /** Conversation-level id — matches the api-side subscription key. */
  turnId: string;
  /** Run id for this emission (unique within the turn). */
  runId: string;
  /** Parent run id in the (runId, parentRunId) tree; null at the root. */
  parentRunId: string | null;
  /** Canonical event name (`agent_start`, `tool_executing`, ...). */
  event: string;
  /** Opaque payload — re-emitted verbatim by the api-side bridge. */
  payload: Record<string, unknown>;
  /** Monotonic seq shared across the parent/child tree. */
  seq: number;
  /** Epoch ms — stamped at emit(), not at construction. */
  ts: number;
}

export interface SeqCounter { value: number; }

export interface AgentProgressContextOptions {
  publish: (envelope: AgentProgressEnvelope) => void | Promise<void>;
  turnId: string;
  runId: string;
  parentRunId?: string | null;
  /** Internal — used by createChild() to share the counter across the tree. */
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
    const maybePromise = this.publish(envelope);
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
      (maybePromise as Promise<void>).catch(() => { /* swallow — transport is its own problem */ });
    }
  }

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

// ── HTTP publisher factory ────────────────────────────────────────────────
//
// Reads env at construction, returns a `publish` callable that POSTs
// envelopes to `${OPENAGENTIC_API_CALLBACK_URL}/api/chat/agent-event`
// with the internal-secret header (`x-internal-secret`). Two env vars:
//
//   OPENAGENTIC_API_CALLBACK_URL — base URL of the api service
//     (e.g. http://openagentic-api.openagentic.svc.cluster.local:8080).
//     When unset, `createHttpPublisher` returns a no-op publisher so
//     local dev without a running api doesn't crash openagentic-proxy. This
//     matches the local-dev fallback described in Phase C4.
//
//   OPENAGENTIC_PROXY_SERVICE_TOKEN — the service token the api validates
//     against INTERNAL_API_KEY in agent-event.route.ts. Also read from
//     INTERNAL_SERVICE_SECRET as a fallback (existing openagentic-proxy env
//     naming — see AgentOrchestrator.resolveAgentFromAPI).
//
// The publisher's returned function is intentionally fire-and-forget
// from the emitter's POV. Any fetch error is logged once per call and
// swallowed — progress events are advisory, not durable.
export interface HttpPublisherOptions {
  callbackUrl?: string;           // override env
  serviceToken?: string;          // override env
  fetchImpl?: typeof fetch;       // override for tests
  onError?: (err: unknown) => void;
}

export type PublishFn = (envelope: AgentProgressEnvelope) => Promise<void>;

export function createHttpPublisher(opts: HttpPublisherOptions = {}): PublishFn {
  const url = opts.callbackUrl ?? process.env.OPENAGENTIC_API_CALLBACK_URL;
  const token = opts.serviceToken
    ?? process.env.OPENAGENTIC_PROXY_SERVICE_TOKEN
    ?? process.env.INTERNAL_SERVICE_SECRET
    ?? '';
  const doFetch = opts.fetchImpl ?? (globalThis as any).fetch;
  const onError = opts.onError ?? (() => { /* no-op */ });

  if (!url) {
    // No callback URL → local dev or misconfigured prod. Return a no-op
    // publisher so emit() calls don't blow up. The contract locked in
    // the Phase C3 test: "If OPENAGENTIC_API_CALLBACK_URL is unset,
    // openagentic-proxy no-ops (local dev)".
    return async () => { /* no-op */ };
  }

  const fullUrl = url.replace(/\/$/, '') + '/api/chat/agent-event';

  return async (envelope: AgentProgressEnvelope): Promise<void> => {
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (token) {
        // Primary: match openagentic-api's x-internal-secret convention
        // (agent-event.route.ts:42). Also send Bearer for any downstream
        // transparent proxy that filters on Authorization.
        headers['x-internal-secret'] = token;
        headers['authorization'] = `Bearer ${token}`;
      }

      await doFetch(fullUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
      });
    } catch (err) {
      onError(err);
    }
  };
}
