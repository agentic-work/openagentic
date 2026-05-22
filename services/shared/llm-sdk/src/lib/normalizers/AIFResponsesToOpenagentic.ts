/**
 * AIFResponsesToOpenagenticNormalizer — translate Azure AI Foundry's Responses
 * API envelope (gpt-5.x family, codex models, non-streaming caller path) into
 * the canonical OpenAgentic Messages SSE event union.
 *
 * The Responses API returns a single response envelope (not chunked SSE).
 * This normalizer SYNTHESIZES the canonical streaming events from that
 * envelope so downstream code is provider-agnostic — it doesn't have to
 * know whether the underlying API streamed or not.
 *
 * Envelope shape (relevant fields only):
 *   {
 *     id: string,
 *     model?: string,
 *     output: [
 *       { type: 'message', id, role: 'assistant', content: [
 *           { type: 'output_text', text: string, annotations?: [...] }
 *         ] },
 *       { type: 'function_call', id, call_id, name, arguments: string },
 *       ...
 *     ],
 *     status: 'completed' | 'incomplete' | ...,
 *     incomplete_details?: { reason: 'max_output_tokens' | ... },
 *     usage?: {...}
 *   }
 *
 * Pure state machine. No network, no provider deps.
 *
 * Companion normalizers: OllamaToOpenagentic, OpenAIToOpenagentic,
 * VertexGeminiToOpenagentic. All four emit the SAME canonical event union.
 */

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';
export type { CanonicalEvent } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// AIF Responses input shape (only fields we read)
// ---------------------------------------------------------------------------

export interface AIFOutputTextPart {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
}

/**
 * Gap 6 (AIF half) — Responses API surfaces a refusal as either:
 *   (a) a `refusal` content part embedded in a message's content array
 *   (b) a top-level `output[]` item of type='refusal'
 * Both shapes carry the refusal copy in `refusal` field (string). Mapped
 * canonically to a text block + stop_reason='refusal' so downstream UX
 * surfaces a distinct refusal banner.
 * Source: https://platform.openai.com/docs/guides/structured-outputs#refusals
 */
export interface AIFRefusalPart {
  type: 'refusal';
  refusal: string;
}

export interface AIFMessageOutput {
  type: 'message';
  id: string;
  role: 'assistant' | string;
  content?: Array<AIFOutputTextPart | AIFRefusalPart>;
}

export interface AIFRefusalOutput {
  type: 'refusal';
  id?: string;
  refusal: string;
}

export interface AIFFunctionCallOutput {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  /** Stringified JSON of the call arguments (Responses API spec). */
  arguments: string;
}

/**
 * G3 — Responses API emits reasoning summary as a dedicated output item
 * for gpt-5 / o-series models. Per MS Learn Azure AI Foundry docs:
 *   {
 *     type: 'reasoning',
 *     id: 'rs_...',
 *     summary: [{ type: 'summary_text', text: '...' }, ...]
 *   }
 * Mapped to a canonical thinking block (Anthropic-shape).
 */
export interface AIFSummaryTextPart {
  type: 'summary_text';
  text: string;
}

export interface AIFReasoningOutput {
  type: 'reasoning';
  id: string;
  summary?: AIFSummaryTextPart[];
}

export type AIFOutputItem =
  | AIFMessageOutput
  | AIFFunctionCallOutput
  | AIFReasoningOutput
  | AIFRefusalOutput
  | { type: string; [k: string]: unknown };

export interface AIFResponsesEnvelope {
  id: string;
  model?: string;
  output: AIFOutputItem[];
  status?: 'completed' | 'incomplete' | string;
  incomplete_details?: { reason?: string };
  // usage, error, etc. ignored.
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface NormalizerOptions {
  messageId: string;
  model?: string;
}

export interface Normalizer {
  consume(envelope: AIFResponsesEnvelope): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

export function createAIFResponsesToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const model = opts.model ?? 'unknown';

  let messageStarted = false;
  let messageStopped = false;
  let stopReason: CanonicalStopReason = 'end_turn';
  let stopReasonSet = false;
  let hasToolUse = false;
  let hasRefusal = false;
  let nextBlockIndex = 0;

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

