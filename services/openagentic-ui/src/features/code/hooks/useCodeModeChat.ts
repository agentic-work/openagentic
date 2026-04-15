/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiEndpoint } from '@/utils/api';
import type {
  AnthropicStreamEvent,
  AssistantBlock,
  AssistantChatMessage,
  CanUseToolRequest,
  ChatMessage,
  ContentBlockDeltaPayload,
  ContentBlock,
  ControlRequestEvent,
  ResultEvent,
  StreamJsonEvent,
  StreamEventWrapper,
  SystemInitEvent,
  ToolProgressEvent,
  UiToolUseBlock,
  UiToolResult,
  UserToolResultEvent,
  ToolResultBlock,
} from '../types/streamJson';

interface UseCodeModeChatOptions {
  sessionId: string | null;
  authToken?: string;
}

interface SendMessageOptions {
  model?: string;
  /**
   * Openagentic permission mode for this turn. Forwarded to the exec
   * daemon which translates it to --permission-mode / --permissive CLI
   * flags. See ../permissionMode.ts for the mapping. Defaults to
   * bypassPermissions server-side if unset.
   */
  permissionMode?: string;
  /**
   * Base64-encoded image attachments for vision-capable models. Each
   * image is sent as a content block alongside the text in the
   * stream-json user message. Non-vision models ignore them.
   */
  images?: Array<{ name: string; mediaType: string; base64: string }>;
}

interface UseCodeModeChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (text: string, opts?: SendMessageOptions) => Promise<void>;
  clear: () => void;
  /**
   * Interrupt the in-flight turn without clearing the transcript.
   * Tries a graceful control_request{interrupt} via sendControl first
   * (openagentic's own chat:cancel path), then falls back to aborting
   * the SSE fetch which makes the exec daemon SIGTERM the child. A
   * "⚠ interrupted" marker is appended to the in-flight assistant
   * message so the user sees where the turn was cut off.
   */
  cancel: () => void;
  /**
   * Current pending permission request from openagentic. Non-null
   * when a `control_request` with subtype `can_use_tool` has arrived
   * on the stream and the user hasn't yet responded. Rendered by the
   * PermissionDialog component in CodeModeChatView. Cleared on
   * approve/deny via respondToPermission.
   */
  pendingPermission: CanUseToolRequest & { request_id: string } | null;
  /**
   * Approve or deny a pending permission prompt. Writes a matching
   * control_response frame back to the exec daemon's stdin via
   * POST /api/code/sessions/:id/chat/control. `updatedInput` lets
   * the user modify the tool's arguments before approval (e.g.
   * narrowing a Bash command). Clears `pendingPermission` on send.
   */
  respondToPermission: (
    decision: { behavior: 'allow'; updatedInput?: Record<string, unknown> }
             | { behavior: 'deny'; message?: string; interrupt?: boolean },
  ) => Promise<void>;
  /**
   * Send an arbitrary control frame to openagentic's stdin. Used by
   * cancel() for interrupt requests and by respondToPermission for
   * can_use_tool responses. Most callers should use the higher-level
   * helpers instead of calling this directly.
   */
  sendControl: (frame: Record<string, unknown>) => Promise<void>;
  /**
   * Current session context-window usage. Populated from the latest
   * result-event usage.input_tokens (since openagentic uses --continue,
   * each turn's input_tokens = total context at that moment).
   * undefined until the first turn completes.
   */
  contextTokens: number | undefined;
  /**
   * Briefly non-null when a compact boundary arrives (system event
   * with subtype: 'compact_boundary'). Lets the header strip flash a
   * "compacted" pulse animation. Reset to null after ~2 seconds.
   */
  compactionFlash: 'manual' | 'auto' | null;
  /** Model name reported by openagentic's system init event. */
  model: string | undefined;
  /** Fast-mode state reported by openagentic's system init event. */
  fastMode: string | undefined;
  /** Accumulated session cost across all turns in this browser session. */
  totalCostUsd: number;
  /** Total output tokens emitted in the session. */
  totalOutputTokens: number;
  /** Duration (ms) of the most recent turn. */
  lastTurnMs: number | undefined;
  /** Session metadata from openagentic's system init event. */
  sessionMeta: {
    tools: string[];
    mcpServers: Array<{ name: string; status: string }>;
    agents: string[];
    skills: string[];
    plugins: string[];
    slashCommands: string[];
    cwd: string;
    permissionMode: string;
    openagenticVersion: string;
    detail?: import('../types/streamJson').SystemInitDetail;
  } | null;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Tries to JSON.parse a partial_json accumulator — returns the parsed
 * object if it's now syntactically valid, otherwise undefined so the
 * caller can keep accumulating.
 */
