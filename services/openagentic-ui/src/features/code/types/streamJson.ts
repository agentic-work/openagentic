/**
 * openagentic stream-json event types.
 *
 * Emitted by `openagentic --print --output-format stream-json` (openagentic
 * v0.6.3+). Each JSONL line on stdout is one of these top-level records.
 * Content-block deltas mirror Anthropic's SSE format exactly, so tools
 * built for the Anthropic Messages streaming API can be reused.
 *
 * Kept intentionally close to the raw wire format — the UI reducer in
 * useCodeModeChat.ts flattens these into UI-friendly message blocks.
 */

// ────────────────────────────────────────────────────────────────────────────
// Top-level record wrappers
// ────────────────────────────────────────────────────────────────────────────

export type StreamJsonEvent =
  | SystemInitEvent
  | StreamEventWrapper
  | MaterializedAssistantEvent
  | UserToolResultEvent
  | ResultEvent
  | ErrorEvent
  | ControlRequestEvent
  | ToolProgressEvent;

/**
 * Mid-execution progress from a tool (primarily BashTool stdout chunks).
 * Emitted by openagentic as the tool is running so the client can show
 * live output instead of waiting for the final tool_result. The
 * `parentToolUseID` ties it back to the in-flight tool_use block.
 */
export interface ToolProgressEvent {
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
}

/**
 * openagentic → client mid-turn permission prompt. Arrives as a
 * stream-json record with type: 'control_request' and a `can_use_tool`
 * subtype, carrying the proposed tool call for the user to approve or
 * deny. The client responds by writing a control_response record back
 * via POST /api/code/sessions/:id/chat/control. See
 * useCodeModeChat.sendControl and PermissionDialog for the UI side.
 *
 * Other subtypes (interrupt, end_session, set_permission_mode) are
 * client→openagentic only and don't arrive on stdout.
 */
export interface ControlRequestEvent {
  type: 'control_request';
  request_id: string;
  request: CanUseToolRequest | { subtype: string; [k: string]: unknown };
  session_id?: string;
  uuid?: string;
}

export interface CanUseToolRequest {
  subtype: 'can_use_tool';
  tool_name: string;
  input: Record<string, unknown>;
  tool_use_id: string;
  permission_suggestions?: unknown[];
  blocked_path?: string | null;
  decision_reason?: unknown;
  agent_id?: string;
}

/**
 * Tool result event. Emitted by openagentic after a tool finishes
 * executing, as a user-role message containing one or more tool_result
 * content blocks. Each block's `tool_use_id` ties it back to the
 * corresponding tool_use block in the assistant turn that preceded it.
 *
 * Also carries a richer `tool_use_result` sibling with stdout/stderr
 * structured fields — useful for Bash and similar tools where the
 * flat `content` string is a pre-formatted summary.
 */
export interface UserToolResultEvent {
  type: 'user';
  message: {
    role: 'user';
    content: Array<ToolResultBlock>;
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
}

/** Content block inside a UserToolResultEvent. */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  /** Flat string content, or list of typed content blocks for image support. */
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      >;
  is_error?: boolean;
}

/**
 * Non-delta form: openagentic emits a full, materialized assistant
 * message alongside the streaming `stream_event` deltas. We already
 * render from the deltas, so this is treated as a no-op in the reducer.
 * Documented here to prevent "unknown record type" warnings.
 */
export interface MaterializedAssistantEvent {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: ContentBlock[];
    model?: string;
    stop_reason?: string | null;
  };
  session_id?: string;
  uuid?: string;
}

// ─── Rich detail types for CodeMode React modals ───

export interface ToolDetail {
  name: string;
  category: string;
  categoryLabel: string;
  isMcp: boolean;
  serverName?: string;
  searchHint?: string;
  enabled: boolean;
}

export interface McpServerDetail {
  name: string;
  status: string; // 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string;
  version?: string;
  tools: string[];
}

export interface PluginDetail {
  name: string;
  source: string;
  path: string;
  enabled: boolean;
  hasMcpServers: boolean;
}

export interface SkillDetail {
  name: string;
  description: string;
  loadedFrom: string; // 'skills' | 'plugin' | 'bundled' | 'mcp' | etc.
  source: string; // 'userSettings' | 'projectSettings' | 'policySettings' | 'plugin' | 'mcp' | 'bundled' | etc.
}

export interface AgentDetail {
  name: string;
  description: string;
  model?: string;
  source: string;
  tools?: string[];
}

export interface SystemInitDetail {
  tools: ToolDetail[];
  mcp_servers: McpServerDetail[];
  plugins: PluginDetail[];
  skills: SkillDetail[];
  agents: AgentDetail[];
  permissions: { mode: string };
}

/** Emitted once at the start with session metadata. */
export interface SystemInitEvent {
  type: 'system';
  subtype: 'init';
  cwd: string;
  session_id: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: string;
  slash_commands: string[];
  apiKeySource: string;
  openagentic_version: string;
  output_style?: string;
  agents?: string[];
  skills?: string[];
  plugins?: string[];
  uuid: string;
  fast_mode_state?: string;
  /** Rich detail for CodeMode React modals */
  _detail?: SystemInitDetail;
}

/** Wraps an Anthropic-compatible stream event. */
export interface StreamEventWrapper {
  type: 'stream_event';
  event: AnthropicStreamEvent;
  session_id: string;
  parent_tool_use_id: string | null;
  uuid: string;
}

