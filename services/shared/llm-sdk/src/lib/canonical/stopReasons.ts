/**
 * Canonical stop_reason mapping — single SoT for translating provider-native
 * finish/done/stop reasons into the canonical OpenAgentic taxonomy and back.
 *
 * Inbound (provider → canonical) is used by SDK normalizers. Outbound
 * (canonical → provider) is used by future adapters that translate canonical
 * request bodies into provider-native shapes. Replaces FIVE copies of this
 * table across api provider classes + the inline blocks in SDK normalizers.
 *
 * Provider wire references:
 *   - Anthropic Messages SSE — pause_turn / refusal in 2025-09 schema.
 *   - OpenAI Chat Completions — stop / length / tool_calls / function_call
 *     / content_filter / refusal.
 *   - AWS Bedrock Converse — guardrail_intervened / content_filtered.
 *   - Vertex Gemini — STOP / MAX_TOKENS / SAFETY / RECITATION / BLOCKLIST
 *     / PROHIBITED_CONTENT / SPII / OTHER.
 *   - Ollama — stop / length / tool_calls / load.
 *
 * Mapping functions are TOTAL over CanonicalStopReason; unknown provider
 * inputs degrade to 'end_turn' with a console.warn (no throws).
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */

import type { CanonicalStopReason } from '../normalizers/CanonicalEvent.js';
export type { CanonicalStopReason } from '../normalizers/CanonicalEvent.js';

function warnUnknown(provider: string, input: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[canonical/stopReasons] unknown ${provider} stop reason: "${input}" — degrading to 'end_turn'`,
  );
}

// ---------------------------------------------------------------------------
// Inbound — provider wire → canonical. Implemented as readonly lookup tables.
// ---------------------------------------------------------------------------

const ANTHROPIC_IN: Record<string, CanonicalStopReason> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  pause_turn: 'pause_turn',
  refusal: 'refusal',
};

const OPENAI_IN: Record<string, CanonicalStopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'content_filter',
  refusal: 'refusal',
};

const BEDROCK_IN: Record<string, CanonicalStopReason> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  tool_use: 'tool_use',
  stop_sequence: 'stop_sequence',
  guardrail_intervened: 'safety',
  content_filtered: 'content_filter',
};

const VERTEX_IN: Record<string, CanonicalStopReason> = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'safety',
  RECITATION: 'recitation',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  OTHER: 'end_turn',
};

const OLLAMA_IN: Record<string, CanonicalStopReason> = {
  stop: 'end_turn',
  load: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
};

function lookupInbound(
  table: Record<string, CanonicalStopReason>,
  provider: string,
  input: string,
): CanonicalStopReason {
  const mapped = table[input];
  if (mapped !== undefined) return mapped;
  warnUnknown(provider, input);
  return 'end_turn';
}

/** Anthropic Messages SSE — `message_delta.delta.stop_reason`. */
export function mapAnthropicStopReason(input: string): CanonicalStopReason {
  return lookupInbound(ANTHROPIC_IN, 'anthropic', input);
}
/** OpenAI Chat Completions — `choices[].finish_reason`. */
export function mapOpenAIFinishReason(input: string): CanonicalStopReason {
  return lookupInbound(OPENAI_IN, 'openai', input);
}
/** AWS Bedrock Converse + invoke-with-response-stream `stopReason`. */
export function mapBedrockStopReason(input: string): CanonicalStopReason {
  return lookupInbound(BEDROCK_IN, 'bedrock', input);
}
/** Vertex Gemini — `candidates[].finishReason`. */
export function mapVertexFinishReason(input: string): CanonicalStopReason {
  return lookupInbound(VERTEX_IN, 'vertex', input);
}
/** Ollama chat NDJSON — `done_reason` on the final `done:true` chunk. */
export function mapOllamaDoneReason(input: string): CanonicalStopReason {
  return lookupInbound(OLLAMA_IN, 'ollama', input);
}

// ---------------------------------------------------------------------------
// Outbound — canonical → provider wire (used by Phase 0.3 adapters).
// Implemented as exhaustive Record<CanonicalStopReason,string> tables so
// adding a new canonical variant fails compilation here as a forcing function.
// ---------------------------------------------------------------------------

/** Anthropic-shape outbound. pause_turn + refusal native in 2025-09+;
 * safety / content_filter / recitation collapse to end_turn (the platform
 * surfaces those events separately via agentic-events). */
const ANTHROPIC_OUT: Record<CanonicalStopReason, string> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  tool_use: 'tool_use',
  pause_turn: 'pause_turn',
  refusal: 'refusal',
  content_filter: 'end_turn',
  safety: 'end_turn',
  recitation: 'end_turn',
};

const OPENAI_OUT: Record<CanonicalStopReason, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  pause_turn: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
  content_filter: 'content_filter',
  safety: 'content_filter',
  recitation: 'content_filter',
  refusal: 'refusal',
};

const BEDROCK_OUT: Record<CanonicalStopReason, string> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  tool_use: 'tool_use',
  stop_sequence: 'stop_sequence',
  safety: 'guardrail_intervened',
  content_filter: 'content_filtered',
  recitation: 'content_filtered',
  refusal: 'end_turn',
  pause_turn: 'end_turn',
};

const VERTEX_OUT: Record<CanonicalStopReason, string> = {
  end_turn: 'STOP',
  tool_use: 'STOP',
  stop_sequence: 'STOP',
  max_tokens: 'MAX_TOKENS',
  safety: 'SAFETY',
  recitation: 'RECITATION',
  content_filter: 'BLOCKLIST',
  refusal: 'OTHER',
  pause_turn: 'OTHER',
};

const OLLAMA_OUT: Record<CanonicalStopReason, string> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  pause_turn: 'stop',
  safety: 'stop',
  recitation: 'stop',
  content_filter: 'stop',
  refusal: 'stop',
  max_tokens: 'length',
  tool_use: 'tool_calls',
};

export function toAnthropicStopReason(input: CanonicalStopReason): string {
  return ANTHROPIC_OUT[input];
}
export function toOpenAIFinishReason(input: CanonicalStopReason): string {
  return OPENAI_OUT[input];
}
export function toBedrockStopReason(input: CanonicalStopReason): string {
  return BEDROCK_OUT[input];
}
export function toVertexFinishReason(input: CanonicalStopReason): string {
  return VERTEX_OUT[input];
}
export function toOllamaDoneReason(input: CanonicalStopReason): string {
  return OLLAMA_OUT[input];
}
