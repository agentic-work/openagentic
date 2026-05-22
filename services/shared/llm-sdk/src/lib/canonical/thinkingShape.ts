/**
 * thinkingShape — unified canonical thinking-block conversion helpers.
 *
 * Canonical thinking block: `{ type: 'thinking', thinking: '<text>',
 * signature?: '<base64>' }` — matches the Anthropic Messages API native
 * shape (thinking-block stop-event signature for multi-turn replay).
 *
 * Today the openagentic-api has five different shapes for "where does
 * the thinking text live" across providers, plus per-provider ad-hoc
 * extraction. This module is the SoT every adapter and normalizer pulls
 * from.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *        §"Phase 0.2 — SDK shared canonical invariants"
 *
 * Audit refs:
 *   - F2-8 — Ollama `<think>...</think>` XML legacy (deepseek-r1, qwq).
 *   - L4-3 — Vertex Gemini "thought" parts (parts[i].thought === true).
 *   - L5-2 — Azure OpenAI Chat Completions delta.reasoning_content (gpt-5 / o-).
 *   - L5-3 — Azure AIF Responses API reasoning summary output items.
 */

import type { CanonicalRequestThinkingBlock } from './types.js';

// ---------------------------------------------------------------------------
// OpenAI Chat Completions reasoning_content (Azure OpenAI gpt-5 / o-series)
// ---------------------------------------------------------------------------

/**
 * Pulls `delta.reasoning_content` from an OpenAI Chat Completions streaming
 * chunk. Per MS Learn Azure OpenAI reasoning docs, the field is a string
 * fragment emitted BEFORE `delta.content` on thinking-capable models.
 *
 * Returns null when the field is absent, null, empty, or not a string.
 */
export function extractThinkingFromOpenAIDelta(delta: unknown): string | null {
  if (delta === null || typeof delta !== 'object') return null;
  const rc = (delta as { reasoning_content?: unknown }).reasoning_content;
  if (typeof rc !== 'string' || rc.length === 0) return null;
  return rc;
}

// ---------------------------------------------------------------------------
// Azure AI Foundry Responses API — reasoning output item
// ---------------------------------------------------------------------------

/**
 * Pulls reasoning summary text from an AIF Responses API output item of
 * type `reasoning`:
 *   { type: 'reasoning', id: 'rs_...', summary: [{ type: 'summary_text', text }] }
 *
 * Concatenates every `summary_text` part into a single string. Returns
 * null when the item isn't a reasoning item, the summary is missing /
 * empty, or no summary_text parts exist.
 */
export function extractThinkingFromAIFResponses(event: unknown): string | null {
  if (event === null || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e['type'] !== 'reasoning') return null;
  const summary = e['summary'];
  if (!Array.isArray(summary) || summary.length === 0) return null;
  const texts: string[] = [];
  for (const part of summary) {
    if (part === null || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p['type'] !== 'summary_text') continue;
    const t = p['text'];
    if (typeof t !== 'string' || t.length === 0) continue;
    texts.push(t);
  }
  if (texts.length === 0) return null;
  return texts.join('');
}

// ---------------------------------------------------------------------------
// Vertex Gemini — "thought" parts
// ---------------------------------------------------------------------------

/**
 * Pulls thinking text from a Vertex Gemini content-part. Gemini marks
 * thinking parts with `thought: true` and puts the text in `text`.
 * Returns null when the part isn't a thought part or has no text.
 */
