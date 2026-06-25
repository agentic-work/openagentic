/**
 * OpenAIToOpenagenticNormalizer — fixture-driven TDD.
 *
 * Translates Azure OpenAI / OpenAI-direct streaming chunk shapes into the
 * canonical OpenAgentic Messages SSE event union. Downstream pipeline reads
 * the canonical events provider-agnostically and emits identical NDJSON
 * envelopes regardless of source provider.
 *
 * Tool-call accumulator pattern:
 *   - content_block_start (tool_use) → initialize { ...content_block, input: '' }
 *   - content_block_delta (input_json_delta) → input += partial_json
 *   - content_block_stop  → finalize, parse JSON only when consumed downstream
 *   - NO in-stream JSON repair
 *
 * the design notes
 */

import { describe, it, expect } from 'vitest';
import {
  createOpenAIToOpenagenticNormalizer,
  type OpenAIChunk,
  type CanonicalEvent,
} from '../OpenAIToOpenagentic.js';

/**
 * Helper: feed an array of OpenAI chunks through a fresh normalizer and
 * collect every emitted canonical event in order.
 */
function normalize(chunks: OpenAIChunk[]): CanonicalEvent[] {
  const norm = createOpenAIToOpenagenticNormalizer({ messageId: 'msg_test' });
  const out: CanonicalEvent[] = [];
  for (const chunk of chunks) {
    for (const ev of norm.consume(chunk)) out.push(ev);
  }
  for (const ev of norm.finalize()) out.push(ev);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures — minimal Azure OpenAI / OpenAI streaming chunks.
// Real chunks have more fields (system_fingerprint, etc.); only fields
// the normalizer reads are included here.
// ---------------------------------------------------------------------------

const TEXT_TWO_DELTAS_THEN_STOP: OpenAIChunk[] = [
  // First chunk: role='assistant'
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  // Text token 1
  { choices: [{ index: 0, delta: { content: 'Hello, ' }, finish_reason: null }] },
  // Text token 2
  { choices: [{ index: 0, delta: { content: 'world!' }, finish_reason: null }] },
  // Final chunk
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
];

const SINGLE_TOOL_CALL: OpenAIChunk[] = [
  // Role
  { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] },
  // First tool_call chunk: id + function.name
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_abc123',
              type: 'function',
              function: { name: 'azure_list_subscriptions', arguments: '' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  // Argument fragment 1
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"tenant_id":"' } }],
        },
        finish_reason: null,
      },
    ],
  },
  // Argument fragment 2
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: 'abc"}' } }],
        },
        finish_reason: null,
      },
    ],
  },
  // Final chunk: finish_reason='tool_calls'
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
];

const PARALLEL_TWO_TOOL_CALLS: OpenAIChunk[] = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] },
  // Both tool_calls start in same chunk
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_a', type: 'function', function: { name: 'azure_list_resource_groups', arguments: '' } },
            { index: 1, id: 'call_b', type: 'function', function: { name: 'aws_list_buckets', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  // Args interleave
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"sub":"x"}' } }],
        },
        finish_reason: null,
      },
    ],
  },
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [{ index: 1, function: { arguments: '{"region":"us"}' } }],
        },
        finish_reason: null,
      },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
];

const EMPTY_TOOL_ARGS: OpenAIChunk[] = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] },
  {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id: 'call_zero', type: 'function', function: { name: 'no_arg_tool', arguments: '' } },
          ],
        },
        finish_reason: null,
      },
    ],
  },
  // No argument fragments at all
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
];

