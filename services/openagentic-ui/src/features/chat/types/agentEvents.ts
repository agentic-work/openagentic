/**
 * Phase F.6 — typed envelope for sub-agent lifecycle events.
 *
 * The wire names already exist (`agent_spawn_plan`, `agent_start`,
 * `agent_tool_call`, `agent_tool_result`, `agent_complete`,
 * `execution_complete`, `agent_stream`). This module:
 *
 * - enumerates them in one place so producers and consumers cannot
 *   drift (prior to F.6 the list was duplicated across 14 files)
 * - provides a discriminated-union shape so `safeData` in
 *   useChatStream can be narrowed without `any`
 * - exposes a runtime type guard so flaky openagentic-proxy payloads are
 *   rejected before they corrupt component state
 *
 * The validators are intentionally permissive: we only require `type`
 * and whatever keys the UI branches on. Extra fields pass through.
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

export interface AgentSpawnPlanEvent {
  type: 'agent_spawn_plan';
  executionId?: string;
  agents: Array<{ agentId: string; role: string; model?: string; task?: string }>;
  strategy?: 'parallel' | 'sequential';
  timestamp?: number;
}

export interface AgentStartEvent {
  type: 'agent_start';
  executionId?: string;
  agentId: string;
  role: string;
  model?: string;
  task?: string;
  timestamp?: number;
}

export interface AgentStreamEventFrame {
  type: 'agent_stream';
  agentId: string;
  content: string;
  timestamp?: number;
}

export interface AgentToolCallEvent {
  type: 'agent_tool_call';
  executionId?: string;
  agentId: string;
  toolName: string;
  toolCallId?: string;
  arguments?: unknown;
  timestamp?: number;
}

export interface AgentToolResultEvent {
  type: 'agent_tool_result';
  executionId?: string;
  agentId: string;
  toolName: string;
  toolCallId?: string;
  success?: boolean;
  durationMs?: number;
  result?: unknown;
  error?: string;
  timestamp?: number;
}

export interface AgentThinkingEvent {
  type: 'agent_thinking';
  agentId: string;
  content: string;
  timestamp?: number;
}

export interface AgentCompleteEvent {
  type: 'agent_complete';
  executionId?: string;
  agentId: string;
  status?: 'success' | 'error';
  durationMs?: number;
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
  };
  output?: string;
  timestamp?: number;
}

export interface AgentReturnEvent {
  type: 'agent_return';
  executionId?: string;
  agentId: string;
  parentAgentId?: string;
  output?: string;
  timestamp?: number;
}

export interface AgentDelegationEvent {
  type: 'agent_delegation';
  fromAgentId: string;
  toAgentId: string;
  task?: string;
  timestamp?: number;
}

export interface AgentImageGeneratedEvent {
  type: 'agent_image_generated';
  agentId: string;
  imageUrl: string;
  prompt?: string;
  timestamp?: number;
}

export interface ExecutionCompleteEvent {
  type: 'execution_complete';
  executionId: string;
  status?: 'success' | 'error';
  totalDurationMs?: number;
  timestamp?: number;
}

/** Discriminated union covering every agent-lifecycle event on the wire. */
export type AgentStreamEvent =
  | AgentSpawnPlanEvent
  | AgentStartEvent
  | AgentStreamEventFrame
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentThinkingEvent
  | AgentCompleteEvent
  | AgentReturnEvent
  | AgentDelegationEvent
  | AgentImageGeneratedEvent
  | ExecutionCompleteEvent;

const AGENT_EVENT_SET: Set<string> = new Set(AGENT_EVENT_TYPES);

/** True when `value` is a known agent-lifecycle event. Does not validate
 *  every required field — downstream handlers still guard specifics — but
 *  does reject string/number/null inputs and events with an unknown type. */
export function isAgentEvent(value: unknown): value is AgentStreamEvent {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && AGENT_EVENT_SET.has(type);
}

/** Narrow helper used by handlers that care about a specific subtype. */
export function isAgentEventOfType<T extends AgentEventType>(
  value: unknown,
  wanted: T
): value is Extract<AgentStreamEvent, { type: T }> {
  return isAgentEvent(value) && value.type === wanted;
}