export function extractThinkingFromVertexGemini(part: unknown): string | null {
  if (part === null || typeof part !== 'object') return null;
  const p = part as Record<string, unknown>;
  if (p['thought'] !== true) return null;
  const t = p['text'];
  if (typeof t !== 'string' || t.length === 0) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Ollama — <think>...</think> XML tag extraction
// ---------------------------------------------------------------------------

/**
 * Parses `<think>...</think>` XML tags out of an Ollama NDJSON
 * `message.content` string. Returns the thinking text (concatenated across
 * multiple tag pairs) and the remaining "visible reply" text. Handles the
 * streaming case where a chunk arrives with an opened but not-yet-closed
 * tag — the partial thinking is captured and rest is empty for that chunk.
 *
 * Used by adapters for deepseek-r1 / qwq family Ollama models that emit
 * the legacy XML pattern instead of the native `message.thinking` field
 * (which gpt-oss:20b and modern Ollama use). Audit F2-8.
 */
export function extractThinkingFromOllamaContent(content: string): {
  thinking: string | null;
  rest: string;
} {
  if (content.length === 0) return { thinking: null, rest: '' };

  let thinking = '';
  let rest = '';
  let i = 0;
  const len = content.length;
  let inTag = false;

  while (i < len) {
    if (inTag) {
      const endIdx = content.indexOf('</think>', i);
      if (endIdx >= 0) {
        thinking += content.slice(i, endIdx);
        i = endIdx + '</think>'.length;
        inTag = false;
      } else {
        thinking += content.slice(i);
        i = len;
      }
    } else {
      const startIdx = content.indexOf('<think>', i);
      if (startIdx >= 0) {
        rest += content.slice(i, startIdx);
        i = startIdx + '<think>'.length;
        inTag = true;
      } else {
        rest += content.slice(i);
        i = len;
      }
    }
  }

  return {
    thinking: thinking.length > 0 ? thinking : null,
    rest,
  };
}

/**
 * Streaming-state-aware variant. The single-shot
 * `extractThinkingFromOllamaContent` above takes a complete content
 * string. For Ollama's `/api/chat` streaming, content arrives in many
 * tiny chunks and tags can straddle chunk boundaries — e.g. chunk 1 =
 * "hello <thi", chunk 2 = "nk>part", chunk 3 = "</think>visible".
 *
 * Caller maintains a `StreamingThinkState` across `consume()` invocations
 * (typically inside the OllamaToOpenagentic normalizer closure) and
 * passes it back in on each call. Returns split fragments + updated
 * state. Pending tag-prefix bytes are buffered as `state.pending` so
 * they're not flushed as plain text and lost.
 *
 * On end-of-stream, the caller passes `{ finalize: true }` to drain
 * any buffered `pending` into `rest` (the safest fallback — if the
 * stream really did end with an unfinished tag prefix, the user
 * probably wants to see those bytes as text rather than silently
 * dropping them).
 *
 * F2-8 — used by `OllamaToOpenagentic.consume()` so deepseek-r1 / qwq /
 * any other reasoning model that emits the legacy `<think>` XML pattern
 * (rather than the native `message.thinking` field) routes its
 * reasoning into `content_block_delta(thinking_delta)` events instead
 * of leaking it as `text_delta` in the assistant body.
 */
export interface StreamingThinkState {
  /** True when we're currently inside a <think>...</think> body. */
  inThinkTag: boolean;
  /**
   * Partial tag-prefix bytes carried over from the previous chunk
   * because the chunk ended mid-tag (e.g. "<thi" or "</thin"). Empty
   * when no tag-edge is being tracked.
   */
  pending: string;
}

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Find the longest tag-prefix at the END of `s` (e.g. "...hello <thi"
 * → "<thi"). Returns "" when the trailing bytes aren't a partial-tag
 * prefix.
 */
function trailingTagPrefix(s: string, target: string): string {
  // Search backwards — the tail of `s` of length 1..target.length-1
  // that matches the prefix of `target`.
  const maxLen = Math.min(s.length, target.length - 1);
  for (let len = maxLen; len > 0; len--) {
    const tail = s.slice(s.length - len);
    if (target.startsWith(tail)) return tail;
  }
  return '';
}

export interface StreamingExtractOptions {
  /** When true, flush any buffered pending bytes into `rest` and reset. */
  finalize?: boolean;
}

export function extractThinkingFromOllamaContentStreaming(
  chunk: string,
  prevState: StreamingThinkState,
  opts: StreamingExtractOptions = {},
): { thinking: string; rest: string; state: StreamingThinkState } {
  // Prepend any buffered partial-tag bytes from the previous chunk.
  const buf = prevState.pending + chunk;
  let inTag = prevState.inThinkTag;
  let thinking = '';
  let rest = '';
  let i = 0;

  while (i < buf.length) {
    if (inTag) {
      const closeIdx = buf.indexOf(CLOSE_TAG, i);
      if (closeIdx >= 0) {
        thinking += buf.slice(i, closeIdx);
        i = closeIdx + CLOSE_TAG.length;
        inTag = false;
      } else {
        // No complete close tag — check for a partial close at the tail.
        const remaining = buf.slice(i);
        const tail = trailingTagPrefix(remaining, CLOSE_TAG);
        if (tail.length > 0 && !opts.finalize) {
          // Buffer the partial close tag for next chunk.
          thinking += remaining.slice(0, remaining.length - tail.length);
          return { thinking, rest, state: { inThinkTag: true, pending: tail } };
        }
        // Either no partial tail OR finalizing: flush everything to thinking.
        thinking += remaining;
        i = buf.length;
      }
    } else {
      const openIdx = buf.indexOf(OPEN_TAG, i);
      if (openIdx >= 0) {
        rest += buf.slice(i, openIdx);
        i = openIdx + OPEN_TAG.length;
        inTag = true;
      } else {
        // No complete open tag — check for a partial open at the tail.
        const remaining = buf.slice(i);
        const tail = trailingTagPrefix(remaining, OPEN_TAG);
        if (tail.length > 0 && !opts.finalize) {
          rest += remaining.slice(0, remaining.length - tail.length);
          return { thinking, rest, state: { inThinkTag: false, pending: tail } };
        }
        // Either no partial tail OR finalizing: flush everything to rest.
        rest += remaining;
        i = buf.length;
      }
    }
  }

  return { thinking, rest, state: { inThinkTag: inTag, pending: '' } };
}

// ---------------------------------------------------------------------------
// Canonical thinking block constructor
// ---------------------------------------------------------------------------

/**
 * Wraps a thinking text fragment into the canonical block shape. Optional
 * `signature` (Anthropic encrypts the thinking trace into an opaque base64
 * string for multi-turn replay; other providers don't emit signatures).
 */
export function wrapAsCanonicalThinking(
  text: string,
  signature?: string,
): CanonicalRequestThinkingBlock {
  if (signature !== undefined) {
    return { type: 'thinking', thinking: text, signature };
  }
  return { type: 'thinking', thinking: text };
}
