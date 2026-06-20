/**
 * VertexGeminiToOpenagenticNormalizer — translate Google Vertex's Gemini
 * `streamGenerateContent` SSE stream into the canonical OpenAgentic Messages
 * SSE event union.
 *
 * Gemini chunk shape (per Vertex AI Generative Models docs):
 *   {
 *     candidates: [{
 *       content: { role: 'model', parts: [...] },
 *       finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER',
 *     }],
 *     modelVersion?: string,
 *     usageMetadata?: {...},
 *   }
 *
 * Each chunk delivers a partial parts[]; concatenate text parts across
 * chunks. functionCall parts arrive as PARSED objects (not streaming
 * argument fragments) — JSON.stringify once and emit a single
 * input_json_delta. Thinking parts are tagged `thought: true`.
 *
 * Pure state machine. No network, no provider deps.
 *
 * Companion normalizers: OllamaToOpenagentic, OpenAIToOpenagentic.
 */

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';
export type { CanonicalEvent } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// Gemini input shape (only fields we read)
// ---------------------------------------------------------------------------

export interface GeminiFunctionCall {
  name: string;
  /** Parsed JSON object (Vertex emits args as a parsed object, not a string). */
  args?: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  // Other fields (inlineData, fileData) ignored — they don't translate
  // cleanly to text/tool_use blocks; downstream code handles them via
  // the artifact channel rather than the model stream.
}

export interface GeminiContent {
  role?: 'model' | 'user';
  parts?: GeminiPart[];
}

export interface GeminiCandidate {
  index?: number;
  content?: GeminiContent;
  finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | string;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  // Other fields (trafficType, *_details) ignored — surface via cost ledger
  // separately when needed.
}

export interface GeminiChunk {
  candidates?: GeminiCandidate[];
  modelVersion?: string;
  /** Vertex/Gemini emits usageMetadata on the final chunk that carries
   *  finishReason. Captured here and surfaced on canonical message_delta.usage. */
  usageMetadata?: GeminiUsageMetadata;
  // promptFeedback, etc. ignored.
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
  consume(chunk: GeminiChunk): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

let synthCounter = 0;
function synthesizeToolUseId(prefix: string): string {
  synthCounter += 1;
  return `${prefix}${Date.now().toString(36)}${synthCounter.toString(36)}`;
}

export function createVertexGeminiToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const model = opts.model ?? 'unknown';
  const toolIdPrefix = opts.toolIdPrefix ?? 'toolu_';

  let messageStarted = false;
  let messageStopped = false;
  let stopReason: CanonicalStopReason = 'end_turn';
  let stopReasonSet = false;
  // G7 — Vertex Gemini emits `finishReason:"STOP"` even on tool-use turns.
  // Track whether a tool_use block was emitted so finalize() can override
  // the upstream STOP and surface 'tool_use' for the chat-loop to dispatch.
  let hasToolUse = false;
  // G1 — capture Vertex usageMetadata from the final chunk that carries
  // finishReason. Real chunks: promptTokenCount, candidatesTokenCount.
  let lastUsage: GeminiUsageMetadata | undefined;

  const blocks: Map<number, BlockState> = new Map();
  let nextBlockIndex = 0;

  // The currently open non-tool block (text or thinking). Tool_use blocks
  // are ephemeral — opened, deltad, and closed within one consume() call.
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

