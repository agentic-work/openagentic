/**
 * V3 typed-event builders — typed constructors for the V3 emit sites.
 *
 * Phase 2 (Spec §12.2): every `ctx.emit(...)` call in V3 uses a typed
 * builder for its payload, never an inline object literal. This module
 * is the single source of payload-shape truth for V3 emits.
 *
 * Pattern: each builder takes a typed args object and returns the shape
 * the V3 stream-handler ctx expects (`{type, data}` is wrapped at the
 * handler level — these builders return just the data payload).
 *
 * SDK reuse: where a V3 emit's payload shape EXACTLY matches an SDK
 * canonical event type, we import + re-use the SDK `buildXxx` builder.
 * Where the V3 emit retains a legacy V2-shape payload (UI consumer
 * compatibility during the dual-emit transition window — Spec §16.x
 * RIPs the legacy emits in Phase 16 once UI consumers migrate), we
 * declare a local typed builder here.
 *
 * Migration path: as UI consumers migrate to canonical SDK shapes, the
 * local builders here get retired one at a time. The arch test at
 * `__tests__/architecture/no-object-literal-emits.source-regression.test.ts`
 * keeps the door closed against new object-literal regressions.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §12.2
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 2, Tasks 2.4-2.7.
 */

import type { StopReason } from './types.js';
import type { ToolResultMeta } from '../../../../types/ToolResult.js';

/**
 * `assistant_message_delta` payload — V2 dual-emit. UI's `useChatStream`
 * reducer at `assistant_message_delta` arm consumes this and appends to
 * the live message body.
 *
 * SDK alternative: `buildContentBlockDelta({delta:{type:'text_delta',text}})`
 * — but UI's reducer does not key off the SDK's `delta.text` shape yet.
 * Migration deferred to Phase 16 Spec §16.x.
 */
export interface AssistantMessageDeltaPayload {
  text: string;
}
export function buildAssistantMessageDelta(
  args: AssistantMessageDeltaPayload,
): AssistantMessageDeltaPayload {
  return { text: args.text };
}

/**
 * `content_block_delta` payload — Anthropic-shape inner delta envelope.
 * UI consumes for live thinking/reasoning preview rendering.
 *
 * SDK alternative: `buildContentBlockDelta({index, delta})` — close shape
 * match, but the SDK builder requires an `index` field that V3 doesn't
 * track at this emit site (the V3 chat-loop accumulates text/thinking
 * into a single content block per turn). Local builder keeps the V2
 * shape stable; index-aware migration deferred to Phase 16.
 */
export interface ContentBlockDeltaPayload {
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string };
}
export function buildContentBlockDelta(
  args: ContentBlockDeltaPayload,
): ContentBlockDeltaPayload {
  return { delta: args.delta };
}

/**
 * `tool_executing` payload — opens the tool_use ContentBlock card in the
 * UI mock at mocks/UX/01-cloud-ops.html. Field shape (`name`,
 * `tool_use_id`, `input`) matches the legacy chat pipeline contract.
 *
 * SDK alternative: `buildToolExecuting({tool_use_id, tool_name,
 * args_preview, surface})` — different field layout (snake_case
 * `tool_name`, no `input`, requires `args_preview`+`surface`). UI
 * consumer migration deferred to Phase 16.
 */
export interface ToolExecutingPayload {
  name: string;
  tool_use_id: string;
  input: unknown;
}
export function buildToolExecuting(args: ToolExecutingPayload): ToolExecutingPayload {
  return { name: args.name, tool_use_id: args.tool_use_id, input: args.input };
}

/**
 * `tool_result` payload — fills the RESULT card body. Field shape
 * (`name`, `tool_use_id`, `content`, `is_error`) matches the legacy chat
 * pipeline contract that `useChatStream` consumes.
 *
 * SDK alternative: `buildToolCompleted({tool_use_id, tool_name,
 * duration_ms, ok, output_preview, bytes})` or `buildToolFailed(...)` —
 * different field set; doesn't carry `content` directly. UI consumer
 * migration deferred to Phase 16.
 */
export interface ToolResultPayload {
  name: string;
  tool_use_id: string;
  content: unknown;
  is_error: boolean;
  /**
   * Phase 4 — two-channel envelope UI side. Present when the dispatcher
   * returned a `ToolResult` envelope; absent on legacy bare-output paths.
   * UI's `useChatStream` tool_result reducer arm reads `_meta.outputTemplate`
   * and looks up the React component via FrameRendererRegistry.
   *
   * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §6.2
   */
  _meta?: ToolResultMeta;
}
export function buildToolResult(args: ToolResultPayload): ToolResultPayload {
  const out: ToolResultPayload = {
    name: args.name,
    tool_use_id: args.tool_use_id,
    content: args.content,
    is_error: args.is_error,
  };
  if (args._meta !== undefined) {
    out._meta = args._meta;
  }
  return out;
}

// Phase 2.4.2 §A6 (2026-05-12): `buildModelHandoffOffer` retired.
// The Phase 10 TFC handoff_offer code path was ripped in F0-2
// (2026-05-12 audit — runChat.ts:468-471 explains) after the Phase E.1
// intent-classifier deletion left it without an upstream signal.
// Zero production callers remain; the local typed builder is removed.
// The SDK still exports a canonical `buildModelHandoffOffer` at
// lib/agentic-sdk/agentic-events/builders.ts if a future revival needs
// a payload constructor. Pinned by
// __tests__/architecture/no-object-literal-emits.source-regression.test.ts.

/**
 * `assistant_message_stop` payload — closes the assistant turn in the
 * UI's stream reducer. Field shape (`reason`, `model`) is the V2 dual-
 * emit contract.
 *
 * SDK alternative: `buildMessageStop({})` — the canonical event carries
 * no payload fields (the stop_reason lives on the preceding
 * `message_delta` event in the canonical wire shape). The V2 dual-emit
 * carries `reason` + `model` directly so the UI doesn't need to track
 * the prior message_delta. Migration deferred to Phase 16 once the UI
 * consumer reads from the canonical `message_delta` instead.
 */
export interface AssistantMessageStopPayload {
  reason: StopReason;
  model: string;
}
export function buildAssistantMessageStop(
  args: AssistantMessageStopPayload,
): AssistantMessageStopPayload {
  return { reason: args.reason, model: args.model };
}
