import {
  closeAllStreamingAssistants,
  forceCloseMessageBlocks,
  sessionMetaFromInit,
  type SessionMetaShape,
  tryParseInput,
} from '../chat/sdkAdapter';
import type {
  AnthropicStreamEvent,
  CanUseToolRequest,
  ContentBlock,
  ContentBlockDeltaPayload,
  ControlRequestEvent,
  DiffOp,
  ResultEvent,
  StreamEventWrapper,
  StreamJsonEvent,
  SystemInitEvent,
  ToolProgressEvent,
  ToolResultBlock,
  UiCloseFrame,
  UiOpenFrame,
  UiPatchFrame,
  UserToolResultEvent,
  VdomNode,
} from '../types/_sdk-bindings';
import type {
  AssistantBlock,
  AssistantChatMessage,
  ChatMessage,
  UiBoundaryBlock,
  UiParallelGroupBlock,
  UiPreviewBlock,
  UiToolResult,
  UiToolUseBlock,
} from '../types/uiState';

// ────────────────────────────────────────────────────────────────────
// State shape
// ────────────────────────────────────────────────────────────────────

/**
 * Snapshot of everything the reducer maintains across one chat session.
 *
 * `streamingMessageId` is the id of the assistant message currently
 * receiving deltas. Set atomically by `submit_user` BEFORE any wire
 * frames for that turn arrive (which fixes the
 * `streamingMsgIdRef.current === null` race that left blocks: [] when
 * the daemon's delta sequence beat React's setState batching).
 *
 * `isStreaming` is a derived selector — `streamingMessageId !== null`.
 * It's not stored on state; consumers compute it from the message id.
 */
export interface ChatState {
  /** Ordered transcript — user/assistant/system/error messages. */
  messages: ChatMessage[];
  /** id of the assistant message currently receiving deltas. null when no turn is in flight. */
  streamingMessageId: string | null;
  /** Most recent error string surfaced to the UI. null when healthy. */
  error: string | null;
  /** Latest input_tokens from a result event — also the rolling context size. */
  contextTokens: number | undefined;
  /** Briefly non-null after a system/compact_boundary event for the flash animation. */
  compactionFlash: 'manual' | 'auto' | null;
  /** Most recent model name reported by system/init. */
  model: string | undefined;
  /** Most recent fast_mode_state reported by system/init. */
  fastMode: string | undefined;
  /** Accumulated session cost across all turns. */
  totalCostUsd: number;
  /** Accumulated session output tokens across all turns. */
  totalOutputTokens: number;
  /** Duration (ms) of the most recent turn. */
  lastTurnMs: number | undefined;
  /**
   * Pending can_use_tool prompt waiting for the user's allow/deny.
   *
   * `parent_tool_use_id` (Phase F, codemode-permanent-plan §4) carries
   * the toolUseId of the spawning Task tool when the permission was
   * triggered by a subagent — the UI uses it to mount the
   * `InlinePermissionCard` inside that subagent's panel instead of at
   * the assistant message tail. `null` / unset means root-level
   * permission (single-agent flow, tail mount).
   */
  pendingPermission:
    | (CanUseToolRequest & {
        request_id: string;
        parent_tool_use_id?: string | null;
      })
    | null;
  /** Captured session metadata from the most recent system/init event. */
  sessionMeta: SessionMetaShape | null;
  /**
   * Phase E (codemode-permanent-plan §4) — per-viewId mount state for
   * the daemon's `local-jsx` slash-command UIs.
   *
   * Keyed by `viewId` from `ui_open`. Each entry carries the current
   * vdom snapshot (mutated via `ui_patch` ops) and the command label
   * for debug. The browser's `InkDomView` reads from this map via
   * context and re-renders whenever the vdom changes. `ui_close`
   * deletes the entry; subsequent renders show an empty shell.
   *
   * The streaming assistant message ALSO has a corresponding
   * `inkdom_view` block in its `blocks` list so `Part.tsx` knows to
   * mount an `InkDomView` for that viewId. The block carries only
   * `viewId` + `command` — the canonical vdom is here.
   */
  inkDomViews: Record<string, { vdom: VdomNode; lastPatchedAt?: number }>;
  /**
   * Native React picker overlay — Slice 1+ of the codemode native React
   * pickers plan. Set when the user types `/skills` (Slice 1), `/plugin`
   * (Slice 2), or `/model` (Slice 4 — model swap). The CodeModeChatView
   * renders the matching picker overlay when `activePicker === <name>`.
   * `null` means no picker is active.
   *
   * Distinct from `inkDomViews` (the InkVdom bridge) because pickers are
   * native React in the browser, backed by a daemon RPC for data — see
   * useDaemonRPC + SkillsPicker.
   *
   * `'model'` is special among the pickers: clicking a row triggers a
   * mid-session model swap via `set_model`, while the others are
   * read/manage UIs. The picker still uses the same activePicker slot.
   */
  activePicker: 'skills' | 'mcp' | 'plugins' | 'model' | 'agents' | null;
  /**
   * Boot-time boundary buffer — fix 2026-04-30 for the mock-2 parity bug.
   *
   * openagentic 99f5086 verified that the daemon emits 2× plugin_loaded
   * system events at boot AND 1× skill_invoked mid-turn. Mid-turn worked;
   * boot did not, because boot boundaries arrive BEFORE the first
   * assistant message exists and the reducer's old behavior was to drop
   * them silently (`if (!state.streamingMessageId) return state;`).
   *
   * Now the reducer buffers boot boundaries here. On the next top-level
   * assistant `message_start`, the buffer is prepended to the new
   * message's blocks (in arrival order, ahead of any text/tool blocks)
   * and cleared. Idempotent: dedupes on (subtype, label, body) so a
   * double-init replaying plugin_loaded twice doesn't double-count.
   *
   * Reset on `clear` and `system/init`.
   */
  pendingBoundaryBlocks?: UiBoundaryBlock[];
}

/**
 * The initial reducer state. Frozen because reducer purity demands it
 * — never mutate this; always derive a new object via `reduce()`.
 */
export const INITIAL_STATE: ChatState = Object.freeze({
  messages: [],
  streamingMessageId: null,
  error: null,
  contextTokens: undefined,
  compactionFlash: null,
  model: undefined,
  fastMode: undefined,
  totalCostUsd: 0,
  totalOutputTokens: 0,
  lastTurnMs: undefined,
  pendingPermission: null,
  sessionMeta: null,
  inkDomViews: {},
  activePicker: null,
  pendingBoundaryBlocks: [],
}) as ChatState;

/**
 * Legacy factory — the Phase B tests call this. Keep the export so the
 * old test file's `createInitialState()` continues working without
 * changes. Returns a shallow clone (NOT frozen) so test code can
 * append seed messages via spread.
 */
export function createInitialState(): ChatState {
  return { ...INITIAL_STATE, messages: [], inkDomViews: {}, activePicker: null };
}

// ────────────────────────────────────────────────────────────────────
// ChatAction — what the reducer accepts
// ────────────────────────────────────────────────────────────────────

/**
 * Discriminated union of every action the reducer handles.
 *
 *   - `event` — a wire frame from the daemon (StreamJsonEvent: SDKMessage
 *     plus the synthetic frames the relay emits like ErrorEvent and
 *     ToolProgressEvent).
 *   - `submit_user` — the hook seeds a user/assistant pair and sets
 *     `streamingMessageId` atomically. Dispatched by `sendMessage`.
 *   - `permission_response` — the hook responded to a can_use_tool
 *     prompt; clear `pendingPermission`. Dispatched by
 *     `respondToPermission` BEFORE sending the control_response frame.
 *   - `interrupt` — the user clicked cancel; close the in-flight
 *     assistant with a marker. Dispatched by `cancel`.
 *   - `connection_closed` — WS dropped mid-turn; close the in-flight
 *     assistant with a marker. Dispatched by `ws.onclose`.
 *   - `clear` — wipe the transcript. Dispatched by `clear`.
 *   - `set_error` — surface an error string. Dispatched by error
 *     handlers (config fetch fail, non-fatal relay errors).
 *   - `restore` — replace the transcript with a persisted one (loaded
 *     from localStorage). Dispatched on hook mount and sessionId change.
 *   - `system_message_inject` — append a synthetic system/italic row
 *     for mid-turn status events. Dispatched by the hook because
 *     genId() is impure.
 */
