/**
 * subagentEventPublish — the #84 publisher-side helper.
 *
 * The legacy in-api orchestrator + openagentic-proxy call this once per progress event
 * to forward it into the parent chat turn via AgentEventStore.
 * The chat handler subscribed to that turn re-emits the event as an
 * `agent_progress` NDJSON frame so the UI renders sub-agent cards per
 * mockup 01-cloud-ops.html (`.sa-head` with turns/tokens/time/cost).
 *
 * Defensive: missing turnId is a silent no-op (sub-agents invoked
 * outside a chat turn don't have a parent to report to). Store errors
 * are swallowed — publishing is best-effort.
 *
 * Phase A rename: field is `turnId` (was `parentTurnId`). Matches the
 * Inngest AgentKit StreamingContext convention for the conversation-level
 * identifier; within-turn nesting uses `(runId, parentRunId)`.
 */

import type { AgentEventStore, AgentProgressEvent } from './AgentEventStore.js';

export interface PublishInput {
  turnId: string;
  runId?: string;
  parentRunId?: string | null;
  roundId?: string;
  agentId: string;
  agentRole?: string;
  event: AgentProgressEvent['event'];
  payload: Record<string, unknown>;
  timestamp?: number;
}

// Metric hook — production can wire this to Prometheus, tests can count.
let _published = 0;
export function getAgentEventCount(): number { return _published; }
export function resetAgentEventCount(): void { _published = 0; }

export function publishAgentEvent(store: Pick<AgentEventStore, 'publish'>, input: PublishInput): void {
  // No turn = no subscriber possible; don't even buffer.
  if (!input.turnId) return;

  const ev: AgentProgressEvent = {
    turnId: input.turnId,
    runId: input.runId,
    parentRunId: input.parentRunId,
    roundId: input.roundId,
    agentId: input.agentId,
    agentRole: input.agentRole,
    event: input.event,
    payload: input.payload ?? {},
    timestamp: input.timestamp ?? Date.now(),
  };

  try {
    store.publish(ev);
    _published++;
  } catch {
    /* swallow — publisher is best-effort, don't crash the sub-agent */
  }
}
