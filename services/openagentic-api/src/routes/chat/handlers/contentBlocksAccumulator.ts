/**
 * Server-side content_blocks accumulator.
 *
 * Sev-0 #924/#925/#926: stream and finalized DOM must be byte-identical.
 *
 * The UI builds its canonical content_blocks[] chronology via
 * `services/openagentic-ui/src/features/chat/hooks/streamReducer/applyCanonicalFrame.ts`.
 * On `done`, the UI dispatches the chronology through `onMessage` so the
 * client store keeps it. But on session reload the client has no in-memory
 * state — it reads from the DB. So the server MUST also persist the
 * chronology onto `chat_messages.content_blocks` (Json column shipped by
 * the Phase 3 keystone).
 *
 * This helper accumulates the chronology server-side by consuming the
 * same wire-emit frames the client reducer sees. Call `consume(type, payload)`
 * from the V2 ctx.emit shim for every frame we forward to the client; call
 * `snapshot()` at done time to retrieve the chronology to forward into
 * `persistAssistantMessage(opts.contentBlocks)`.
 *
 * Pure: no external state, no I/O, no logger calls. Test-friendly.
 */

export interface ServerContentBlock {
  id: string;
  index: number;
  type:
    | 'thinking'
    | 'text'
    | 'tool_use'
    | 'viz_render'
    | 'app_render'
    | 'follow_up'
    | string;
  content?: string;
  isComplete?: boolean;
  timestamp?: number;
  startTime?: number;
  duration?: number;
  toolId?: string;
  toolName?: string;
  input?: unknown;
  result?: unknown;
  resultRaw?: unknown;
  error?: string;
  /** viz_render / app_render artifact fields. */
  template?: string;
  kind?: string;
  title?: string;
  caption?: string;
  html?: string;
  pyodideRequired?: boolean;
  nonce?: string | null;
  groupId?: string;
  /** follow_up chip strings. */
  items?: string[];
}

export interface ContentBlocksAccumulatorState {
  blocks: ServerContentBlock[];
  currentTextIdx: number | null;
  currentThinkingIdx: number | null;
  toolIdxByUseId: Record<string, number>;
  nextIndex: number;
}