/** Terminal record emitted when the turn finishes. */
export interface ResultEvent {
  type: 'result';
  subtype: 'success' | 'error' | 'error_max_turns';
  is_error: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  session_id: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  result?: string;
  uuid: string;
}

/** Non-fatal error event. */
export interface ErrorEvent {
  type: 'error';
  message: string;
  session_id?: string;
  uuid?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Anthropic Messages streaming events (the inner `event` of StreamEventWrapper)
// ────────────────────────────────────────────────────────────────────────────

export type AnthropicStreamEvent =
  | MessageStart
  | MessageDelta
  | MessageStop
  | ContentBlockStart
  | ContentBlockDelta
  | ContentBlockStop;

export interface MessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export interface MessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason?: string | null;
    stop_sequence?: string | null;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface MessageStop {
  type: 'message_stop';
}

export interface ContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: ContentBlock;
}

export interface ContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: ContentBlockDeltaPayload;
}

export interface ContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Content blocks
// ────────────────────────────────────────────────────────────────────────────

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ContentBlockDeltaPayload =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'signature_delta'; signature: string }
  | { type: 'input_json_delta'; partial_json: string };

// ────────────────────────────────────────────────────────────────────────────
// UI-side flattened message shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * What the chat view actually renders. We flatten stream-json into a
 * list of these, one per assistant turn. The reducer in useCodeModeChat
 * appends deltas to the last block of the matching kind instead of
 * creating thousands of tiny TextBlocks.
 */
export type ChatMessage =
  | UserChatMessage
  | AssistantChatMessage
  | SystemChatMessage
  | ErrorChatMessage;

export interface UserChatMessage {
  id: string;
  role: 'user';
  text: string;
  createdAt: number;
}

export interface AssistantChatMessage {
  id: string;
  role: 'assistant';
  /** Ordered content blocks rendered top-to-bottom in the message bubble. */
  blocks: AssistantBlock[];
  /** True while the SSE stream is still active. */
  streaming: boolean;
  /** model_delta.stop_reason once the turn finishes. */
  stopReason?: string | null;
  /** Model that produced this turn (from message_start.message.model). */
  turnModel?: string;
  /** Populated from the final `result` event. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd?: number;
  };
  createdAt: number;
  /**
   * Reducer-internal: running block-index offset for the *current*
   * LLM message inside this turn. Openagentic emits multiple sibling
   * `message_start`→…→`message_stop` sequences in a single turn (once
   * per tool loop), and each message restarts its `content_block`
   * indices at 0. We append-shift those indices by this offset so
   * earlier tool_use / thinking blocks aren't overwritten when the
   * next message begins.
   */
  _currentMessageBlockOffset?: number;
}

export interface SystemChatMessage {
  id: string;
  role: 'system';
  text: string;
  createdAt: number;
}

export interface ErrorChatMessage {
  id: string;
  role: 'error';
  text: string;
  createdAt: number;
}

/** A single renderable block inside an assistant message. */
export type AssistantBlock = UiTextBlock | UiThinkingBlock | UiToolUseBlock;

export interface UiTextBlock {
  kind: 'text';
  text: string;
}

export interface UiThinkingBlock {
  kind: 'thinking';
  thinking: string;
  /** True if the block is still receiving deltas. */
  streaming: boolean;
}

export interface UiToolUseBlock {
  kind: 'tool_use';
  toolUseId: string;
  name: string;
  /**
   * Accumulated partial JSON string for the tool input. openagentic
   * emits `input_json_delta` events with a `partial_json` fragment —
   * we keep the raw string and attempt a JSON.parse once the block
   * closes or after every delta if the string is syntactically valid.
   */
  partialInputJson: string;
  /** Parsed input once the JSON is complete. */
  input?: Record<string, unknown>;
  /** True while the stream is still adding tokens to this block. */
  streaming: boolean;
  /**
   * Populated after the tool finishes — attached by the reducer when
   * a UserToolResultEvent arrives with a matching tool_use_id. Renders
   * as the `⎿ <result>` sub-row beneath the tool-use card.
   */
  result?: UiToolResult;
  /**
   * Live stdout from a running tool (primarily Bash). Updated by
   * progress events as the command runs so the user sees output before
   * the final tool_result arrives. Cleared when the result is attached.
   */
  liveOutput?: string;
  /**
   * Nested sub-transcript for Task tool invocations. openagentic spawns
   * a child LLM loop whose stream_event records arrive on the parent
   * stream with `parent_tool_use_id` set to this block's `toolUseId`.
   * The reducer routes those events into these sub-blocks so the view
   * can render a collapsible child transcript under the Task card.
   */
  subBlocks?: AssistantBlock[];
  /**
   * Internal: same multi-message offset trick as
   * AssistantChatMessage._currentMessageBlockOffset, but for the
   * nested sub-transcript above.
   */
  _subMessageBlockOffset?: number;
}

/** UI-side flattened tool result for a completed tool call. */
export interface UiToolResult {
  /** Flat text content (Bash combines stdout+stderr, other tools a summary). */
  text: string;
  /** True if the tool reported an error (is_error: true). */
  isError: boolean;
  /** True if the result contains an image attachment (openagentic's FileReadTool on images, screenshots, etc.). */
  hasImage: boolean;
  /** Structured detail: stdout/stderr/etc. from openagentic's tool_use_result sibling. */
  detail?: {
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    noOutputExpected?: boolean;
  };
}