  function ensureOpenBlock(out: CanonicalEvent[], type: 'text' | 'thinking'): number {
    if (openTextOrThinkingType === type && openTextOrThinkingIndex !== null) {
      return openTextOrThinkingIndex;
    }
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

  function emitToolUseBlock(out: CanonicalEvent[], call: GeminiFunctionCall): void {
    closeOpenTextOrThinking(out);

    const name = call.name ?? '';
    const id = synthesizeToolUseId(toolIdPrefix);
    const args = call.args ?? {};

    const idx = nextBlockIndex++;
    blocks.set(idx, { index: idx, type: 'tool_use', closed: false });

    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id, name, input: {} },
    });

    const partial_json = JSON.stringify(args);
    out.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json },
    });

    const block = blocks.get(idx)!;
    block.closed = true;
    out.push({ type: 'content_block_stop', index: idx });

    // G7 — record tool_use precedence so applyFinishReason can override
    // upstream STOP / OTHER on tool-use turns.
    hasToolUse = true;
    if (!stopReasonSet) {
      stopReason = 'tool_use';
    }
  }

  function applyFinishReason(reason: string | undefined): void {
    if (!reason) return;
    switch (reason) {
      case 'STOP':
        // G7 — Vertex 2.5-flash returns STOP even on tool turns. When a
        // tool_use block was already emitted, map to 'tool_use' so the
        // chat-loop dispatches; otherwise standard end_turn.
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
      case 'MAX_TOKENS':
        stopReason = 'max_tokens';
        break;
      case 'SAFETY':
        // B8 (2026-05-12) — Vertex SAFETY trip surfaces as canonical
        // 'safety' so the UI can render a compliance banner instead
        // of silently truncating as end_turn. tool_use precedence
        // still applies if the model emitted a function call BEFORE
        // the safety stop fired (rare but defended).
        stopReason = hasToolUse ? 'tool_use' : 'safety';
        break;
      case 'RECITATION':
        // B8 — Vertex RECITATION = model regurgitated copyrighted /
        // training-set material. Distinct canonical 'recitation'
        // surfaces the dedicated compliance signal for audit.
        stopReason = hasToolUse ? 'tool_use' : 'recitation';
        break;
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
        // B8 — Vertex content-policy variants all roll up to canonical
        // 'content_filter' (matches stopReasons.ts VERTEX_IN table).
        stopReason = hasToolUse ? 'tool_use' : 'content_filter';
        break;
      case 'OTHER':
        // No direct mapping; tool_use precedence still applies if the
        // model managed to emit a function call before the OTHER stop.
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
      default:
        stopReason = hasToolUse ? 'tool_use' : 'end_turn';
        break;
    }
    stopReasonSet = true;
  }

  return {
    consume(chunk: GeminiChunk): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      emitMessageStart(out);

      // G1 — Vertex emits usageMetadata on the final chunk (same one as
      // finishReason). Capture once so finalize() can surface it on the
      // canonical message_delta.usage payload.
      if (chunk.usageMetadata && typeof chunk.usageMetadata === 'object') {
        lastUsage = chunk.usageMetadata;
      }

      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];
        for (const part of parts) {
          if (part.thought === true && typeof part.text === 'string' && part.text.length > 0) {
            const idx = ensureOpenBlock(out, 'thinking');
            out.push({
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'thinking_delta', thinking: part.text },
            });
            continue;
          }
          if (typeof part.text === 'string' && part.text.length > 0) {
            const idx = ensureOpenBlock(out, 'text');
            out.push({
              type: 'content_block_delta',
              index: idx,
              delta: { type: 'text_delta', text: part.text },
            });
            continue;
          }
          if (part.functionCall) {
            emitToolUseBlock(out, part.functionCall);
            continue;
          }
        }

        if (candidate.finishReason) {
          applyFinishReason(candidate.finishReason);
        }
      }

      return out;
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      emitMessageStart(out);

      closeOpenTextOrThinking(out);
      // tool_use blocks are always closed inline; defend the invariant.
      for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
        if (!block.closed) {
          block.closed = true;
          out.push({ type: 'content_block_stop', index: block.index });
        }
      }

      const usage: { output_tokens: number; input_tokens?: number } = {
        output_tokens: lastUsage?.candidatesTokenCount ?? 0,
      };
      if (typeof lastUsage?.promptTokenCount === 'number') {
        usage.input_tokens = lastUsage.promptTokenCount;
      }
      // G7 final guard — same as Ollama: ensure tool_use stop_reason wins
      // when a tool block was emitted, even if no finishReason fired.
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
