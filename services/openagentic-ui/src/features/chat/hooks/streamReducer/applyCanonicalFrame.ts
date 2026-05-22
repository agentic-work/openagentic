/**
 * Pure reducer from canonical NDJSON wire frames to ContentBlock[].
 *
 * Block-boundary inference: the wire emits content_block_delta with
 * no surrounding content_block_start / content_block_stop for thinking.
 * Tool dispatch, thinking_complete, and stream_complete are the implicit
 * close-the-current-accumulator signals. A text_delta arriving while a
 * thinking block is open opens a NEW text block (it does not mix).
 */
import type { ContentBlock } from '../useChatStream';
// F2 (2026-05-18) — SDK SoT for WireFrame. `UIStreamFrameLoose` is the
// structural superset `{ type: string; [k: string]: unknown }` the SDK
// already publishes; the local `WireFrame` type is now a strict alias so
// reducer callers transitively see the SDK type. New code should import
// `UIStreamFrame` (strict-discriminated) or `UIStreamFrameLoose` (loose
// superset) directly from `@agentic-work/llm-sdk`.
import type { UIStreamFrameLoose } from '@agentic-work/llm-sdk';

/**
 * Pragmatic wire-frame shape — alias of SDK's `UIStreamFrameLoose`. The
 * loose form is the runtime-safe superset every reducer caller already
 * uses. Strict callers can narrow on `type` and consume the SDK's
 * `UIStreamFrame` discriminated union directly.
 */
export type WireFrame = UIStreamFrameLoose;

export interface FrameState {
  contentBlocks: ContentBlock[];
  currentThinkingIdx: number | null;
  currentTextIdx: number | null;
  toolIdxByUseId: Record<string, number>;
  // #815 — maps wire `index` → contentBlock idx for in-flight tool blocks.
  // `input_json_delta` only carries the wire index, not the tool_use_id, so
  // we need this to find which block to accumulate partial_json into.
  toolIdxByWireIndex: Record<number, number>;
  nextBlockIndex: number;
}

export function initialFrameState(): FrameState {
  return {
    contentBlocks: [],
    currentThinkingIdx: null,
    currentTextIdx: null,
    toolIdxByUseId: {},
    toolIdxByWireIndex: {},
    nextBlockIndex: 0,
  };
}

function closeOpenAccumulators(state: FrameState, ts?: number): FrameState {
  const tIdx = state.currentThinkingIdx;
  const xIdx = state.currentTextIdx;
  if (tIdx === null && xIdx === null) return state;
  const needsTClose = tIdx !== null && !state.contentBlocks[tIdx]?.isComplete;
  const needsXClose = xIdx !== null && !state.contentBlocks[xIdx]?.isComplete;
  if (!needsTClose && !needsXClose) {
    return { ...state, currentThinkingIdx: null, currentTextIdx: null };
  }
  const blocks = state.contentBlocks.slice();
  // #813 — InlineThinkingBlock reads endedAt = startTime + duration. Without
  // a duration on close, the UI shows "Thought · 0.0s". Stamp duration from
  // the frame ts so the live header reflects true wall-clock elapsed.
  const closeBlock = (b: ContentBlock): ContentBlock => {
    const next: ContentBlock = { ...b, isComplete: true };
    if (typeof ts === 'number' && typeof b.startTime === 'number' && b.duration == null) {
      next.duration = Math.max(0, ts - b.startTime);
    }
    return next;
  };
  if (needsTClose) blocks[tIdx!] = closeBlock(blocks[tIdx!]);
  if (needsXClose) blocks[xIdx!] = closeBlock(blocks[xIdx!]);
  return { ...state, contentBlocks: blocks, currentThinkingIdx: null, currentTextIdx: null };
}

function appendDelta(
  state: FrameState,
  kind: 'thinking' | 'text',
  text: string,
  ts: number,
): FrameState {
  const currentIdx = kind === 'thinking' ? state.currentThinkingIdx : state.currentTextIdx;
  if (currentIdx !== null) {
    const blocks = state.contentBlocks.slice();
    const b = blocks[currentIdx];
    blocks[currentIdx] = { ...b, content: b.content + text };
    return { ...state, contentBlocks: blocks };
  }
  const insertAt = state.contentBlocks.length;
  const newBlock: ContentBlock = {
    id: `block-${state.nextBlockIndex}-${ts}`,
    index: state.nextBlockIndex,
    type: kind,
    content: text,
    isComplete: false,
    timestamp: ts,
    startTime: ts,
  };
  return {
    ...state,
    contentBlocks: [...state.contentBlocks, newBlock],
    currentThinkingIdx: kind === 'thinking' ? insertAt : state.currentThinkingIdx,
    currentTextIdx: kind === 'text' ? insertAt : state.currentTextIdx,
    nextBlockIndex: state.nextBlockIndex + 1,
  };
}

