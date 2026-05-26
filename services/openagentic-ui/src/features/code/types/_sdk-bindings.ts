// ─────────────────────────────────────────────────────────────────────
// Anthropic-shape (content blocks, raw stream events, message types)
// from `@agentic-work/llm-sdk`.
// ─────────────────────────────────────────────────────────────────────

export type {
  // Top-level message
  Message,
  // Content blocks (12-variant union)
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ToolUseBlock,
  // Tool result params (the "block in user message" shape)
  ToolResultBlockParam,
  // Stream events (top-level wrappers)
  RawMessageStreamEvent,
  RawMessageStartEvent,
  RawMessageDeltaEvent,
  RawMessageStopEvent,
  RawContentBlockStartEvent,
  RawContentBlockDeltaEvent,
  RawContentBlockStopEvent,
  // Inner deltas
  RawContentBlockDelta,
  TextDelta,
  ThinkingDelta,
  SignatureDelta,
  CitationsDelta,
  InputJSONDelta,
  // Stop reasons (6-variant: end_turn, max_tokens, stop_sequence, tool_use, pause_turn, refusal)
  StopReason,
} from '@agentic-work/llm-sdk/resources/messages';

// Hand-rolled UI used `ToolInputDelta` while the SDK calls it
// `InputJSONDelta`. Re-export the SDK type under both names so consumer
// migration is one-step (they can either keep calling it ToolInputDelta
// or move to InputJSONDelta — both resolve to the same type).
export type { InputJSONDelta as ToolInputDelta } from '@agentic-work/llm-sdk/resources/messages';

// MessageStream accumulator (runtime) — used by some UI helpers.
export { MessageStream } from '@agentic-work/llm-sdk/lib/MessageStream';

// ─────────────────────────────────────────────────────────────────────
// openagentic SDK message envelope discriminator union and subtypes
// from `@agentic-work/openagentic-sdk/types`.
// ─────────────────────────────────────────────────────────────────────

export type {
  // Top-level discriminated union (everything the daemon writes to stdout)
  SDKMessage,
  // Assistant role
  SDKAssistantMessage,
  // User role (incl. tool results, replays)
  SDKUserMessage,
  SDKUserMessageReplay,
  // System messages (init, compact_boundary, status, hooks, retries, etc.)
  SDKSystemMessage,
  SDKCompactBoundaryMessage,
  SDKStatusMessage,
  SDKAPIRetryMessage,
  SDKLocalCommandOutputMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  // Result envelope
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  // Stream-event envelope (carries Anthropic-shape RawMessageStreamEvent)
  SDKPartialAssistantMessage,
  // Tool / task / state events
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SDKAuthStatusMessage,
  SDKSessionStateChangedMessage,
  SDKFilesPersistedEvent,
  SDKRateLimitEvent,
  SDKRateLimitInfo,
  SDKElicitationCompleteMessage,
  SDKPromptSuggestionMessage,
  SDKStreamlinedTextMessage,
  SDKStreamlinedToolUseSummaryMessage,
  SDKPostTurnSummaryMessage,
  // Init detail (rich CodeMode modal payload)
  SDKSystemInitDetail,
  // Permission shapes
  PermissionMode,
  PermissionUpdate,
  PermissionResult,
  PermissionBehavior,
  // Misc shared
  ApiKeySource,
  FastModeState,
  ModelInfo,
  AgentInfo,
  SlashCommand,
  McpServerStatus,
  AccountInfo,
} from '@agentic-work/openagentic-sdk/types';

// ─────────────────────────────────────────────────────────────────────
// Control protocol — request/response envelopes flowing both directions
// from `@agentic-work/openagentic-sdk/control`.
// ─────────────────────────────────────────────────────────────────────

