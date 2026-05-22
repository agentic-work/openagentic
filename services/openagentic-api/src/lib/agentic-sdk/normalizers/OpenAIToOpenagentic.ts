/**
 * OpenAIToOpenagenticNormalizer — translate OpenAI / Azure OpenAI streaming
 * delta chunks into the canonical OpenAgentic Messages SSE event union.
 *
 * Pure state machine. NO provider/network dependencies. Feed chunks one at
 * a time via `consume()`; collect emitted events; call `finalize()` at
 * stream end to flush wrapper events.
 *
 * Companion normalizers (each translates a different provider into the
 * SAME canonical OpenAgentic event union): OllamaToOpenagentic,
 * VertexGeminiToOpenagentic, BedrockToOpenagentic (passthrough),
 * VertexToOpenagentic (passthrough), AIFResponsesToOpenagentic.
 *
 * Spec: docs/superpowers/specs/2026-05-01-canonical-stream-normalizer.md
 */

// ---------------------------------------------------------------------------
// OpenAI input shape (only fields we read; real chunks have more)
// ---------------------------------------------------------------------------

export interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface OpenAIChoice {
  index?: number;
  delta?: {
    role?: 'assistant';
    content?: string | null;
    tool_calls?: OpenAIToolCallDelta[];
    refusal?: string | null;
    /**
     * G2 — Azure OpenAI Chat Completions reasoning models (gpt-5, o-series)
     * emit reasoning_content BEFORE content on a thinking turn. Per MS Learn
     * Azure OpenAI reasoning docs. Mapped to canonical thinking_delta events.
     */
    reasoning_content?: string | null;
  };
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // OpenAI emits these when stream_options.include_usage:true. Captured
  // here so callers reporting cost (and the canonical message_delta) can
  // surface input_tokens / output_tokens authoritatively. Reasoning tokens
  // and cache details live nested but are not yet plumbed; downstream
  // cost-ledger reads completion_tokens_details when needed.
  completion_tokens_details?: { reasoning_tokens?: number; [k: string]: unknown };
  prompt_tokens_details?: { cached_tokens?: number; [k: string]: unknown };
}

export interface OpenAIChunk {
  id?: string;
  model?: string;
  choices?: OpenAIChoice[];
  /** OpenAI/AIF emit this on a trailing `choices:[]` chunk when the caller
   *  set `stream_options.include_usage:true`. The normalizer captures it
   *  via consume() and re-emits the values on canonical message_delta.usage. */
  usage?: OpenAIUsage | null;
  // Other fields ignored.
}

// ---------------------------------------------------------------------------
// Canonical event shape — shared with peer normalizers (OllamaToOpenagentic,
// BedrockToOpenagentic, VertexToOpenagentic). Defined in CanonicalEvent.ts so
// every normalizer emits the EXACT same discriminated union.
// ---------------------------------------------------------------------------

import type { CanonicalEvent, CanonicalStopReason } from './CanonicalEvent.js';
export type { CanonicalEvent } from './CanonicalEvent.js';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

interface BlockState {
  index: number;          // canonical block index
  type: 'text' | 'tool_use' | 'thinking';
  // For tool_use blocks:
  toolUseOpenAIIndex?: number;
  toolUseId?: string;
  toolUseName?: string;
  toolUseHasArgs?: boolean; // tracks whether we've emitted at least one input_json_delta
  closed?: boolean;
}

export interface NormalizerOptions {
  messageId: string;
  model?: string;
}

export interface Normalizer {
  consume(chunk: OpenAIChunk): CanonicalEvent[];
  finalize(): CanonicalEvent[];
}