function openToolUseBlock(
  state: FrameState,
  id: string,
  name: string,
  input: unknown,
  ts: number,
  wireIndex?: number,
): FrameState {
  const closed = closeOpenAccumulators(state, ts);
  const insertAt = closed.contentBlocks.length;
  const block: ContentBlock = {
    id: `block-${closed.nextBlockIndex}-${ts}`,
    index: closed.nextBlockIndex,
    type: 'tool_use',
    content: '',
    isComplete: false,
    timestamp: ts,
    startTime: ts,
    toolId: id,
    toolName: name,
    input,
  };
  const next: FrameState = {
    ...closed,
    contentBlocks: [...closed.contentBlocks, block],
    toolIdxByUseId: { ...closed.toolIdxByUseId, [id]: insertAt },
    nextBlockIndex: closed.nextBlockIndex + 1,
  };
  if (typeof wireIndex === 'number') {
    next.toolIdxByWireIndex = { ...closed.toolIdxByWireIndex, [wireIndex]: insertAt };
  }
  return next;
}

export function applyCanonicalFrame(state: FrameState, frame: WireFrame): FrameState {
  const ts = (frame._ts as number) ?? Date.now();
  switch (frame.type) {
    case 'stream_start':
      return initialFrameState();

    case 'content_block_start': {
      // #815 — open an in-flight tool_use block at content_block_start (NOT
      // at tool_call_complete) so the UI's ToolCard appears the moment the
      // model commits to a tool, with progressive partial-input streaming.
      const cb = frame.content_block as
        | { type?: string; id?: string; name?: string; input?: unknown }
        | undefined;
      if (cb?.type !== 'tool_use' || !cb.id || !cb.name) return state;
      const wireIndex = typeof frame.index === 'number' ? frame.index : undefined;
      if (state.toolIdxByUseId[cb.id] !== undefined) {
        // Block already open for this id — preserve, just (re)map wire index
        // so input_json_delta can find it.
        if (wireIndex === undefined) return state;
        return {
          ...state,
          toolIdxByWireIndex: { ...state.toolIdxByWireIndex, [wireIndex]: state.toolIdxByUseId[cb.id] },
        };
      }
      return openToolUseBlock(state, cb.id, cb.name, cb.input ?? {}, ts, wireIndex);
    }

    case 'content_block_delta': {
      const delta = (frame.delta as
        | { type?: string; thinking?: string; text?: string; partial_json?: string }
        | undefined) || {};
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return appendDelta(state, 'thinking', delta.thinking, ts);
      }
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return appendDelta(state, 'text', delta.text, ts);
      }
      // #815 — accumulate partial_json into the open tool_use block's content
      // field (ToolCard.tsx reads block.content as inputDeltaContent when
      // status === 'running'). Look up by wire index; if no matching block,
      // ignore (nothing to accumulate into).
      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const wireIndex = typeof frame.index === 'number' ? frame.index : undefined;
        if (wireIndex === undefined) return state;
        const blockIdx = state.toolIdxByWireIndex[wireIndex];
        if (blockIdx === undefined) return state;
        const blocks = state.contentBlocks.slice();
        const b = blocks[blockIdx];
        blocks[blockIdx] = { ...b, content: b.content + delta.partial_json };
        return { ...state, contentBlocks: blocks };
      }
      return state;
    }

    case 'content_block_stop':
      // #815 — content_block_stop fires after input_json_delta on the wire
      // but the tool block waits for tool_result / tool_error to flip
      // isComplete. text/thinking blocks are closed by their own *_complete
      // signals (thinking_complete, message_stop). So content_block_stop is
      // a no-op for the reducer.
      return state;

    case 'tool_call_complete': {
      const id = frame.id as string | undefined;
      const name = frame.name as string | undefined;
      if (!id || !name) return state;
      // Block already open (via content_block_start)? Update the final input.
      const existingIdx = state.toolIdxByUseId[id];
      if (existingIdx !== undefined) {
        const blocks = state.contentBlocks.slice();
        blocks[existingIdx] = { ...blocks[existingIdx], input: frame.input };
        return { ...state, contentBlocks: blocks };
      }
      return openToolUseBlock(state, id, name, frame.input, ts);
    }

    case 'tool_executing': {
      const id = frame.tool_use_id as string | undefined;
      if (!id) return state;
      if (state.toolIdxByUseId[id] !== undefined) return state;
      const name = (frame.name as string | undefined) ?? 'tool';
      return openToolUseBlock(state, id, name, frame.input, ts);
    }

    case 'tool_result': {
      const id = frame.tool_use_id as string | undefined;
      if (!id) return state;
      const idx = state.toolIdxByUseId[id];
      if (idx === undefined) return state;
      const blocks = state.contentBlocks.slice();
      const b = blocks[idx];
      const content = frame.content as { summary?: string; data?: unknown } | undefined;
      blocks[idx] = {
        ...b,
        isComplete: true,
        result: content,
        resultRaw: content?.data,
        content: typeof content?.summary === 'string' ? content.summary : b.content,
        duration: ts - (b.startTime ?? ts),
      };
      return { ...state, contentBlocks: blocks };
    }

    case 'tool_error': {
      const id = frame.tool_use_id as string | undefined;
      if (!id) return state;
      const idx = state.toolIdxByUseId[id];
      if (idx === undefined) return state;
      const blocks = state.contentBlocks.slice();
      const b = blocks[idx];
      blocks[idx] = {
        ...b,
        isComplete: true,
        error: typeof frame.error === 'string' ? frame.error : 'tool error',
        duration: ts - (b.startTime ?? ts),
      };
      return { ...state, contentBlocks: blocks };
    }

    case 'thinking_complete':
    case 'stream_complete':
    case 'message_stop':
      return closeOpenAccumulators(state, ts);

    case 'visual_render':
      return foldVizRenderFrame(state, frame, ts);

    case 'app_render':
      return foldAppRenderFrame(state, frame, ts);

    case 'artifact_render':
      return foldArtifactRenderFrame(state, frame, ts);

    case 'follow_up':
      return foldFollowUpFrame(state, frame, ts);

    default:
      return state;
  }
}

