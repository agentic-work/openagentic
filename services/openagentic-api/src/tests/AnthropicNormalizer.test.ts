/**
 * AnthropicNormalizer Unit Tests
 * TDD: written before implementation to drive the normalizeAnthropicChunk API.
 */

import { describe, test, expect } from 'vitest';
import { createNormalizerState } from '../services/llm-providers/ILLMProvider.js';
import { normalizeAnthropicChunk } from '../services/llm-providers/AnthropicProvider.js';

describe('Anthropic normalizer', () => {
  test('message_start emits stream_start', () => {
    const state = createNormalizerState();
    const chunk = { type: 'message_start', message: { id: 'msg-1', model: 'claude-sonnet-4-6', usage: { input_tokens: 100 } } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'stream_start', messageId: 'msg-1', model: 'claude-sonnet-4-6', provider: 'anthropic' });
  });

  test('content_block_start with type=thinking emits thinking_start', () => {
    const state = createNormalizerState();
    const chunk = { type: 'content_block_start', index: 0, content_block: { type: 'thinking', text: '' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'thinking_start', id: 'tk-0' });
  });

  test('content_block_delta with thinking_delta emits thinking_delta with accumulated', () => {
    const state = createNormalizerState();
    state.thinkingId = 'tk-0';
    state.thinkingStartTime = Date.now();
    const chunk = { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'analyzing...' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('analyzing...');
      expect(events[0].accumulated).toBe('analyzing...');
    }
  });

  test('content_block_stop after thinking emits thinking_stop with elapsed', () => {
    const state = createNormalizerState();
    state.thinkingId = 'tk-0';
    state.thinkingStartTime = Date.now() - 500;
    // First simulate the block start so block type is tracked
    normalizeAnthropicChunk({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', text: '' } }, state);
    const events = normalizeAnthropicChunk({ type: 'content_block_stop', index: 0 }, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_stop');
    if (events[0].type === 'thinking_stop') {
      expect(events[0].id).toBe('tk-0');
      expect(events[0].elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('content_block_start with type=text emits text_start', () => {
    const state = createNormalizerState();
    const chunk = { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_start', id: 'txt-1' });
  });

  test('content_block_delta with text_delta emits text_delta', () => {
    const state = createNormalizerState();
    state.textBlockId = 'txt-1';
    const chunk = { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello ' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', id: 'txt-1', content: 'hello ' });
  });

  test('content_block_start with type=tool_use emits tool_start', () => {
    const state = createNormalizerState();
    const chunk = { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-1', name: 'list_pods' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_start', id: 'call-1', toolName: 'list_pods', serverName: '' });
  });

  test('content_block_delta with input_json_delta emits tool_delta', () => {
    const state = createNormalizerState();
    // Track that index 2 is tool_use
    normalizeAnthropicChunk({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-1', name: 'list_pods' } }, state);
    const events = normalizeAnthropicChunk({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"namespace":' } }, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_delta', id: 'call-1', argsFragment: '{"namespace":' });
  });

  test('content_block_stop after tool_use emits tool_stop', () => {
    const state = createNormalizerState();
    normalizeAnthropicChunk({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-1', name: 'list_pods' } }, state);
    const events = normalizeAnthropicChunk({ type: 'content_block_stop', index: 2 }, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_stop', id: 'call-1', result: null, durationMs: 0 });
  });

  test('content_block_stop after text emits text_stop', () => {
    const state = createNormalizerState();
    normalizeAnthropicChunk({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, state);
    const events = normalizeAnthropicChunk({ type: 'content_block_stop', index: 1 }, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_stop', id: 'txt-1' });
  });

  test('signature_delta emits redacted_thinking', () => {
    const state = createNormalizerState();
    state.thinkingId = 'tk-0';
    const chunk = { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'redacted_thinking', id: 'tk-0', signature: 'sig123' });
  });

  test('message_stop emits stream_end', () => {
    const state = createNormalizerState();
    const chunk = { type: 'message_stop' };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('message_delta with usage emits usage event', () => {
    const state = createNormalizerState();
    const chunk = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 500 } };
    const events = normalizeAnthropicChunk(chunk, state);
    expect(events.some(e => e.type === 'usage')).toBe(true);
  });

  test('full stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { type: 'message_start', message: { id: 'msg-1', model: 'claude-sonnet-4-6', usage: { input_tokens: 100 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me think' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello!' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } },
      { type: 'message_stop' },
    ];

    const allEvents = chunks.flatMap(c => normalizeAnthropicChunk(c, state));
    const types = allEvents.map(e => e.type);

    expect(types).toEqual([
      'stream_start',
      'thinking_start',
      'thinking_delta',
      'thinking_stop',
      'text_start',
      'text_delta',
      'text_stop',
      'usage',
      'stream_end',
    ]);
  });

  test('thinking accumulates across multiple deltas', () => {
    const state = createNormalizerState();
    normalizeAnthropicChunk({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', text: '' } }, state);
    normalizeAnthropicChunk({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'first ' } }, state);
    const events = normalizeAnthropicChunk({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'second' } }, state);
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('second');
      expect(events[0].accumulated).toBe('first second');
    }
  });

  test('stream_start sets streamStartEmitted on state', () => {
    const state = createNormalizerState();
    expect(state.streamStartEmitted).toBe(false);
    normalizeAnthropicChunk({ type: 'message_start', message: { id: 'msg-1', model: 'claude-sonnet-4-6', usage: {} } }, state);
    expect(state.streamStartEmitted).toBe(true);
  });

  test('unknown event type returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeAnthropicChunk({ type: 'ping' }, state);
    expect(events).toHaveLength(0);
  });
});