export function createContentBlocksAccumulator() {
  const state: ContentBlocksAccumulatorState = {
    blocks: [],
    currentTextIdx: null,
    currentThinkingIdx: null,
    toolIdxByUseId: {},
    nextIndex: 0,
  };

  function closeOpenAccumulators(ts: number) {
    if (state.currentThinkingIdx !== null) {
      const b = state.blocks[state.currentThinkingIdx];
      if (!b.isComplete) {
        b.isComplete = true;
        if (typeof b.startTime === 'number' && b.duration == null) {
          b.duration = Math.max(0, ts - b.startTime);
        }
      }
      state.currentThinkingIdx = null;
    }
    if (state.currentTextIdx !== null) {
      const b = state.blocks[state.currentTextIdx];
      if (!b.isComplete) {
        b.isComplete = true;
        if (typeof b.startTime === 'number' && b.duration == null) {
          b.duration = Math.max(0, ts - b.startTime);
        }
      }
      state.currentTextIdx = null;
    }
  }

  function appendDelta(kind: 'thinking' | 'text', text: string, ts: number) {
    const currentIdx =
      kind === 'thinking' ? state.currentThinkingIdx : state.currentTextIdx;
    if (currentIdx !== null) {
      state.blocks[currentIdx].content =
        (state.blocks[currentIdx].content || '') + text;
      return;
    }
    const insertAt = state.blocks.length;
    const block: ServerContentBlock = {
      id: `block-${state.nextIndex}-${ts}`,
      index: state.nextIndex,
      type: kind,
      content: text,
      isComplete: false,
      timestamp: ts,
      startTime: ts,
    };
    state.blocks.push(block);
    if (kind === 'thinking') state.currentThinkingIdx = insertAt;
    else state.currentTextIdx = insertAt;
    state.nextIndex += 1;
  }

  function openToolUseBlock(
    id: string,
    name: string,
    input: unknown,
    ts: number,
  ) {
    closeOpenAccumulators(ts);
    if (state.toolIdxByUseId[id] !== undefined) return;
    const insertAt = state.blocks.length;
    const block: ServerContentBlock = {
      id: `block-${state.nextIndex}-${ts}`,
      index: state.nextIndex,
      type: 'tool_use',
      content: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
      isComplete: false,
      timestamp: ts,
      startTime: ts,
      toolId: id,
      toolName: name,
      input,
    };
    state.blocks.push(block);
    state.toolIdxByUseId[id] = insertAt;
    state.nextIndex += 1;
  }

  function completeToolUse(
    id: string,
    result: unknown,
    error: string | undefined,
    ts: number,
  ) {
    const idx = state.toolIdxByUseId[id];
    if (idx === undefined) return;
    const b = state.blocks[idx];
    b.isComplete = true;
    if (typeof b.startTime === 'number' && b.duration == null) {
      b.duration = Math.max(0, ts - b.startTime);
    }
    if (error) {
      b.error = error;
    } else if (result !== undefined) {
      b.result = result;
      b.resultRaw =
        typeof result === 'object' && result !== null && 'data' in (result as any)
          ? (result as any).data
          : result;
    }
  }

  function upsertArtifact(
    type: 'viz_render' | 'app_render',
    payload: any,
    ts: number,
  ) {
    closeOpenAccumulators(ts);
    const artifactId =
      typeof payload?.artifact_id === 'string' ? payload.artifact_id : '';
    if (!artifactId) return;
    const groupId =
      typeof payload?.group_id === 'string' ? payload.group_id : undefined;
    const insertAt = state.blocks.length;

    const block: ServerContentBlock = {
      id: artifactId,
      index: state.nextIndex,
      type,
      content: type === 'viz_render' ? String(payload?.content ?? '') : '',
      isComplete: true,
      timestamp: ts,
      startTime: ts,
      template: typeof payload?.template === 'string' ? payload.template : undefined,
      kind: typeof payload?.kind === 'string' ? payload.kind : undefined,
      title: typeof payload?.title === 'string' ? payload.title : undefined,
      caption: typeof payload?.caption === 'string' ? payload.caption : undefined,
      html: type === 'app_render' && typeof payload?.html === 'string' ? payload.html : undefined,
      pyodideRequired: type === 'app_render' && payload?.pyodide_required === true ? true : undefined,
      nonce: type === 'app_render' && typeof payload?.nonce === 'string' ? payload.nonce : undefined,
      groupId,
    };

    // group_id hot-swap: replace existing block, preserve its index.
    if (groupId) {
      const existingIdx = state.blocks.findIndex(
        (b) => b.groupId === groupId && b.type === type,
      );
      if (existingIdx >= 0) {
        const prior = state.blocks[existingIdx];
        block.index = prior.index;
        block.id = block.id || prior.id;
        state.blocks[existingIdx] = block;
        return;
      }
    }
    state.blocks.push(block);
    state.nextIndex += 1;
  }

  function consume(frame: string, payload: any) {
    const ts = Date.now();
    switch (frame) {
      case 'thinking_event':
      case 'thinking': {
        const text =
          typeof payload?.text === 'string'
            ? payload.text
            : typeof payload?.thinking === 'string'
              ? payload.thinking
              : typeof payload?.delta === 'string'
                ? payload.delta
                : '';
        if (text.length > 0) appendDelta('thinking', text, ts);
        break;
      }
      case 'thinking_complete': {
        closeOpenAccumulators(ts);
        break;
      }
      case 'content_block_delta': {
        // #1021 — Anthropic-canonical wire envelope carries thinking_delta
        // inside `delta`. UI's applyCanonicalFrame.ts handles this at line
        // 172; without the mirror here, chat_messages.content_blocks loses
        // every thinking entry that rendered live but never persisted.
        // text_delta path stays in 'content_delta'/'stream' cases — no
        // double-handling.
        const delta = payload?.delta;
        if (delta && typeof delta === 'object') {
          if (
            delta.type === 'thinking_delta' &&
            typeof delta.thinking === 'string' &&
            delta.thinking.length > 0
          ) {
            appendDelta('thinking', delta.thinking, ts);
          }
        }
        break;
      }
      case 'content_delta':
      case 'stream': {
        const text =
          typeof payload?.content === 'string'
            ? payload.content
            : typeof payload?.text === 'string'
              ? payload.text
              : '';
        if (text.length > 0) appendDelta('text', text, ts);
        break;
      }
      case 'assistant_message_delta': {
        const text = typeof payload?.text === 'string' ? payload.text : '';
        if (text.length > 0) appendDelta('text', text, ts);
        break;
      }
      case 'tool_executing': {
        const id =
          typeof payload?.tool_use_id === 'string'
            ? payload.tool_use_id
            : typeof payload?.toolCallId === 'string'
              ? payload.toolCallId
              : typeof payload?.id === 'string'
                ? payload.id
                : undefined;
        const name =
          typeof payload?.name === 'string'
            ? payload.name
            : typeof payload?.toolName === 'string'
              ? payload.toolName
              : 'tool';
        const input =
          payload?.input !== undefined
            ? payload.input
            : payload?.arguments !== undefined
              ? payload.arguments
              : payload?.args;
        if (id) openToolUseBlock(id, name, input, ts);
        break;
      }
      case 'tool_result': {
        const id =
          typeof payload?.tool_use_id === 'string'
            ? payload.tool_use_id
            : typeof payload?.toolCallId === 'string'
              ? payload.toolCallId
              : typeof payload?.id === 'string'
                ? payload.id
                : undefined;
        const result =
          payload?.content !== undefined ? payload.content : payload?.result;
        if (id) completeToolUse(id, result, undefined, ts);
        break;
      }
      case 'tool_error': {
        const id =
          typeof payload?.tool_use_id === 'string'
            ? payload.tool_use_id
            : typeof payload?.toolCallId === 'string'
              ? payload.toolCallId
              : typeof payload?.id === 'string'
                ? payload.id
                : undefined;
        const err =
          typeof payload?.error === 'string' ? payload.error : 'tool error';
        if (id) completeToolUse(id, undefined, err, ts);
        break;
      }
      case 'visual_render':
        upsertArtifact('viz_render', payload, ts);
        break;
      case 'app_render':
        upsertArtifact('app_render', payload, ts);
        break;
      case 'follow_up': {
        closeOpenAccumulators(ts);
        const rawItems = payload?.items;
        const items: string[] = Array.isArray(rawItems)
          ? rawItems
              .filter((s: unknown): s is string => typeof s === 'string')
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 0)
              .slice(0, 5)
          : [];
        if (items.length === 0) break;
        const existingIdx = state.blocks.findIndex((b) => b.type === 'follow_up');
        const block: ServerContentBlock = {
          id:
            existingIdx >= 0
              ? state.blocks[existingIdx].id
              : `block-${state.nextIndex}-${ts}`,
          index:
            existingIdx >= 0
              ? state.blocks[existingIdx].index
              : state.nextIndex,
          type: 'follow_up',
          content: '',
          isComplete: true,
          timestamp: ts,
          startTime: ts,
          items,
        };
        if (existingIdx >= 0) {
          state.blocks[existingIdx] = block;
        } else {
          state.blocks.push(block);
          state.nextIndex += 1;
        }
        break;
      }
      default:
        // Other frames (pipeline_stage, model_info, ping, …) don't add
        // to the chronology — ignore.
        break;
    }
  }

  function snapshot(): ServerContentBlock[] {
    // Close any open accumulators at snapshot time so persisted blocks
    // have isComplete:true.
    closeOpenAccumulators(Date.now());
    return state.blocks.slice();
  }

  return { consume, snapshot };
}

export type ContentBlocksAccumulator = ReturnType<
  typeof createContentBlocksAccumulator
>;
