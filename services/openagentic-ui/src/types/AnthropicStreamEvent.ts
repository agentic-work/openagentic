/**
 * AnthropicStreamEvent + AgenticStreamEvent (UI mirror) — model-stream
 * + platform superset.
 * =====================================================================
 *
 * **Status (Slice G.3, 2026-05-01):** the synthetic `Normalized*`
 * model-stream variants (`thinking_*`, `tool_*`, `text_*`,
 * `redacted_thinking`) have been ripped. All providers now emit
 * canonical Anthropic Messages SSE `content_block_*` events directly
 * and `buildTree` consumes ONLY canonical model-stream + platform
 * envelope events. The UI synthesizes `content_block_*` from envelope
 * events (agent_thinking → canonical thinking block;
 * agent_tool_call/result → canonical tool_use block) inside
 * `useChatStream.ts`.
 *
 * The model-stream layer (`Anthropic*` types) is re-exported from the
 * SDK-vendored module at `./agentic-events/index.js`. The platform
 * layer below is still defined inline; new platform events go in the
 * vendored SDK SoT and use typed builders from
 * `src/types/agentic-events/builders.ts`.
 *
 * Source-of-truth: `~/openagentic/openagentic-sdk/src/lib/agentic-events/`
 *
 * The api-side mirror lives at
 * `services/openagentic-api/src/services/AnthropicStreamEvent.ts`.
 */

// ---------------------------------------------------------------------------
// Phase A — model-stream re-exports from SDK SoT
// ---------------------------------------------------------------------------
// The 8 events below are structurally identical to their SDK counterparts.
// Importers can use either name; the canonical name lives in
// ./agentic-events/index.js. These aliases stay until all importers
// migrate (Phase B), at which point the legacy `Anthropic*` names are
// retired (Phase I).

import type {
  MessageStartEvent,
  ContentBlockStartEvent,
  ContentBlockDeltaEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStopEvent,
  ModelPingEvent,
  ModelErrorEvent,
  ModelStreamEvent,
} from './agentic-events/index.js';

// ---------------------------------------------------------------------------
// 1. AnthropicStreamEvent — wire-exact Anthropic Messages streaming contract
// ---------------------------------------------------------------------------
//
// The 8 types below are aliases of the SDK-vendored types. Shape is
// byte-identical (both mirror the Anthropic Messages SSE wire). New code
// should import the SDK names directly; legacy `Anthropic*` names are
// kept for migration compat only.

/** @deprecated Import `MessageStartEvent` from `./agentic-events/index.js`. */
export type AnthropicMessageStartEvent = MessageStartEvent;

/** @deprecated Import `ContentBlockStartEvent` from `./agentic-events/index.js`. */
export type AnthropicContentBlockStartEvent = ContentBlockStartEvent;

/** @deprecated Import `ContentBlockDeltaEvent` from `./agentic-events/index.js`. */
export type AnthropicContentBlockDeltaEvent = ContentBlockDeltaEvent;

/** @deprecated Import `ContentBlockStopEvent` from `./agentic-events/index.js`. */
export type AnthropicContentBlockStopEvent = ContentBlockStopEvent;

/** @deprecated Import `MessageDeltaEvent` from `./agentic-events/index.js`. */
export type AnthropicMessageDeltaEvent = MessageDeltaEvent;

/** @deprecated Import `MessageStopEvent` from `./agentic-events/index.js`. */
export type AnthropicMessageStopEvent = MessageStopEvent;

/** @deprecated Import `ModelPingEvent` from `./agentic-events/index.js`. */
export type AnthropicPingEvent = ModelPingEvent;

/** @deprecated Import `ModelErrorEvent` from `./agentic-events/index.js`. */
export type AnthropicErrorEvent = ModelErrorEvent;

/** @deprecated Import `ModelStreamEvent` from `./agentic-events/index.js`. */
export type AnthropicStreamEvent = ModelStreamEvent;

// ---------------------------------------------------------------------------
// 2. AgenticStreamEvent — platform superset
// ---------------------------------------------------------------------------

export interface StreamStartEvent {
  type: 'stream_start';
  messageId: string;
  model: string;
  provider: string;
}
export interface StreamEndEvent {
  type: 'stream_end';
  finishReason: string;
  totalDurationMs: number;
}