export type ChatAction =
  | { type: 'event'; event: StreamJsonEvent }
  | {
      type: 'submit_user';
      userMsgId: string;
      asstMsgId: string;
      text: string;
      createdAt: number;
    }
  | { type: 'permission_response'; requestId: string }
  | { type: 'interrupt'; markerCreatedAt?: number }
  | { type: 'connection_closed'; code: number }
  | { type: 'clear' }
  | { type: 'set_error'; message: string }
  | {
      type: 'restore';
      messages: ChatMessage[];
      meta?: {
        model?: string;
        contextTokens?: number;
        sessionMeta?: SessionMetaShape | null;
      };
    }
  | {
      type: 'system_message_inject';
      id: string;
      text: string;
      createdAt: number;
    }
  | { type: 'clear_compaction_flash' }
  | { type: 'open_picker'; picker: 'skills' | 'mcp' | 'plugins' | 'model' | 'agents' }
  | { type: 'close_picker' };

// ────────────────────────────────────────────────────────────────────
// Block helpers — duplicated here from useCodeModeChat so the reducer
// has no dependency on the hook. Phase C consolidates: this is the
// canonical home; the hook imports from here (or has its own copy
// removed).
// ────────────────────────────────────────────────────────────────────

/**
 * Structural container for the multi-message block layout — shared by
 * top-level assistant messages AND the nested sub-transcripts hosted
 * inside Task tool_use blocks. Lets one applier drive both layers.
 */
interface BlockContainer {
  blocks: AssistantBlock[];
  _currentMessageBlockOffset?: number;
}

function cloneBlock(b: AssistantBlock): AssistantBlock {
  if (b.kind === 'text') return { ...b };
  if (b.kind === 'thinking') return { ...b };
  if (b.kind === 'tool_result') return { ...b, result: { ...b.result } };
  if (b.kind === 'todo') return { ...b, todos: b.todos.map((t) => ({ ...t })) };
  // Phase E — inkdom_view blocks reference vdom that lives in
  // ChatState.inkDomViews; cloning the block itself is enough.
  if (b.kind === 'inkdom_view') return { ...b };
  // Boundary frames (plugin_loaded / skill_invoked) are flat by design —
  // a shallow clone is sufficient.
  if (b.kind === 'boundary') return { ...b };
  // Preview blocks (dev-server iframe) are flat by design.
  if (b.kind === 'preview') return { ...b };
  // Parallel groups carry an array of tool_use children; clone each.
  if (b.kind === 'parallel_group') {
    return { ...b, tools: b.tools.map((t) => cloneBlock(t) as UiToolUseBlock) };
  }
  return {
    ...b,
    subBlocks: b.subBlocks ? b.subBlocks.map(cloneBlock) : undefined,
  };
}

function contentBlockToUi(block: ContentBlock): AssistantBlock {
  if (block.type === 'text') {
    return { kind: 'text', text: block.text || '' };
  }
  if (block.type === 'thinking') {
    return { kind: 'thinking', thinking: block.thinking || '', streaming: true };
  }
  if (block.type === 'tool_use') {
    return {
      kind: 'tool_use',
      toolUseId: block.id,
      name: block.name,
      partialInputJson: block.input ? JSON.stringify(block.input) : '',
      input: block.input as Record<string, unknown> | undefined,
      streaming: true,
    };
  }
  // ContentBlock has 9 additional SDK variants (server-tool results, etc.)
  // that the codemode UI does not render today. Materialize them as a
  // text block carrying a debug trail so they're visible if the daemon
  // ever emits one.
  return {
    kind: 'text',
    text: `[unsupported content block: ${block.type}]`,
  };
}

function applyDelta(block: AssistantBlock, delta: ContentBlockDeltaPayload): void {
  switch (delta.type) {
    case 'text_delta':
      if (block.kind === 'text') {
        block.text += delta.text;
      }
      return;
    case 'thinking_delta':
      if (block.kind === 'thinking') {
        block.thinking += delta.thinking;
      }
      return;
    case 'signature_delta':
      // ignored — opaque metadata
      return;
    case 'input_json_delta':
      if (block.kind === 'tool_use') {
        block.partialInputJson += delta.partial_json;
        const parsed = tryParseInput(block.partialInputJson);
        if (parsed) block.input = parsed;
      }
      return;
  }
}

/**
 * Apply an inner Anthropic stream event (message_start, content_block_*,
 * message_delta, message_stop) to a block container. Mutates the
 * container in place — callers must clone first if React identity matters.
 */
function applyInnerEvent(
  container: BlockContainer,
  inner: AnthropicStreamEvent,
  msg?: AssistantChatMessage,
): void {
  switch (inner.type) {
    case 'message_start': {
      // Snapshot the current blocks length as the offset for THIS
      // message's content_block indices. openagentic emits multiple
      // Anthropic messages per turn (one per tool loop), each of which
      // restarts its content_block indices at 0.
      container._currentMessageBlockOffset = container.blocks.length;
      if (msg && inner.message.model) {
        msg.turnModel = inner.message.model;
      }
      // Stamp turnStartedAt on the first message_start of the turn so
      // TurnStatsFooter has a "total elapsed" anchor. openagentic emits
      // multiple message_start envelopes per turn (one per tool loop),
      // so set-once-then-leave-alone — only the first one wins.
      if (msg && !msg.turnStartedAt) {
        msg.turnStartedAt = Date.now();
      }
      // Pull initial usage from message_start. The Anthropic /v1/messages
      // SSE protocol emits `input_tokens` here so the live `↑ N tokens`
      // heartbeat indicator can render right when streaming begins
      // (before the model has finished and message_delta lands).
      // Providers like AIF/OpenAI-completions only have usage in the
      // finish chunk — those will populate via message_delta below.
      const startUsage = (inner.message as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
      if (msg && startUsage && (startUsage.input_tokens || startUsage.output_tokens)) {
        // Use Math.max instead of `??` so a sub-message's start (which
        // can carry input_tokens=N, output_tokens=0 or even both as 0
        // for the second + later tool loops) NEVER zeroes the running
        // turn totals. Bug seen live 2026-05-08: gpt-oss-120b restarts
        // message_start per tool loop with output_tokens=0; the old
        // `?? prev ?? 0` chain accepted the literal 0 and the heartbeat
        // counter went 406 → 166 → 67 (going DOWN) instead of climbing.
        // Math.max also keeps input monotonic when subsequent loops
        // extend the prompt with prior tool results.
        msg.usage = {
          inputTokens: Math.max(startUsage.input_tokens ?? 0, msg.usage?.inputTokens ?? 0),
          outputTokens: Math.max(startUsage.output_tokens ?? 0, msg.usage?.outputTokens ?? 0),
          totalCostUsd: msg.usage?.totalCostUsd,
        };
      }
      if (inner.message.content && inner.message.content.length > 0) {
        for (const block of inner.message.content) {
          container.blocks.push(contentBlockToUi(block));
        }
      }
      return;
    }
    case 'content_block_start': {
      const ui = contentBlockToUi(inner.content_block);
      const offset = container._currentMessageBlockOffset ?? 0;
      const absIdx = offset + inner.index;
      while (container.blocks.length <= absIdx) {
        container.blocks.push({ kind: 'text', text: '' });
      }
      container.blocks[absIdx] = ui;
      // Stamp thinking start the first time a thinking channel opens.
      // Captures wall-clock so the heartbeat can flip from `thinking…`
      // → `thought for Ns` once the model leaves the reasoning channel.
      if (msg && ui.kind === 'thinking' && msg.thinkingStartedAt === undefined) {
        msg.thinkingStartedAt = Date.now();
      }
      return;
    }
    case 'content_block_delta': {
      const offset = container._currentMessageBlockOffset ?? 0;
      const target = container.blocks[offset + inner.index];
      if (!target) return;
      applyDelta(target, inner.delta);
      // Belt-and-suspenders: some providers (gpt-oss via Ollama) sometimes
      // emit `thinking_delta` without a preceding `content_block_start`
      // for the thinking block. Stamp on first observed thinking_delta.
      if (
        msg &&
        inner.delta.type === 'thinking_delta' &&
        msg.thinkingStartedAt === undefined
      ) {
        msg.thinkingStartedAt = Date.now();
      }
      return;
    }
    case 'content_block_stop': {
      const offset = container._currentMessageBlockOffset ?? 0;
      const target = container.blocks[offset + inner.index];
      if (!target) return;
      if (target.kind === 'thinking') target.streaming = false;
      if (target.kind === 'tool_use') {
        target.streaming = false;
        const parsed = tryParseInput(target.partialInputJson);
        if (parsed) target.input = parsed;
      }
      return;
    }
    case 'message_delta': {
      if (!msg) return;
      if (inner.delta.stop_reason !== undefined) {
        msg.stopReason = inner.delta.stop_reason;
      }
      if (inner.usage) {
        msg.usage = {
          inputTokens: inner.usage.input_tokens ?? msg.usage?.inputTokens ?? 0,
          outputTokens: inner.usage.output_tokens ?? msg.usage?.outputTokens ?? 0,
          totalCostUsd: msg.usage?.totalCostUsd,
        };
      }
      return;
    }
    case 'message_stop':
      // End-of-message but not end-of-turn — the outer `result` event
      // is the single point that flips the turn closed.
      // Freeze thinking duration if reasoning ever happened — by the
      // time message_stop lands the model has fully exited the
      // reasoning channel.
      if (msg && msg.thinkingStartedAt !== undefined && msg.thinkingEndedAt === undefined) {
        msg.thinkingEndedAt = Date.now();
      }
      return;
  }
}

/**
 * Route a stream_event to the right container — top-level streaming
 * assistant message OR (for subagent Task invocations) the parent
 * tool_use block's `subBlocks`. Returns a new messages array.
 */
function applyStreamEventRouted(
  messages: ChatMessage[],
  streamingMessageId: string | null,
  wrapper: StreamEventWrapper,
): ChatMessage[] {
  const parentId = wrapper.parent_tool_use_id;
  const inner = wrapper.event as AnthropicStreamEvent;

  if (!parentId) {
    const idx = messages.findIndex((m) => m.id === streamingMessageId);
    if (idx < 0) return messages;
    const current = messages[idx];
    if (current.role !== 'assistant') return messages;
    const clone: AssistantChatMessage = {
      ...current,
      blocks: current.blocks.map(cloneBlock),
    };
    applyInnerEvent(clone, inner, clone);
    const next = [...messages];
    next[idx] = clone;
    return next;
  }

  // Sub-transcript path — find parent Task tool_use block, recurse
  // through nested subBlocks, route the event into its container.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const updatedBlocks = applyToNestedToolUse(m.blocks, parentId, inner);
    if (updatedBlocks) {
      const next = [...messages];
      next[i] = { ...m, blocks: updatedBlocks };
      return next;
    }
  }
  return messages;
}