function tryParseInput(raw: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Structural container for the multi-message block layout — shared by
 * top-level assistant messages (AssistantChatMessage) AND the nested
 * sub-transcripts hosted inside Task tool_use blocks (UiToolUseBlock).
 * This lets one applier drive both layers.
 */
interface BlockContainer {
  blocks: AssistantBlock[];
  _currentMessageBlockOffset?: number;
}

/**
 * Applies an AnthropicStreamEvent to an in-progress block container.
 * For top-level messages, pass the AssistantChatMessage directly (it
 * already matches the shape). For Task sub-transcripts, pass a shim
 * wrapping the parent tool block's subBlocks + _subMessageBlockOffset.
 *
 * Mutates the container in place — callers must clone before passing
 * in if React identity matters.
 */
function applyInnerEvent(
  container: BlockContainer,
  inner: AnthropicStreamEvent,
  msg?: AssistantChatMessage,
): void {
  switch (inner.type) {
    case 'message_start': {
      // DO NOT overwrite msg.id here. msg.id is our stable tracking
      // handle (set by genId('asst-')) and the reducer pipeline uses it
      // to find-and-update the in-progress assistant message in the
      // messages array. Replacing it with the LLM's message id breaks
      // every subsequent delta lookup (the UI hangs on "Thinking…").
      //
      // Snapshot the current blocks length as the offset for THIS
      // message's content_block indices. openagentic emits multiple
      // Anthropic messages per turn (one per tool loop), each of
      // which restarts its content_block indices at 0 — without this
      // offset, message 2's `content_block_start index=0` would
      // clobber message 1's first block.
      container._currentMessageBlockOffset = container.blocks.length;

      // Capture the model that produced this turn so the stats chart
      // can break down tokens by model (matches openagentic TUI's
      // "Tokens per Day" chart which groups by model name).
      if (msg && inner.message.model) {
        msg.turnModel = inner.message.model;
      }

      // Seed any content blocks that ship pre-populated (rare — usually
      // they're empty and we get content_block_start events next).
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
      return;
    }

    case 'content_block_delta': {
      const offset = container._currentMessageBlockOffset ?? 0;
      const target = container.blocks[offset + inner.index];
      if (!target) return; // out-of-order delta, drop it
      applyDelta(target, inner.delta);
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
      // message_delta only applies to top-level messages. Sub-transcripts
      // don't track usage separately — they roll up into the parent.
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

    case 'message_stop': {
      // End-of-message but not end-of-turn — a single openagentic turn
      // can emit multiple Anthropic messages (e.g. tool call + follow-up).
      // Streaming stays true until the outer `result` event fires.
      return;
    }
  }
}

/**
 * Routes a stream_event to the right container — either the top-level
 * streaming assistant message or, for subagent Task invocations, the
 * parent tool_use block's `subBlocks`. Returns a new messages array
 * with the mutated branch cloned in place for React identity.
 *
 * openagentic wire format: a sub-agent Task spawns a child REPL whose
 * stream_event records arrive on the parent stream with
 * `parent_tool_use_id` set to the Task tool_use id. We route those
 * events into a nested transcript on the Task card so they render
 * indented beneath the parent invocation.
 */
function applyStreamEventRouted(
  messages: ChatMessage[],
  streamingMsgId: string | null,
  wrapper: StreamEventWrapper,
): ChatMessage[] {
  const parentId = wrapper.parent_tool_use_id;
  const inner = wrapper.event;

  if (!parentId) {
    // Top-level path — apply to the in-flight streaming message.
    const idx = messages.findIndex((m) => m.id === streamingMsgId);
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

  // Sub-transcript path — find the parent Task tool_use block anywhere
  // in the messages list and apply the event to its subBlocks.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const blockIdx = m.blocks.findIndex(
      (b) => b.kind === 'tool_use' && b.toolUseId === parentId,
    );
    if (blockIdx < 0) continue;

    const parentBlock = m.blocks[blockIdx] as UiToolUseBlock;
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
    const clonedBlocks = m.blocks.map((b, j): AssistantBlock =>
      j === blockIdx ? clonedParent : b,
    );
    const next = [...messages];
    next[i] = { ...m, blocks: clonedBlocks };
    return next;
  }
  // Parent tool not found — drop the event rather than losing it to
  // the wrong container.
  return messages;
}

function cloneBlock(b: AssistantBlock): AssistantBlock {
  if (b.kind === 'text') return { ...b };
  if (b.kind === 'thinking') return { ...b };
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
  // tool_use
  return {
    kind: 'tool_use',
    toolUseId: block.id,
    name: block.name,
    partialInputJson: block.input ? JSON.stringify(block.input) : '',
    input: block.input,
    streaming: true,
  };
}

/**
 * Converts a UserToolResultEvent's content block into the flat UI shape
 * the renderer uses. Handles the two wire formats openagentic uses:
 * (1) flat string content, (2) array of typed content blocks with text
 * and/or image items.
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
 * Attach a tool result to a tool_use block by id. Recurses into nested
 * sub-transcripts (Task tool subBlocks) so subagent tool results bind
 * to the right parent card. Returns a new messages array with the
 * mutated branch cloned in place for React identity; other branches
 * are kept by reference. Returns the original list if no match found.
 */
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

/**
 * Recursive helper for attachToolResult. Returns a new blocks array
 * with the matching tool_use updated, or null if no match was found
 * anywhere in the tree (including sub-transcripts).
 */
function attachResultInBlocks(
  blocks: AssistantBlock[],
  toolUseId: string,
  result: UiToolResult,
): AssistantBlock[] | null {
  // Direct match at this level?
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
  // Recurse into sub-transcripts of any tool_use with subBlocks.
  let mutated: AssistantBlock[] | null = null;
  for (let j = 0; j < blocks.length; j++) {
    const b = blocks[j];
    if (b.kind !== 'tool_use' || !b.subBlocks || b.subBlocks.length === 0) continue;
    const sub = attachResultInBlocks(b.subBlocks, toolUseId, result);
    if (sub) {
      mutated = mutated ?? [...blocks];
      mutated[j] = { ...b, subBlocks: sub };
      return mutated;
    }
  }
  return null;
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
      // ignored for now — signature is opaque opaque metadata
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
 * Parses an SSE body stream. Yields one parsed record per `data:` line.
 * Each SSE event frame is `event: <name>\ndata: <payload>\n\n`; we
 * extract both so the caller can distinguish `message` frames from
 * `done` frames.
 */
async function* iterateSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIdx: number;
    while ((splitIdx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, splitIdx);
      buffer = buffer.slice(splitIdx + 2);
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      if (dataLines.length > 0) {
        yield { event: eventName, data: dataLines.join('\n') };
      }
    }
  }
}