export interface AgentStartEvent {
  type: 'agent_start';
  id: string;
  name: string;
  role: string;
  parentId?: string;
}
export interface AgentStopEvent {
  type: 'agent_stop';
  id: string;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface HitlRequestEvent {
  type: 'hitl_request';
  id: string;
  agentId?: string;
  tool: string;
  description: string;
  scope: string;
  metadata: Record<string, string>;
}
export interface HitlResponseEvent {
  type: 'hitl_response';
  id: string;
  approved: boolean;
  waitMs: number;
}

export interface ArtifactStartEvent {
  type: 'artifact_start';
  id: string;
  artifactType: string;
  title: string;
}
export interface ArtifactDeltaEvent {
  type: 'artifact_delta';
  id: string;
  content: string;
}
export interface ArtifactStopEvent {
  type: 'artifact_stop';
  id: string;
  sizeBytes: number;
}

export interface UsageEvent {
  type: 'usage';
  tokensIn: number;
  tokensOut: number;
  cost: number;
  contextUsed: number;
  contextMax: number;
}

export interface PlatformErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
  stage?: string;
}

/**
 * The platform-level superset. Slice G.3 (2026-05-01) — synthetic
 * `Normalized*` model-stream variants (`thinking_*`, `tool_*`, `text_*`,
 * `redacted_thinking`) were ripped; canonical `content_block_*` events
 * cover those.
 */
export type AgenticStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  | StreamStartEvent
  | StreamEndEvent
  | AgentStartEvent
  | AgentStopEvent
  | HitlRequestEvent
  | HitlResponseEvent
  | ArtifactStartEvent
  | ArtifactDeltaEvent
  | ArtifactStopEvent
  | UsageEvent
  | PlatformErrorEvent;

/**
 * @deprecated Use `AgenticStreamEvent` (platform superset) or
 *   `AnthropicStreamEvent` (wire-exact Messages contract). Retained as a
 *   stable name for existing UI importers in `features/chat/**`.
 */
export type NormalizedStreamEvent = AgenticStreamEvent;

// ---------------------------------------------------------------------------
// 3. Type guard helpers
// ---------------------------------------------------------------------------
//
// Slice G.3 — the legacy thinking/tool/text guards were deleted because
// they referenced the now-removed synthetic event variants. Callers that
// need to detect thinking/tool blocks on the canonical wire should use
// the `isAnthropic*` guards below plus the discriminator on
// `content_block.type` for `content_block_start` events.

export function isEnvelopeEvent(
  event: AgenticStreamEvent,
): event is StreamStartEvent | StreamEndEvent {
  return event.type === 'stream_start' || event.type === 'stream_end';
}

export function isAgentEvent(
  event: AgenticStreamEvent,
): event is AgentStartEvent | AgentStopEvent {
  return event.type === 'agent_start' || event.type === 'agent_stop';
}

// ---------------------------------------------------------------------------
// 4. Anthropic-wire type guards
// ---------------------------------------------------------------------------

export function isAnthropicToolUseBlockStart(
  event: AnthropicStreamEvent,
): event is AnthropicContentBlockStartEvent & {
  content_block: Extract<AnthropicContentBlockStartEvent['content_block'], { type: 'tool_use' }>;
} {
  return (
    event.type === 'content_block_start' &&
    event.content_block.type === 'tool_use'
  );
}

export function isAnthropicInputJsonDelta(
  event: AnthropicStreamEvent,
): event is AnthropicContentBlockDeltaEvent & {
  delta: Extract<AnthropicContentBlockDeltaEvent['delta'], { type: 'input_json_delta' }>;
} {
  return (
    event.type === 'content_block_delta' &&
    event.delta.type === 'input_json_delta'
  );
}

export function isAnthropicThinkingDelta(
  event: AnthropicStreamEvent,
): event is AnthropicContentBlockDeltaEvent & {
  delta: Extract<AnthropicContentBlockDeltaEvent['delta'], { type: 'thinking_delta' }>;
} {
  return (
    event.type === 'content_block_delta' &&
    event.delta.type === 'thinking_delta'
  );
}

export function isAnthropicCitationsDelta(
  event: AnthropicStreamEvent,
): event is AnthropicContentBlockDeltaEvent & {
  delta: Extract<AnthropicContentBlockDeltaEvent['delta'], { type: 'citations_delta' }>;
} {
  return (
    event.type === 'content_block_delta' &&
    event.delta.type === 'citations_delta'
  );
}
