// ────────────────────────────────────────────────────────────────────────────
// UI-side flattened message shape
// ────────────────────────────────────────────────────────────────────────────

/**
 * What the chat view actually renders. The reducer flattens stream-json
 * into a list of these, one per assistant turn (with sub-blocks for
 * Task children). The reducer in `state/streamReducer.ts` appends
 * deltas to the last block of the matching kind instead of creating
 * thousands of tiny TextBlocks.
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
  /** message_delta.stop_reason once the turn finishes. */
  stopReason?: string | null;
  /** Model that produced this turn (from message_start.message.model). */
  turnModel?: string;
  /** Populated from the final `result` event. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd?: number;
  };
  /** ms timestamp when the first `thinking_delta` (or thinking
   * `content_block_start`) was observed. Used by InlineActivityHeartbeat
   * to render `thinking…` while live and `thought for Ns` once frozen.
   * Mirrors claude code's `SpinnerAnimationRow` `thinkingStatus`. */
  thinkingStartedAt?: number;
  /** ms timestamp when reasoning finished (set on `message_stop`
   * if `thinkingStartedAt` was set and is not yet frozen). */
  thinkingEndedAt?: number;
  /** ms timestamp when the assistant turn STARTED accepting bytes —
   * either the first `message_start` or, when none arrived yet,
   * `createdAt`. Used by TurnStatsFooter to render total turn elapsed
   * (vs `thinkingEndedAt − thinkingStartedAt` which is just the
   * reasoning sub-segment). */
  turnStartedAt?: number;
  /** ms timestamp when the turn finished (final `result` / `message_stop`
   * for the last LLM message in the turn). Frozen on transition out of
   * streaming. */
  turnEndedAt?: number;
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
export type AssistantBlock =
  | UiTextBlock
  | UiThinkingBlock
  | UiToolUseBlock
  | UiToolResultBlock
  | UiTodoBlock
  | UiInkDomViewBlock
  | UiBoundaryBlock
  | UiParallelGroupBlock
  | UiPreviewBlock;

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
   * Seconds since the tool started running, last reported by a
   * SDKToolProgressMessage. Shown as a small "⏱ 12s" pill next to the tool
   * card header so the user can see a long-running command is still
   * alive. Cleared when the tool_result arrives. Mirrors the
   * `tool_progress` stream event in openagentic
   * (SDKToolProgressMessage.elapsed_time_seconds).
   */
  elapsedSec?: number;
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

/**
 * Standalone tool_result block. The normal flow attaches results to
 * their parent UiToolUseBlock via `result`. This block is used when the
 * tool_result arrives without a matching tool_use (e.g. orphan replays
 * from a saved transcript) and still needs to render in the transcript.
 */
export interface UiToolResultBlock {
  kind: 'tool_result';
  /** The tool_use_id this result references — useful for debug, may be unmatched. */
  toolUseId: string;
  result: UiToolResult;
  /** Optional tool name for display, when known. */
  toolName?: string;
}

/**
 * Inline ink-DOM view block — Phase E (codemode-permanent-plan §4).
 *
 * When the daemon dispatches a `local-jsx` slash command (/help,
 * /skills, /mcp, /agents, /permissions, /resume, /config, /status), it
 * mounts a React tree via the InkVdom reconciler and emits `ui_open`
 * over the WS. The reducer stores the vdom under
 * `ChatState.inkDomViews[viewId]` AND pushes one of these blocks onto
 * the streaming assistant message so `Part.tsx` renders the picker
 * inline. Subsequent `ui_patch` frames mutate the stored vdom; the
 * `InkDomView` component reads from context and re-renders.
 *
 * The block carries only the `viewId` and `command` — the actual vdom
 * lives in `ChatState.inkDomViews`. This keeps the block tiny, avoids
 * duplicating tree state across both maps, and lets the renderer
 * subscribe to vdom updates through a single channel.
 */
export interface UiInkDomViewBlock {
  kind: 'inkdom_view';
  viewId: string;
  command: string;
}

/**
 * Boundary frame block — visual divider that announces a "system event"
 * landed mid-turn. Today: plugin_loaded (a Claude plugin was auto-loaded
 * because of the prompt) and skill_invoked (a discovered skill was used).
 * Mirrors `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines
 * 39-50 — the dashed top/bottom rule with glyph + colored label + body.
 *
 * Subtype drives the glyph color (plugin → info, skill → success, compact
 * → warning, generic → prompt). Label is short bold ("Plugin loaded"),
 * body is a longer detail string.
 */
