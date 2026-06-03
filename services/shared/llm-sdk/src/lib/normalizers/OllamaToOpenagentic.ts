/**
 * OllamaToOpenagenticNormalizer — translate Ollama's native chat NDJSON stream
 * into the canonical OpenAgentic Messages SSE event union.
 *
 * Ollama chat NDJSON shape (per Ollama API docs):
 *   { model, created_at, message: { role, content, thinking?, tool_calls? }, done, done_reason? }
 *
 * Key transforms:
 *   - message.content fragment → content_block_delta(text_delta)
 *   - message.thinking fragment → content_block_delta(thinking_delta) inside a thinking block
 *   - message.tool_calls[] → one tool_use block per call. arguments is a parsed
 *     OBJECT (not a streaming string), so we JSON.stringify() once and emit a
 *     single input_json_delta.
 *   - done_reason maps to canonical stop_reason:
 *       'stop'       → 'end_turn'
 *       'length'     → 'max_tokens'
 *       'tool_calls' → 'tool_use'
 *       'load'       → 'end_turn'  (no-op load result)
 *
 * Pure state machine. No network, no provider deps.
 *
 * Reference architecture: Claude Code's accumulator at
 *   ~/anthropic/src/services/api/claude.ts:1997-2111
 *
 * Companion normalizer: OpenAIToOpenagentic.ts (Azure OpenAI / OpenAI-direct).
 */

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';
import {
  extractThinkingFromOllamaContentStreaming,
  type StreamingThinkState,
} from '../canonical/thinkingShape.js';
export type { CanonicalEvent } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// Ollama input shape (only fields we read)
// ---------------------------------------------------------------------------

export interface OllamaToolCall {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    /**
     * Per Ollama API spec this is a parsed JSON object (not a streaming
     * string). In practice some small models (gpt-oss:20b) occasionally
     * emit a STRING that may or may not be valid JSON — we accept both
     * shapes and B4-tag any string that fails JSON.parse so downstream
     * can short-circuit to a synthetic tool_result with is_error:true.
     */
    arguments?: Record<string, unknown> | string;
  };
}

export interface OllamaMessage {
  role?: 'assistant' | 'user' | 'system' | 'tool';
  content?: string;
  thinking?: string;
  tool_calls?: OllamaToolCall[];
}

export interface OllamaChunk {
  model?: string;
  created_at?: string;
  message?: OllamaMessage;
  done?: boolean;
  done_reason?: 'stop' | 'length' | 'tool_calls' | 'load' | string;
  // Token counts arrive on the final `done:true` chunk per Ollama API spec.
  // The normalizer captures them and surfaces on canonical message_delta.usage.
  prompt_eval_count?: number;
  eval_count?: number;
  // Other fields (total_duration, load_duration, eval_duration) ignored.
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

interface BlockState {
  index: number;
  type: 'text' | 'thinking' | 'tool_use';
  closed?: boolean;
}

export interface NormalizerOptions {
  messageId: string;
  model?: string;
  /** Override the synthesized tool_use id prefix. Defaults to `toolu_`. */
  toolIdPrefix?: string;
}

export interface Normalizer {
  consume(chunk: OllamaChunk): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

let synthCounter = 0;
function synthesizeToolUseId(prefix: string): string {
  synthCounter += 1;
  // Match the canonical id format (toolu_*) so downstream code paths
  // that look for `toolu_` prefixes; rest is opaque.
  return `${prefix}${Date.now().toString(36)}${synthCounter.toString(36)}`;
}

export function createOllamaToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const model = opts.model ?? 'unknown';
  const toolIdPrefix = opts.toolIdPrefix ?? 'toolu_';

  let messageStarted = false;
  let messageStopped = false;
  let stopReason: CanonicalStopReason = 'end_turn';
  let stopReasonSet = false;
  // G7 — Ollama gpt-oss:20b emits `done_reason:"stop"` on the same final
  // chunk that carries tool_calls[]. If we let applyDoneReason('stop')
  // overwrite to end_turn, the chat-loop never dispatches the tool. Track
  // whether a tool_use block was emitted on this turn so the finalize
  // reason can override.
  let hasToolUse = false;
  // G1 — capture token counts from the final `done:true` chunk.
  let lastPromptEvalCount: number | undefined;
  let lastEvalCount: number | undefined;
  // F2-8 — chunk-aware <think>...</think> extractor state. Used to route
  // legacy-XML reasoning content (deepseek-r1 / qwq / sometimes gpt-oss)
  // from message.content into thinking_delta events instead of letting
  // the reasoning leak into the assistant body as text_delta.
  let thinkState: StreamingThinkState = { inThinkTag: false, pending: '' };

