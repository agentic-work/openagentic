/**
 * Pure reducer from canonical NDJSON wire frames to UIContentBlock[].
 *
 * Block-boundary inference: the wire emits content_block_delta with
 * no surrounding content_block_start / content_block_stop for thinking.
 * Tool dispatch, thinking_complete, and stream_complete are the implicit
 * close-the-current-accumulator signals. A text_delta arriving while a
 * thinking block is open opens a NEW text block (it does not mix).
 *
 * Track B Phase 7 of the canonical streaming rip (chatmode):
 *
 *   - This file IS the SoT reducer for both the UI's live render path
 *     (`useChatStream` → `AgenticActivityStream`) AND the server's
 *     persistence path (`stream.handler.ts` consumes the SAME reducer
 *     so `chat_messages.content_blocks` Json column is byte-identical
 *     to the live wire-emit chronology).
 *
 *   - Pure. No React, no DOM, no I/O, no logger calls. State in, state out.
 *
 *   - Output blocks are `UIContentBlock` — the persistence + render shape
 *     defined in `./types.ts`.
 *
 * (Track B Phase 7.)
 */
import type { UIContentBlock, UIStreamFrameLoose } from './types.js';

/**
 * Pragmatic wire-frame shape — alias of SDK's `UIStreamFrameLoose`. The
 * loose form is the runtime-safe superset every reducer caller already
 * uses. Strict callers can narrow on `type` and consume the SDK's
 * `UIStreamFrame` discriminated union directly.
 */
export type WireFrame = UIStreamFrameLoose;