/**
 * F1-6 (2026-05-17) — fold the end-of-turn `follow_up` chip-row frame into
 * contentBlocks[].
 *
 * Behavior:
 *   - closes any open thinking/text accumulators first so the chip row
 *     never lands inside an open prose block (CLAUDE.md rule 8a)
 *   - 0 valid items → no block (UI no-op)
 *   - 1..5 valid items → append a single `follow_up` block
 *   - if a `follow_up` block already exists (re-emit), REPLACE it rather
 *     than appending another — one chip row per assistant turn
 */
function foldFollowUpFrame(state: FrameState, frame: WireFrame, ts: number): FrameState {
  const rawItems = (frame as { items?: unknown }).items;
  const items: string[] = Array.isArray(rawItems)
    ? rawItems
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 5)
    : [];

  // Always close any open prose first — even on no-op so the next frame
  // can't accidentally append to a stale buffer.
  const closed = closeOpenAccumulators(state, ts);
  if (items.length === 0) return closed;

  const existingIdx = closed.contentBlocks.findIndex((b) => b.type === 'follow_up');
  const newBlock: ContentBlock = {
    id: existingIdx >= 0
      ? closed.contentBlocks[existingIdx].id
      : `block-${closed.nextBlockIndex}-${ts}`,
    index: existingIdx >= 0
      ? (closed.contentBlocks[existingIdx].index ?? closed.nextBlockIndex)
      : closed.nextBlockIndex,
    type: 'follow_up',
    content: '',
    isComplete: true,
    timestamp: ts,
    startTime: ts,
    items,
  };

  if (existingIdx >= 0) {
    const blocks = closed.contentBlocks.slice();
    blocks[existingIdx] = newBlock;
    return { ...closed, contentBlocks: blocks };
  }
  return {
    ...closed,
    contentBlocks: [...closed.contentBlocks, newBlock],
    nextBlockIndex: closed.nextBlockIndex + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Typed-block artifact path. `visual_render` / `app_render` / `artifact_render`
// wire frames fold into ContentBlock[] so they render INLINE at the wire-emit
// chronological position. group_id is the hot-swap key — re-emitting a frame
// with the same group_id REPLACES the existing block at its current index
// (preserves position), not append.
// ─────────────────────────────────────────────────────────────────────────

function upsertArtifactBlock(
  state: FrameState,
  block: ContentBlock,
  groupId: string | undefined,
): FrameState {
  const closed = closeOpenAccumulators(state, block.timestamp);
  if (groupId) {
    const existingIdx = closed.contentBlocks.findIndex(
      (b) => b.groupId === groupId && (b.type === block.type),
    );
    if (existingIdx >= 0) {
      const blocks = closed.contentBlocks.slice();
      const prior = blocks[existingIdx];
      blocks[existingIdx] = { ...block, index: prior.index, id: block.id || prior.id };
      return { ...closed, contentBlocks: blocks };
    }
  }
  return {
    ...closed,
    contentBlocks: [...closed.contentBlocks, { ...block, index: closed.nextBlockIndex }],
    nextBlockIndex: closed.nextBlockIndex + 1,
  };
}

type VizFrame = {
  artifact_id?: string;
  template?: string;
  kind?: string;
  content?: string;
  title?: string;
  group_id?: string;
  loading_messages?: unknown;
  caption?: string;
};

function foldVizRenderFrame(state: FrameState, frame: WireFrame, ts: number): FrameState {
  const f = frame as unknown as VizFrame;
  const artifactId = typeof f.artifact_id === 'string' ? f.artifact_id : '';
  const content = typeof f.content === 'string' ? f.content : '';
  if (!artifactId || !content) return state;
  const knd = typeof f.kind === 'string' ? f.kind : 'svg';
  const allowedKinds: ReadonlyArray<ContentBlock['kind']> = [
    'svg', 'html', 'reactflow_arch', 'arch_diagram', 'chart',
  ];
  const kind = (allowedKinds as ReadonlyArray<string>).includes(knd)
    ? (knd as ContentBlock['kind'])
    : ('svg' as ContentBlock['kind']);
  const groupId = typeof f.group_id === 'string' ? f.group_id : undefined;
  const block: ContentBlock = {
    id: artifactId,
    index: state.nextBlockIndex,
    type: 'viz_render',
    content,
    isComplete: true,
    template: typeof f.template === 'string' ? f.template : '',
    kind,
    title: typeof f.title === 'string' ? f.title : undefined,
    caption: typeof f.caption === 'string' && f.caption.length > 0 ? f.caption : undefined,
    loadingMessages: Array.isArray(f.loading_messages)
      ? (f.loading_messages.filter((s) => typeof s === 'string') as string[])
      : undefined,
    groupId,
    timestamp: ts,
    startTime: ts,
  };
  return upsertArtifactBlock(state, block, groupId);
}

type AppFrame = {
  artifact_id?: string;
  html?: string;
  title?: string;
  group_id?: string;
  pyodide_required?: boolean;
  nonce?: string | null;
};

function foldAppRenderFrame(state: FrameState, frame: WireFrame, ts: number): FrameState {
  const f = frame as unknown as AppFrame;
  const artifactId = typeof f.artifact_id === 'string' ? f.artifact_id : '';
  const html = typeof f.html === 'string' ? f.html : '';
  if (!artifactId || !html) return state;
  const groupId = typeof f.group_id === 'string' ? f.group_id : undefined;
  const block: ContentBlock = {
    id: artifactId,
    index: state.nextBlockIndex,
    type: 'app_render',
    content: '',
    html,
    isComplete: true,
    title: typeof f.title === 'string' ? f.title : 'Mini app',
    pyodideRequired: f.pyodide_required === true,
    nonce: typeof f.nonce === 'string' ? f.nonce : null,
    groupId,
    timestamp: ts,
    startTime: ts,
  };
  return upsertArtifactBlock(state, block, groupId);
}

type ArtifactFrame = {
  artifact_id?: string;
  kind?: string;
  content?: string;
  title?: string;
  group_id?: string;
};

function foldArtifactRenderFrame(state: FrameState, frame: WireFrame, ts: number): FrameState {
  const f = frame as unknown as ArtifactFrame;
  const artifactId = typeof f.artifact_id === 'string' ? f.artifact_id : '';
  const content = typeof f.content === 'string' ? f.content : '';
  const knd = typeof f.kind === 'string' ? f.kind : '';
  if (!artifactId || !content || !knd) return state;
  const groupId = typeof f.group_id === 'string' ? f.group_id : undefined;
  // Discriminator: react/html/python_plot → app_render; svg → viz_render.
  if (knd === 'react' || knd === 'html' || knd === 'python_plot') {
    const block: ContentBlock = {
      id: artifactId,
      index: state.nextBlockIndex,
      type: 'app_render',
      content: '',
      html: content,
      isComplete: true,
      kind: knd as ContentBlock['kind'],
      title: typeof f.title === 'string' ? f.title : 'Artifact',
      groupId,
      timestamp: ts,
      startTime: ts,
    };
    return upsertArtifactBlock(state, block, groupId);
  }
  if (knd === 'svg') {
    const block: ContentBlock = {
      id: artifactId,
      index: state.nextBlockIndex,
      type: 'viz_render',
      content,
      isComplete: true,
      template: knd,
      kind: knd as ContentBlock['kind'],
      title: typeof f.title === 'string' ? f.title : undefined,
      groupId,
      timestamp: ts,
      startTime: ts,
    };
    return upsertArtifactBlock(state, block, groupId);
  }
  return state;
}