export function createOpenAIToOpenagenticNormalizer(opts: NormalizerOptions): Normalizer {
  const messageId = opts.messageId;
  const model = opts.model ?? 'unknown';

  let messageStarted = false;
  let stopReason: CanonicalStopReason = 'end_turn';
  let stopReasonSet = false;
  let messageStopped = false;
  // G1 — capture trailing usage chunk so message_delta surfaces token
  // counts authoritatively. OpenAI emits this AFTER finish_reason, on a
  // chunk whose `choices` is [] and `usage` is populated.
  let lastUsage: OpenAIUsage | null = null;

  // Active blocks keyed by canonical index.
  const blocks: Map<number, BlockState> = new Map();
  let nextBlockIndex = 0;
  // Map from OpenAI tool_calls[].index → canonical block index.
  const toolUseIndexMap: Map<number, number> = new Map();
  // Single text block (if any).
  let textBlockIndex: number | null = null;
  // G2 — thinking block from delta.reasoning_content (opens once, closes
  // when content/tool_calls/finish_reason arrives).
  let thinkingBlockIndex: number | null = null;

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

  function openTextBlock(out: CanonicalEvent[]): number {
    if (textBlockIndex !== null) return textBlockIndex;
    const idx = nextBlockIndex++;
    textBlockIndex = idx;
    blocks.set(idx, { index: idx, type: 'text' });
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'text', text: '' },
    });
    return idx;
  }

  function openThinkingBlock(out: CanonicalEvent[]): number {
    if (thinkingBlockIndex !== null) return thinkingBlockIndex;
    const idx = nextBlockIndex++;
    thinkingBlockIndex = idx;
    blocks.set(idx, { index: idx, type: 'thinking' });
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'thinking', thinking: '' },
    });
    return idx;
  }

  function closeThinkingIfOpen(out: CanonicalEvent[]): void {
    if (thinkingBlockIndex !== null) {
      closeBlock(out, thinkingBlockIndex);
      thinkingBlockIndex = null;
    }
  }

  function openToolBlock(
    out: CanonicalEvent[],
    openAIIndex: number,
    id: string,
    name: string,
  ): number {
    const idx = nextBlockIndex++;
    toolUseIndexMap.set(openAIIndex, idx);
    blocks.set(idx, {
      index: idx,
      type: 'tool_use',
      toolUseOpenAIIndex: openAIIndex,
      toolUseId: id,
      toolUseName: name,
      toolUseHasArgs: false,
    });
    out.push({
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'tool_use', id, name, input: {} },
    });
    return idx;
  }

  function closeBlock(out: CanonicalEvent[], idx: number): void {
    const block = blocks.get(idx);
    if (!block || block.closed) return;
    block.closed = true;
    out.push({ type: 'content_block_stop', index: idx });
  }

  function closeAllOpenBlocks(out: CanonicalEvent[]): void {
    // Close in registration order for stable output.
    const sorted = [...blocks.values()].sort((a, b) => a.index - b.index);
    for (const b of sorted) {
      if (!b.closed) closeBlock(out, b.index);
    }
  }

  return {
    consume(chunk: OpenAIChunk): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      // G1 — capture chunk.usage if present (emitted on trailing
      // include_usage:true chunk after finish_reason). May arrive on a
      // chunk with empty choices[] OR (rarely) co-arrive with content.
      if (chunk.usage && typeof chunk.usage === 'object') {
        lastUsage = chunk.usage;
      }

      // Emit message_start lazily on the first real chunk.
      if (!chunk.choices || chunk.choices.length === 0) {
        // Pure no-op chunks (just role / system_fingerprint / trailing
        // usage / prompt_filter_results) — emit message_start so downstream
        // can lock onto the message id, then return without emitting per-
        // choice events.
        emitMessageStart(out);
        return out;
      }

      for (const choice of chunk.choices) {
        emitMessageStart(out);

        const delta = choice.delta ?? {};

        // 0. G2 — reasoning_content deltas (gpt-5 / o-series thinking).
        // Open thinking block lazily, append each fragment as a
        // thinking_delta. Closes automatically when content / tool_calls /
        // finish_reason arrives below.
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          const idx = openThinkingBlock(out);
          out.push({
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
          });
        }

        // 1. Text deltas
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          // Close thinking block before text starts (Anthropic-shape ordering).
          closeThinkingIfOpen(out);
          // If a tool block is currently open ahead of text, close it before
          // resuming text. (Rare but possible if model emits tool_use then
          // text in the same turn.)
          // Default: text comes first, then tools, then finish. We only need
          // to open the text block on demand.
          const idx = openTextBlock(out);
          out.push({
            type: 'content_block_delta',
            index: idx,
            delta: { type: 'text_delta', text: delta.content },
          });
        }

        // 2. Tool call deltas
        if (Array.isArray(delta.tool_calls)) {
          for (const tcDelta of delta.tool_calls) {
            if (typeof tcDelta.index !== 'number') continue;
            // First chunk for this tool_call_index: must have id + name.
            // OpenAI emits id+name in the FIRST tool_calls delta and only
            // function.arguments in subsequent deltas.
            const existing = toolUseIndexMap.get(tcDelta.index);
            if (existing === undefined) {
              const id = tcDelta.id ?? '';
              const name = tcDelta.function?.name ?? '';
              if (id || name) {
                // Close thinking/text blocks before tool_use (Anthropic shape).
                closeThinkingIfOpen(out);
                if (textBlockIndex !== null) {
                  closeBlock(out, textBlockIndex);
                  textBlockIndex = null;
                }
                openToolBlock(out, tcDelta.index, id, name);
              }
            }

            // Argument fragment (may co-arrive with the start chunk if model
            // is fast). Append as input_json_delta.
            const argFragment = tcDelta.function?.arguments;
            if (typeof argFragment === 'string' && argFragment.length > 0) {
              const idx = toolUseIndexMap.get(tcDelta.index);
              if (idx !== undefined) {
                const block = blocks.get(idx);
                if (block) {
                  block.toolUseHasArgs = true;
                  out.push({
                    type: 'content_block_delta',
                    index: idx,
                    delta: { type: 'input_json_delta', partial_json: argFragment },
                  });
                }
              }
            }
          }
        }

        // 3. Finish reason — close any open thinking block first
        if (choice.finish_reason) {
          closeThinkingIfOpen(out);
          switch (choice.finish_reason) {
            case 'stop':
              stopReason = 'end_turn';
              break;
            case 'length':
              stopReason = 'max_tokens';
              break;
            case 'tool_calls':
              stopReason = 'tool_use';
              break;
            case 'content_filter':
              stopReason = 'end_turn'; // No direct mapping in our canonical taxonomy; closest match.
              break;
          }
          stopReasonSet = true;
        }
      }

      return out;
    },

    finalize(): CanonicalEvent[] {
      const out: CanonicalEvent[] = [];
      if (messageStopped) return out;

      // Emit message_start in the empty-input path.
      emitMessageStart(out);

      // Close all open content blocks.
      closeAllOpenBlocks(out);

      // Emit message_delta with stop_reason. If no finish_reason was ever
      // observed (e.g. the stream cut off), default to end_turn so downstream
      // doesn't break.
      const usage: { output_tokens: number; input_tokens?: number } = {
        output_tokens: lastUsage?.completion_tokens ?? 0,
      };
      if (typeof lastUsage?.prompt_tokens === 'number') {
        usage.input_tokens = lastUsage.prompt_tokens;
      }
      out.push({
        type: 'message_delta',
        delta: {
          stop_reason: stopReasonSet ? stopReason : 'end_turn',
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