export type {
  SDKControlRequest,
  SDKControlResponse,
  SDKControlRequestInner,
  SDKControlInterruptRequest,
  SDKControlPermissionRequest,
  SDKControlInitializeRequest,
  SDKControlInitializeResponse,
  SDKControlSetPermissionModeRequest,
  SDKControlSetModelRequest,
  SDKControlSetMaxThinkingTokensRequest,
  SDKControlMcpStatusRequest,
  SDKControlMcpStatusResponse,
  SDKControlGetContextUsageRequest,
  SDKControlRewindFilesRequest,
  SDKControlRewindFilesResponse,
  SDKControlCancelAsyncMessageRequest,
  SDKControlCancelAsyncMessageResponse,
  SDKControlSeedReadStateRequest,
  SDKHookCallbackRequest,
  SDKControlMcpMessageRequest,
  SDKControlMcpSetServersRequest,
  SDKControlMcpSetServersResponse,
  SDKControlReloadPluginsRequest,
  SDKControlReloadPluginsResponse,
  SDKControlMcpReconnectRequest,
  SDKControlMcpToggleRequest,
  SDKControlInstallPluginRequest,
  SDKControlPluginToggleRequest,
  SDKControlUninstallPluginRequest,
  SDKControlStopTaskRequest,
  SDKControlApplyFlagSettingsRequest,
  SDKControlGetSettingsRequest,
  SDKControlGetSettingsResponse,
  SDKControlElicitationRequest,
  SDKControlElicitationResponse,
  SDKControlEndSessionRequest,
  SDKControlChannelEnableRequest,
  SDKControlMcpAuthenticateRequest,
  SDKControlMcpOAuthCallbackUrlRequest,
  SDKControlOpenAgenticAuthenticateRequest,
  SDKControlOpenAgenticOAuthCallbackRequest,
  SDKControlOpenAgenticOAuthWaitForCompletionRequest,
  SDKControlMcpClearAuthRequest,
  SDKControlGenerateSessionTitleRequest,
  SDKControlSideQuestionRequest,
  SDKControlRemoteControlRequest,
  ControlResponse,
  ControlErrorResponse,
  SDKControlCancelRequest,
  SDKKeepAliveMessage,
  SDKUpdateEnvironmentVariablesMessage,
  // Wire envelope unions (what flows on stdout / stdin)
  StdoutMessage,
  StdinMessage,
} from '@agentic-work/openagentic-sdk/control';

// ─────────────────────────────────────────────────────────────────────
// Runtime-side option types (used by SDK-aware UI helpers)
// from `@agentic-work/openagentic-sdk/runtime`.
// ─────────────────────────────────────────────────────────────────────

export type {
  Options,
  Query,
  EffortLevel,
  SDKSession,
  SDKSessionOptions,
} from '@agentic-work/openagentic-sdk/runtime';

// ─────────────────────────────────────────────────────────────────────
// Schemas — runtime zod validators.
// ─────────────────────────────────────────────────────────────────────

export {
  SDKMessageSchema,
} from '@agentic-work/openagentic-sdk/schemas';

export {
  SDKControlRequestInnerSchema,
} from '@agentic-work/openagentic-sdk/control-schemas';

// ─────────────────────────────────────────────────────────────────────
// Ink-VDOM frame shapes + runtime guards
// from `@agentic-work/openagentic-sdk/vdom`.
// ─────────────────────────────────────────────────────────────────────

export type {
  VdomNode,
  DiffOp,
  DiffOpSetProp,
  DiffOpReplaceNode,
  DiffOpAppendChild,
  DiffOpRemoveChild,
  UiOpenFrame,
  UiPatchFrame,
  UiCloseFrame,
  UiEventFrame,
  UiFrame,
} from '@agentic-work/openagentic-sdk/vdom';

export {
  isUiOpenFrame,
  isUiPatchFrame,
  isUiCloseFrame,
  isUiEventFrame,
  serializeUiFrame,
  parseUiFrame,
} from '@agentic-work/openagentic-sdk/vdom';

// ─────────────────────────────────────────────────────────────────────
// UI compatibility aliases
//
// These names mirror the legacy hand-rolled types from the deleted
// `streamJson.ts` file so consumer migration is a one-line import path
// change. New code should prefer the canonical SDK names above.
// ─────────────────────────────────────────────────────────────────────

