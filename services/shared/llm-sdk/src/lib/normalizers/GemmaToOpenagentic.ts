/**
 * Gemma → canonical OpenAgentic normalizer.
 *
 * Gemma 3 (Google) has NO native function-calling protocol. When served via
 * AWS Bedrock Converse it just emits raw text deltas. Tool calls leak in a
 * fenced markdown code-block with an OpenAI-style function-call array:
 *
 *   ```tool_calls
 *   [
 *     {
 *       "type": "function",
 *       "function": {
 *         "name": "azure_list_subscriptions",
 *         "arguments": "{}"
 *       }
 *     }
 *   ]
 *   ```
 *
 * Other normalizers (AnthropicShape, Ollama) assume native `tool_use` blocks
 * in their input. If we route Bedrock-Gemma through AnthropicShape, the
 * fenced block bleeds into the assistant body as text and downstream code
 * never sees a `tool_use` content_block — the chat-loop can't dispatch.
 *
 * This normalizer wraps a streaming text source: it watches the text stream
 * for ```` ```tool_calls\n…\n``` ```` fenced blocks, splits them out,
 * JSON-parses the body, and emits canonical `tool_use` content_blocks (one
 * per array entry — Gemma can fan out multiple calls in a single block).
 * Text outside the fence flows through as `text_delta` normally.
 *
 * Also strips Gemma's `<start_of_turn>`/`<end_of_turn>` chat-template tokens
 * if they ever leak (rare — Bedrock typically strips them).
 *
 * Input contract: chunks of the form `{ textDelta: string, done: boolean,
 * finishReason?: string, usage?: {...} }`. The Bedrock-Gemma branch in
 * AWSBedrockProvider.ts normalizes Converse `contentBlockDelta` events into
 * this shape before feeding them here.
 */

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

export interface GemmaChunk {
  /** Token(s) emitted in this stream chunk. May be empty (e.g. trailing usage). */
  textDelta?: string;
  /** Set on the final chunk. */
  done?: boolean;
  /** Provider-native stop reason. Mapped to canonical inside finalize. */
  finishReason?:
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'stop_sequence'
    | 'content_filter'
    | 'safety'
    | 'recitation'
    | string;
  /** Output token count from the final chunk. */
  outputTokens?: number;
  /** Input token count (Bedrock reports on the same final chunk). */
  inputTokens?: number;
}

export interface NormalizerOptions {
  messageId: string;
  model?: string;
  toolIdPrefix?: string;
}

export interface Normalizer {
  consume(chunk: GemmaChunk): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let synthCounter = 0;
function synthesizeToolUseId(prefix: string): string {
  synthCounter += 1;
  return `${prefix}${Date.now().toString(36)}${synthCounter.toString(36)}`;
}

// Gemma chat-template tokens that occasionally leak through Bedrock Converse.
// These are conversation-boundary markers, not part of the model's actual
// content — strip on the fly.
const CHAT_TEMPLATE_RE = /<\/?(?:start|end)_of_turn>(?:user|model|system)?>?/g;

// Real Gemma 3 on Bedrock emits a fenced markdown code-block with
// language tag `tool_calls`. The opener is at the START of a line; the
// closer is a bare ``` on its own line. We match line-anchored for the
// opener (TOOL_OPEN may appear at buf start or after \n) and accept either
// `\n```` or end-of-string as the closer.
const TOOL_OPEN = '```tool_calls';
const TOOL_CLOSE = '```';

function stripChatTemplate(text: string): string {
  return text.replace(CHAT_TEMPLATE_RE, '');
}

function mapFinishReason(reason: string | undefined): CanonicalStopReason {
  switch (reason) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'length':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'content_filter':
      return 'content_filter';
    case 'safety':
      return 'safety';
    case 'recitation':
      return 'recitation';
    default:
      return 'end_turn';
  }
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export function createGemmaToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const model = opts.model ?? 'unknown';
  const toolIdPrefix = opts.toolIdPrefix ?? 'toolu_';

  let messageStarted = false;
  let messageStopped = false;
  let hasToolUse = false;
  let nextBlockIndex = 0;
  let openTextIndex: number | null = null;

  // Streaming `tool_calls` fence extractor state. We can be:
  //  - Outside (default): emit text deltas normally; watch for TOOL_OPEN.
  //  - Inside: buffer body; watch for TOOL_CLOSE → JSON.parse → emit tool_use.
  //
  // The `pendingTail` buffer holds tail characters that COULD be the start of
  // an opening tag boundary across chunk splits (e.g. chunk ends with "```too"
  // and next chunk starts with "l_calls{...}"). We hold up to TOOL_OPEN.length
  // characters before emitting them as text.
  let inToolCall = false;
  let toolBuf = '';
  let pendingTail = '';