  function emitReasoningBlock(out: CanonicalEvent[], r: AIFReasoningOutput): void {
    const summary = r.summary ?? [];
    const texts = summary
      .filter((p): p is AIFSummaryTextPart => p && p.type === 'summary_text' && typeof p.text === 'string')
      .map((p) => p.text)
      .filter((t) => t.length > 0);

    if (texts.length === 0) return;

    const idx = nextBlockIndex++;
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'thinking', thinking: '' },
    });
    for (const t of texts) {
      out.push({
        type: 'content_block_delta',
        index: idx,
        delta: { type: 'thinking_delta', thinking: t },
      });
    }
    out.push({ type: 'content_block_stop', index: idx });
  }

  function emitMessageBlock(out: CanonicalEvent[], message: AIFMessageOutput): void {
    const parts = message.content ?? [];
    const texts: string[] = [];
    const refusalTexts: string[] = [];
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue;
      const part = p as AIFOutputTextPart | AIFRefusalPart;
      if (part.type === 'output_text' && typeof part.text === 'string' && part.text.length > 0) {
        texts.push(part.text);
      } else if (part.type === 'refusal' && typeof part.refusal === 'string' && part.refusal.length > 0) {
        // Gap 6 — refusal content part inside message; surface as text + flag.
        refusalTexts.push(part.refusal);
      }
    }

    if (texts.length > 0) {
      const idx = nextBlockIndex++;
      out.push({
        type: 'content_block_start',
        index: idx,
        content_block: { type: 'text', text: '' },
      });
      for (const t of texts) {
        out.push({
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'text_delta', text: t },
        });
      }
      out.push({ type: 'content_block_stop', index: idx });
    }

    if (refusalTexts.length > 0) {
      emitRefusalBlock(out, refusalTexts.join(''));
    }
  }

  function emitRefusalBlock(out: CanonicalEvent[], text: string): void {
    if (text.length === 0) return;
    const idx = nextBlockIndex++;
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'text', text: '' },
    });
    out.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'text_delta', text },
    });
    out.push({ type: 'content_block_stop', index: idx });
    hasRefusal = true;
  }

  function emitFunctionCallBlock(out: CanonicalEvent[], call: AIFFunctionCallOutput): void {
    const idx = nextBlockIndex++;
    // Responses API gives us a stable call_id — keep it as the canonical
    // tool_use id so downstream tool-result correlation works without
    // re-mapping. (Some Anthropic-shape consumers expect `toolu_*` prefix;
    // call_id is shape-equivalent for our purposes.)
    const id = call.call_id ?? call.id;
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id, name: call.name, input: {} },
    });

    // Arguments arrive stringified. Pass through verbatim — downstream
    // accumulator parses it once at content_block_stop. If parse fails,
    // surface raw and let the dispatcher decide.
    let partial_json: string;
    try {
      JSON.parse(call.arguments);
      partial_json = call.arguments;
    } catch {
      partial_json = call.arguments; // raw fallback; downstream will see same string
    }
    out.push({
      type: 'content_block_delta',
      index: idx,
      delta: { type: 'input_json_delta', partial_json },
    });

    out.push({ type: 'content_block_stop', index: idx });

    hasToolUse = true;
  }

  function applyStatus(envelope: AIFResponsesEnvelope): void {
    const reason = envelope.incomplete_details?.reason;
    if (envelope.status === 'incomplete') {
      if (reason === 'max_output_tokens' || reason === 'max_tokens') {
        stopReason = 'max_tokens';
        stopReasonSet = true;
        return;
      }
      // Gap 7 — AOAI content filter terminates the response with
      // incomplete_details.reason='content_filter'. Map to canonical
      // content_filter so downstream UX can surface a distinct banner.
      if (reason === 'content_filter' || reason === 'safety' || reason === 'content_filtered') {
        stopReason = 'content_filter';
        stopReasonSet = true;
        return;
      }
      // Other incomplete reasons map to end_turn — there's no canonical
      // dlp_block frame; downstream UX handles via separate frames if needed.
      stopReason = 'end_turn';
      stopReasonSet = true;
      return;
    }
    if (envelope.status === 'completed' && !stopReasonSet) {
      // Precedence: refusal > tool_use > end_turn. Refusal beats tool_use
      // because the model declined to act; surfacing tool_use would imply
      // dispatch where none was authorized.
      if (hasRefusal) {
        stopReason = 'refusal';
      } else if (hasToolUse) {
        stopReason = 'tool_use';
      } else {
        stopReason = 'end_turn';
      }
      stopReasonSet = true;
    }
  }

  return {
    consume(envelope: AIFResponsesEnvelope): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      emitMessageStart(out);

      const items = envelope.output ?? [];
      for (const item of items) {
        if (item.type === 'reasoning') {
          emitReasoningBlock(out, item as AIFReasoningOutput);
          continue;
        }
        if (item.type === 'message') {
          emitMessageBlock(out, item as AIFMessageOutput);
          continue;
        }
        if (item.type === 'function_call') {
          emitFunctionCallBlock(out, item as AIFFunctionCallOutput);
          continue;
        }
        if (item.type === 'refusal') {
          // Gap 6 — top-level refusal output item.
          const r = item as AIFRefusalOutput;
          if (typeof r.refusal === 'string') {
            emitRefusalBlock(out, r.refusal);
          }
          continue;
        }
        // Unknown output types ignored — Responses API may add more shapes.
      }

      applyStatus(envelope);
      return out;
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      emitMessageStart(out);

      out.push({
        type: 'message_delta',
        delta: {
          stop_reason: stopReasonSet ? stopReason : 'end_turn',
          stop_sequence: null,
        },
        usage: { output_tokens: 0 },
      });
      out.push({ type: 'message_stop' });
      messageStopped = true;
      return out;
    },
  };
}