import type {
  RawMessageStreamEvent as _RawMessageStreamEvent,
  RawMessageStartEvent as _RawMessageStartEvent,
  RawMessageDeltaEvent as _RawMessageDeltaEvent,
  RawMessageStopEvent as _RawMessageStopEvent,
  RawContentBlockStartEvent as _RawContentBlockStartEvent,
  RawContentBlockDeltaEvent as _RawContentBlockDeltaEvent,
  RawContentBlockStopEvent as _RawContentBlockStopEvent,
  RawContentBlockDelta as _RawContentBlockDelta,
  ToolResultBlockParam as _ToolResultBlockParam,
} from '@agentic-work/llm-sdk/resources/messages';
import type {
  SDKMessage as _SDKMessage,
  SDKSystemMessage as _SDKSystemMessage,
  SDKPartialAssistantMessage as _SDKPartialAssistantMessage,
  SDKResultMessage as _SDKResultMessage,
} from '@agentic-work/openagentic-sdk/types';
import type {
  SDKControlRequest as _SDKControlRequest,
  SDKControlPermissionRequest as _SDKControlPermissionRequest,
} from '@agentic-work/openagentic-sdk/control';

/**
 * Top-level wire union — kept under the legacy name `StreamJsonEvent`.
 * Equals `SDKMessage` (everything the daemon emits via the formal SDK
 * shape) plus the additional shapes the codemode UI sees on stdout:
 * - `ErrorEvent` — synthesized by the relay for transport errors.
 * - `UserToolResultEvent` — narrowed `SDKUserMessage` for tool results.
 * - `ToolProgressEvent` — legacy `'progress'` shape carrying live
 *   Bash stdout (the SDK has not formally modelled live output yet).
 * - control envelopes — the relay forwards `SDKControlRequest` and
 *   `SDKControlResponse` frames to the UI for permission prompts and
 *   command-response handling. These are NOT part of `SDKMessage` (which
 *   is stdout-only); the UI must also receive them on the same channel.
 */
export type StreamJsonEvent =
  | _SDKMessage
  | ErrorEvent
  | UserToolResultEvent
  | ToolProgressEvent
  | _SDKControlRequest
  | { type: 'control_response'; response: unknown };

/**
 * Anthropic-shape stream event (wrapped inside `SDKPartialAssistantMessage.event`).
 * Legacy name; identical to `RawMessageStreamEvent`.
 */
export type AnthropicStreamEvent = _RawMessageStreamEvent;
export type MessageStart = _RawMessageStartEvent;
export type MessageDelta = _RawMessageDeltaEvent;
export type MessageStop = _RawMessageStopEvent;
export type ContentBlockStart = _RawContentBlockStartEvent;
export type ContentBlockDelta = _RawContentBlockDeltaEvent;
export type ContentBlockStop = _RawContentBlockStopEvent;
export type ContentBlockDeltaPayload = _RawContentBlockDelta;

/** Legacy alias for `SDKPartialAssistantMessage` (the stream-event envelope). */
export type StreamEventWrapper = _SDKPartialAssistantMessage;

/** Legacy alias for `SDKResultMessage` (success or error). */
export type ResultEvent = _SDKResultMessage;

/**
 * Tool progress envelope — the LEGACY openagentic `'progress'` shape
 * (carries live Bash stdout etc.). The newer SDK has a formally-typed
 * `SDKToolProgressMessage` with `type: 'tool_progress'` and snake_case
 * fields, but it doesn't model live tool output today. Until the SDK
 * adds that, the codemode UI keeps consuming the legacy shape.
 *
 * Re-exported here so all wire-shape types flow through one module.
 */
export type ToolProgressEvent = {
  type: 'progress';
  data: {
    type: string;
    output?: string;
    fullOutput?: string;
    elapsedTimeSeconds?: number;
    totalLines?: number;
    totalBytes?: number;
    taskId?: string;
    timeoutMs?: number;
  };
  toolUseID: string;
  parentToolUseID: string;
  uuid: string;
  timestamp?: string;
};

/** Re-export the SDK-typed tool progress for new consumers. */
export type { SDKToolProgressMessage as ToolProgressMessageV2 } from '@agentic-work/openagentic-sdk/types';