  let lastOutputTokens = 0;
  let lastInputTokens = 0;
  let stopReason: CanonicalStopReason = 'end_turn';

  function emitMessageStart(out: CanonicalEvent[]): void {
    if (messageStarted) return;
    messageStarted = true;
    out.push({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  function ensureTextBlock(out: CanonicalEvent[]): number {
    if (openTextIndex !== null) return openTextIndex;
    const idx = nextBlockIndex++;
    openTextIndex = idx;
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'text', text: '' },
    });
    return idx;
  }

  function closeTextBlock(out: CanonicalEvent[]): void {
    if (openTextIndex === null) return;
    out.push({ type: 'content_block_stop', index: openTextIndex });
    openTextIndex = null;
  }

  function emitTextDelta(out: CanonicalEvent[], text: string): void {
    if (!text) return;
    // Rule 8(a) interleave parity: never OPEN a new text block for content
    // that is only whitespace — that is the stray framing newline around a
    // tool-call fence, and a whitespace-only block renders as an empty prose
    // bubble downstream. Whitespace appended to an ALREADY-open prose block is
    // kept (real inter-word/line spacing); only block-creating whitespace is
    // dropped.
    if (openTextIndex === null && text.trim().length === 0) return;
    // Chat-template strip already ran on the combined `pendingTail + chunk`
    // buffer in ingestText, so the text here is already clean. (Re-stripping
    // is harmless but unnecessary.)
    const idx = ensureTextBlock(out);
    out.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'text_delta', text },
    });
  }

  /**
   * Parse Gemma's OpenAI-style function-call array body into 1..N tool_use
   * blocks. Real shape:
   *
   *   [
   *     { "type": "function",
   *       "function": { "name": "...", "arguments": "..." } },
   *     ...
   *   ]
   *
   * `arguments` is a JSON-encoded STRING (the OpenAI-spec wire shape). We
   * inner-parse it; if it's not a string we accept the raw object too
   * (some models drop the spec and emit the obj directly).
   */
  function emitToolUseFromBuffer(out: CanonicalEvent[], body: string): void {
    const trimmed = body.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      emitTextDelta(out, `${TOOL_OPEN}\n${body}\n${TOOL_CLOSE}`);
      return;
    }
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    let emittedAny = false;
    for (const c of calls) {
      if (!c || typeof c !== 'object') continue;
      const fn = (c as { function?: unknown }).function;
      let name: string | null = null;
      let rawArgs: unknown = undefined;
      if (fn && typeof fn === 'object') {
        const fnObj = fn as { name?: unknown; arguments?: unknown };
        if (typeof fnObj.name === 'string') name = fnObj.name;
        rawArgs = fnObj.arguments;
      } else {
        // Some Gemma variants emit `{ "name": ..., "arguments": ... }` flat.
        const flat = c as { name?: unknown; arguments?: unknown };
        if (typeof flat.name === 'string') name = flat.name;
        rawArgs = flat.arguments;
      }
      if (!name) continue;
      let input: Record<string, unknown> = {};
      if (typeof rawArgs === 'string') {
        const s = rawArgs.trim();
        if (s) {
          try {
            const a = JSON.parse(s);
            if (a && typeof a === 'object' && !Array.isArray(a)) {
              input = a as Record<string, unknown>;
            }
          } catch {
            // Bad arguments JSON — keep input={}; the chat-loop will
            // surface the missing-args error to the next turn.
          }
        }
      } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
        input = rawArgs as Record<string, unknown>;
      }

      closeTextBlock(out);
      const idx = nextBlockIndex++;
      const id = synthesizeToolUseId(toolIdPrefix);
      out.push({
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'tool_use', id, name, input },
      });
      out.push({
        type: 'content_block_delta',
        index: idx,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      });
      out.push({ type: 'content_block_stop', index: idx });
      hasToolUse = true;
      emittedAny = true;
    }
    if (!emittedAny) {
      // Couldn't extract any tool calls — surface raw text so the failure
      // is visible (no_confab).
      emitTextDelta(out, `${TOOL_OPEN}\n${body}\n${TOOL_CLOSE}`);
    }
  }

  /**
   * Stream-feed `text` through the tool-call extractor. Handles tag boundaries
   * that span chunk splits via `pendingTail`.
   */
  function ingestText(out: CanonicalEvent[], text: string): void {
    // Strip chat-template tokens on the COMBINED `pendingTail + chunk` slice
    // so a tag that spans a chunk boundary (e.g. chunk-1 ends "...<end_of_"
    // and chunk-2 starts "turn>foo") is still matched as one token.
    let buf = stripChatTemplate(pendingTail + text);
    pendingTail = '';

    while (buf.length > 0) {
      if (!inToolCall) {
        const openIdx = buf.indexOf(TOOL_OPEN);
        if (openIdx === -1) {
          // No opener yet. Find the LONGEST suffix of buf that is a prefix
          // of TOOL_OPEN — hold that as pendingTail; emit the rest as text.
          // Without this, a chunk boundary inside the opener (e.g. chunk
          // ends with "```too") would drop the partial opener into the text
          // stream and the next chunk's "l_calls" would be orphaned.
          let holdLen = 0;
          const maxHold = Math.min(buf.length, TOOL_OPEN.length - 1);
          for (let k = maxHold; k >= 1; k--) {
            if (TOOL_OPEN.startsWith(buf.substring(buf.length - k))) {
              holdLen = k;
              break;
            }
          }
          const emit = holdLen ? buf.substring(0, buf.length - holdLen) : buf;
          if (emit) emitTextDelta(out, emit);
          if (holdLen) pendingTail = buf.substring(buf.length - holdLen);
          return;
        }
        // Found opener.
        if (openIdx > 0) emitTextDelta(out, buf.substring(0, openIdx));
        buf = buf.substring(openIdx + TOOL_OPEN.length);
        inToolCall = true;
        toolBuf = '';
      } else {
        // Append the new chunk to toolBuf then search the COMBINED buffer
        // for TOOL_CLOSE. This is the only way the closer can be found when
        // it spans a chunk boundary (e.g. chunk-N ends "``" and chunk-N+1
        // starts "`"). Searching just `buf` would miss it.
        toolBuf += buf;
        buf = '';
        const closeIdx = toolBuf.indexOf(TOOL_CLOSE);
        if (closeIdx === -1) {
          // Closer not yet in stream. Stay in tool_call; wait for more.
          return;
        }
        const body = toolBuf.substring(0, closeIdx);
        const after = toolBuf.substring(closeIdx + TOOL_CLOSE.length);
        emitToolUseFromBuffer(out, body);
        toolBuf = '';
        inToolCall = false;
        // Continue processing whatever followed the closer.
        buf = after;
      }
    }
  }

  return {
    consume(chunk: GemmaChunk): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;
      // Malformed-chunk resilience: a null/undefined/non-object chunk (a bare
      // `null` keep-alive line, a truncated frame, an empty parse) is a no-op,
      // never a mid-stream crash. finalize() still closes the envelope cleanly.
      if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return out;
      emitMessageStart(out);

      if (chunk.textDelta) ingestText(out, chunk.textDelta);

      if (typeof chunk.outputTokens === 'number') lastOutputTokens = chunk.outputTokens;
      if (typeof chunk.inputTokens === 'number') lastInputTokens = chunk.inputTokens;
      if (chunk.finishReason) stopReason = mapFinishReason(chunk.finishReason);
      if (chunk.done) {
        return [...out, ...this.finalize()];
      }
      return out;
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;
      emitMessageStart(out);

      // Flush any pending tail (was a prefix of TOOL_OPEN but never matched).
      if (pendingTail) {
        emitTextDelta(out, pendingTail);
        pendingTail = '';
      }
      // Unterminated tool_call at EOF — emit the raw text as a fallback so it
      // is visible to the user / chatLoop rescue path rather than dropped.
      if (inToolCall && toolBuf) {
        emitTextDelta(out, `${TOOL_OPEN}${toolBuf}`);
        toolBuf = '';
        inToolCall = false;
      }
      closeTextBlock(out);

      // If we emitted a tool_use, override end_turn → tool_use so the
      // chatLoop dispatches. Mirrors OllamaToOpenagentic G7.
      if (hasToolUse && stopReason === 'end_turn') {
        stopReason = 'tool_use';
      }

      out.push({
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: {
          output_tokens: lastOutputTokens,
          input_tokens: lastInputTokens,
        },
      });
      out.push({ type: 'message_stop' });
      messageStopped = true;
      return out;
    },
  };
}