export interface FrameState {
  contentBlocks: UIContentBlock[];
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
  const tBlock = tIdx !== null ? state.contentBlocks[tIdx] : undefined;
  const xBlock = xIdx !== null ? state.contentBlocks[xIdx] : undefined;
  const needsTClose = tBlock !== undefined && !tBlock.isComplete;
  const needsXClose = xBlock !== undefined && !xBlock.isComplete;
  if (!needsTClose && !needsXClose) {
    return { ...state, currentThinkingIdx: null, currentTextIdx: null };
  }
  const blocks = state.contentBlocks.slice();
  // #813 — InlineThinkingBlock reads endedAt = startTime + duration. Without
  // a duration on close, the UI shows "Thought · 0.0s". Stamp duration from
  // the frame ts so the live header reflects true wall-clock elapsed.
  const closeBlock = (b: UIContentBlock): UIContentBlock => {
    const next: UIContentBlock = { ...b, isComplete: true };
    if (typeof ts === 'number' && typeof b.startTime === 'number' && b.duration == null) {
      next.duration = Math.max(0, ts - b.startTime);
    }
    return next;
  };
  if (needsTClose && tBlock !== undefined && tIdx !== null) blocks[tIdx] = closeBlock(tBlock);
  if (needsXClose && xBlock !== undefined && xIdx !== null) blocks[xIdx] = closeBlock(xBlock);
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
    if (b !== undefined) {
      blocks[currentIdx] = { ...b, content: b.content + text };
    }
    return { ...state, contentBlocks: blocks };
  }
  const insertAt = state.contentBlocks.length;
  const newBlock: UIContentBlock = {
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
  const block: UIContentBlock = {
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
  // WireFrame is the loose union `{ type: string; [k: string]: unknown }` so
  // every non-`type` field must use bracket access under the SDK's strict
  // `noPropertyAccessFromIndexSignature` rule.
  const f = frame as Record<string, unknown>;
  const ts = (typeof f['_ts'] === 'number' ? (f['_ts'] as number) : Date.now());
  switch (frame.type) {
    case 'stream_start':
      return initialFrameState();

    case 'content_block_start': {
      // #815 — open an in-flight tool_use block at content_block_start (NOT
      // at tool_call_complete) so the UI's ToolCard appears the moment the
      // model commits to a tool, with progressive partial-input streaming.
      const cb = f['content_block'] as
        | { type?: string; id?: string; name?: string; input?: unknown }
        | undefined;
      if (cb?.type !== 'tool_use' || !cb.id || !cb.name) return state;
      const wireIndex = typeof f['index'] === 'number' ? (f['index'] as number) : undefined;
      const existingByUseId = state.toolIdxByUseId[cb.id];
      if (existingByUseId !== undefined) {
        // Block already open for this id — preserve, just (re)map wire index
        // so input_json_delta can find it.
        if (wireIndex === undefined) return state;
        return {
          ...state,
          toolIdxByWireIndex: { ...state.toolIdxByWireIndex, [wireIndex]: existingByUseId },
        };
      }
      return openToolUseBlock(state, cb.id, cb.name, cb.input ?? {}, ts, wireIndex);
    }

    case 'content_block_delta': {
      const delta = (f['delta'] as
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
        const wireIndex = typeof f['index'] === 'number' ? (f['index'] as number) : undefined;
        if (wireIndex === undefined) return state;
        const blockIdx = state.toolIdxByWireIndex[wireIndex];
        if (blockIdx === undefined) return state;
        const blocks = state.contentBlocks.slice();
        const b = blocks[blockIdx];
        if (b !== undefined) {
          blocks[blockIdx] = { ...b, content: b.content + delta.partial_json };
        }
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
      const id = typeof f['id'] === 'string' ? (f['id'] as string) : undefined;
      const name = typeof f['name'] === 'string' ? (f['name'] as string) : undefined;
      if (!id || !name) return state;
      // Block already open (via content_block_start)? Update the final input.
      const existingIdx = state.toolIdxByUseId[id];
      if (existingIdx !== undefined) {
        const blocks = state.contentBlocks.slice();
        const prior = blocks[existingIdx];
        if (prior !== undefined) {
          blocks[existingIdx] = { ...prior, input: f['input'] };
        }
        return { ...state, contentBlocks: blocks };
      }
      return openToolUseBlock(state, id, name, f['input'], ts);
    }

    case 'tool_executing': {
      const id = typeof f['tool_use_id'] === 'string' ? (f['tool_use_id'] as string) : undefined;
      if (!id) return state;
      if (state.toolIdxByUseId[id] !== undefined) return state;
      const name = typeof f['name'] === 'string' ? (f['name'] as string) : 'tool';
      return openToolUseBlock(state, id, name, f['input'], ts);
    }

    case 'tool_result': {
      const id = typeof f['tool_use_id'] === 'string' ? (f['tool_use_id'] as string) : undefined;
      if (!id) return state;
      const idx = state.toolIdxByUseId[id];
      if (idx === undefined) return state;
      const blocks = state.contentBlocks.slice();
      const b = blocks[idx];
      if (b === undefined) return state;
      const rawContent = f['content'];
      const content = (rawContent && typeof rawContent === 'object' ? rawContent : undefined) as
        | { summary?: string; data?: unknown }
        | undefined;
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
      const id = typeof f['tool_use_id'] === 'string' ? (f['tool_use_id'] as string) : undefined;
      if (!id) return state;
      const idx = state.toolIdxByUseId[id];
      if (idx === undefined) return state;
      const blocks = state.contentBlocks.slice();
      const b = blocks[idx];
      if (b === undefined) return state;
      blocks[idx] = {
        ...b,
        isComplete: true,
        error: typeof f['error'] === 'string' ? (f['error'] as string) : 'tool error',
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

    case 'image_render':
      return foldImageRenderFrame(state, frame, ts);

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
  const priorBlock = existingIdx >= 0 ? closed.contentBlocks[existingIdx] : undefined;
  const newBlock: UIContentBlock = {
    id: priorBlock
      ? priorBlock.id
      : `block-${closed.nextBlockIndex}-${ts}`,
    index: priorBlock
      ? (priorBlock.index ?? closed.nextBlockIndex)
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
// wire frames fold into UIContentBlock[] so they render INLINE at the wire-emit
// chronological position. group_id is the hot-swap key — re-emitting a frame
// with the same group_id REPLACES the existing block at its current index
// (preserves position), not append.
// ─────────────────────────────────────────────────────────────────────────

function upsertArtifactBlock(
  state: FrameState,
  block: UIContentBlock,
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
      if (prior !== undefined) {
        const merged: UIContentBlock = { ...block, id: block.id || prior.id };
        if (prior.index !== undefined) merged.index = prior.index;
        blocks[existingIdx] = merged;
      }
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
  const allowedKinds: ReadonlyArray<UIContentBlock['kind']> = [
    'svg', 'html', 'reactflow_arch', 'arch_diagram', 'chart',
  ];
  const kind = (allowedKinds as ReadonlyArray<string>).includes(knd)
    ? (knd as UIContentBlock['kind'])
    : ('svg' as UIContentBlock['kind']);
  const groupId = typeof f.group_id === 'string' ? f.group_id : undefined;
  const block: UIContentBlock = {
    id: artifactId,
    index: state.nextBlockIndex,
    type: 'viz_render',
    content,
    isComplete: true,
    template: typeof f.template === 'string' ? f.template : '',
    timestamp: ts,
    startTime: ts,
  };
  block.kind = kind as NonNullable<UIContentBlock['kind']>;
  if (typeof f.title === 'string') block.title = f.title;
  if (typeof f.caption === 'string' && f.caption.length > 0) block.caption = f.caption;
  if (Array.isArray(f.loading_messages)) {
    block.loadingMessages = f.loading_messages.filter((s) => typeof s === 'string') as string[];
  }
  if (groupId !== undefined) block.groupId = groupId;
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
  const block: UIContentBlock = {
    id: artifactId,
    index: state.nextBlockIndex,
    type: 'app_render',
    content: '',
    html,
    isComplete: true,
    title: typeof f.title === 'string' ? f.title : 'Mini app',
    pyodideRequired: f.pyodide_required === true,
    nonce: typeof f.nonce === 'string' ? f.nonce : null,
    timestamp: ts,
    startTime: ts,
  };
  if (groupId !== undefined) block.groupId = groupId;
  return upsertArtifactBlock(state, block, groupId);
}

type ImageFrame = {
  artifact_id?: string;
  image_url?: string;
  prompt?: string;
  model?: string;
  provider?: string;
  format?: string;
  alt?: string;
  group_id?: string;
};

function foldImageRenderFrame(state: FrameState, frame: WireFrame, ts: number): FrameState {
  const f = frame as unknown as ImageFrame;
  const artifactId = typeof f.artifact_id === 'string' ? f.artifact_id : '';
  const imageUrl = typeof f.image_url === 'string' ? f.image_url : '';
  // Defensive: drop frames with no id/url OR an external host. The
  // generate_image tool already refuses external URLs server-side; this is
  // belt-and-suspenders so a malformed wire frame never renders a fabricated
  // off-platform image.
  if (!artifactId || !imageUrl || /^https?:\/\//i.test(imageUrl)) return state;
  const groupId = typeof f.group_id === 'string' ? f.group_id : undefined;
  const block: UIContentBlock = {
    id: artifactId,
    index: state.nextBlockIndex,
    type: 'image_render',
    content: '',
    imageUrl,
    isComplete: true,
    title: typeof f.alt === 'string' ? f.alt : (typeof f.prompt === 'string' ? f.prompt : 'Generated image'),
    timestamp: ts,
    startTime: ts,
  };
  if (typeof f.prompt === 'string') block.prompt = f.prompt;
  if (typeof f.model === 'string') block.model = f.model;
  if (typeof f.provider === 'string') block.provider = f.provider;
  if (groupId !== undefined) block.groupId = groupId;
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
    const block: UIContentBlock = {
      id: artifactId,
      index: state.nextBlockIndex,
      type: 'app_render',
      content: '',
      html: content,
      isComplete: true,
      kind: knd as NonNullable<UIContentBlock['kind']>,
      title: typeof f.title === 'string' ? f.title : 'Artifact',
      timestamp: ts,
      startTime: ts,
    };
    if (groupId !== undefined) block.groupId = groupId;
    return upsertArtifactBlock(state, block, groupId);
  }
  if (knd === 'svg') {
    const block: UIContentBlock = {
      id: artifactId,
      index: state.nextBlockIndex,
      type: 'viz_render',
      content,
      isComplete: true,
      template: knd,
      kind: knd as NonNullable<UIContentBlock['kind']>,
      timestamp: ts,
      startTime: ts,
    };
    if (typeof f.title === 'string') block.title = f.title;
    if (groupId !== undefined) block.groupId = groupId;
    return upsertArtifactBlock(state, block, groupId);
  }
  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// Server-side adapter: wire-envelope `(frame, payload)` → CanonicalEvent
// shape the reducer consumes.
//
// The server's `stream.handler.ts` accumulates content blocks by calling
// `consume(frame, payload)` on every NDJSON frame it emits to the UI. The
// UI's wire stream comes in CanonicalEvent shape already (`{ type, ...fields }`)
// so this adapter is a passthrough merge — the payload object is the frame
// body, the `frame` string is the discriminant.
//
// One translation: the server's accumulator historically accepted
// `'content_delta'` + `'stream'` as legacy text-stream envelopes. The UI
// reducer ignores both. To preserve persistence of text deltas emitted via
// those envelopes (legacy path, still in use until Phase 2 dual-emit kill),
// the adapter rewrites them to `content_block_delta { text_delta }`.
// ─────────────────────────────────────────────────────────────────────────

export function consumeWireFrame(
  state: FrameState,
  frame: string,
  payload: unknown,
): FrameState {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  // Legacy text-stream envelopes → synthesize canonical text_delta.
  if (frame === 'content_delta' || frame === 'stream') {
    const text =
      typeof p['content'] === 'string'
        ? (p['content'] as string)
        : typeof p['text'] === 'string'
          ? (p['text'] as string)
          : '';
    if (text.length === 0) return state;
    return applyCanonicalFrame(state, {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    });
  }

  // Legacy `assistant_message_delta` envelope → synthesize canonical text_delta.
  if (frame === 'assistant_message_delta') {
    const text = typeof p['text'] === 'string' ? (p['text'] as string) : '';
    if (text.length === 0) return state;
    return applyCanonicalFrame(state, {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    });
  }

  // Legacy `thinking_event` envelope → synthesize canonical thinking_delta.
  if (frame === 'thinking_event' || frame === 'thinking') {
    const text =
      typeof p['text'] === 'string'
        ? (p['text'] as string)
        : typeof p['thinking'] === 'string'
          ? (p['thinking'] as string)
          : typeof p['delta'] === 'string'
            ? (p['delta'] as string)
            : '';
    if (text.length === 0) return state;
    return applyCanonicalFrame(state, {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: text },
    });
  }

  // Default: forward as-is. The frame type IS the discriminant; the payload
  // object IS the frame body. This preserves the canonical wire shape end
  // to end (UI reducer consumes the SAME frames the api emits).
  return applyCanonicalFrame(state, { type: frame, ...p } as WireFrame);
}
