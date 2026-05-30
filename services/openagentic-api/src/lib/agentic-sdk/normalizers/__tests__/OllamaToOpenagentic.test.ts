/**
 * OllamaToOpenagenticNormalizer — fixture-driven TDD.
 *
 * Translates Ollama's native NDJSON streaming chunk shape into the canonical
 * OpenAgentic Messages SSE event union (the same union OpenAIToOpenagentic emits,
 * extended with thinking blocks).
 *
 * Ollama chat NDJSON shape (per https://github.com/ollama/ollama/blob/main/docs/api.md#chat-request):
 *   { model, created_at, message: { role, content, thinking?, tool_calls? }, done, done_reason? }
 *
 * Key differences vs OpenAI:
 *   - tool_calls.function.arguments is an OBJECT (already parsed JSON), not a streaming string.
 *     We JSON.stringify() once and emit a single input_json_delta per tool call.
 *   - thinking content arrives as message.thinking — emit as a thinking content block.
 *   - tool_calls usually arrive in the FINAL chunk (done=true) for gpt-oss-style models,
 *     but the normalizer must also handle mid-stream tool calls (some models emit them earlier).
 *   - done_reason can be 'stop' | 'load' | 'length' | 'tool_calls'.
 */

import { describe, it, expect } from 'vitest';
import {
  createOllamaToOpenagenticNormalizer,
  type OllamaChunk,
  type CanonicalEvent,
} from '../OllamaToOpenagentic.js';

function normalize(chunks: OllamaChunk[]): CanonicalEvent[] {
  const norm = createOllamaToOpenagenticNormalizer({ messageId: 'msg_test', model: 'llama3' });
  const out: CanonicalEvent[] = [];
  for (const chunk of chunks) {
    for (const ev of norm.consume(chunk)) out.push(ev);
  }
  for (const ev of norm.finalize()) out.push(ev);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEXT_TWO_DELTAS_THEN_STOP: OllamaChunk[] = [
  { model: 'llama3', message: { role: 'assistant', content: 'Hello, ' }, done: false },
  { model: 'llama3', message: { role: 'assistant', content: 'world!' }, done: false },
  { model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
];

const SINGLE_TOOL_CALL_FINAL_CHUNK: OllamaChunk[] = [
  // gpt-oss style: prelude with empty content + final chunk with tool_calls
  { model: 'gpt-oss:20b', message: { role: 'assistant', content: '' }, done: false },
  {
    model: 'gpt-oss:20b',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          function: { name: 'azure_list_subscriptions', arguments: { tenant_id: 'abc' } },
        },
      ],
    },
    done: true,
    done_reason: 'tool_calls',
  },
];

const TWO_PARALLEL_TOOL_CALLS: OllamaChunk[] = [
  { model: 'gpt-oss:20b', message: { role: 'assistant', content: '' }, done: false },
  {
    model: 'gpt-oss:20b',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        { function: { name: 'azure_list_resource_groups', arguments: { sub_id: 'sub1' } } },
        { function: { name: 'azure_list_resource_groups', arguments: { sub_id: 'sub2' } } },
      ],
    },
    done: true,
    done_reason: 'tool_calls',
  },
];

const THINKING_THEN_TEXT: OllamaChunk[] = [
  { model: 'qwen3', message: { role: 'assistant', content: '', thinking: 'Let me think... ' }, done: false },
  { model: 'qwen3', message: { role: 'assistant', content: '', thinking: 'about Azure' }, done: false },
  { model: 'qwen3', message: { role: 'assistant', content: 'Azure subs:' }, done: false },
  { model: 'qwen3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' },
];

const TEXT_THEN_TOOL_USE: OllamaChunk[] = [
  { model: 'gpt-oss:20b', message: { role: 'assistant', content: 'Calling the tool now.' }, done: false },
  {
    model: 'gpt-oss:20b',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'list_resources', arguments: {} } }],
    },
    done: true,
    done_reason: 'tool_calls',
  },
];

const STOP_REASON_LENGTH: OllamaChunk[] = [
  { model: 'llama3', message: { role: 'assistant', content: 'truncated' }, done: false },
  { model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'length' },
];

const STOP_REASON_LOAD: OllamaChunk[] = [
  // 'load' is for an empty load-only result (no message generated). Should still emit a clean stream.
  { model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'load' },
];