// Persist/restore chat transcript in sessionStorage so navigating
// away and back doesn't lose the conversation. Keyed by sessionId.
const STORAGE_PREFIX = 'cm-chat:';

function loadPersistedMessages(sid: string | null): ChatMessage[] {
  if (!sid) return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + sid);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function persistMessages(sid: string | null, msgs: ChatMessage[]) {
  if (!sid) return;
  try {
    // Only persist non-streaming messages (skip in-flight partial state)
    const safe = msgs.filter((m) => m.role !== 'assistant' || !(m as any).streaming);
    sessionStorage.setItem(STORAGE_PREFIX + sid, JSON.stringify(safe));
  } catch { /* quota exceeded — degrade silently */ }
}

function loadPersistedMeta(sid: string | null): { model?: string; contextTokens?: number; sessionMeta?: any } {
  if (!sid) return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + sid + ':meta');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persistMeta(sid: string | null, data: Record<string, unknown>) {
  if (!sid) return;
  try { sessionStorage.setItem(STORAGE_PREFIX + sid + ':meta', JSON.stringify(data)); } catch {}
}

export function useCodeModeChat({ sessionId, authToken }: UseCodeModeChatOptions): UseCodeModeChatReturn {
  // Restore persisted state on mount so navigating away and back
  // shows the previous conversation instead of the splash screen.
  const persisted = loadPersistedMessages(sessionId);
  const persistedMeta = loadPersistedMeta(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(persisted);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState<number | undefined>(persistedMeta.contextTokens as number | undefined);
  const [compactionFlash, setCompactionFlash] = useState<'manual' | 'auto' | null>(null);
  const [model, setModel] = useState<string | undefined>(persistedMeta.model as string | undefined);
  const [fastMode, setFastMode] = useState<string | undefined>(undefined);
  const [totalCostUsd, setTotalCostUsd] = useState<number>(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState<number>(0);
  const [lastTurnMs, setLastTurnMs] = useState<number | undefined>(undefined);
  const [pendingPermission, setPendingPermission] =
    useState<(CanUseToolRequest & { request_id: string }) | null>(null);

  // Session metadata from openagentic's system init event — populated
  // once on the first turn. Drives the React modals for /tools, /mcp,
  // /agents, /skills, /plugins so the user can browse and manage them
  // without a separate API call.
  const [sessionMeta, setSessionMeta] = useState<{
    tools: string[];
    mcpServers: Array<{ name: string; status: string }>;
    agents: string[];
    skills: string[];
    plugins: string[];
    slashCommands: string[];
    cwd: string;
    permissionMode: string;
    openagenticVersion: string;
    detail?: import('../types/streamJson').SystemInitDetail;
  } | null>(persistedMeta.sessionMeta ?? null);

  // Persist messages + meta to sessionStorage so navigating away and
  // back restores the conversation. Debounced: only writes when NOT
  // streaming (to avoid thrashing on every delta token).
  useEffect(() => {
    if (isStreaming) return; // don't persist mid-stream partial state
    persistMessages(sessionId, messages);
  }, [messages, isStreaming, sessionId]);

  useEffect(() => {
    persistMeta(sessionId, { model, contextTokens, sessionMeta });
  }, [model, contextTokens, sessionMeta, sessionId]);

  // Clear the compaction flash after 2s so the pulse animation doesn't
  // stick on. Sub-second duration feels like a glitch; longer feels
  // like something's wrong.
  useEffect(() => {
    if (!compactionFlash) return;
    const t = setTimeout(() => setCompactionFlash(null), 2000);
    return () => clearTimeout(t);
  }, [compactionFlash]);

  // Track the message id currently being streamed so delta handlers
  // can find-and-update without a linear scan on every token.
  const streamingMsgIdRef = useRef<string | null>(null);
  // AbortController for the in-flight fetch so unmount + clear cancel it.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingMsgIdRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
  }, []);

  const sendControl = useCallback(
    async (frame: Record<string, unknown>): Promise<void> => {
      if (!sessionId) return;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        await fetch(
          apiEndpoint(`/code/sessions/${encodeURIComponent(sessionId)}/chat/control`),
          { method: 'POST', headers, body: JSON.stringify(frame) },
        );
      } catch (err) {
        console.warn('[useCodeModeChat] sendControl failed', err);
      }
    },
    [sessionId, authToken],
  );

  const respondToPermission = useCallback(
    async (
      decision:
        | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
        | { behavior: 'deny'; message?: string; interrupt?: boolean },
    ): Promise<void> => {
      const pending = pendingPermission;
      if (!pending) return;
      const responseBody =
        decision.behavior === 'allow'
          ? {
              behavior: 'allow',
              updatedInput: decision.updatedInput ?? pending.input ?? {},
              toolUseID: pending.tool_use_id,
            }
          : {
              behavior: 'deny',
              message: decision.message ?? 'User denied',
              interrupt: decision.interrupt,
              toolUseID: pending.tool_use_id,
            };
      const frame = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: pending.request_id,
          response: responseBody,
        },
      };
      setPendingPermission(null);
      await sendControl(frame);
    },
    [pendingPermission, sendControl],
  );

  const cancel = useCallback(() => {
    // Try the graceful path first: ask openagentic to self-abort via a
    // control_request {subtype: 'interrupt'}. This matches its native
    // chat:cancel keybinding and lets the CLI write a proper end-of-turn
    // result event before exiting. Fire-and-forget — we don't wait for
    // the control POST to resolve before aborting the SSE fetch.
    if (sessionId) {
      void sendControl({
        type: 'control_request',
        request_id: `int-${Date.now().toString(36)}`,
        request: { subtype: 'interrupt' },
      });
    }
    // Always abort the fetch — closes the SSE stream, which the exec
    // daemon detects via res.on('close') and uses to SIGTERM the child
    // if the graceful interrupt didn't already end things. Leaves the
    // transcript intact and tags the in-flight assistant message.
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === streamingMsgIdRef.current);
      if (idx < 0) return prev;
      const current = prev[idx];
      if (current.role !== 'assistant') return prev;
      const next = [...prev];
      next[idx] = {
        ...current,
        streaming: false,
        blocks: [...current.blocks, { kind: 'text', text: '⚠ interrupted by user' }],
      };
      return next;
    });
    streamingMsgIdRef.current = null;
    setIsStreaming(false);
    setPendingPermission(null);
  }, [sessionId, sendControl]);

  const sendMessage = useCallback(
    async (text: string, opts: SendMessageOptions = {}): Promise<void> => {
      const { model, permissionMode, images } = opts;
      if (!sessionId) {
        setError('No active session');
        return;
      }
      if (isStreaming) {
        // Serialize turns — a second sendMessage while one is in flight is a no-op.
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;

      setError(null);

      const userMsg: ChatMessage = {
        id: genId('user'),
        role: 'user',
        text: trimmed,
        createdAt: Date.now(),
      };
      const assistantMsg: AssistantChatMessage = {
        id: genId('asst'),
        role: 'assistant',
        blocks: [],
        streaming: true,
        createdAt: Date.now(),
      };
      streamingMsgIdRef.current = assistantMsg.id;
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const response = await fetch(
          apiEndpoint(`/code/sessions/${encodeURIComponent(sessionId)}/chat`),
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: trimmed,
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(images && images.length > 0 ? { images } : {}),
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok || !response.body) {
          throw new Error(`Chat request failed: HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        for await (const frame of iterateSse(reader)) {
          if (frame.event === 'done') break;
          if (frame.event !== 'message') continue;

          let record: StreamJsonEvent;
          try {
            record = JSON.parse(frame.data);
          } catch (parseErr) {
            console.warn('[useCodeModeChat] Failed to parse stream-json line', parseErr, frame.data);
            continue;
          }

          // System init — fires once per turn at the start. Carries
          // the model name, fast_mode_state, tools list, etc. We
          // snapshot the parts we surface in the status bar.
          if (record.type === 'system' && (record as any).subtype === 'init') {
            const sys = record as SystemInitEvent;
            if (sys.model) setModel(sys.model);
            if (sys.fast_mode_state !== undefined) setFastMode(sys.fast_mode_state);
            setSessionMeta({
              tools: sys.tools ?? [],
              mcpServers: sys.mcp_servers ?? [],
              agents: sys.agents ?? [],
              skills: sys.skills ?? [],
              plugins: sys.plugins ?? [],
              slashCommands: sys.slash_commands ?? [],
              cwd: sys.cwd ?? '',
              permissionMode: sys.permissionMode ?? '',
              openagenticVersion: sys.openagentic_version ?? '',
              detail: sys._detail,
            });
            continue;
          }

          // Compact boundary — openagentic emits
          // { type: 'system', subtype: 'compact_boundary', ... } when
          // auto-compaction or /compact fires. Trigger a flash for
          // the header gauge so the user sees context shrink.
          if (record.type === 'system' && (record as any).subtype === 'compact_boundary') {
            const trigger = ((record as any).trigger ?? 'auto') as 'manual' | 'auto';
            setCompactionFlash(trigger);
            continue;
          }

          // Permission prompts from openagentic arrive as top-level
          // control_request records with subtype `can_use_tool`.
          // Surface the first one via pendingPermission so the
          // PermissionDialog can render. openagentic will block on
          // stdin until we POST a matching control_response.
          if (record.type === 'control_request') {
            const ctrl = record as ControlRequestEvent;
            const req = ctrl.request as CanUseToolRequest;
            if (req && req.subtype === 'can_use_tool') {
              setPendingPermission({ ...req, request_id: ctrl.request_id });
            }
            continue;
          }

          // Tool progress events — live stdout chunks from running
          // tools (primarily Bash). Attach to the matching tool_use
          // block's liveOutput so the UI can show streaming output.
          if (record.type === 'progress') {
            const prog = record as ToolProgressEvent;
            if (prog.parentToolUseID && prog.data?.output) {
              setMessages((prev) => {
                for (let i = prev.length - 1; i >= 0; i--) {
                  const m = prev[i];
                  if (m.role !== 'assistant') continue;
                  const blockIdx = m.blocks.findIndex(
                    (b) => b.kind === 'tool_use' && b.toolUseId === prog.parentToolUseID,
                  );
                  if (blockIdx < 0) continue;
                  const block = m.blocks[blockIdx] as UiToolUseBlock;
                  const next = [...prev];
                  const clonedBlocks = [...m.blocks];
                  clonedBlocks[blockIdx] = {
                    ...block,
                    liveOutput: prog.data.output,
                  };
                  next[i] = { ...m, blocks: clonedBlocks };
                  return next;
                }
                return prev;
              });
            }
            continue;
          }

          // Tool results arrive as user-role records AFTER the
          // assistant message_stop, so they target a PRIOR assistant
          // message (not the in-flight one). Handle them separately
          // before the find-by-streaming-id path.
          if (record.type === 'user') {
            const ure = record as UserToolResultEvent;
            setMessages((prev) => {
              let next = prev;
              for (const block of ure.message.content) {
                if (block.type !== 'tool_result') continue;
                const uiResult = toolResultBlockToUi(block, ure.tool_use_result);
                next = attachToolResult(next, block.tool_use_id, uiResult);
              }
              return next;
            });
            continue;
          }

          // stream_event: routed via applyStreamEventRouted which
          // handles both top-level messages and nested sub-transcripts
          // inside Task tool blocks (parent_tool_use_id != null).
          if (record.type === 'stream_event') {
            setMessages((prev) =>
              applyStreamEventRouted(prev, streamingMsgIdRef.current, record as StreamEventWrapper),
            );
            continue;
          }

          // Non-stream_event records update the top-level streaming
          // message only (result, error, materialized assistant).
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === streamingMsgIdRef.current);
            if (idx < 0) return prev;
            const current = prev[idx];
            if (current.role !== 'assistant') return prev;

            const clone: AssistantChatMessage = {
              ...current,
              blocks: current.blocks.map(cloneBlock),
            };

            switch (record.type) {
              case 'system':
                // Init event — already snapshotted above (model, fastMode).
                break;
              case 'assistant':
                // Materialized (non-delta) assistant message. We already
                // render from stream_event deltas, so skip to avoid
                // duplicating blocks. Documented in streamJson.ts.
                break;
              case 'result': {
                clone.streaming = false;
                clone.stopReason = clone.stopReason ?? 'end_turn';
                const res = record as ResultEvent;
                if (res.usage) {
                  const ru = res.usage;
                  clone.usage = {
                    inputTokens: ru.input_tokens,
                    outputTokens: ru.output_tokens,
                    totalCostUsd: res.total_cost_usd,
                  };
                  // --continue means each turn's input_tokens is the
                  // running session context total, so overwriting is
                  // correct. A sudden drop indicates auto-compaction.
                  setContextTokens(ru.input_tokens);
                  setTotalOutputTokens((prev) => prev + (ru.output_tokens ?? 0));
                }
                if (typeof res.total_cost_usd === 'number' && !Number.isNaN(res.total_cost_usd)) {
                  setTotalCostUsd((prev) => prev + res.total_cost_usd!);
                }
                if (typeof res.duration_ms === 'number') {
                  setLastTurnMs(res.duration_ms);
                }
                break;
              }
              case 'error':
                clone.streaming = false;
                clone.blocks.push({ kind: 'text', text: `⚠ ${record.message}` });
                break;
            }

            const next = [...prev];
            next[idx] = clone;
            return next;
          });

          if (record.type === 'result' || record.type === 'error') {
            // Stream-side is done; break out of the SSE loop even if
            // the server keeps the connection open for the final `done`.
            break;
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[useCodeModeChat] stream error', err);
        setError(msg);
        // Mark the in-flight assistant message as non-streaming and
        // append an error block so the user sees what happened.
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === streamingMsgIdRef.current);
          if (idx < 0) return prev;
          const current = prev[idx];
          if (current.role !== 'assistant') return prev;
          const next = [...prev];
          next[idx] = {
            ...current,
            streaming: false,
            blocks: [...current.blocks, { kind: 'text', text: `⚠ ${msg}` }],
          };
          return next;
        });
      } finally {
        streamingMsgIdRef.current = null;
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [sessionId, authToken, isStreaming],
  );

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clear,
    cancel,
    contextTokens,
    compactionFlash,
    model,
    fastMode,
    totalCostUsd,
    totalOutputTokens,
    lastTurnMs,
    pendingPermission,
    respondToPermission,
    sendControl,
    sessionMeta,
  };
}