  const blocks: Map<number, BlockState> = new Map();
  let nextBlockIndex = 0;

  // The currently open non-tool block (text or thinking). Tool blocks are
  // ephemeral — opened, deltad, and closed within a single iteration.
  let openTextOrThinkingIndex: number | null = null;
  let openTextOrThinkingType: 'text' | 'thinking' | null = null;

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

  function closeOpenTextOrThinking(out: CanonicalEvent[]): void {
    if (openTextOrThinkingIndex === null) return;
    const idx = openTextOrThinkingIndex;
    const block = blocks.get(idx);
    if (block && !block.closed) {
      block.closed = true;
      out.push({ type: 'content_block_stop', index: idx });
    }
    openTextOrThinkingIndex = null;
    openTextOrThinkingType = null;
  }

  function ensureOpenBlock(
    out: CanonicalEvent[],
    type: 'text' | 'thinking',
  ): number {
    if (openTextOrThinkingType === type && openTextOrThinkingIndex !== null) {
      return openTextOrThinkingIndex;
    }
    // Different active block? Close it first.
    if (openTextOrThinkingIndex !== null) {
      closeOpenTextOrThinking(out);
    }
    const idx = nextBlockIndex++;
    blocks.set(idx, { index: idx, type });
    openTextOrThinkingIndex = idx;
    openTextOrThinkingType = type;
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block:
        type === 'text'
          ? { type: 'text', text: '' }
          : { type: 'thinking', thinking: '' },
    });
    return idx;
  }

  function emitToolUseBlock(
    out: CanonicalEvent[],
    toolCall: OllamaToolCall,
  ): void {
    // Close any open text/thinking before tool_use.
    closeOpenTextOrThinking(out);

    const fn = toolCall.function ?? {};
    const name = fn.name ?? '';
    const id = toolCall.id ?? synthesizeToolUseId(toolIdPrefix);
    const rawArgs = fn.arguments;

    // B4: detect malformed-args at the seam. Ollama's spec says arguments
    // is a parsed object; small models (gpt-oss:20b) occasionally emit a
    // STRING. If that string fails JSON.parse, tag the tool_use block with
    // `__malformed_args:true` + `__raw_args:<the bad string>` so the api
    // can short-circuit to a synthetic tool_result with is_error:true
    // BEFORE dispatch runs garbage input through an MCP tool.
    let malformedArgs = false;
    let rawArgsString: string | undefined;
    let argsObject: Record<string, unknown> = {};
    let partial_json: string;
    if (typeof rawArgs === 'string') {
      rawArgsString = rawArgs;
      try {
        const parsed = JSON.parse(rawArgs);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          argsObject = parsed as Record<string, unknown>;
          partial_json = rawArgs;
        } else {
          malformedArgs = true;
          partial_json = rawArgs;
        }
      } catch {
        malformedArgs = true;
        partial_json = rawArgs;
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      argsObject = rawArgs as Record<string, unknown>;
      partial_json = JSON.stringify(argsObject);
    } else {
      partial_json = '{}';
    }

    const blockInput: Record<string, unknown> = malformedArgs
      ? { __malformed_args: true, __raw_args: rawArgsString ?? '' }
      : {};

    const idx = nextBlockIndex++;
    blocks.set(idx, { index: idx, type: 'tool_use', closed: false });

    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id, name, input: blockInput },
    });

    out.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json },
    });
    void argsObject; // retained for type-narrowing — not emitted directly

    const block = blocks.get(idx)!;
    block.closed = true;
    out.push({ type: 'content_block_stop', index: idx });

    // G7 — record that a tool_use block was emitted. Final stop_reason
    // resolution in finalize() must be 'tool_use' regardless of upstream
    // done_reason ('stop' / 'load') because Ollama's small models often
    // mislabel their own done_reason on tool turns.
    hasToolUse = true;
    if (!stopReasonSet) {
      stopReason = 'tool_use';
    }
  }

  function applyDoneReason(reason: string | undefined): void {
    if (!reason) return;
    switch (reason) {
      case 'stop':
        // G7 — when a tool_use block was already emitted, 'stop' from the
        // small-model upstream means "I'm done emitting; the tool_call IS
        // the response." Map to 'tool_use' so the chat-loop dispatches.
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
      case 'length':
        stopReason = 'max_tokens';
        break;
      case 'tool_calls':
        stopReason = 'tool_use';
        break;
      case 'load':
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
      default:
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
    }
    stopReasonSet = true;
  }

  return {
    consume(chunk: OllamaChunk): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;
      // Malformed-chunk resilience: a null/undefined/non-object chunk (a bare
      // `null` keep-alive line, a truncated frame, an empty parse) is a no-op,
      // never a mid-stream crash. finalize() still closes the envelope cleanly.
      if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return out;

      emitMessageStart(out);

      const message = chunk.message;
      if (message) {
        // 1. thinking fragment
        if (typeof message.thinking === 'string' && message.thinking.length > 0) {
          const idx = ensureOpenBlock(out, 'thinking');
          out.push({
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'thinking_delta', thinking: message.thinking },
          });
        }

        // 2. text fragment — F2-8: route legacy <think>...</think> XML
        // content into thinking_delta instead of text_delta. Maintains
        // state across chunks so tag boundaries split across NDJSON
        // chunks ("hel<thi" | "nk>..." | "</think>visible") flow into
        // the right block. When message.thinking already arrived above
        // (modern Ollama path), tag-extraction returns empty thinking
        // — no double-emission — and the visible body is the only
        // content kept.
        if (typeof message.content === 'string' && message.content.length > 0) {
          const split = extractThinkingFromOllamaContentStreaming(
            message.content,
            thinkState,
          );
          thinkState = split.state;
          if (split.thinking.length > 0) {
            const idx = ensureOpenBlock(out, 'thinking');
            out.push({
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'thinking_delta', thinking: split.thinking },
            });
          }
          if (split.rest.length > 0) {
            const idx = ensureOpenBlock(out, 'text');
            out.push({
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'text_delta', text: split.rest },
            });
          }
        }

        // 3. tool_calls (always close any open text/thinking first)
        if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
          for (const tc of message.tool_calls) {
            emitToolUseBlock(out, tc);
          }
        }
      }

      // 4. done flag — capture token counts and the done_reason mapping.
      // The actual envelope close happens in finalize().
      if (chunk.done) {
        if (typeof chunk.prompt_eval_count === 'number') {
          lastPromptEvalCount = chunk.prompt_eval_count;
        }
        if (typeof chunk.eval_count === 'number') {
          lastEvalCount = chunk.eval_count;
        }
        applyDoneReason(chunk.done_reason);
      }

      return out;
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      emitMessageStart(out);

      // F2-8 — flush any buffered partial-tag bytes (e.g. stream ended on
      // "hello <thi"). The extractor with `finalize:true` drains them into
      // `rest` and emits as text_delta so they don't silently disappear.
      if (thinkState.pending.length > 0) {
        const flushed = extractThinkingFromOllamaContentStreaming('', thinkState, { finalize: true });
        thinkState = flushed.state;
        if (flushed.thinking.length > 0) {
          const idx = ensureOpenBlock(out, 'thinking');
          out.push({
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'thinking_delta', thinking: flushed.thinking },
          });
        }
        if (flushed.rest.length > 0) {
          const idx = ensureOpenBlock(out, 'text');
          out.push({
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'text_delta', text: flushed.rest },
          });
        }
      }

      // Close any block that's still open.
      closeOpenTextOrThinking(out);
      // (tool_use blocks are always closed inline, so this only closes
      // text/thinking — but defend the invariant just in case.)
      for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
        if (!block.closed) {
          block.closed = true;
          out.push({ type: 'content_block_stop', index: block.index });
        }
      }

      const usage: { output_tokens: number; input_tokens?: number } = {
        output_tokens: lastEvalCount ?? 0,
      };
      if (typeof lastPromptEvalCount === 'number') {
        usage.input_tokens = lastPromptEvalCount;
      }
      // G7 final guard: if a tool_use block was emitted but stop_reason
      // somehow ended up at end_turn (e.g. done_reason wasn't set at all),
      // override to tool_use so the chat-loop dispatches.
      const resolvedStopReason: CanonicalStopReason =
        stopReasonSet ? stopReason : (hasToolUse ? 'tool_use' : 'end_turn');
      out.push({
        type: 'message_delta',
        delta: {
          stop_reason: resolvedStopReason,
          stop_sequence: null,
        },
        usage,
      });
      out.push({ type: 'message_stop' });
      messageStopped = true;
      return out;
    },
  };
}
