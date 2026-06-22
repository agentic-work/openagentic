/**
 * Phase C.3 (2026-04-23) — flows engine ↔ AgentEventStore subscribe-and-
 * forward bridge.
 *
 * The flows engine's `executeOpenAgenticProxyNode` talks to openagentic-proxy via a
 * synchronous `/api/agents/execute-sync` POST. During that request,
 * openagentic-proxy (Phase C) HTTP-callbacks progress envelopes to
 * `/api/chat/agent-event` or `/api/agent-event` (Phase C.2) keyed on the
 * `turnId` body field — the route handler publishes them into the in-
 * proc `AgentEventStore`.
 *
 * For the flows SSE stream to surface sub-agent progress live, the
 * engine must **pre-subscribe** to the store with `executionId` as the
 * turnId BEFORE issuing the HTTP POST, then forward each received event
 * as a `WorkflowNodeProgressEvent` — which the engine re-emits as a
 * `node_stream` `ExecutionEvent`, and the flows SSE handler (Phase C.4)
 * re-emits as `agent_progress` NDJSON frames. Same wire shape as chat.
 *
 * This helper is extracted so the subscribe/forward/unsubscribe
 * lifecycle can be unit-tested without instantiating the full
 * WorkflowExecutionEngine (prisma + 20 other deps).
 *
 * Call site pattern:
 *
 *   const unsubscribe = subscribeAgentProgressForWorkflowNode(
 *     this.context.executionId,
 *     node.id,
 *     (e) => this.emitEvent('node_stream', { nodeId: node.id, event: e }),
 *   );
 *   try {
 *     await axios.post(proxyUrl, { ..., turnId: this.context.executionId });
 *   } finally {
 *     unsubscribe();
 *   }
 */

import { getAgentEventStore, type AgentProgressEvent } from './AgentEventStore.js';

/**
 * The envelope written on the wire as a flows `agent_progress` NDJSON
 * frame (Phase C.4). Parity with chat's stream.handler.ts:631 `agent_progress`
 * frame — same field names, plus `executionId` so the UI can correlate
 * to the correct flow execution.
 */
export interface FlowsAgentProgressFrame {
  executionId: string;
  turnId: string;
  runId?: string;
  parentRunId?: string | null;
  event: AgentProgressEvent['event'];
  payload: Record<string, unknown>;
  agentId?: string;
  agentRole?: string;
  timestamp: number;
}

/**
 * Phase C.4 (2026-04-23) — subscribe to the in-proc AgentEventStore
 * keyed on `executionId` and re-emit each envelope as a flat
 * `agent_progress` frame suitable for writing to the flows SSE/NDJSON
 * response. Returns an unsubscribe function.
 *
 * This is the parity counterpart of the Phase B wire-in at
 * stream.handler.ts:631 which subscribes at the chat stream boundary
 * and emits `agent_progress` NDJSON frames. The flows version is
 * structurally identical: same store, same envelope, same wire
 * name — the only difference is the routing key (`executionId`
 * vs `turnId` — both are opaque strings to AgentEventStore).
 *
 * Note: the engine's Phase C.3 wiring (`executeOpenAgenticProxyNode`) ALSO
 * subscribes to the same store and forwards as `node_stream`. Both
 * subscribers see every publish — we intentionally dual-emit so:
 *   - `node_stream` frames carry the per-node context (nodeId wrap)
 *     for the flow-graph UI's per-node spinner rendering.
 *   - `agent_progress` frames carry the raw envelope for the UI's
 *     shared sub-agent tree component (same one chat uses).
 */
export function subscribeAgentProgressForFlowsStream(
  executionId: string,
  onFrame: (frame: FlowsAgentProgressFrame) => void,
): () => void {
  const unsubscribe = getAgentEventStore().subscribe(executionId, (raw) => {
    onFrame({
      executionId,
      turnId: raw.turnId,
      runId: raw.runId,
      parentRunId: raw.parentRunId,
      event: raw.event,
      payload: raw.payload ?? {},
      agentId: raw.agentId,
      agentRole: raw.agentRole,
      timestamp: raw.timestamp,
    });
  });
  return unsubscribe;
}

/**
 * The envelope forwarded to the engine's `emitEvent('node_stream', ...)`
 * callback. Enriches the raw `AgentProgressEvent` with `nodeId` so the
 * SSE consumer can associate progress with the correct workflow node.
 */
export interface WorkflowNodeProgressEvent {
  nodeId: string;
  executionId: string;
  event: AgentProgressEvent['event'];
  payload: Record<string, unknown>;
  runId?: string;
  parentRunId?: string | null;
  agentId?: string;
  agentRole?: string;
  timestamp: number;
}

/**
 * Subscribe to the in-proc `AgentEventStore` keyed on `executionId`.
 * Every matching event is forwarded to `onEvent` wrapped as a
 * `WorkflowNodeProgressEvent`. Returns an unsubscribe function that
 * stops forwarding — callers MUST invoke it (typically in a `finally`
 * block around the openagentic-proxy HTTP POST) to avoid leaking listeners.
 */
export function subscribeAgentProgressForWorkflowNode(
  executionId: string,
  nodeId: string,
  onEvent: (event: WorkflowNodeProgressEvent) => void,
): () => void {
  const unsubscribe = getAgentEventStore().subscribe(executionId, (raw) => {
    onEvent({
      nodeId,
      executionId,
      event: raw.event,
      payload: raw.payload ?? {},
      runId: raw.runId,
      parentRunId: raw.parentRunId,
      agentId: raw.agentId,
      agentRole: raw.agentRole,
      timestamp: raw.timestamp,
    });
  });
  return unsubscribe;
}
