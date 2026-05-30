/**
 * AgentEventStore — in-process rendezvous for openagentic-proxy → chat bridge.
 *
 * When the chat pipeline delegates to openagentic-proxy (via delegate_to_agents
 * or the legacy in-api orchestrator's parallel path), the sub-agents execute far away
 * from the parent's chat stream. This store lets the agent layer publish
 * progress events keyed by `turnId`; the chat handler subscribed to that
 * turn re-emits them as `agent_progress` NDJSON frames so the UI can
 * draw a live nested tree.
 *
 * Phase A (2026-04-23): renamed `parentTurnId` → `turnId` to align with
 * the conversation-level identifier pattern used by Inngest AgentKit's
 * `StreamingContext` (packages/agent-kit/src/streaming.ts:359-412) and
 * opencode's parent-session-id model. Within-turn nesting now lives on
 * `(runId, parentRunId)` — see AgentProgressContext for the tree semantics.
 *
 * Mirrors the SandboxResultStore pattern. Singleton; module-private.
 */

export interface AgentProgressEvent {
  /** Conversation-level id. Used as the subscription key. */
  turnId: string;
  /**
   * Run id for this emission — unique within the turn. Optional for
   * back-compat with legacy publishers that only stamp `turnId`; new
   * code (AgentProgressContext) always sets it.
   */
  runId?: string;
  /**
   * Link to the parent run in the `(runId, parentRunId)` tree. `null`
   * marks a root-level emission inside the turn; `undefined` is
   * treated the same for back-compat.
   */
  parentRunId?: string | null;
  /** Optional roundId tying this event to a parallel tool round. */
  roundId?: string;
  /** Stable id of the sub-agent emitting the event. */
  agentId: string;
  /** Agent role (research, synthesis, architect, …) for UI icons. */
  agentRole?: string;
  /** Canonical event name — matches the chat stream event vocabulary. */
  event: 'tool_executing' | 'tool_progress' | 'tool_complete' | 'agent_start' | 'agent_complete' | 'message' | 'thinking_event'
       | 'mcp_approval_required' | 'hitl_approval' | 'mcp_approval_resolved';
  /** Event-specific payload. Opaque to the store; re-emitted verbatim. */
  payload: Record<string, unknown>;
  /** Epoch ms. */
  timestamp: number;
}

type Listener = (event: AgentProgressEvent) => void;

const PRE_SUBSCRIBE_BUFFER_CAP = 32;

export class AgentEventStore {
  private listeners = new Map<string, Set<Listener>>();
  /** Events that arrive before any subscriber — replay to the first one. */
  private buffers = new Map<string, AgentProgressEvent[]>();

  /** Subscribe the chat-stream handler for a given turn. Returns unsubscribe. */
  subscribe(turnId: string, cb: Listener): () => void {
    let set = this.listeners.get(turnId);
    if (!set) {
      set = new Set();
      this.listeners.set(turnId, set);
    }
    set.add(cb);

    // Flush buffered events to the FIRST subscriber only (new subscribers
    // after the first don't get the replay — they're additions, not
    // reconnects).
    const isFirstSubscriber = set.size === 1;
    if (isFirstSubscriber) {
      const buf = this.buffers.get(turnId);
      if (buf) {
        for (const e of buf) cb(e);
        this.buffers.delete(turnId);
      }
    }

    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.listeners.delete(turnId);
    };
  }

  /** Publish an event. Returns true if it was delivered to ≥1 subscriber. */
  publish(event: AgentProgressEvent): boolean {
    const set = this.listeners.get(event.turnId);
    if (set && set.size > 0) {
      for (const cb of set) {
        try {
          cb(event);
        } catch {
          /* swallow; one bad subscriber can't block the others */
        }
      }
      return true;
    }
    // No subscriber yet — buffer up to N events per turn (drop-oldest).
    let buf = this.buffers.get(event.turnId);
    if (!buf) {
      buf = [];
      this.buffers.set(event.turnId, buf);
    }
    buf.push(event);
    if (buf.length > PRE_SUBSCRIBE_BUFFER_CAP) {
      buf.splice(0, buf.length - PRE_SUBSCRIBE_BUFFER_CAP);
    }
    return false;
  }

  /** Test-only. */
  __clear(): void {
    this.listeners.clear();
    this.buffers.clear();
  }
}

let _singleton: AgentEventStore | null = null;

export function getAgentEventStore(): AgentEventStore {
  if (!_singleton) _singleton = new AgentEventStore();
  return _singleton;
}
