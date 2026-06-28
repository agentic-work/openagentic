/**
 * AnthropicShapeToOpenagenticNormalizer — passthrough normalizer for
 * providers that serve the Anthropic Messages SSE shape natively.
 *
 * Used by:
 *   - AWS Bedrock (Claude models served via Bedrock's
 *     `invoke-model-with-response-stream`)
 *   - Google Vertex AI (Claude models served via Vertex's
 *     `streamRawPredict` Anthropic endpoint)
 *   - Azure AI Foundry (Claude models served via AIF's Anthropic-shape
 *     endpoint, NOT the gpt-5.x Responses API)
 *
 * These three clouds expose Claude with the Anthropic Messages event
 * shape under different transport framings (AWS event-stream binary
 * chunks, Vertex HTTP/2 SSE, AIF SSE). Provider WRAPPERS strip the
 * transport framing and feed plain JSON events into this normalizer.
 *
 * At the model-stream layer, the Anthropic Messages event shape is
 * already byte-compatible with our canonical OpenAgentic model-stream
 * subset (we extended it with platform events that providers don't emit).
 * So the normalizer is effectively a typed passthrough: collect events,
 * stamp `message_start` if the provider didn't emit one (some clouds
 * skip it), and forward each event to the canonical union.
 *
 * Three named exports — `createBedrockToOpenagenticNormalizer`,
 * `createVertexAnthropicToOpenagenticNormalizer`,
 * `createFoundryAnthropicToOpenagenticNormalizer` — point at the same
 * impl. The names exist so emit sites can be explicit about which cloud
 * they're consuming, while the conversion logic stays single-sourced.
 */

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';
export type { CanonicalEvent } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// Anthropic-shape input — only the fields we route. Real chunks have more.
// ---------------------------------------------------------------------------

export interface AnthropicShapeMessageStart {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model?: string;
    content: unknown[];
    stop_reason: CanonicalStopReason | null;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicShapeContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block:
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
}

export interface AnthropicShapeContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta:
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; thinking: string }
    | { type: 'input_json_delta'; partial_json: string };
}

export interface AnthropicShapeContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface AnthropicShapeMessageDelta {
  type: 'message_delta';
  delta: { stop_reason: CanonicalStopReason; stop_sequence: string | null };
  usage: { output_tokens: number };
}

export interface AnthropicShapeMessageStop {
  type: 'message_stop';
}

export interface AnthropicShapePing {
  type: 'ping';
}

export type AnthropicShapeChunk =
  | AnthropicShapeMessageStart
  | AnthropicShapeContentBlockStart
  | AnthropicShapeContentBlockDelta
  | AnthropicShapeContentBlockStop
  | AnthropicShapeMessageDelta
  | AnthropicShapeMessageStop
  | AnthropicShapePing;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface NormalizerOptions {
  messageId: string;
  /** Override the model field on the synthesized message_start when the
   * cloud doesn't emit one. */
  model?: string;
}

export interface Normalizer {
  consume(chunk: AnthropicShapeChunk): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

function createImpl(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const fallbackModel = opts.model ?? 'unknown';

  let messageStarted = false;
  let messageStopped = false;
  let stopReasonSet = false;

  function ensureMessageStart(out: CanonicalEvent[]): void {
    if (messageStarted) return;
    messageStarted = true;
    out.push({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: fallbackModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  return {
    consume(chunk: AnthropicShapeChunk): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;
      // Malformed-chunk resilience: a null/undefined/non-object chunk (a bare
      // `null` keep-alive line, a truncated frame, an empty parse) is a no-op,
      // never a mid-stream crash. finalize() still closes the envelope cleanly.
      if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) return out;

      switch (chunk.type) {
        case 'message_start': {
          // Pass through verbatim — but enforce our canonical id/model
          // when the source omitted them. Anthropic-on-Bedrock sometimes
          // lacks the model field.
          messageStarted = true;
          const msg = chunk.message;
          // Canonical message_start always carries null stop_reason +
          // null stop_sequence (it's a START, not a continuation). Source
          // values in those fields, if any, are stale/no-op — drop them.
          out.push({
            type: 'message_start',
            message: {
              id: msg.id || messageId,
              type: 'message',
              role: 'assistant',
              model: msg.model || fallbackModel,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: msg.usage ?? { input_tokens: 0, output_tokens: 0 },
            },
          });
          return out;
        }
        case 'ping': {
          // Ping events are heartbeat-only; downstream typically ignores
          // them but we keep them in the canonical stream so transports
          // that need keep-alive markers can use them.
          ensureMessageStart(out);
          return out;
        }
        case 'content_block_start': {
          ensureMessageStart(out);
          out.push({
            type: 'content_block_start',
            index: chunk.index,
            content_block: chunk.content_block,
          });
          return out;
        }
        case 'content_block_delta': {
          ensureMessageStart(out);
          out.push({
            type: 'content_block_delta',
            index: chunk.index,
            delta: chunk.delta,
          });
          return out;
        }
        case 'content_block_stop': {
          ensureMessageStart(out);
          out.push({ type: 'content_block_stop', index: chunk.index });
          return out;
        }
        case 'message_delta': {
          ensureMessageStart(out);
          stopReasonSet = true;
          out.push({
            type: 'message_delta',
            delta: chunk.delta,
            usage: chunk.usage ?? { output_tokens: 0 },
          });
          return out;
        }
        case 'message_stop': {
          ensureMessageStart(out);
          if (!stopReasonSet) {
            // Some clouds emit message_stop without a prior message_delta
            // (notably AIF Anthropic at very short responses). Synthesize
            // one so downstream always sees the canonical pair.
            out.push({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 0 },
            });
            stopReasonSet = true;
          }
          out.push({ type: 'message_stop' });
          messageStopped = true;
          return out;
        }
        default: {
          // Unknown event type — silently skip. The provider wrapper is
          // responsible for surfacing schema drift via platform_error.
          return out;
        }
      }
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;
      ensureMessageStart(out);
      if (!stopReasonSet) {
        out.push({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 },
        });
      }
      out.push({ type: 'message_stop' });
      messageStopped = true;
      return out;
    },
  };
}

/**
 * Generic Anthropic-shape passthrough normalizer. Use this directly when
 * the cloud doesn't matter, or use one of the three named factories below.
 */
export function createAnthropicShapeToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  return createImpl(opts);
}

/** Claude-on-Bedrock: AWS event-stream wrapper strip happens upstream. */
export function createBedrockToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  return createImpl(opts);
}

/** Claude-on-Vertex: Vertex anthropic@anthropic.x.x SSE wrapper strip happens upstream. */
export function createVertexAnthropicToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  return createImpl(opts);
}

/** Claude-on-AIF: AIF Anthropic-shape SSE (NOT the gpt-5.x Responses API). */
export function createFoundryAnthropicToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  return createImpl(opts);
}
