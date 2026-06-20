/**
 * stopReasons — single SoT for canonical stop_reason mapping in both
 * directions (provider → canonical inbound, canonical → provider outbound).
 *
 * Today the api maintains five different copies of this mapping, one per
 * provider class. This consolidates them under the SDK so adapters built
 * in Phase 0.3 can rely on a single SoT.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapAnthropicStopReason,
  mapOpenAIFinishReason,
  mapBedrockStopReason,
  mapVertexFinishReason,
  mapOllamaDoneReason,
  toAnthropicStopReason,
  toOpenAIFinishReason,
  toBedrockStopReason,
  toVertexFinishReason,
  toOllamaDoneReason,
  type CanonicalStopReason,
} from '../stopReasons.js';

describe('mapAnthropicStopReason — inbound from Anthropic-shape providers', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['stop_sequence', 'stop_sequence'],
    ['tool_use', 'tool_use'],
    ['pause_turn', 'pause_turn'],
    ['refusal', 'refusal'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapAnthropicStopReason(input)).toBe(expected);
  });

  it('degrades unknown values to end_turn with a console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapAnthropicStopReason('something_new')).toBe('end_turn');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatch(/anthropic.*something_new/);
    spy.mockRestore();
  });
});

describe('mapOpenAIFinishReason — inbound from OpenAI Chat Completions', () => {
  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['tool_calls', 'tool_use'],
    ['function_call', 'tool_use'],
    ['content_filter', 'content_filter'],
    ['refusal', 'refusal'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapOpenAIFinishReason(input)).toBe(expected);
  });

  it('degrades unknown to end_turn with warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapOpenAIFinishReason('weird')).toBe('end_turn');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('mapBedrockStopReason — inbound from Bedrock (Anthropic-on-Bedrock + Converse)', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['tool_use', 'tool_use'],
    ['stop_sequence', 'stop_sequence'],
    ['guardrail_intervened', 'safety'],
    ['content_filtered', 'content_filter'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapBedrockStopReason(input)).toBe(expected);
  });

  it('degrades unknown to end_turn with warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapBedrockStopReason('NEW_REASON')).toBe('end_turn');
    spy.mockRestore();
  });
});

describe('mapVertexFinishReason — inbound from Vertex Gemini', () => {
  it.each([
    ['STOP', 'end_turn'],
    ['MAX_TOKENS', 'max_tokens'],
    ['SAFETY', 'safety'],
    ['RECITATION', 'recitation'],
    ['BLOCKLIST', 'content_filter'],
    ['PROHIBITED_CONTENT', 'content_filter'],
    ['SPII', 'content_filter'],
    ['OTHER', 'end_turn'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapVertexFinishReason(input)).toBe(expected);
  });

  it('degrades unknown to end_turn with warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapVertexFinishReason('ALIEN')).toBe('end_turn');
    spy.mockRestore();
  });
});

describe('mapOllamaDoneReason — inbound from Ollama chat NDJSON', () => {
  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['tool_calls', 'tool_use'],
    ['load', 'end_turn'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapOllamaDoneReason(input)).toBe(expected);
  });

  it('degrades unknown to end_turn with warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapOllamaDoneReason('experimental')).toBe('end_turn');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Reverse mappings — canonical → provider wire (for future adapters)
// ---------------------------------------------------------------------------

describe('toAnthropicStopReason — outbound to Anthropic-shape providers', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['stop_sequence', 'stop_sequence'],
    ['tool_use', 'tool_use'],
    ['pause_turn', 'pause_turn'],
    ['refusal', 'refusal'],
    ['content_filter', 'end_turn'],
    ['safety', 'end_turn'],
    ['recitation', 'end_turn'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toAnthropicStopReason(input as CanonicalStopReason)).toBe(expected);
  });
});

describe('toOpenAIFinishReason — outbound to OpenAI Chat Completions', () => {
  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'tool_calls'],
    ['content_filter', 'content_filter'],
    ['refusal', 'refusal'],
    ['stop_sequence', 'stop'],
    ['pause_turn', 'stop'],
    ['safety', 'content_filter'],
    ['recitation', 'content_filter'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toOpenAIFinishReason(input as CanonicalStopReason)).toBe(expected);
  });
});

describe('toBedrockStopReason — outbound to Bedrock', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['max_tokens', 'max_tokens'],
    ['tool_use', 'tool_use'],
    ['stop_sequence', 'stop_sequence'],
    ['safety', 'guardrail_intervened'],
    ['content_filter', 'content_filtered'],
    ['refusal', 'end_turn'],
    ['pause_turn', 'end_turn'],
    ['recitation', 'content_filtered'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toBedrockStopReason(input as CanonicalStopReason)).toBe(expected);
  });
});

describe('toVertexFinishReason — outbound to Vertex Gemini', () => {
  it.each([
    ['end_turn', 'STOP'],
    ['max_tokens', 'MAX_TOKENS'],
    ['safety', 'SAFETY'],
    ['recitation', 'RECITATION'],
    ['content_filter', 'BLOCKLIST'],
    ['tool_use', 'STOP'],
    ['stop_sequence', 'STOP'],
    ['refusal', 'OTHER'],
    ['pause_turn', 'OTHER'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toVertexFinishReason(input as CanonicalStopReason)).toBe(expected);
  });
});

describe('toOllamaDoneReason — outbound to Ollama chat NDJSON', () => {
  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'tool_calls'],
    ['stop_sequence', 'stop'],
    ['pause_turn', 'stop'],
    ['safety', 'stop'],
    ['recitation', 'stop'],
    ['content_filter', 'stop'],
    ['refusal', 'stop'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(toOllamaDoneReason(input as CanonicalStopReason)).toBe(expected);
  });
});