/**
 * Recursively look for a tool_use block with the matching id and apply
 * the event to its subBlocks container. Returns a cloned block array
 * if a match was found, null otherwise.
 */
function applyToNestedToolUse(
  blocks: AssistantBlock[],
  parentToolUseId: string,
  inner: AnthropicStreamEvent,
): AssistantBlock[] | null {
  const directIdx = blocks.findIndex(
    (b) => b.kind === 'tool_use' && b.toolUseId === parentToolUseId,
  );
  if (directIdx >= 0) {
    const parentBlock = blocks[directIdx] as UiToolUseBlock;
    const subContainer: BlockContainer = {
      blocks: (parentBlock.subBlocks ?? []).map(cloneBlock),
      _currentMessageBlockOffset: parentBlock._subMessageBlockOffset,
    };
    applyInnerEvent(subContainer, inner);
    const clonedParent: UiToolUseBlock = {
      ...parentBlock,
      subBlocks: subContainer.blocks,
      _subMessageBlockOffset: subContainer._currentMessageBlockOffset,
    };
    return blocks.map((b, j) => (j === directIdx ? clonedParent : b));
  }
  // Recurse into subBlocks of any tool_use with children.
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.kind !== 'tool_use' || !b.subBlocks || b.subBlocks.length === 0) continue;
    const recursed = applyToNestedToolUse(b.subBlocks, parentToolUseId, inner);
    if (recursed) {
      const out = [...blocks];
      out[j] = { ...b, subBlocks: recursed };
      return out;
    }
  }
  return null;
}

/**
 * Convert a tool_result content block to the flat UI shape. Handles
 * both wire formats (string content vs. array of typed blocks).
 */
function toolResultBlockToUi(
  block: ToolResultBlock,
  detail: UserToolResultEvent['tool_use_result'],
): UiToolResult {
  let text = '';
  let hasImage = false;
  if (typeof block.content === 'string') {
    text = block.content;
  } else if (Array.isArray(block.content)) {
    const parts: string[] = [];
    for (const item of block.content) {
      if (item.type === 'text') parts.push(item.text);
      if (item.type === 'image') hasImage = true;
    }
    text = parts.join('\n');
  }
  return {
    text,
    isError: block.is_error === true,
    hasImage,
    detail: detail
      ? {
          stdout: detail.stdout,
          stderr: detail.stderr,
          interrupted: detail.interrupted,
          noOutputExpected: detail.noOutputExpected,
        }
      : undefined,
  };
}

/**
 * Append the content of a materialized subagent assistant envelope into
 * the parent Task tool_use's subBlocks. Walks the messages newest-first,
 * recurses through nested tool_use children, and clones the spine so
 * React identity remains correct.
 *
 * Each ContentBlock in `content` is converted to its UI counterpart via
 * `contentBlockToUi` (the same function the stream_event path uses for
 * top-level rendering). Materialized envelopes are non-streaming —
 * `streaming` is forced to `false` for tool_use entries so the renderer
 * skips the in-flight spinner glyph.
 *
 * Returns the original messages array reference unchanged when the
 * parent id is not found anywhere — silent no-op so out-of-order frames
 * don't corrupt state.
 */
function appendSubagentBlocks(
  messages: ChatMessage[],
  parentToolUseId: string,
  content: ContentBlock[],
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const updated = appendSubagentBlocksInBlocks(m.blocks, parentToolUseId, content);
    if (updated) {
      const next = [...messages];
      next[i] = { ...m, blocks: updated };
      return next;
    }
  }
  return messages;
}

function appendSubagentBlocksInBlocks(
  blocks: AssistantBlock[],
  parentToolUseId: string,
  content: ContentBlock[],
): AssistantBlock[] | null {
  const directIdx = blocks.findIndex(
    (b) => b.kind === 'tool_use' && b.toolUseId === parentToolUseId,
  );
  if (directIdx >= 0) {
    const parent = blocks[directIdx] as UiToolUseBlock;
    const newSubBlocks: AssistantBlock[] = [...(parent.subBlocks ?? [])];
    for (const cb of content) {
      const ui = contentBlockToUi(cb);
      // Materialized envelopes carry finalized blocks; flip streaming off
      // so the renderer doesn't show in-flight chrome.
      if (ui.kind === 'tool_use') ui.streaming = false;
      if (ui.kind === 'thinking') ui.streaming = false;
      newSubBlocks.push(ui);
    }
    const clonedParent: UiToolUseBlock = {
      ...parent,
      subBlocks: newSubBlocks,
    };
    return blocks.map((b, j) => (j === directIdx ? clonedParent : b));
  }
  // Recurse into existing nested subBlocks — supports nested Task spawns.
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.kind !== 'tool_use' || !b.subBlocks || b.subBlocks.length === 0) continue;
    const recursed = appendSubagentBlocksInBlocks(b.subBlocks, parentToolUseId, content);
    if (recursed) {
      const out = [...blocks];
      out[j] = { ...b, subBlocks: recursed };
      return out;
    }
  }
  return null;
}

