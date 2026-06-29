/**
 * Phase F.6 — canonical list of agent lifecycle event types.
 *
 * This module is the single source of truth for the `type` field of every
 * event that openagentic-proxy relays through Redis and the chat NDJSON emitter
 * forwards to the UI. Producers (the legacy in-api orchestrator, openagentic-proxy relay
 * in tool-execution.helper.ts) and consumers (UI
 * useChatStream, useAgentTreeStore) MUST both import from here so new
 * events land in one place instead of being re-declared per site.
 *
 * Keep this file in lockstep with
 * `services/openagentic-ui/src/features/chat/types/agentEvents.ts`.
 */

export const AGENT_EVENT_TYPES = [
  'agent_spawn_plan',
  'agent_start',
  'agent_stream',
  'agent_tool_call',
  'agent_tool_result',
  'agent_thinking',
  'agent_complete',
  'agent_return',
  'agent_delegation',
  'agent_image_generated',
  'execution_complete',
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** Set form for O(1) membership checks; safer than writing `.includes` ad hoc. */
export const AGENT_EVENT_SET: ReadonlySet<string> = new Set(AGENT_EVENT_TYPES);

export function isAgentEventType(type: unknown): type is AgentEventType {
  return typeof type === 'string' && AGENT_EVENT_SET.has(type);
}

/**
 * Shape of an event as it crosses the openagentic-proxy Redis channel. The
 * V2 cascade relay parses this and forwards it to the chat stream.
 * Producers may include additional fields; consumers treat them as
 * opaque passthrough.
 */
export interface AgentEventEnvelope {
  /** Wire type name. MUST be in AGENT_EVENT_TYPES for the relay to forward. */
  type: AgentEventType;
  /** Execution id assigned by the relay; ties events from one agent run together. */
  executionId?: string;
  /** The subagent emitting this frame, when applicable. */
  agentId?: string;
  /** Parent agent / run when nesting applies. */
  parentAgentId?: string;
  /** The role the subagent is playing (e.g. "data_query", "validator"). */
  role?: string;
  /** Server timestamp in ms. */
  timestamp?: number;
  /** Producer-specific payload. */
  data?: Record<string, unknown>;
}
