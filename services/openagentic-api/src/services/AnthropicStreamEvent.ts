/**
 * AnthropicStreamEvent + AgenticStreamEvent — model-stream + platform superset
 * ===========================================================================
 *
 * **Status (Slice G.3, 2026-05-01):** the synthetic `Normalized*` model-stream
 * variants (`thinking_start`/`thinking_delta`/`thinking_stop`/`redacted_thinking`,
 * `tool_start`/`tool_delta`/`tool_stop`, `text_start`/`text_delta`/`text_stop`)
 * have been ripped. All providers now emit canonical Anthropic Messages SSE
 * `content_block_*` events directly; the UI's buildTree consumes only
 * canonical model-stream + platform envelope events.
 *
 * The model-stream layer (`Anthropic*` types) is re-exported from the
 * SDK-vendored module at `./agentic-events/index.js`. The platform layer
 * below (`AgenticStreamEvent` superset — `AgentStart`, `Artifact*`, `Hitl*`,
 * `Usage`, `Stream*`, `PlatformError`) is still defined inline, with shape
 * diffs vs the SDK SoT to be migrated per-family in subsequent phases.
 *
 * **DO NOT add new event types here.** New events go in
 * `services/agentic-events/types.ts` (the vendored SDK SoT). New emit code
 * uses the typed builders from `services/agentic-events/builders.ts`.
 *
 * Source-of-truth: `~/openagentic/openagentic-sdk/src/lib/agentic-events/`
 *
 * Two exported unions:
 *
 *   - `AnthropicStreamEvent` — wire-exact Anthropic Messages stream events.
 *     Re-exported from SDK as `ModelStreamEvent`. @deprecated — import
 *     `ModelStreamEvent` from `./agentic-events/index.js` directly.
 *
 *   - `AgenticStreamEvent`  — platform superset (canonical model-stream +
 *     platform envelope).
 *
 * Backwards-compat alias: `NormalizedStreamEvent` = `AgenticStreamEvent`.
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
// Reference: https://docs.anthropic.com/en/api/messages-streaming
//
// Event order for a single response:
//   message_start
//   (content_block_start, N × content_block_delta, content_block_stop)+
//   message_delta
//   message_stop
//
// `ping` and `error` can interleave at any point. `ping` is advisory (server
// keepalive). `error` terminates the stream.
//
// **The 8 types below are aliases** of the SDK-vendored types in
// `./agentic-events/index.js`. Shape is byte-identical (both mirror the
// Anthropic Messages SSE wire). New code should import the SDK names
// directly; legacy `Anthropic*` names are kept for migration compat only.

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
//
// The platform emits these envelope events alongside the Anthropic wire
// events. They describe orchestration state the Messages API itself doesn't
// model (sub-agents, HITL approvals, inline artifacts, per-turn usage rollups,
// etc.). Provider adapters now emit ONLY canonical Anthropic Messages SSE
// `content_block_*` events for thinking / tool / text — the legacy
// `Normalized*` family was retired in Slice G.3 (2026-05-01).

/** --- Envelope --- */
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

/** --- Agents --- */
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

/** --- Human-in-the-loop --- */
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

/** --- Artifacts --- */
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

/** --- Usage (per LLM completion round) --- */
export interface UsageEvent {
  type: 'usage';
  tokensIn: number;
  tokensOut: number;
  cost: number;
  contextUsed: number;
  contextMax: number;
}

/**
 * --- Platform error ---
 *
 * Distinct from `AnthropicErrorEvent` (which carries `error: {type,message}`).
 * The platform variant is flat + includes a retryable flag and the pipeline
 * stage so the UI can offer precise retry semantics.
 */
export interface PlatformErrorEvent {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
  stage?: string;
}

/**
 * The platform-level superset. Includes:
 *   - every wire-exact `AnthropicStreamEvent` variant (except `error`,
 *     which is replaced by the richer `PlatformErrorEvent`)
 *   - the envelope, agent, HITL, artifact, and usage events the platform
 *     emits around those wire events
 *
 * Slice G.3 (2026-05-01): the synthetic `Normalized*` model-stream variants
 * (`thinking_*`, `tool_*`, `text_*`, `redacted_thinking`) were ripped from
 * this union — provider adapters emit canonical `content_block_*` directly.
 */
export type AgenticStreamEvent =
  // Anthropic wire-exact events (minus `error`, replaced below)
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicPingEvent
  // Platform envelope
  | StreamStartEvent
  | StreamEndEvent
  // Platform orchestration envelopes
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
 * @deprecated Use `AgenticStreamEvent` for platform streams (superset) or
 *   `AnthropicStreamEvent` for wire-exact Anthropic Messages events.
 *   Retained as a stable name for the 11+ existing importers across
 *   `services/openagentic-api/src/services/llm-providers/*` and
 *   `services/openagentic-ui/src/features/chat/**`.
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

/** Matches: stream_start, stream_end */
export function isEnvelopeEvent(
  event: AgenticStreamEvent,
): event is StreamStartEvent | StreamEndEvent {
  return event.type === 'stream_start' || event.type === 'stream_end';
}

/** Matches: agent_start, agent_stop */
export function isAgentEvent(
  event: AgenticStreamEvent,
): event is AgentStartEvent | AgentStopEvent {
  return event.type === 'agent_start' || event.type === 'agent_stop';
}

// ---------------------------------------------------------------------------
// 4. Anthropic-wire type guards (for new adapter code + tests)
// ---------------------------------------------------------------------------

/** Matches wire-exact Anthropic `content_block_start` where the block is a
 *  `tool_use` variant. Useful for the A₂ adapter path. */
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

/** Matches wire-exact Anthropic `content_block_delta` where the delta is an
 *  `input_json_delta` (tool args streamed per-char). */
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

/** Matches wire-exact Anthropic `content_block_delta` where the delta is a
 *  `thinking_delta` (extended-thinking token stream). */
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

/** Matches wire-exact Anthropic `content_block_delta` where the delta is a
 *  `citations_delta` (inline citation record). */
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