function attachToolResult(
  messages: ChatMessage[],
  toolUseId: string,
  result: UiToolResult,
): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const cloned = attachResultInBlocks(m.blocks, toolUseId, result);
    if (cloned) {
      const next = [...messages];
      next[i] = { ...m, blocks: cloned };
      return next;
    }
  }
  return messages;
}

function attachResultInBlocks(
  blocks: AssistantBlock[],
  toolUseId: string,
  result: UiToolResult,
): AssistantBlock[] | null {
  const directIdx = blocks.findIndex(
    (b) => b.kind === 'tool_use' && b.toolUseId === toolUseId,
  );
  if (directIdx >= 0) {
    return blocks.map((b, j): AssistantBlock => {
      if (j !== directIdx) return b;
      if (b.kind !== 'tool_use') return b;
      return { ...b, result, streaming: false };
    });
  }
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.kind !== 'tool_use' || !b.subBlocks || b.subBlocks.length === 0) continue;
    const sub = attachResultInBlocks(b.subBlocks, toolUseId, result);
    if (sub) {
      const out = [...blocks];
      out[j] = { ...b, subBlocks: sub };
      return out;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Parallel-tool grouping — derived view for the renderer.
//
// When the assistant fires multiple tools concurrently in the same
// turn (e.g. 12 file writes in one swing — see
// `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines 67-69),
// the wire delivers each tool_use as a separate `content_block_start`
// inside the SAME `message_start` envelope. The reducer keeps them flat
// in `blocks` (so individual delta routing keeps working by index).
//
// This pure helper produces a render-ready view: consecutive tool_use
// blocks (≥ 2) coalesce into a virtual `kind:'parallel_group'` block
// holding the children. Single tool_uses are passed through unchanged.
//
// Idempotency: re-running on the output produces the same shape (a
// parallel_group already in `tools` is left alone — the helper never
// nests a parallel_group inside another).
// ────────────────────────────────────────────────────────────────────

/**
 * Tool names that should NEVER be wrapped in a parallel_group. Task /
 * Agent tools render their own subagent chrome (see TaskTranscriptPart
 * in Part.tsx + the cm-subagent panel) and shouldn't be visually
 * coalesced — even when fan-out runs three of them concurrently, each
 * panel has its own scrollable transcript and footer. TodoWrite is
 * typically a single-fire tool; we leave it ungrouped to keep the
 * sticky todo panel rendering predictable.
 */
const PARALLEL_GROUP_EXCLUDED_TOOLS = new Set([
  'Task',
  'Agent',
  'TodoWrite',
  'Todo',
]);

/**
 * Coalesce consecutive `tool_use` blocks into `parallel_group` virtual
 * blocks for display. Pure: never mutates input, returns either the
 * original array reference (when no grouping is needed) or a new one.
 *
 * Tools listed in `PARALLEL_GROUP_EXCLUDED_TOOLS` are passed through
 * unchanged — they have their own visualisation that doesn't fit the
 * "↯ N tools in parallel" wrapper.
 */
export function groupParallelTools(blocks: AssistantBlock[]): AssistantBlock[] {
  // Fast path: nothing to do if there's at most one groupable tool_use.
  let groupableCount = 0;
  for (const b of blocks) {
    if (b.kind === 'tool_use' && !PARALLEL_GROUP_EXCLUDED_TOOLS.has(b.name)) {
      groupableCount += 1;
    } else if (b.kind === 'parallel_group') {
      groupableCount += 2; // already grouped — keep as-is, but flag re-pass
    }
  }
  if (groupableCount < 2) return blocks;

  const out: AssistantBlock[] = [];
  let buffer: UiToolUseBlock[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      out.push(buffer[0]);
    } else {
      out.push({ kind: 'parallel_group', tools: buffer } as UiParallelGroupBlock);
    }
    buffer = [];
  };

  for (const b of blocks) {
    if (b.kind === 'tool_use' && !PARALLEL_GROUP_EXCLUDED_TOOLS.has(b.name)) {
      buffer.push(b);
      continue;
    }
    if (b.kind === 'parallel_group') {
      // Already-grouped block — flush the live buffer first, then keep
      // the existing group as-is. This makes the helper idempotent: a
      // second pass over the output produces the same shape.
      flush();
      out.push(b);
      continue;
    }
    // Non-groupable kind (or excluded tool) ends a parallel run.
    flush();
    out.push(b);
  }
  flush();
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Phase E (codemode-permanent-plan §4) — ink-DOM diff applier
//
// The daemon's reconciler emits paths in absolute form: each path is
// the chain of node ids from the wire vdom root → … → the node the op
// targets. So path[0] is always the wire root's id (the user's JSX
// root) — the synthetic container the reconciler uses internally is
// excluded from paths by `pathOf()`.
//
// `set_prop` / `replace_node` paths point AT the targeted node.
// `append_child` paths point AT the parent (we append onto its
// children). `remove_child` paths point AT the node being removed
// (last id is the doomed child).
//
// All four ops are applied immutably: we walk the tree along the path,
// shallow-clone every node we mutate, and leave untouched siblings
// shared. This is fine for React identity because the rendered
// component reads from the new tree on each commit.
// ────────────────────────────────────────────────────────────────────

/**
 * Apply a sequence of DiffOps to a wire vdom tree, returning a new
 * tree. Pure: never mutates the input. Unrecognized ops or paths that
 * don't resolve are silently no-op'd (the daemon reconciler is the
 * authoritative source of paths; if the UI's snapshot is out of sync,
 * silent skip is safer than throwing — the next ui_open re-syncs).
 *
 * @param vdom The current wire vdom snapshot.
 * @param ops  Sequenced diff ops from a single ui_patch frame.
 */
export function applyDiffOps(vdom: VdomNode, ops: DiffOp[]): VdomNode {
  let next = vdom;
  for (const op of ops) {
    next = applySingleOp(next, op);
  }
  return next;
}

function applySingleOp(vdom: VdomNode, op: DiffOp): VdomNode {
  switch (op.kind) {
    case 'set_prop':
      return mapAtPath(vdom, op.path, (node) => {
        const props = { ...node.props };
        if (op.value === undefined) {
          delete props[op.propKey];
        } else {
          props[op.propKey] = op.value;
        }
        return { ...node, props };
      });
    case 'replace_node':
      return mapAtPath(vdom, op.path, () => op.node);
    case 'append_child':
      return mapAtPath(vdom, op.path, (parent) => ({
        ...parent,
        children: [...parent.children, op.node],
      }));
    case 'remove_child': {
      // path = [..., parentId, childId]. Mutate the parent (path minus
      // the last id) by filtering its children.
      if (op.path.length === 0) return vdom;
      const childId = op.path[op.path.length - 1];
      const parentPath = op.path.slice(0, -1);
      return mapAtPath(vdom, parentPath, (parent) => ({
        ...parent,
        children: parent.children.filter((c) => c.id !== childId),
      }));
    }
    default:
      return vdom;
  }
}

/**
 * Walk the vdom along the path; at the terminal node, replace via
 * `transform`. Returns a new vdom with the path-clones replaced and
 * everything else share-referenced. If any path segment fails to
 * match, returns the original vdom unchanged (silent no-op).
 *
 * Path semantics: path[0] is the wire root's id. So for the wire root
 * itself, path = [rootId]. For a child of the root, path = [rootId,
 * childId]. We assert path[0] === vdom.id; if not, no-op.
 */
function mapAtPath(
  vdom: VdomNode,
  path: string[],
  transform: (node: VdomNode) => VdomNode,
): VdomNode {
  if (path.length === 0) return vdom;
  if (path[0] !== vdom.id) return vdom;
  if (path.length === 1) return transform(vdom);
  // Descend.
  const [, nextId, ...rest] = path;
  const idx = vdom.children.findIndex((c) => c.id === nextId);
  if (idx < 0) return vdom;
  const updatedChild = mapAtPath(
    vdom.children[idx],
    [nextId, ...rest],
    transform,
  );
  if (updatedChild === vdom.children[idx]) return vdom;
  const children = vdom.children.slice();
  children[idx] = updatedChild;
  return { ...vdom, children };
}

// ────────────────────────────────────────────────────────────────────
// Helper: handle a single wire frame — used by both the legacy direct-
// event path AND the new {type:'event', event} action path.
// ────────────────────────────────────────────────────────────────────

function reduceWireEvent(
  state: ChatState,
  event: StreamJsonEvent | { type: string; [k: string]: unknown },
): ChatState {
  // ── ui_open / ui_patch / ui_close (Phase E) ──────────────────────
  //
  // Daemon's local-jsx slash-command renders flow over the same WS as
  // SDKMessage frames. The reducer's `inkDomViews` map is the canonical
  // store; the streaming assistant message ALSO carries an
  // `inkdom_view` block so `Part.tsx` knows to mount an `InkDomView`
  // for that viewId.
  if (event.type === 'ui_open') {
    const open = event as unknown as UiOpenFrame;
    const nextViews = {
      ...state.inkDomViews,
      [open.viewId]: { vdom: open.vdom },
    };
    // Push an inkdom_view block onto the streaming assistant message
    // so it renders inline. If the assistant message already contains
    // a block for this viewId (e.g. a duplicate ui_open from a daemon
    // race), don't duplicate the block — just refresh the vdom.
    let nextMessages = state.messages;
    if (state.streamingMessageId) {
      const idx = state.messages.findIndex(
        (m) => m.id === state.streamingMessageId,
      );
      if (idx >= 0 && state.messages[idx].role === 'assistant') {
        const current = state.messages[idx] as AssistantChatMessage;
        const hasBlock = current.blocks.some(
          (b) => b.kind === 'inkdom_view' && b.viewId === open.viewId,
        );
        if (!hasBlock) {
          const clone: AssistantChatMessage = {
            ...current,
            blocks: [
              ...current.blocks,
              {
                kind: 'inkdom_view',
                viewId: open.viewId,
                command: open.command,
              },
            ],
          };
          nextMessages = [...state.messages];
          nextMessages[idx] = clone;
        }
      }
    }
    return { ...state, messages: nextMessages, inkDomViews: nextViews };
  }

  if (event.type === 'ui_patch') {
    const patch = event as unknown as UiPatchFrame;
    const entry = state.inkDomViews[patch.viewId];
    if (!entry) return state;
    const nextVdom = applyDiffOps(entry.vdom, patch.ops);
    if (nextVdom === entry.vdom) return state;
    return {
      ...state,
      inkDomViews: {
        ...state.inkDomViews,
        [patch.viewId]: { vdom: nextVdom },
      },
    };
  }

  if (event.type === 'ui_close') {
    const close = event as unknown as UiCloseFrame;
    if (!state.inkDomViews[close.viewId]) return state;
    const nextViews = { ...state.inkDomViews };
    delete nextViews[close.viewId];
    return { ...state, inkDomViews: nextViews };
  }

  // ── system events ────────────────────────────────────────────────
  if (event.type === 'system' && (event as any).subtype === 'init') {
    const sys = event as SystemInitEvent;
    // NOTE: do NOT reset pendingBoundaryBlocks here. openagentic emits a
    // fresh `system/init` at the start of every turn (not just session
    // boot), so resetting would wipe boot-time plugin_loaded events
    // before they can flush on the next message_start. The buffer is
    // session-scoped — `clear` resets it, and the flush itself empties
    // it once boundaries reach the assistant message.
    return {
      ...state,
      model: sys.model ?? state.model,
      fastMode: sys.fast_mode_state !== undefined ? sys.fast_mode_state : state.fastMode,
      sessionMeta: sessionMetaFromInit(sys),
    };
  }

  if (event.type === 'system' && (event as any).subtype === 'compact_boundary') {
    const trigger = ((event as any).trigger ?? 'auto') as 'manual' | 'auto';
    return { ...state, compactionFlash: trigger };
  }

  // Plugin / skill boundary frames — see `UiBoundaryBlock` JSDoc and
  // `mocks/codemode-tui-parity/mock-2-fullstack-build.html` lines 39-50
  // for the visual contract. The daemon emits these as system events with
  // a `subtype` of `plugin_loaded` / `skill_invoked` plus a `data` payload
  // describing what loaded. We append a `kind:'boundary'` block to the
  // currently-streaming assistant message; if no turn is in flight (rare
  // — boundaries are usually emitted in response to user prompts) the
  // event is dropped silently rather than synthesizing a phantom message.
  if (
    event.type === 'system' &&
    ((event as any).subtype === 'plugin_loaded' ||
      (event as any).subtype === 'skill_invoked')
  ) {
    const sub = (event as any).subtype as 'plugin_loaded' | 'skill_invoked';
    const subtype: UiBoundaryBlock['subtype'] = sub === 'plugin_loaded' ? 'plugin' : 'skill';
    const label = sub === 'plugin_loaded' ? 'Plugin loaded' : 'Skill invoked';
    const data = (event as any).data ?? {};

    // 2026-05-02 user feedback (round 2): suppress noisy plugin_loaded
    // boundaries that contributed NOTHING. These fire for every plugin
    // the daemon discovers at boot, including marketplace-discovery
    // entries that haven't been installed (yet). The earlier strict
    // `=== 0 && typeof === 'number'` check missed the most common case
    // — daemon sends tools/skills as `undefined` for these — so the
    // notifications kept spamming the transcript on every prompt.
    //
    // Treat missing/undefined/null as 0. Also accept any falsy/zero
    // count from any well-known surface field (tools, skills, agents,
    // hooks, mcps). If the plugin contributed nothing the user can
    // act on, drop the frame. The full inventory still lives in
    // /plugin → Installed tab.
    if (sub === 'plugin_loaded') {
      const toNum = (v: unknown): number =>
        typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0;
      const tools = toNum((data as any).tools);
      const skills = toNum((data as any).skills);
      const agents = toNum((data as any).agents);
      const hooks = toNum((data as any).hooks);
      const mcps = toNum((data as any).mcps);
      const lsps = toNum((data as any).lsps);
      const total = tools + skills + agents + hooks + mcps + lsps;
      if (total === 0) {
        return state;
      }
    }

    let body: string;
    if (sub === 'plugin_loaded') {
      // Compose: "<id>@<version> (from <marketplace>) — added N tools, M skills"
      const id = String(data.pluginId ?? data.id ?? data.name ?? 'plugin');
      const version = data.version ? String(data.version) : '';
      const marketplace = data.marketplace ? ` (from ${data.marketplace})` : '';
      const tools = typeof data.tools === 'number' ? data.tools : undefined;
      const skills = typeof data.skills === 'number' ? data.skills : undefined;
      const counts =
        tools !== undefined || skills !== undefined
          ? ` — added ${tools ?? 0} tools, ${skills ?? 0} skills`
          : '';
      body = `${id}${version ? `@${version}` : ''}${marketplace}${counts}`;
    } else {
      // Skill: "<id>@<version> — used the auto-discovery rule "<rule>""
      const id = String(data.skillId ?? data.id ?? data.name ?? 'skill');
      const version = data.version ? String(data.version) : '';
      const rule = data.rule ? ` — used the auto-discovery rule "${data.rule}"` : '';
      body = `${id}${version ? `@${version}` : ''}${rule}`;
    }
    if (typeof data.detail === 'string' && data.detail.length > 0 && body.length === 0) {
      body = String(data.detail);
    }

    const newBlock: UiBoundaryBlock = { kind: 'boundary', subtype, label, body };

    // Boot-time path — no assistant message in flight yet (the daemon
    // emits plugin_loaded BEFORE the first message_start). Buffer the
    // block and let the next top-level message_start flush it. Dedupe
    // on (subtype, label, body) so a re-init replaying the same plugin
    // doesn't double-count.
    if (!state.streamingMessageId) {
      const buffer = state.pendingBoundaryBlocks ?? [];
      const exists = buffer.some(
        (b) => b.subtype === newBlock.subtype && b.label === newBlock.label && b.body === newBlock.body,
      );
      if (exists) return state;
      return { ...state, pendingBoundaryBlocks: [...buffer, newBlock] };
    }

    const idx = state.messages.findIndex((m) => m.id === state.streamingMessageId);
    if (idx < 0) return state;
    const current = state.messages[idx];
    if (current.role !== 'assistant') return state;
    const clone: AssistantChatMessage = {
      ...current,
      blocks: [...current.blocks.map(cloneBlock), newBlock],
    };
    const next = [...state.messages];
    next[idx] = clone;
    return { ...state, messages: next };
  }

  // Inline live-preview frame — the daemon detected a dev-server boot URL
  // (either via Bash-tool boot-banner detection, OR via the daemon's
  // 30s /proc/net/tcp rescanner that catches non-Bash dev servers like
  // serve-tool wrappers, kubectl exec, pod restart with surviving
  // processes). Append a `kind:'preview'` block so the UI mounts an
  // iframe pointed at the api path-proxy. Dedupe per port across the
  // attached message so a server restart doesn't double the panel.
  if (event.type === 'system' && (event as any).subtype === 'preview_ready') {
    const data = (event as any).data ?? {};
    const port = typeof data.port === 'number' ? data.port : NaN;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return state;
    const url = typeof data.url === 'string' ? data.url : `http://localhost:${port}`;
    const framework = typeof data.framework === 'string' ? data.framework : 'generic';
    const toolUseId = typeof data.toolUseId === 'string' ? data.toolUseId : undefined;

    // Choose where to attach the preview block:
    //   1. The currently-streaming assistant message (the originating
    //      Bash-tool case — preview should appear inline with the agent's
    //      streaming reply that ran the dev server).
    //   2. The most recent assistant message if no stream is active (the
    //      rescanner case — frame fires on a timer between turns, when
    //      streamingMessageId is null but there's still a turn-history
    //      message that's a sensible host for the panel).
    // If neither exists (empty session), drop the frame.
    let idx = -1;
    if (state.streamingMessageId) {
      idx = state.messages.findIndex((m) => m.id === state.streamingMessageId);
    }
    if (idx < 0) {
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'assistant') {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return state;
    const current = state.messages[idx];
    if (current.role !== 'assistant') return state;

    // Dedupe per port across the attached message's lifetime.
    const exists = current.blocks.some(
      (b) => b.kind === 'preview' && (b as UiPreviewBlock).port === port,
    );
    if (exists) return state;

    const block: UiPreviewBlock = { kind: 'preview', port, url, framework, toolUseId };
    const clone: AssistantChatMessage = {
      ...current,
      blocks: [...current.blocks.map(cloneBlock), block],
    };
    const nextMsgs = [...state.messages];
    nextMsgs[idx] = clone;
    return { ...state, messages: nextMsgs };
  }

  if (event.type === 'system') {
    return state;
  }

  // ── permission control_request / control_response ────────────────
  if (event.type === 'control_request') {
    const ctrl = event as ControlRequestEvent;
    const req = ctrl.request as CanUseToolRequest;
    if (req && req.subtype === 'can_use_tool') {
      // Phase F: when the daemon flags the envelope with
      // `parent_tool_use_id`, propagate it so MessageTree can mount
      // the InlinePermissionCard inside the matching subagent panel
      // rather than at the assistant message tail. Null / undefined
      // keeps the existing single-agent behaviour (tail mount).
      return {
        ...state,
        pendingPermission: {
          ...req,
          request_id: ctrl.request_id,
          parent_tool_use_id: ctrl.parent_tool_use_id ?? null,
        },
      };
    }
    return state;
  }

  if (event.type === 'control_response') {
    const resp = (event as any).response;
    let next = state;
    if (
      resp?.subtype === 'success' &&
      state.pendingPermission &&
      resp.request_id === state.pendingPermission.request_id
    ) {
      next = { ...next, pendingPermission: null };
    }
    if (resp?.subtype === 'error') {
      const msg = typeof resp.error === 'string' ? resp.error : 'control request failed';
      next = { ...next, error: msg };
    }
    return next;
  }

  // ── progress (live tool output / elapsed seconds) ────────────────
  if (event.type === 'progress') {
    const prog = event as ToolProgressEvent;
    const hasOutput = typeof prog.data?.output === 'string';
    const hasElapsed = typeof prog.data?.elapsedTimeSeconds === 'number';
    if (!prog.parentToolUseID || (!hasOutput && !hasElapsed)) return state;
    const messages = state.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      const blockIdx = m.blocks.findIndex(
        (b) => b.kind === 'tool_use' && b.toolUseId === prog.parentToolUseID,
      );
      if (blockIdx < 0) continue;
      const block = m.blocks[blockIdx] as UiToolUseBlock;
      const nextBlock: UiToolUseBlock = { ...block };
      if (hasOutput) nextBlock.liveOutput = prog.data.output;
      if (hasElapsed) nextBlock.elapsedSec = prog.data.elapsedTimeSeconds;
      const clonedBlocks = [...m.blocks];
      clonedBlocks[blockIdx] = nextBlock;
      const next = [...messages];
      next[i] = { ...m, blocks: clonedBlocks };
      return { ...state, messages: next };
    }
    return state;
  }

  // ── user (tool_result) ───────────────────────────────────────────
  if (event.type === 'user') {
    const ure = event as UserToolResultEvent;
    let nextMessages = state.messages;
    for (const block of ure.message.content) {
      if (block.type !== 'tool_result') continue;
      const uiResult = toolResultBlockToUi(block, ure.tool_use_result);
      nextMessages = attachToolResult(nextMessages, block.tool_use_id, uiResult);
    }
    return nextMessages === state.messages ? state : { ...state, messages: nextMessages };
  }

  // ── stream_event (Anthropic deltas, possibly routed to subagent) ─
  if (event.type === 'stream_event') {
    const wrapper = event as StreamEventWrapper;

    // Boot-boundary flush — when a top-level (no parent_tool_use_id)
    // `message_start` arrives AND we have buffered boot-time boundaries,
    // prepend them to the streaming assistant's blocks BEFORE running
    // the stream-event applier. This places the boundaries ahead of any
    // text/tool blocks the daemon is about to push for this message.
    let preState = state;
    const inner = wrapper.event;
    const isTopLevelMessageStart =
      !wrapper.parent_tool_use_id && inner && inner.type === 'message_start';
    const buffered = state.pendingBoundaryBlocks ?? [];
    if (isTopLevelMessageStart && buffered.length > 0 && state.streamingMessageId) {
      const idx = state.messages.findIndex((m) => m.id === state.streamingMessageId);
      if (idx >= 0 && state.messages[idx].role === 'assistant') {
        const current = state.messages[idx] as AssistantChatMessage;
        const clone: AssistantChatMessage = {
          ...current,
          blocks: [...buffered, ...current.blocks.map(cloneBlock)],
        };
        const nextMsgs = [...state.messages];
        nextMsgs[idx] = clone;
        preState = { ...state, messages: nextMsgs, pendingBoundaryBlocks: [] };
      }
    }

    const nextMessages = applyStreamEventRouted(
      preState.messages,
      preState.streamingMessageId,
      wrapper,
    );
    let nextState = nextMessages === preState.messages ? preState : { ...preState, messages: nextMessages };

    // Bug-fix 2026-04-30: defensive turn-close on top-level message_stop
    // when the model has signalled end_turn. Daemons sometimes drop the
    // tail-end `result` event due to coalescing or socket flush races,
    // which left `streamingMessageId` set forever and the cm-rule pill
    // stuck on THINKING. Anthropic's `stop_reason: end_turn` is the
    // canonical "model is done" signal — when it lands at the top level
    // (no parent_tool_use_id), force-close the turn even if `result`
    // never shows up.
    //
    // Subagent message_stops (parent_tool_use_id set) are explicitly
    // excluded — those close subagent runs, not the parent turn.
    //
    // Additional gate (dark-after-turn fix): openagentic's stream layer
    // can emit `message_delta` with `stop_reason: end_turn` on turns that
    // actually ended with a tool_use — so the flag alone lies. If the
    // assistant message contains a tool_use block, more LLM completions
    // are coming after the tool runs; closing here would null
    // `streamingMessageId` and silently drop the next turn's events at
    // `applyStreamEventRouted`'s no-match guard.
    const isTopLevelMessageStop =
      !wrapper.parent_tool_use_id && inner && inner.type === 'message_stop';
    if (isTopLevelMessageStop && nextState.streamingMessageId) {
      const sIdx = nextState.messages.findIndex((m) => m.id === nextState.streamingMessageId);
      if (sIdx >= 0 && nextState.messages[sIdx].role === 'assistant') {
        const asst = nextState.messages[sIdx] as AssistantChatMessage;
        const hasToolUse = asst.blocks.some((b) => b.kind === 'tool_use');
        if (asst.stopReason === 'end_turn' && !hasToolUse) {
          const closed = forceCloseMessageBlocks({
            ...asst,
            blocks: asst.blocks.map(cloneBlock),
          });
          const nextMsgs = [...nextState.messages];
          nextMsgs[sIdx] = closed;
          nextState = {
            ...nextState,
            messages: nextMsgs,
            streamingMessageId: null,
          };
        }
      }
    }

    return nextState;
  }

  // ── assistant (materialized) ─
  //
  // For TOP-LEVEL turns (parent_tool_use_id is null/unset) the materialized
  // envelope is a no-op: the deltas already rendered the content via the
  // stream_event path.
  //
  // For SUB-AGENT turns (parent_tool_use_id is set) the daemon does NOT
  // emit matching stream_event deltas with the parent id populated —
  // print.ts hardcodes parent_tool_use_id:null on every stream_event
  // envelope. The only signal that a tool_use belongs to a subagent is
  // this materialized assistant envelope wrapping an `agent_progress`
  // payload. Append its content blocks into the parent Task tool_use's
  // subBlocks so TaskTranscriptPart can render the inline transcript.
  //
  // See openagentic/src/utils/queryHelpers.ts:122-156 for the daemon-side
  // normalizer that yields these envelopes with parent_tool_use_id set.
  if (event.type === 'assistant') {
    const ev = event as {
      message?: { content?: ContentBlock[] };
      parent_tool_use_id?: string | null;
    };
    const parentId = ev.parent_tool_use_id;
    if (!parentId) return state;
    const content = ev.message?.content;
    if (!Array.isArray(content) || content.length === 0) return state;
    const nextMessages = appendSubagentBlocks(state.messages, parentId, content);
    return nextMessages === state.messages ? state : { ...state, messages: nextMessages };
  }

  // ── result / error (terminal) ────────────────────────────────────
  if (event.type === 'result' || event.type === 'error') {
    const messages = state.messages;
    const idx = messages.findIndex((m) => m.id === state.streamingMessageId);
    let nextMessages = messages;
    let nextContextTokens = state.contextTokens;
    let nextTotalCostUsd = state.totalCostUsd;
    let nextTotalOutputTokens = state.totalOutputTokens;
    let nextLastTurnMs = state.lastTurnMs;

    if (idx < 0) {
      // Defensive sweep — close every still-streaming assistant so the
      // UI doesn't hang on "Agent is working…" if id matching missed.
      nextMessages = closeAllStreamingAssistants(messages);

      // Bug-fix 2026-04-30: when the Bug-2 pre-emptive close on
      // `message_stop+end_turn` already cleared streamingMessageId, the
      // tail-end `result` event lands here with idx<0 — but we still
      // want its usage / cost / duration to be attributed to the
      // most-recent assistant message (not just running totals). Find
      // the last assistant message and overwrite its usage with the
      // result's authoritative numbers (message_delta carries partial
      // counts that the result event finalises).
      if (event.type === 'result') {
        const res = event as ResultEvent;
        const usage = res.usage as
          | { input_tokens?: number; output_tokens?: number }
          | undefined;
        const lastAsstIdx = (() => {
          for (let i = nextMessages.length - 1; i >= 0; i--) {
            if (nextMessages[i].role === 'assistant') return i;
          }
          return -1;
        })();
        if (lastAsstIdx >= 0 && usage) {
          const asst = nextMessages[lastAsstIdx] as AssistantChatMessage;
          const cloned: AssistantChatMessage = {
            ...asst,
            usage: {
              // Math.max — never let a literal 0 from the result event
              // wipe a populated value from message_start. Same bug
              // pattern as the parallel branch below.
              inputTokens: Math.max(usage.input_tokens ?? 0, asst.usage?.inputTokens ?? 0),
              outputTokens: Math.max(usage.output_tokens ?? 0, asst.usage?.outputTokens ?? 0),
              totalCostUsd: res.total_cost_usd ?? asst.usage?.totalCostUsd,
            },
            stopReason: asst.stopReason ?? 'end_turn',
            // Freeze turnEndedAt so TurnStatsFooter can render a stable
            // total turn elapsed (was: undefined → footer would tick
            // forever via Date.now() fallback). Per turn — set even
            // when usage is also being attached.
            turnEndedAt: asst.turnEndedAt ?? Date.now(),
          };
          const updated = [...nextMessages];
          updated[lastAsstIdx] = cloned;
          nextMessages = updated;
        } else if (lastAsstIdx >= 0) {
          // No usage in the result event but we still want turnEndedAt
          // stamped so the footer renders a stable elapsed time.
          const asst = nextMessages[lastAsstIdx] as AssistantChatMessage;
          if (!asst.turnEndedAt) {
            const updated = [...nextMessages];
            updated[lastAsstIdx] = { ...asst, turnEndedAt: Date.now() };
            nextMessages = updated;
          }
        }
        if (usage) {
          nextContextTokens = usage.input_tokens ?? nextContextTokens;
          nextTotalOutputTokens =
            state.totalOutputTokens + (usage.output_tokens ?? 0);
        }
        if (typeof res.total_cost_usd === 'number' && !Number.isNaN(res.total_cost_usd)) {
          nextTotalCostUsd = state.totalCostUsd + res.total_cost_usd;
        }
        if (typeof res.duration_ms === 'number') {
          nextLastTurnMs = res.duration_ms;
        }
      }
    } else {
      const current = messages[idx];
      if (current.role === 'assistant') {
        let clone: AssistantChatMessage = {
          ...current,
          blocks: current.blocks.map(cloneBlock),
        };
        if (event.type === 'result') {
          clone.stopReason = clone.stopReason ?? 'end_turn';
          const res = event as ResultEvent;
          const usage = res.usage as
            | { input_tokens?: number; output_tokens?: number }
            | undefined;
          if (usage) {
            // Bug-fix 2026-05-08: AIF/gpt-oss-120b's result event sends
            // either omitted OR literal-zero input_tokens, both of which
            // were wiping the running total populated from message_start
            // (heartbeat showed ↑2.9k throughout streaming, footer
            // showed ↑0 once frozen). Use Math.max instead of `??` so a
            // literal 0 in the result NEVER overrides a populated total.
            clone.usage = {
              inputTokens: Math.max(usage.input_tokens ?? 0, clone.usage?.inputTokens ?? 0),
              outputTokens: Math.max(usage.output_tokens ?? 0, clone.usage?.outputTokens ?? 0),
              totalCostUsd: res.total_cost_usd ?? clone.usage?.totalCostUsd,
            };
            nextContextTokens = usage.input_tokens || nextContextTokens;
            nextTotalOutputTokens = state.totalOutputTokens + (usage.output_tokens ?? 0);
          }
          // Always stamp turnEndedAt on the result event so the footer
          // shows a stable elapsed time (decoupled from usage presence).
          if (!clone.turnEndedAt) {
            clone.turnEndedAt = Date.now();
          }
          if (typeof res.total_cost_usd === 'number' && !Number.isNaN(res.total_cost_usd)) {
            nextTotalCostUsd = state.totalCostUsd + res.total_cost_usd;
          }
          if (typeof res.duration_ms === 'number') {
            nextLastTurnMs = res.duration_ms;
          }
          clone = forceCloseMessageBlocks(clone);
        } else {
          // error
          const msg = (event as any).message ?? 'unknown error';
          clone.blocks.push({ kind: 'text', text: `⚠ ${msg}` });
          clone = forceCloseMessageBlocks(clone);
        }
        const next = [...messages];
        next[idx] = clone;
        nextMessages = next;
      }
    }

    return {
      ...state,
      messages: nextMessages,
      streamingMessageId: null,
      contextTokens: nextContextTokens,
      totalCostUsd: nextTotalCostUsd,
      totalOutputTokens: nextTotalOutputTokens,
      lastTurnMs: nextLastTurnMs,
    };
  }

  // Unknown event — leave state unchanged so unknown record types don't
  // silently corrupt the transcript.
  return state;
}

// ────────────────────────────────────────────────────────────────────
// reduce — the public entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Pure reducer: apply a ChatAction to the chat state and return the
 * next state.
 *
 * Accepts BOTH the new ChatAction discriminated union AND the legacy
 * pattern of passing a wire event directly. The new code path goes
 * through `{type:'event', event}`; the legacy tests pass events with
 * a top-level `type: 'system' | 'stream_event' | 'result' | …`. We
 * detect the action discriminator at the top: if `action.type` is
 * one of the ChatAction variants, we handle it; otherwise we treat
 * the whole object as a wire event.
 *
 * This dual entry was deliberate: it lets the older Phase B test
 * suite (`streamReducer.test.ts` — 19 tests) keep its
 * `reduce(state, event)` form working while the Phase C fixture
 * tests use the canonical `reduce(state, {type:'event', event})`.
 *
 * NEVER add side effects to this function. No Date.now, no Math.random,
 * no localStorage, no fetch, no console. State in, action in, new
 * state out. Period.
 */
export function reduce(
  state: ChatState,
  action: ChatAction | StreamJsonEvent | { type: string; [k: string]: unknown },
): ChatState {
  // ── ChatAction union variants (Phase C) ──────────────────────────
  switch (action.type) {
    case 'event':
      return reduceWireEvent(state, (action as { event: StreamJsonEvent }).event);

    case 'submit_user': {
      const a = action as Extract<ChatAction, { type: 'submit_user' }>;
      const userMsg: ChatMessage = {
        id: a.userMsgId,
        role: 'user',
        text: a.text,
        createdAt: a.createdAt,
      };
      // Seed estimated input-token count so the live `↑ N tokens`
      // indicator can render IMMEDIATELY on AIF/OpenAI providers that
      // only put real `usage.input_tokens` in the final chunk.
      // Estimate = (turn-so-far conversation chars) / 4. Real usage
      // when message_start/message_delta arrives overwrites this.
      let estInputTokens = 0;
      for (const m of state.messages) {
        if (m.role === 'user') estInputTokens += (m.text || '').length;
        else if (m.role === 'assistant') {
          for (const b of m.blocks) {
            if (b.kind === 'text') estInputTokens += (b.text || '').length;
            else if (b.kind === 'thinking') estInputTokens += (b.thinking || '').length;
            else if (b.kind === 'tool_use') estInputTokens += (b.partialInputJson || '').length;
          }
        }
      }
      estInputTokens += (a.text || '').length;
      estInputTokens = Math.round(estInputTokens / 4);
      const asstMsg: AssistantChatMessage = {
        id: a.asstMsgId,
        role: 'assistant',
        blocks: [],
        streaming: true,
        usage: estInputTokens > 0
          ? { inputTokens: estInputTokens, outputTokens: 0 }
          : undefined,
        createdAt: a.createdAt,
      };
      return {
        ...state,
        messages: [...state.messages, userMsg, asstMsg],
        streamingMessageId: a.asstMsgId,
        error: null,
      };
    }

    case 'permission_response': {
      const a = action as Extract<ChatAction, { type: 'permission_response' }>;
      if (
        state.pendingPermission &&
        state.pendingPermission.request_id === a.requestId
      ) {
        return { ...state, pendingPermission: null };
      }
      return state;
    }

    case 'interrupt': {
      // Append a "⚠ interrupted" marker to the in-flight assistant
      // and clear streamingMessageId. The hook follows by sending the
      // control_request{interrupt} frame; the daemon will eventually
      // emit a `result` which would normally close the turn, but we
      // close pre-emptively so the spinner stops immediately.
      if (!state.streamingMessageId) return state;
      const idx = state.messages.findIndex((m) => m.id === state.streamingMessageId);
      if (idx < 0) {
        return { ...state, streamingMessageId: null, pendingPermission: null };
      }
      const current = state.messages[idx];
      if (current.role !== 'assistant') {
        return { ...state, streamingMessageId: null, pendingPermission: null };
      }
      const next = [...state.messages];
      next[idx] = {
        ...current,
        streaming: false,
        blocks: [...current.blocks, { kind: 'text', text: '⚠ interrupted by user' }],
      };
      return {
        ...state,
        messages: next,
        streamingMessageId: null,
        pendingPermission: null,
      };
    }

    case 'connection_closed': {
      const a = action as Extract<ChatAction, { type: 'connection_closed' }>;
      if (!state.streamingMessageId) return state;
      const idx = state.messages.findIndex((m) => m.id === state.streamingMessageId);
      if (idx < 0) {
        return { ...state, streamingMessageId: null };
      }
      const current = state.messages[idx];
      if (current.role !== 'assistant') {
        return { ...state, streamingMessageId: null };
      }
      const next = [...state.messages];
      next[idx] = {
        ...current,
        streaming: false,
        blocks: [
          ...current.blocks,
          { kind: 'text', text: `⚠ chat connection closed (${a.code})` },
        ],
      };
      return { ...state, messages: next, streamingMessageId: null };
    }

    case 'clear':
      // Reset transcript but keep session-wide metadata (model,
      // sessionMeta, totals) — those reflect facts about the daemon
      // that don't change just because we wiped the bubble history.
      // inkDomViews tie to the messages we're nuking, so clear those
      // too — any orphan picker would render with a stale vdom and no
      // longer-existent block reference. Boundary buffer is also
      // session-scoped and clears with the transcript.
      return {
        ...state,
        messages: [],
        streamingMessageId: null,
        error: null,
        pendingPermission: null,
        inkDomViews: {},
        pendingBoundaryBlocks: [],
      };

    case 'set_error': {
      const a = action as Extract<ChatAction, { type: 'set_error' }>;
      return { ...state, error: a.message };
    }

    case 'restore': {
      const a = action as Extract<ChatAction, { type: 'restore' }>;
      return {
        ...state,
        messages: a.messages,
        model: a.meta?.model ?? state.model,
        contextTokens: a.meta?.contextTokens ?? state.contextTokens,
        sessionMeta: a.meta?.sessionMeta ?? state.sessionMeta,
      };
    }

    case 'system_message_inject': {
      const a = action as Extract<ChatAction, { type: 'system_message_inject' }>;
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: a.id, role: 'system', text: a.text, createdAt: a.createdAt },
        ],
      };
    }

    case 'clear_compaction_flash':
      return state.compactionFlash === null ? state : { ...state, compactionFlash: null };

    case 'open_picker': {
      const a = action as Extract<ChatAction, { type: 'open_picker' }>;
      if (state.activePicker === a.picker) return state;
      return { ...state, activePicker: a.picker };
    }

    case 'close_picker':
      return state.activePicker === null ? state : { ...state, activePicker: null };

    default:
      // Legacy direct-event path: the action's `type` doesn't match any
      // ChatAction discriminator, so treat it as a wire event. This
      // preserves the Phase-B `reduce(state, event)` API used by the
      // existing 19 tests AND lets unknown wire-event types trickle
      // through the wire-event handler (which has its own permissive
      // default).
      return reduceWireEvent(state, action as { type: string; [k: string]: unknown });
  }
}
