/**
 * Canonical OpenAgentic Messages SSE event union — the SoT shape every
 * normalizer emits and every downstream service consumes. OpenAgentic owns
 * this taxonomy. It generalizes the streaming patterns we've observed across
 * providers (delta-text + tool_use + thinking blocks + envelope start/stop)
 * and is the foundation we extend with platform-specific events (sub-agents,
 * artifacts, tier hints, RAG citations, cost pulses, HITL, etc).
 *
 * Provider normalizers translate native streaming chunks into this shape;
 * provider differences become invisible to downstream code. When a source
 * provider doesn't emit a particular block type (e.g. OpenAI never produces
 * `thinking` blocks today), the normalizer simply never produces that
 * variant — downstream code matches on the discriminator and skips what it
 * doesn't care about.
 */

export type CanonicalContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type CanonicalDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'input_json_delta'; partial_json: string };

export type CanonicalStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  // Cross-provider hazards. Anthropic doesn't emit these natively today,
  // but Azure AOAI content-filter / Bedrock guardrail / Vertex SAFETY +
  // RECITATION + BLOCKLIST + PROHIBITED_CONTENT + SPII + OpenAI o1+ refusal
  // need representable canonical variants — adapters back-map to provider
  // wire format. B8 (2026-05-12) chatmode FedRAMP-Hi audit.
  | 'content_filter'
  | 'safety'
  | 'recitation'
  | 'pause_turn'
  | 'refusal';

export type CanonicalEvent =
  | {
      type: 'message_start';
      message: {
        id: string;
        type: 'message';
        role: 'assistant';
        model: string;
        content: [];
        stop_reason: null;
        stop_sequence: null;
        usage: { input_tokens: number; output_tokens: number };
      };
    }
  | {
      type: 'content_block_start';
      index: number;
      content_block: CanonicalContentBlock;
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: CanonicalDelta;
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: {
        stop_reason: CanonicalStopReason;
        stop_sequence: string | null;
      };
      // input_tokens is optional because providers report it differently:
      // OpenAI/AIF emit a trailing usage chunk AFTER finish_reason; Ollama
      // attaches counts to the final `done:true` chunk; Vertex puts them on
      // usageMetadata of the final SSE event. When absent, downstream cost
      // tracking falls back to upstream message_start.usage.input_tokens.
      usage: { output_tokens: number; input_tokens?: number };
    }
  | { type: 'message_stop' };
