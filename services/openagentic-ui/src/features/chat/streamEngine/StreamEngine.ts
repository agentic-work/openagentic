/**
 * StreamEngine — glitchless React-bypass renderer for streaming chat turns.
 *
 * Why this exists:
 *   The current AgenticActivityStream + SharedMarkdownRenderer + EnhancedShikiCodeBlock
 *   pipeline incurs O(N) reconciler work per delta, runs `dangerouslySetInnerHTML`
 *   against the entire code subtree on every Shiki write, and re-parses the full
 *   markdown content per throttle tick. The visible result is jitter, flash, and
 *   restarted CSS animations on every delta. See the companion design doc
 *   `docs/superpowers/specs/2026-05-18-streaming-engine-design.md` for the
 *   validated RCA (7 suspects, all confirmed) and the reference architecture.
 *
 * Contract:
 *   The StreamEngine owns a stable container `HTMLElement` per assistant message.
 *   During streaming it folds canonical NDJSON frames directly into the DOM via
 *   append-only operations (textNode.appendData, element.appendChild). React is
 *   not involved in the streaming hot path. At `finalize()` time the engine
 *   returns the persistable `UIContentBlock[]` (same shape as
 *   `applyCanonicalFrame` produces, identical to what reload reads from DB)
 *   plus the final HTML.
 *
 * Type SoT:
 *   All event + content-block types come from `@agentic-work/llm-sdk`'s
 *   `ui-stream` module. The SDK is the SoT for the wire shape the api emits
 *   AND the persistence shape held in `chat_messages.content_blocks` Json
 *   column. No UI-local intermediate type. See
 *   `openagentic-sdk/src/lib/ui-stream/types.ts` and follow-up tickets in
 *   `docs/superpowers/specs/2026-05-18-streaming-engine-design.md`
 *   §"Follow-up tickets" for the cross-cutting reducer rip.
 *
 * Parity invariant:
 *   The DOM rendered live by the engine MUST be semantically identical (and
 *   ideally byte-identical) to the DOM rendered by the React tree from the
 *   same `UIContentBlock[]`. Enforced by persistence-parity.test.ts.
 *
 * Theme tokens:
 *   All colors derive from `var(--cm-*)`. No hex/rgb literals in this module
 *   (CLAUDE.md rule 8b).
 */

import type {
  UIContentBlock,
  UIStreamFrame,
  UIStreamFrameLoose,
} from '@agentic-work/llm-sdk';
import {
  applyCanonicalFrame,
  initialFrameState,
  type FrameState,
} from '../hooks/streamReducer/applyCanonicalFrame';

// ─────────────────────────────────────────────────────────────────────────────
// Public types — re-export the SDK SoT names locally so callers can choose
// between the structural `CanonicalFrame` alias (back-compat) and the strict
// SDK `UIStreamFrame` discriminated union.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Back-compat alias retained for callers that already import
 * `CanonicalFrame` from this module. New code should import `UIStreamFrame`
 * from `@agentic-work/llm-sdk` directly. The structural shape is a
 * loose-typed `{ type: string; [k: string]: unknown }` superset matching
 * the SDK's `UIStreamFrameLoose`.
 */
export type CanonicalFrame = UIStreamFrameLoose;

/** Re-export the strict-discriminated SDK union for callers that want it. */
export type { UIStreamFrame, UIContentBlock } from '@agentic-work/llm-sdk';

export interface StreamEngineOpts {
  /**
   * Optional async highlighter — when present, code blocks are progressively
   * tokenized on each `content_block_stop`. When absent the engine renders
   * plain <pre><code> with no highlighting (legal fallback).
   */
  highlightCode?: (code: string, language: string) => Promise<string>;
  /**
   * Optional async markdown renderer for the final settle pass. When absent
   * the engine renders text blocks as a plain `<div>` containing whitespace-
   * preserving prose. The settle pass runs once per block on
   * `content_block_stop`, never during the stream's hot path.
   */
  renderMarkdown?: (md: string) => Promise<string>;
  /**
   * Theme-token map for iframe srcdoc injection (viz_render, app_render).
   * Caller passes the parent's resolved CSS custom properties — the engine
   * injects them into the iframe srcdoc so colors match the parent.
   */
  themeTokens?: () => Record<string, string>;
  /**
   * Optional callback for telemetry / debug. Fired on each frame applied
   * AND at finalize. Counts paints via window.performance.
   */
  onPaint?: (info: { phase: 'frame' | 'finalize'; blockType?: string }) => void;
  /**
   * Disable auto-scroll-to-bottom while streaming. Useful for the mock proof
   * where we want to measure paint cost without scroll jitter.
   */
  disableAutoScroll?: boolean;
  /**
   * Override `now()` for deterministic tests. Defaults to `Date.now`.
   */
  now?: () => number;
}