const TOOL_CALL_WITH_ID: OllamaChunk[] = [
  // Some Ollama frontends pass through an `id` field; ensure we honor it.
  {
    model: 'gpt-oss:20b',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_xyz123', function: { name: 'do_thing', arguments: { a: 1 } } },
      ],
    },
    done: true,
    done_reason: 'tool_calls',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OllamaToOpenagenticNormalizer', () => {
  describe('text-only streams', () => {
    it('emits message_start → content_block_start(text) → 2 deltas → content_block_stop → message_delta(end_turn) → message_stop', () => {
      const events = normalize(TEXT_TWO_DELTAS_THEN_STOP);
      const types = events.map(e => e.type);
      expect(types).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);

      // message_start should reflect the model
      const start = events[0] as Extract<CanonicalEvent, { type: 'message_start' }>;
      expect(start.message.id).toBe('msg_test');
      expect(start.message.role).toBe('assistant');

      const blockStart = events[1] as Extract<CanonicalEvent, { type: 'content_block_start' }>;
      expect(blockStart.index).toBe(0);
      expect(blockStart.content_block).toEqual({ type: 'text', text: '' });

      const d1 = events[2] as Extract<CanonicalEvent, { type: 'content_block_delta' }>;
      expect(d1.delta).toEqual({ type: 'text_delta', text: 'Hello, ' });
      const d2 = events[3] as Extract<CanonicalEvent, { type: 'content_block_delta' }>;
      expect(d2.delta).toEqual({ type: 'text_delta', text: 'world!' });

      const messageDelta = events[5] as Extract<CanonicalEvent, { type: 'message_delta' }>;
      expect(messageDelta.delta.stop_reason).toBe('end_turn');
    });
  });

  describe('tool_use streams', () => {
    it('emits a single tool_use block with input_json_delta from the parsed arguments object', () => {
      const events = normalize(SINGLE_TOOL_CALL_FINAL_CHUNK);
      const types = events.map(e => e.type);
      // message_start, content_block_start (tool_use), content_block_delta (input_json_delta), content_block_stop, message_delta, message_stop
      expect(types).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'content_block_stop',
        'message_delta',
        'message_stop',
      ]);

      const blockStart = events[1] as Extract<CanonicalEvent, { type: 'content_block_start' }>;
      expect(blockStart.content_block.type).toBe('tool_use');
      if (blockStart.content_block.type === 'tool_use') {
        expect(blockStart.content_block.name).toBe('azure_list_subscriptions');
        expect(blockStart.content_block.id).toMatch(/^toolu_/); // synthesized id
        expect(blockStart.content_block.input).toEqual({});
      }

      const inputDelta = events[2] as Extract<CanonicalEvent, { type: 'content_block_delta' }>;
      expect(inputDelta.delta.type).toBe('input_json_delta');
      if (inputDelta.delta.type === 'input_json_delta') {
        expect(JSON.parse(inputDelta.delta.partial_json)).toEqual({ tenant_id: 'abc' });
      }

      const messageDelta = events[4] as Extract<CanonicalEvent, { type: 'message_delta' }>;
      expect(messageDelta.delta.stop_reason).toBe('tool_use');
    });

    it('handles two parallel tool calls in the same final chunk', () => {
      const events = normalize(TWO_PARALLEL_TOOL_CALLS);
      const blockStarts = events.filter(e => e.type === 'content_block_start') as Extract<
        CanonicalEvent,
        { type: 'content_block_start' }
      >[];
      expect(blockStarts).toHaveLength(2);
      expect(blockStarts[0]!.index).toBe(0);
      expect(blockStarts[1]!.index).toBe(1);
      expect(blockStarts.every(b => b.content_block.type === 'tool_use')).toBe(true);

      const inputDeltas = events.filter(
        e =>
          e.type === 'content_block_delta' &&
          e.delta.type === 'input_json_delta',
      );
      expect(inputDeltas).toHaveLength(2);

      const stops = events.filter(e => e.type === 'content_block_stop');
      expect(stops).toHaveLength(2);

      const messageDelta = events.find(e => e.type === 'message_delta') as Extract<
        CanonicalEvent,
        { type: 'message_delta' }
      >;
      expect(messageDelta.delta.stop_reason).toBe('tool_use');
    });

    it('honors tool_call.id when provided (no synthesis)', () => {
      const events = normalize(TOOL_CALL_WITH_ID);
      const blockStart = events.find(e => e.type === 'content_block_start') as Extract<
        CanonicalEvent,
        { type: 'content_block_start' }
      >;
      if (blockStart.content_block.type === 'tool_use') {
        expect(blockStart.content_block.id).toBe('call_xyz123');
      }
    });
  });

  describe('thinking blocks', () => {
    it('emits a thinking content block with thinking_delta deltas before the text block', () => {
      const events = normalize(THINKING_THEN_TEXT);
      const types = events.map(e => e.type);
      expect(types).toEqual([
        'message_start',
        'content_block_start', // thinking
        'content_block_delta', // thinking delta 1
        'content_block_delta', // thinking delta 2
        'content_block_stop', // close thinking before text begins
        'content_block_start', // text
        'content_block_delta', // text delta
        'content_block_stop', // close text
        'message_delta',
        'message_stop',
      ]);

      const thinkingStart = events[1] as Extract<CanonicalEvent, { type: 'content_block_start' }>;
      expect(thinkingStart.content_block.type).toBe('thinking');
      if (thinkingStart.content_block.type === 'thinking') {
        expect(thinkingStart.content_block.thinking).toBe('');
      }

      const thinkingDelta1 = events[2] as Extract<CanonicalEvent, { type: 'content_block_delta' }>;
      expect(thinkingDelta1.delta.type).toBe('thinking_delta');
      if (thinkingDelta1.delta.type === 'thinking_delta') {
        expect(thinkingDelta1.delta.thinking).toBe('Let me think... ');
      }

      const textStart = events[5] as Extract<CanonicalEvent, { type: 'content_block_start' }>;
      expect(textStart.content_block.type).toBe('text');
    });
  });

  describe('mixed text + tool_use', () => {
    it('closes the text block before opening the tool_use block', () => {
      const events = normalize(TEXT_THEN_TOOL_USE);
      const types = events.map(e => e.type);
      expect(types).toEqual([
        'message_start',
        'content_block_start', // text
        'content_block_delta', // text delta
        'content_block_stop', // close text
        'content_block_start', // tool_use
        'content_block_delta', // input_json_delta
        'content_block_stop', // close tool_use
        'message_delta',
        'message_stop',
      ]);

      const blocks = events.filter(e => e.type === 'content_block_start') as Extract<
        CanonicalEvent,
        { type: 'content_block_start' }
      >[];
      expect(blocks[0]!.content_block.type).toBe('text');
      expect(blocks[1]!.content_block.type).toBe('tool_use');
      expect(blocks[0]!.index).toBe(0);
      expect(blocks[1]!.index).toBe(1);
    });
  });

  describe('finish reasons', () => {
    it('maps done_reason=length to max_tokens', () => {
      const events = normalize(STOP_REASON_LENGTH);
      const messageDelta = events.find(e => e.type === 'message_delta') as Extract<
        CanonicalEvent,
        { type: 'message_delta' }
      >;
      expect(messageDelta.delta.stop_reason).toBe('max_tokens');
    });

    it('maps done_reason=load to end_turn (no content emitted, just clean envelope)', () => {
      const events = normalize(STOP_REASON_LOAD);
      const types = events.map(e => e.type);
      // No content blocks were ever opened (no thinking, no text, no tool_calls)
      expect(types).toEqual(['message_start', 'message_delta', 'message_stop']);
      const messageDelta = events.find(e => e.type === 'message_delta') as Extract<
        CanonicalEvent,
        { type: 'message_delta' }
      >;
      expect(messageDelta.delta.stop_reason).toBe('end_turn');
    });
  });

  describe('finalize idempotency', () => {
    it('re-running finalize after stream-end is a no-op', () => {
      const norm = createOllamaToOpenagenticNormalizer({ messageId: 'msg_x' });
      norm.consume({ message: { role: 'assistant', content: 'hi' }, done: false });
      const first = norm.finalize();
      const second = norm.finalize();
      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
    });
  });

  describe('message_start contract', () => {
    it('emits message_start exactly once even if consume() is called many times', () => {
      const norm = createOllamaToOpenagenticNormalizer({ messageId: 'msg_x' });
      const a = norm.consume({ message: { role: 'assistant', content: 'a' }, done: false });
      const b = norm.consume({ message: { role: 'assistant', content: 'b' }, done: false });
      const c = norm.finalize();
      const all = [...a, ...b, ...c];
      const starts = all.filter(e => e.type === 'message_start');
      expect(starts).toHaveLength(1);
    });

    it('emits message_start with the configured model field', () => {
      const norm = createOllamaToOpenagenticNormalizer({ messageId: 'm', model: 'gpt-oss:20b' });
      const ev = norm.consume({ message: { role: 'assistant', content: '' }, done: false });
      const start = ev[0] as Extract<CanonicalEvent, { type: 'message_start' }>;
      expect(start.message.model).toBe('gpt-oss:20b');
    });
  });
});