/** Legacy alias for `ToolResultBlockParam` (a content block in user messages). */
export type ToolResultBlock = _ToolResultBlockParam;

/**
 * Legacy alias for `SDKControlRequest`. The hand-rolled type carried
 * `session_id?: string` and `uuid?: string` envelope fields that aren't
 * part of the SDK type proper — augment for backward compatibility.
 *
 * Phase F (codemode-permanent-plan §4) — additionally carries
 * `parent_tool_use_id?: string | null` so the UI can route a
 * `can_use_tool` permission request to the correct subagent panel
 * when the parent assistant turn fanned out into N concurrent Task
 * spawns. The daemon's existing assistant/user envelopes already
 * carry this field (see SDKAssistantMessage / SDKUserMessage in the
 * generated core types); when the daemon emits a control_request for
 * a permission a subagent triggered, it copies the same id onto the
 * envelope so the UI can resolve the right panel without inferring
 * it from `tool_use_id`. Optional + null-default keeps the
 * single-agent path (root-level permission → message-tail card)
 * untouched.
 */
export type ControlRequestEvent = _SDKControlRequest & {
  session_id?: string;
  uuid?: string;
  parent_tool_use_id?: string | null;
};

/**
 * Legacy alias for the permission-request inner control. Identical to
 * `SDKControlPermissionRequest`.
 */
export type CanUseToolRequest = _SDKControlPermissionRequest;

/**
 * SystemInit envelope used across the codemode UI. Equals the SDK's
 * `SDKSystemMessage` (`subtype: 'init'`) plus the platform-specific
 * `budget_cap_usd` augmentation injected by the in-pod daemon (sourced
 * from OPENAGENTIC_BUDGET_CAP_USD env var). The augmentation is NOT in
 * the upstream SDK — it's a tenant-budget hook for code-manager.
 */
export type SystemInitEvent = _SDKSystemMessage & {
  budget_cap_usd?: number | null;
};

/**
 * UI-side narrowing of `SDKUserMessage` for the tool-result variant.
 * The SDK's `SDKUserMessage.message` is `unknown` (the UI/daemon type
 * the daemon emits, but the wire still carries an Anthropic-shape user
 * message with role:'user' and content:Array<ToolResultBlockParam>).
 * The narrowing is the same shape every consumer uses; pinning it here
 * keeps the wire-vs-UI boundary explicit at the binding site.
 */
export type UserToolResultEvent = {
  type: 'user';
  message: {
    role: 'user';
    content: Array<_ToolResultBlockParam>;
  };
  parent_tool_use_id: string | null;
  session_id: string;
  uuid: string;
  timestamp?: string;
  tool_use_result?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    isImage?: boolean;
    noOutputExpected?: boolean;
    [k: string]: unknown;
  };
};

/**
 * Top-level non-fatal error envelope. NOT part of `SDKMessage` — the
 * openagentic-api relay synthesizes this when something goes wrong
 * outside the daemon's reach (auth failure, transport error, malformed
 * frame). Kept here so the UI reducer's discriminated union still
 * compiles; the daemon itself never emits this shape.
 */
export type ErrorEvent = {
  type: 'error';
  message: string;
  session_id?: string;
  uuid?: string;
};

// ─────────────────────────────────────────────────────────────────────
// Rich-detail aliases for CodeMode React modals.
//
// These derive directly from `SDKSystemInitDetail` — no drift possible.
// Used by `RichModals.tsx` to type the per-section table rows.
// ─────────────────────────────────────────────────────────────────────

import type { SDKSystemInitDetail as _SDKSystemInitDetail } from '@agentic-work/openagentic-sdk/types';

export type SystemInitDetail = _SDKSystemInitDetail;
export type ToolDetail = _SDKSystemInitDetail['tools'][number];
export type McpServerDetail = _SDKSystemInitDetail['mcp_servers'][number];
export type PluginDetail = _SDKSystemInitDetail['plugins'][number];
export type SkillDetail = _SDKSystemInitDetail['skills'][number];
export type AgentDetail = _SDKSystemInitDetail['agents'][number];