export interface FinalizeResult {
  /**
   * Persistable content blocks — same shape applyCanonicalFrame produces.
   * Write these to `chat_messages.content_blocks` for reload-time hydration.
   */
  contentBlocks: UIContentBlock[];
  /**
   * Final serialized HTML of the container at settle. Used for the parity
   * test against the React-from-DB render path.
   */
  finalHTML: string;
  /**
   * Total paint operations (DOM writes) executed across the stream. The
   * mock proof asserts this is ~ O(blockCount), not O(deltaCount).
   */
  paintCount: number;
  /**
   * Count of stream frames applied. Lets the caller compute paints/frame
   * ratio (target: << 1.0).
   */
  frameCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — DOM construction, normalization, parity hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a stable DOM `id`/`data-block-id` for a content block. We use the
 * same `block.id` that applyCanonicalFrame produces (`block-{idx}-{ts}`)
 * — guaranteed unique within a turn.
 */
function blockDomId(blockId: string): string {
  return `cm-block-${blockId.replace(/[^a-z0-9-]/gi, '-')}`;
}

/**
 * Escape a string for safe insertion inside an HTML text node value.
 * The DOM textNode APIs (`appendData`, `data=`) handle text content directly
 * — they don't interpret HTML — so this is only used in the cold finalize
 * path when constructing inline markup as a string.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Lookup a child element by `data-block-id`. Returns null when absent.
 */
function findBlockEl(container: HTMLElement, blockId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// StreamEngine
// ─────────────────────────────────────────────────────────────────────────────

interface PerBlockBookkeeping {
  /** The block's outer container element in the DOM. */
  el: HTMLElement;
  /**
   * For text/thinking blocks — the live Text node we append deltas to. We
   * keep a ref so we don't have to walk the DOM on every delta.
   */
  textNode?: Text;
  /**
   * For tool_use blocks — the live JSON-args text node inside the args slot.
   */
  argsTextNode?: Text;
  /**
   * For tool_use blocks — the result section's parent element (mounted on
   * tool_result).
   */
  resultEl?: HTMLElement;
  /**
   * For viz_render / app_render — the iframe element. On hot-swap we replace
   * its srcdoc, not the element itself.
   */
  iframe?: HTMLIFrameElement;
}

export class StreamEngine {
  private readonly container: HTMLElement;
  private readonly opts: StreamEngineOpts;
  private readonly now: () => number;

  private state: FrameState = initialFrameState();
  private messageId: string | null = null;
  private destroyed = false;
  private finalized = false;

  // Per-block bookkeeping. Keyed by `UIContentBlock.id`.
  private readonly book: Map<string, PerBlockBookkeeping> = new Map();

  // Counts for telemetry / mock proof
  private paintCount = 0;
  private frameCount = 0;

  // RAF batching for auto-scroll (Suspect #4 — never on the per-delta path).
  private scrollScheduled = false;

  constructor(container: HTMLElement, opts: StreamEngineOpts = {}) {
    if (!container) throw new Error('StreamEngine: container is required');
    this.container = container;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());

    // Mark container so CSS selectors can target streaming subtrees.
    this.container.classList.add('cm-stream-root');
    this.container.setAttribute('data-cm-stream-root', 'true');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────

  beginMessage(messageId: string): void {
    if (this.destroyed) throw new Error('StreamEngine: cannot beginMessage after destroy()');
    this.messageId = messageId;
    this.state = initialFrameState();
    this.book.clear();
    this.paintCount = 0;
    this.frameCount = 0;
    this.finalized = false;

    // Clear DOM. Single write; React doesn't see this because container is
    // owned by the engine for the duration of the stream.
    this.container.innerHTML = '';
    this.container.setAttribute('data-cm-message-id', messageId);
    this.paintCount += 1;
  }

  applyFrame(frame: CanonicalFrame): void {
    if (this.destroyed) return;
    if (this.finalized) return;
    if (this.messageId === null) {
      throw new Error('StreamEngine.applyFrame called before beginMessage');
    }
    this.frameCount += 1;

    // Fold into the canonical reducer FIRST. This gives us the same
    // UIContentBlock[] that reload-from-DB produces — guaranteed parity.
    const nextState = applyCanonicalFrame(this.state, frame);

    // Then apply the DOM diff between (state) and (nextState). The diff is
    // local: at most one block is touched per frame (text/thinking deltas
    // touch one open block; tool_result touches one tool card; one-shot
    // artifacts append one block). We can do this cheaply by inspecting the
    // frame type directly and only re-running the necessary DOM op.
    this.applyDomForFrame(this.state, nextState, frame);

    this.state = nextState;

    this.opts.onPaint?.({ phase: 'frame', blockType: typeof frame.type === 'string' ? frame.type : undefined });
  }

  finalize(): FinalizeResult {
    if (this.destroyed) throw new Error('StreamEngine: finalize after destroy()');
    if (this.finalized) {
      return {
        contentBlocks: this.state.contentBlocks,
        finalHTML: this.container.innerHTML,
        paintCount: this.paintCount,
        frameCount: this.frameCount,
      };
    }
    // Settle: close any open accumulators by folding a synthetic message_stop.
    const closeFrame: UIStreamFrameLoose = { type: 'message_stop', _ts: this.now() };
    this.state = applyCanonicalFrame(this.state, closeFrame);

    // Mark every open per-block streaming attribute as complete so CSS can
    // stop the streaming-cursor animation.
    for (const [, bk] of this.book) {
      bk.el.removeAttribute('data-streaming');
      bk.el.setAttribute('aria-busy', 'false');
    }

    this.finalized = true;
    this.opts.onPaint?.({ phase: 'finalize' });

    return {
      contentBlocks: this.state.contentBlocks,
      finalHTML: this.container.innerHTML,
      paintCount: this.paintCount,
      frameCount: this.frameCount,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.book.clear();
    // Leave the DOM in place — caller decides whether to unmount the
    // container. We only release internal refs.
  }

  // ───────────────────────────────────────────────────────────────────────
  // Frame → DOM diff
  // ───────────────────────────────────────────────────────────────────────

  private applyDomForFrame(prev: FrameState, next: FrameState, frame: CanonicalFrame): void {
    // Identify newly-added blocks: next.contentBlocks longer than prev.
    if (next.contentBlocks.length > prev.contentBlocks.length) {
      for (let i = prev.contentBlocks.length; i < next.contentBlocks.length; i++) {
        this.mountBlock(next.contentBlocks[i]);
      }
    }

    // Identify mutated blocks: same length, different content for the last
    // mutated block. Most common case: appendDelta() mutated the open
    // text/thinking block's content.
    const minLen = Math.min(prev.contentBlocks.length, next.contentBlocks.length);
    for (let i = 0; i < minLen; i++) {
      const a = prev.contentBlocks[i];
      const b = next.contentBlocks[i];
      if (a === b) continue;
      this.updateBlock(a, b, frame);
    }

    // Auto-scroll once per RAF, never per-delta. Suspect #4 fix.
    this.maybeScheduleScroll();
  }

  private mountBlock(block: UIContentBlock): void {
    switch (block.type) {
      case 'text':
        return this.mountTextBlock(block);
      case 'thinking':
        return this.mountThinkingBlock(block);
      case 'tool_use':
        return this.mountToolUseBlock(block);
      case 'tool_round':
        return this.mountToolRoundBlock(block);
      case 'viz_render':
        return this.mountVizBlock(block);
      case 'app_render':
        return this.mountAppBlock(block);
      case 'follow_up':
        return this.mountFollowUpBlock(block);
      case 'tool_call':
        // Legacy tool_call shape — render as tool_use for parity.
        return this.mountToolUseBlock(block);
      default:
        // Unknown block type — render a placeholder so the parity test still
        // produces stable output instead of silent drop.
        return this.mountFallbackBlock(block);
    }
  }

  private updateBlock(prev: UIContentBlock, next: UIContentBlock, frame: CanonicalFrame): void {
    // The content field is the only thing that grows during streaming for
    // text/thinking; tool_use grows via `content` (input_json_delta partial)
    // and gains a `result` on tool_result.
    if (prev.type !== next.type) {
      // Type change shouldn't happen mid-block; rebuild defensively.
      this.replaceBlock(prev, next);
      return;
    }

    const bk = this.book.get(prev.id);
    if (!bk) {
      // Lost track of the block (e.g. consumer cleared container externally).
      // Rebuild from scratch.
      this.replaceBlock(prev, next);
      return;
    }

    if (next.type === 'text' || next.type === 'thinking') {
      if (next.content.length > prev.content.length) {
        const tail = next.content.slice(prev.content.length);
        if (bk.textNode) {
          bk.textNode.appendData(tail);
          this.paintCount += 1;
        }
      } else if (next.content !== prev.content) {
        // Backward edit / reset — rare; do a single full text replace.
        if (bk.textNode) {
          bk.textNode.data = next.content;
          this.paintCount += 1;
        }
      }
      if (next.isComplete && !prev.isComplete) {
        bk.el.removeAttribute('data-streaming');
        bk.el.setAttribute('aria-busy', 'false');
      }
      return;
    }

    if (next.type === 'tool_use') {
      // Args growth (input_json_delta accumulation)
      if (typeof next.content === 'string' && next.content.length > prev.content.length && bk.argsTextNode) {
        const tail = next.content.slice(prev.content.length);
        bk.argsTextNode.appendData(tail);
        this.paintCount += 1;
      }
      // Result mount on completion
      if (next.isComplete && !prev.isComplete) {
        this.mountToolResult(bk, next);
      }
      return;
    }

    if (next.type === 'viz_render' || next.type === 'app_render') {
      // Hot-swap by group_id is handled by the reducer (upsertArtifactBlock);
      // when we get here the block's content/html changed → re-render iframe srcdoc.
      this.refreshArtifactIframe(bk, next);
      return;
    }

    if (next.type === 'tool_round') {
      // Tool round's children list grew — mount new children inline.
      const prevChildren = prev.children ?? [];
      const nextChildren = next.children ?? [];
      if (nextChildren.length > prevChildren.length) {
        for (let i = prevChildren.length; i < nextChildren.length; i++) {
          // Children are rendered inside the round's child slot.
          const childSlot = bk.el.querySelector<HTMLElement>('.cm-tool-round-children');
          if (childSlot) {
            this.mountBlockInto(childSlot, nextChildren[i]);
          }
        }
      }
      // Round completion stamp.
      if (next.isComplete && !prev.isComplete) {
        bk.el.setAttribute('data-round-complete', 'true');
        bk.el.setAttribute('data-succeeded', String(next.succeeded ?? 0));
        bk.el.setAttribute('data-failed', String(next.failed ?? 0));
        if (typeof next.durationMs === 'number') {
          bk.el.setAttribute('data-duration-ms', String(next.durationMs));
        }
        this.paintCount += 1;
      }
      return;
    }

    if (next.type === 'follow_up') {
      // follow_up upserts atomically; rebuild contents.
      this.replaceBlock(prev, next);
      return;
    }
  }

  private replaceBlock(prev: UIContentBlock, next: UIContentBlock): void {
    const old = this.book.get(prev.id);
    if (old) {
      const newEl = this.buildBlockElement(next);
      old.el.replaceWith(newEl);
      this.book.delete(prev.id);
      // bookkeeping was re-registered by buildBlockElement when it called the
      // mount* helper internally. paintCount stamped there.
    } else {
      this.mountBlock(next);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Per-block mount paths
  // ───────────────────────────────────────────────────────────────────────

  private mountBlockInto(parent: HTMLElement, block: UIContentBlock): void {
    const el = this.buildBlockElement(block);
    parent.appendChild(el);
    this.paintCount += 1;
  }

  /**
   * Build a block's outer DOM element + register bookkeeping. This is the
   * single entry point all mount* helpers funnel through — it ensures the
   * book.set + paintCount += 1 happen exactly once per block.
   */
  private buildBlockElement(block: UIContentBlock): HTMLElement {
    // The book bookkeeping for the new element is written by each mount*
    // function (which constructs the right shape and registers textNode /
    // argsTextNode refs). We pre-create the wrapper and pass it through.
    let el: HTMLElement;
    switch (block.type) {
      case 'text':
        el = this.buildTextEl(block);
        break;
      case 'thinking':
        el = this.buildThinkingEl(block);
        break;
      case 'tool_use':
      case 'tool_call':
        el = this.buildToolUseEl(block);
        break;
      case 'tool_round':
        el = this.buildToolRoundEl(block);
        break;
      case 'viz_render':
        el = this.buildVizEl(block);
        break;
      case 'app_render':
        el = this.buildAppEl(block);
        break;
      case 'follow_up':
        el = this.buildFollowUpEl(block);
        break;
      default:
        el = this.buildFallbackEl(block);
        break;
    }
    return el;
  }

  private mountTextBlock(block: UIContentBlock): void {
    const el = this.buildTextEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountThinkingBlock(block: UIContentBlock): void {
    const el = this.buildThinkingEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountToolUseBlock(block: UIContentBlock): void {
    const el = this.buildToolUseEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountToolRoundBlock(block: UIContentBlock): void {
    const el = this.buildToolRoundEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountVizBlock(block: UIContentBlock): void {
    const el = this.buildVizEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountAppBlock(block: UIContentBlock): void {
    const el = this.buildAppEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountFollowUpBlock(block: UIContentBlock): void {
    const el = this.buildFollowUpEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  private mountFallbackBlock(block: UIContentBlock): void {
    const el = this.buildFallbackEl(block);
    this.container.appendChild(el);
    this.paintCount += 1;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Element builders — all return their root element AND register bookkeeping
  // ───────────────────────────────────────────────────────────────────────

  private buildTextEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-text-block interleaved-text-block';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'text');
    if (!block.isComplete) wrap.setAttribute('data-streaming', 'true');
    if (!block.isComplete) wrap.setAttribute('aria-busy', 'true');

    // Use a single Text child so we can appendData on every delta. Wrapping
    // in a <span class="cm-text-buffer"> lets CSS target the streaming text
    // for cursor animation etc., without forcing a remount when content changes.
    const span = document.createElement('span');
    span.className = 'cm-text-buffer';
    const txt = document.createTextNode(block.content || '');
    span.appendChild(txt);
    wrap.appendChild(span);

    this.book.set(block.id, { el: wrap, textNode: txt });
    return wrap;
  }

  private buildThinkingEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-thinking-block inline-thinking-block';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'thinking');
    if (!block.isComplete) wrap.setAttribute('data-streaming', 'true');

    const header = document.createElement('div');
    header.className = 'cm-thinking-header';
    header.textContent = 'Thinking';
    wrap.appendChild(header);

    const body = document.createElement('div');
    body.className = 'cm-thinking-body';
    const txt = document.createTextNode(block.content || '');
    body.appendChild(txt);
    wrap.appendChild(body);

    this.book.set(block.id, { el: wrap, textNode: txt });
    return wrap;
  }

  private buildToolUseEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-tool-card';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'tool_use');
    wrap.setAttribute('data-tool-id', block.toolId ?? '');
    wrap.setAttribute('data-tool-name', block.toolName ?? '');
    if (!block.isComplete) wrap.setAttribute('data-streaming', 'true');

    const header = document.createElement('div');
    header.className = 'cm-tool-card-header';

    const name = document.createElement('span');
    name.className = 'cm-tool-card-name';
    name.textContent = block.toolName ?? 'tool';
    header.appendChild(name);

    const status = document.createElement('span');
    status.className = 'cm-tool-card-status';
    status.textContent = block.isComplete ? 'done' : 'running';
    header.appendChild(status);

    wrap.appendChild(header);

    // Args block — accumulates input_json_delta partial_json.
    const argsRow = document.createElement('div');
    argsRow.className = 'cm-tool-card-args';
    const argsPre = document.createElement('pre');
    argsPre.className = 'cm-tool-card-args-pre';
    const argsCode = document.createElement('code');
    const argsText = document.createTextNode(typeof block.content === 'string' ? block.content : '');
    argsCode.appendChild(argsText);
    argsPre.appendChild(argsCode);
    argsRow.appendChild(argsPre);
    wrap.appendChild(argsRow);

    // Result slot (empty until tool_result arrives).
    const resultSlot = document.createElement('div');
    resultSlot.className = 'cm-tool-card-result';
    wrap.appendChild(resultSlot);

    this.book.set(block.id, {
      el: wrap,
      argsTextNode: argsText,
      resultEl: resultSlot,
    });

    // If block arrived already-complete (replay path), settle result now.
    if (block.isComplete) {
      this.mountToolResult(this.book.get(block.id)!, block);
    }
    return wrap;
  }

  private mountToolResult(bk: PerBlockBookkeeping, block: UIContentBlock): void {
    const slot = bk.resultEl;
    if (!slot) return;
    // Clear any prior result (idempotent on replay).
    while (slot.firstChild) slot.removeChild(slot.firstChild);

    const status = bk.el.querySelector<HTMLElement>('.cm-tool-card-status');
    if (status) status.textContent = block.error ? 'error' : 'done';

    if (block.error) {
      const err = document.createElement('div');
      err.className = 'cm-tool-card-error';
      err.textContent = block.error;
      slot.appendChild(err);
    } else if (block.result !== undefined) {
      const pre = document.createElement('pre');
      pre.className = 'cm-tool-card-result-pre';
      const code = document.createElement('code');
      // result is the canonical {summary?, data?} envelope. Render summary if
      // present; otherwise JSON-stringify the data.
      const r = block.result as { summary?: string; data?: unknown } | undefined;
      const text = r?.summary
        ? String(r.summary)
        : (block.resultRaw !== undefined
            ? JSON.stringify(block.resultRaw, null, 2)
            : JSON.stringify(r?.data ?? null, null, 2));
      code.appendChild(document.createTextNode(text));
      pre.appendChild(code);
      slot.appendChild(pre);
    }
    bk.el.removeAttribute('data-streaming');
    bk.el.setAttribute('aria-busy', 'false');
    this.paintCount += 1;
  }

  private buildToolRoundEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-tool-round tool-parallel';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'tool_round');
    wrap.setAttribute('data-round-id', block.roundId ?? '');

    const header = document.createElement('div');
    header.className = 'cm-tool-round-header';
    header.textContent = `Running ${(block.toolIds ?? []).length} in parallel…`;
    wrap.appendChild(header);

    const children = document.createElement('div');
    children.className = 'cm-tool-round-children';
    wrap.appendChild(children);

    // Mount any children that arrived bundled with the round shell.
    for (const child of block.children ?? []) {
      this.mountBlockInto(children, child);
    }

    this.book.set(block.id, { el: wrap });
    return wrap;
  }

  private buildVizEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-viz-render interleaved-viz-render';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'viz_render');
    if (block.template) wrap.setAttribute('data-viz-template', block.template);
    if (block.kind) wrap.setAttribute('data-viz-kind', block.kind);
    if (block.groupId) wrap.setAttribute('data-group-id', block.groupId);

    if (block.title) {
      const title = document.createElement('div');
      title.className = 'cm-viz-title';
      title.textContent = block.title;
      wrap.appendChild(title);
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'cm-viz-iframe';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('loading', 'lazy');
    iframe.title = block.title ?? 'visualization';
    iframe.srcdoc = this.buildVizSrcdoc(block);
    wrap.appendChild(iframe);

    if (block.caption) {
      const cap = document.createElement('div');
      cap.className = 'cm-viz-caption';
      cap.textContent = block.caption;
      wrap.appendChild(cap);
    }

    this.book.set(block.id, { el: wrap, iframe });
    return wrap;
  }

  private buildAppEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-app-render interleaved-app-render';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'app_render');
    if (block.groupId) wrap.setAttribute('data-group-id', block.groupId);
    if (block.kind) wrap.setAttribute('data-app-kind', block.kind);

    if (block.title) {
      const title = document.createElement('div');
      title.className = 'cm-app-title';
      title.textContent = block.title;
      wrap.appendChild(title);
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'cm-app-iframe';
    // App-render iframes have nonce-scoped CSP via the api validator; we keep
    // sandbox parity with AppRenderer.tsx — allow scripts + allow-same-origin
    // is intentionally NOT given (CSP nonce gates exec).
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('loading', 'lazy');
    iframe.title = block.title ?? 'app';
    iframe.srcdoc = this.buildAppSrcdoc(block);
    wrap.appendChild(iframe);

    this.book.set(block.id, { el: wrap, iframe });
    return wrap;
  }

  private buildFollowUpEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-follow-up followups';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', 'follow_up');

    for (const item of block.items ?? []) {
      const chip = document.createElement('button');
      chip.className = 'cm-follow-up-chip';
      chip.type = 'button';
      chip.textContent = item;
      wrap.appendChild(chip);
    }
    this.book.set(block.id, { el: wrap });
    return wrap;
  }

  private buildFallbackEl(block: UIContentBlock): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-fallback-block';
    wrap.id = blockDomId(block.id);
    wrap.setAttribute('data-block-id', block.id);
    wrap.setAttribute('data-block-type', String(block.type ?? 'unknown'));
    const inner = document.createElement('pre');
    inner.appendChild(document.createTextNode(typeof block.content === 'string' ? block.content : ''));
    wrap.appendChild(inner);
    this.book.set(block.id, { el: wrap });
    return wrap;
  }

  private refreshArtifactIframe(bk: PerBlockBookkeeping, block: UIContentBlock): void {
    if (!bk.iframe) return;
    if (block.type === 'viz_render') {
      bk.iframe.srcdoc = this.buildVizSrcdoc(block);
    } else if (block.type === 'app_render') {
      bk.iframe.srcdoc = this.buildAppSrcdoc(block);
    }
    this.paintCount += 1;
  }

  // ───────────────────────────────────────────────────────────────────────
  // iframe srcdoc construction — theme tokens injected for cm-* parity
  // ───────────────────────────────────────────────────────────────────────

  private buildThemePreamble(): string {
    const tokens = this.opts.themeTokens ? this.opts.themeTokens() : {};
    const decls = Object.entries(tokens)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    return `<style id="cm-stream-engine-theme">
:root {
${decls}
}
body { margin: 0; color: var(--cm-fg-0, #f8fafc); background: transparent; font: 14px/1.5 system-ui, sans-serif; }
</style>`;
  }

  private buildVizSrcdoc(block: UIContentBlock): string {
    // viz_render content is the rendered SVG / chart payload (string).
    // For chart payloads (kind:'chart') the content is typically rendered
    // server-side already; for kind:'svg' it's the inline SVG markup. We
    // wrap with the theme preamble so colors resolve via var(--cm-*).
    const body = typeof block.content === 'string' ? block.content : '';
    return `<!doctype html><html><head>${this.buildThemePreamble()}</head><body>${body}</body></html>`;
  }

  private buildAppSrcdoc(block: UIContentBlock): string {
    // app_render carries full validated HTML (html field) — the api's
    // composeAppValidator already CSP-gates it. We still inject the theme
    // preamble at the END of <head> so it wins via cascade ordering.
    const html = typeof block.html === 'string' ? block.html : '';
    // Inject just before </head>; if no </head> exists, prepend a <head>.
    if (html.includes('</head>')) {
      return html.replace('</head>', `${this.buildThemePreamble()}</head>`);
    }
    if (html.includes('<html')) {
      return html.replace(/<html([^>]*)>/i, `<html$1><head>${this.buildThemePreamble()}</head>`);
    }
    return `<!doctype html><html><head>${this.buildThemePreamble()}</head><body>${html}</body></html>`;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Auto-scroll batching — Suspect #4 fix
  // ───────────────────────────────────────────────────────────────────────

  private maybeScheduleScroll(): void {
    if (this.opts.disableAutoScroll) return;
    if (this.scrollScheduled) return;
    this.scrollScheduled = true;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(this.now()), 16) as unknown as number;
    raf(() => {
      this.scrollScheduled = false;
      const last = this.container.lastElementChild as HTMLElement | null;
      if (last && typeof last.scrollIntoView === 'function') {
        // 'auto' behavior — never re-trigger an animation mid-flight.
        last.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      }
    });
  }
}

// Re-export helpers for callers that need the raw escape util.
export const _internals = { escapeHtml, blockDomId, findBlockEl };