export interface UiBoundaryBlock {
  kind: 'boundary';
  /**
   * Visual variant.
   *  - `plugin`     — a Claude plugin auto-loaded mid-turn (info colour)
   *  - `skill`      — a registered skill fired (success colour)
   *  - `compact`    — context window auto-compacted (warning colour)
   *  - `model-swap` — the active model changed mid-turn, either by an
   *                   explicit `/model` slash command or by the smart
   *                   router auto-selecting a different model for the
   *                   next task. Mirrors mock-1-deploy-debug.html line
   *                   337-341 — `⤳ Model swap claude-sonnet-4-6 →
   *                   gpt-oss:20b (issued by /model)`.
   *  - `generic`    — fallback (prompt colour)
   */
  subtype: 'plugin' | 'skill' | 'compact' | 'model-swap' | 'generic';
  /** Bold label rendered to the right of the glyph (e.g. "Plugin loaded"). */
  label: string;
  /** Free-form body text rendered after the label. */
  body: string;
}

/**
 * Parallel-tool group — virtual block produced by the reducer's grouping
 * pass when N consecutive tool_use blocks land in the same assistant
 * turn with no text/thinking between them. Renders as a single
 * `↯ <N> tools in parallel` header wrapping the children. Mirrors
 * `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines 67-69.
 *
 * The reducer keeps the original tool_use blocks intact INSIDE this
 * group; downstream consumers (e.g. derive-todos, attach-result) walk
 * through the group transparently. The group itself never owns its own
 * toolUseId / streaming state — those live on the children.
 */
export interface UiParallelGroupBlock {
  kind: 'parallel_group';
  /** The grouped tool_use blocks, in order they arrived. */
  tools: UiToolUseBlock[];
}

/**
 * Inline live-preview block — emitted when the openagentic daemon detects
 * a dev-server boot URL in Bash tool stdout (Vite, Next, uvicorn, …)
 * and forwards a `system/preview_ready` frame. Renders as a chrome bar
 * + iframe inside the streaming assistant message, pointed at the
 * openagentic-api path-proxy URL `/api/code/preview/<sid>/<port>/` so
 * the running app loads inline. Mirrors the `.cm-preview` chrome from
 * `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines 408-418
 * + 605-613.
 */
export interface UiPreviewBlock {
  kind: 'preview';
  /** TCP port the dev server bound to inside the pod (1-65535). */
  port: number;
  /** Pod-local URL the daemon detected (e.g. `http://localhost:5173`). For display only. */
  url: string;
  /** Cosmetic framework label for the chrome badge ("vite" / "next" / …). */
  framework: string;
  /** Bash tool_use that started the server — UI uses this for placement near the action. */
  toolUseId?: string;
}

/**
 * Inline todo list block. Materialized by the reducer (Phase 4+) when
 * a TodoWrite tool_use is observed, so the UI can render todos as a
 * first-class block instead of digging through tool_use input.todos.
 * Today the reducer doesn't emit this kind; Part.tsx supports it for
 * forward-compatibility and so tests can construct fake blocks.
 */
export interface UiTodoBlock {
  kind: 'todo';
  todos: Array<{
    id?: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm?: string;
  }>;
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

// ────────────────────────────────────────────────────────────────────────────
// Legacy V1 conversation types (used by useCodeModeState/useStreamingParser)
//
// These are part of the older non-reducer codepath. Kept here for the
// duration of Phase B; will be removed when the V1 codepath is retired.
// ────────────────────────────────────────────────────────────────────────────

/** UI state machine for the V1 streaming hooks. */
export type UIState =
  | 'IDLE'
  | 'THINKING'
  | 'STREAMING_TEXT'
  | 'TOOL_CALLING'
  | 'TOOL_EXECUTING'
  | 'TOOL_RESULT'
  | 'COMPLETE'
  | 'ERROR';

/** A single tool use step in the V1 UI. */
export interface ToolStep {
  id: string; // tool_use.id
  name: string; // tool_use.name
  displayName: string; // Human-readable name
  icon: ToolIcon; // Icon type for rendering
  input: Record<string, unknown>; // tool_use.input
  inputPreview: string; // Short preview of input for display
  status: ToolStepStatus;
  result?: {
    content: string;
    isError: boolean;
    preview?: string; // Short preview for collapsed view
  };
  startTime: number;
  endTime?: number;
  duration?: number;
  isCollapsed: boolean;
}

export type ToolStepStatus =
  | 'pending'
  | 'executing'
  | 'success'
  | 'error';

export type ToolIcon =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'search'
  | 'fetch'
  | 'list'
  | 'find'
  | 'grep'
  | 'git'
  | 'default';

/** Container of all steps in a conversation turn. */
export interface StepsContainer {
  steps: ToolStep[];
  isCollapsed: boolean;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  errorCount: number;
}

/** A message in the V1 conversation. */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  textContent?: string;
  thinkingContent?: string;
  steps?: StepsContainer;
  isStreaming?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}