const FINISH_REASON_LENGTH: OpenAIChunk[] = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: { content: 'truncated…' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIToOpenagenticNormalizer', () => {
  describe('text-only response', () => {
    it('emits message_start → content_block_start(text) → text_deltas → content_block_stop → message_delta(end_turn) → message_stop', () => {
      const events = normalize(TEXT_TWO_DELTAS_THEN_STOP);
      const types = events.map(e => `${e.type}${'delta' in e && e.delta?.type ? ':' + e.delta.type : ''}${'content_block' in e && e.content_block?.type ? ':' + e.content_block.type : ''}`);
      expect(types).toEqual([
        'message_start',
        'content_block_start:text',
        'content_block_delta:text_delta',
        'content_block_delta:text_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);
    });

    it('preserves text token order in text_deltas', () => {
      const events = normalize(TEXT_TWO_DELTAS_THEN_STOP);
      const textDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && e.delta.type === 'text_delta',
      );
      expect(textDeltas.map(e => (e.delta as any).text)).toEqual(['Hello, ', 'world!']);
    });

    it('reports stop_reason="end_turn" on finish_reason="stop"', () => {
      const events = normalize(TEXT_TWO_DELTAS_THEN_STOP);
      const messageDelta = events.find(e => e.type === 'message_delta') as any;
      expect(messageDelta.delta.stop_reason).toBe('end_turn');
    });
  });

  describe('single tool_call response', () => {
    it('emits content_block_start(tool_use) with id+name and empty input on first tool_calls chunk', () => {
      const events = normalize(SINGLE_TOOL_CALL);
      const blockStart = events.find(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
          e.type === 'content_block_start' && e.content_block.type === 'tool_use',
      );
      expect(blockStart).toBeDefined();
      expect((blockStart!.content_block as any).id).toBe('call_abc123');
      expect((blockStart!.content_block as any).name).toBe('azure_list_subscriptions');
      expect((blockStart!.content_block as any).input).toEqual({});
    });

    it('emits one input_json_delta per OpenAI argument fragment', () => {
      const events = normalize(SINGLE_TOOL_CALL);
      const argDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
      );
      expect(argDeltas.map(e => (e.delta as any).partial_json)).toEqual([
        '{"tenant_id":"',
        'abc"}',
      ]);
    });

    it('reports stop_reason="tool_use" on finish_reason="tool_calls"', () => {
      const events = normalize(SINGLE_TOOL_CALL);
      const messageDelta = events.find(e => e.type === 'message_delta') as any;
      expect(messageDelta.delta.stop_reason).toBe('tool_use');
    });

    it('full event sequence', () => {
      const events = normalize(SINGLE_TOOL_CALL);
      const types = events.map(e => `${e.type}${'delta' in e && e.delta?.type ? ':' + e.delta.type : ''}${'content_block' in e && e.content_block?.type ? ':' + e.content_block.type : ''}`);
      expect(types).toEqual([
        'message_start',
        'content_block_start:tool_use',
        'content_block_delta:input_json_delta',
        'content_block_delta:input_json_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);
    });
  });

  describe('parallel tool_calls', () => {
    it('emits two distinct content_block_start (tool_use) events with different indexes', () => {
      const events = normalize(PARALLEL_TWO_TOOL_CALLS);
      const starts = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
          e.type === 'content_block_start' && e.content_block.type === 'tool_use',
      );
      expect(starts.length).toBe(2);
      expect(starts[0].index).not.toBe(starts[1].index);
      expect((starts[0].content_block as any).id).toBe('call_a');
      expect((starts[1].content_block as any).id).toBe('call_b');
    });

    it('routes each input_json_delta to the right block index', () => {
      const events = normalize(PARALLEL_TWO_TOOL_CALLS);
      const argDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
      );
      expect(argDeltas.length).toBe(2);
      // The block at the same index across runs should accumulate the right args.
      const a = argDeltas.find(e => e.index === 0)!;
      const b = argDeltas.find(e => e.index === 1)!;
      expect((a.delta as any).partial_json).toBe('{"sub":"x"}');
      expect((b.delta as any).partial_json).toBe('{"region":"us"}');
    });

    it('emits content_block_stop for both tool blocks before message_delta', () => {
      const events = normalize(PARALLEL_TWO_TOOL_CALLS);
      const stops = events.filter(e => e.type === 'content_block_stop');
      expect(stops.length).toBe(2);
      const lastStopIdx = events.lastIndexOf(stops[stops.length - 1]);
      const messageDeltaIdx = events.findIndex(e => e.type === 'message_delta');
      expect(lastStopIdx).toBeLessThan(messageDeltaIdx);
    });
  });

  describe('empty tool arguments', () => {
    it('still emits content_block_start + content_block_stop for the tool block', () => {
      const events = normalize(EMPTY_TOOL_ARGS);
      const start = events.find(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
          e.type === 'content_block_start' && e.content_block.type === 'tool_use',
      );
      const stop = events.find(e => e.type === 'content_block_stop');
      expect(start).toBeDefined();
      expect(stop).toBeDefined();
      expect((start!.content_block as any).name).toBe('no_arg_tool');
    });

    it('emits zero or one input_json_delta (not multiple bogus empty deltas)', () => {
      const events = normalize(EMPTY_TOOL_ARGS);
      const argDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
      );
      // Empty-args case: either no input_json_delta (clean) or one with partial_json=''.
      // Pick the clean form: NO input_json_delta when arguments are empty.
      expect(argDeltas.length).toBe(0);
    });
  });

  describe('finish_reason variants', () => {
    it('maps finish_reason="length" to stop_reason="max_tokens"', () => {
      const events = normalize(FINISH_REASON_LENGTH);
      const messageDelta = events.find(e => e.type === 'message_delta') as any;
      expect(messageDelta.delta.stop_reason).toBe('max_tokens');
    });
  });

  describe('input contract', () => {
    it('handles empty chunk array gracefully (still emits message_start + message_stop on finalize)', () => {
      const events = normalize([]);
      // No content blocks but the wrapper events should fire so downstream
      // can still synthesize an empty message.
      expect(events.some(e => e.type === 'message_start')).toBe(true);
      expect(events.some(e => e.type === 'message_stop')).toBe(true);
    });

    it('ignores chunks with no choices (e.g. role-only or system_fingerprint-only)', () => {
      const events = normalize([
        // no choices key at all
        { choices: [] },
        { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
      // Should still produce a clean text-only sequence.
      const types = events.map(e => e.type);
      expect(types).toContain('content_block_start');
      expect(types).toContain('content_block_delta');
    });
  });

  // G1 — usage preservation when no trailing usage chunk arrives.
  // The full G1 + parallel-tools coverage lives in realCaptures.test.ts
  // against the captured AIF gpt-5.4 stream — see that file for the
  // ground-truth assertions on chunk.usage plumbing.
  describe('G1 — chunk.usage preservation (legacy fallback)', () => {
    it('falls back to output_tokens=0 + input_tokens undefined when stream lacks include_usage trailer', () => {
      const events = normalize(TEXT_TWO_DELTAS_THEN_STOP);
      const messageDelta = events.find(e => e.type === 'message_delta') as any;
      expect(messageDelta.usage.output_tokens).toBe(0);
      // input_tokens is optional — undefined when no usage chunk seen
      expect(messageDelta.usage.input_tokens).toBeUndefined();
    });
  });

  // G2 — reasoning_content → canonical thinking blocks.
  //
  // Azure OpenAI Chat Completions reasoning models (gpt-5, o-series) emit
  // `delta.reasoning_content` BEFORE `delta.content` on a thinking turn.
  // Shape (per MS Learn Azure OpenAI reasoning docs):
  //   data: {"choices":[{"delta":{"reasoning_content":"Let me think..."}}]}
  //   data: {"choices":[{"delta":{"reasoning_content":" step by step..."}}]}
  //   data: {"choices":[{"delta":{"content":"The answer is..."}}]}
  //
  // The normalizer must:
  //   - open a thinking block (content_block_start type='thinking') on
  //     first reasoning_content delta
  //   - emit content_block_delta with delta.type='thinking_delta' per fragment
  //   - close the thinking block when content (or finish_reason) arrives
  //
  // Root cause for gpt-5.4 no-thinking UX surface flagged 2026-05-10.
  // Tracked as G2 in reference_sdk_normalizer_gap_analysis.md.
  describe('G2 — reasoning_content → thinking_delta canonical events', () => {
    const REASONING_THEN_CONTENT: OpenAIChunk[] = [
      { choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      // Two reasoning fragments
      { choices: [{ index: 0, delta: { reasoning_content: 'Let me think ' } as any, finish_reason: null }] },
      { choices: [{ index: 0, delta: { reasoning_content: 'step by step.' } as any, finish_reason: null }] },
      // Then actual content
      { choices: [{ index: 0, delta: { content: 'The sky is blue because…' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ];

    it('opens a thinking block + emits thinking_delta events when reasoning_content arrives', () => {
      const events = normalize(REASONING_THEN_CONTENT);
      const thinkingDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && (e.delta as any).type === 'thinking_delta',
      );
      expect(thinkingDeltas.length).toBeGreaterThanOrEqual(2);
      const joined = thinkingDeltas
        .map((d) => (d.delta as any).thinking as string)
        .join('');
      expect(joined).toBe('Let me think step by step.');
    });

    it('thinking block precedes text block (Anthropic-shape ordering)', () => {
      const events = normalize(REASONING_THEN_CONTENT);
      const starts = events.filter((e) => e.type === 'content_block_start') as Array<
        Extract<CanonicalEvent, { type: 'content_block_start' }>
      >;
      const thinkingStart = starts.find((s) => s.content_block.type === 'thinking');
      const textStart = starts.find((s) => s.content_block.type === 'text');
      expect(thinkingStart).toBeDefined();
      expect(textStart).toBeDefined();
      expect(thinkingStart!.index).toBeLessThan(textStart!.index);
    });

    it('thinking block is closed before text block opens', () => {
      const events = normalize(REASONING_THEN_CONTENT);
      // Order: thinking_start, thinking_delta x2, thinking_stop, text_start, text_delta, ...
      const thinkingStartIdx = events.findIndex(
        (e) =>
          e.type === 'content_block_start' &&
          (e as any).content_block.type === 'thinking',
      );
      const thinkingStopIdx = events.findIndex(
        (e, i) => i > thinkingStartIdx && e.type === 'content_block_stop',
      );
      const textStartIdx = events.findIndex(
        (e) =>
          e.type === 'content_block_start' &&
          (e as any).content_block.type === 'text',
      );
      expect(thinkingStartIdx).toBeGreaterThanOrEqual(0);
      expect(thinkingStopIdx).toBeGreaterThan(thinkingStartIdx);
      expect(textStartIdx).toBeGreaterThan(thinkingStopIdx);
    });
  });
});
