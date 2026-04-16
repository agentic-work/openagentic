/**
 * OpenAI Normalizer Unit Tests
 * TDD: written before implementation to drive the normalizeOpenAIChunk API.
 */

import { describe, test, expect } from 'vitest';
import { createNormalizerState } from '../services/llm-providers/ILLMProvider.js';
import { normalizeOpenAIChunk } from '../services/llm-providers/OpenAIProvider.js';

describe('OpenAI normalizer', () => {
  // -------------------------------------------------------------------------
  // First chunk — role=assistant
  // -------------------------------------------------------------------------

  test('first chunk with role=assistant emits stream_start + synthetic thinking', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'openai' });
    expect(events[1].type).toBe('thinking_start');
    expect(events[2].type).toBe('thinking_delta');
  });

  test('stream_start event includes messageId and model', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { id: 'chatcmpl-abc', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events[0]).toMatchObject({ type: 'stream_start', messageId: 'chatcmpl-abc', model: 'gpt-4o' });
  });

  test('synthetic thinking_delta content is Processing', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const thinkDelta = events.find(e => e.type === 'thinking_delta');
    expect(thinkDelta).toBeDefined();
    if (thinkDelta?.type === 'thinking_delta') {
      expect(thinkDelta.content).toBe('Processing');
    }
  });

  test('streamStartEmitted is set after first assistant chunk', () => {
    const state = createNormalizerState();
    expect(state.streamStartEmitted).toBe(false);
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(state.streamStartEmitted).toBe(true);
  });

  test('second assistant role chunk does not re-emit stream_start', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.filter(e => e.type === 'stream_start')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Text content
  // -------------------------------------------------------------------------

  test('delta.content closes synthetic thinking and emits text_start + text_delta', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'text_start')).toBe(true);
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
  });

  test('text_delta event has correct content', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    const textDelta = events.find(e => e.type === 'text_delta');
    expect(textDelta).toMatchObject({ type: 'text_delta', content: 'Hello' });
  });

  test('subsequent text deltas only emit text_delta', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOpenAIChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: ' world' });
  });

  // -------------------------------------------------------------------------
  // Tool calls
  // -------------------------------------------------------------------------

  test('tool_calls with name emits tool_start (after closing synthetic thinking)', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0,
        }],
      },
      state
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'tool_start')).toBe(true);
  });

  test('tool_start event has correct toolName and id', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOpenAIChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0,
        }],
      },
      state
    );
    const toolStart = events.find(e => e.type === 'tool_start');
    expect(toolStart).toMatchObject({ type: 'tool_start', id: 'call-1', toolName: 'list_pods' });
  });

  test('tool_calls with arguments emits tool_delta', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOpenAIChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0,
        }],
      },
      state
    );
    const events = normalizeOpenAIChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"ns":"default"}' } }] },
          index: 0,
        }],
      },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_delta', argsFragment: '{"ns":"default"}' });
  });

  // -------------------------------------------------------------------------
  // Finish reason
  // -------------------------------------------------------------------------

  test('finish_reason=stop emits text_stop + stream_end', () => {
    const state = createNormalizerState();
    state.textBlockId = 'txt-0';
    const events = normalizeOpenAIChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'text_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('finish_reason=stop stream_end has finishReason=stop', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    const streamEnd = events.find(e => e.type === 'stream_end');
    expect(streamEnd).toMatchObject({ type: 'stream_end', finishReason: 'stop' });
  });

  test('finish_reason=tool_calls emits tool_stop for pending tools + stream_end', () => {
    const state = createNormalizerState();
    normalizeOpenAIChunk(
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOpenAIChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fn', arguments: '' } }] },
          index: 0,
        }],
      },
      state
    );
    const events = normalizeOpenAIChunk(
      { choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'tool_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Usage
  // -------------------------------------------------------------------------

  test('usage chunk emits usage event', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'usage', tokensIn: 100, tokensOut: 50 });
  });

  test('usage event fields cost/contextUsed/contextMax are 0', () => {
    const state = createNormalizerState();
    const events = normalizeOpenAIChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events[0]).toMatchObject({ type: 'usage', cost: 0, contextUsed: 0, contextMax: 0 });
  });

  // -------------------------------------------------------------------------
  // Full sequences
  // -------------------------------------------------------------------------

  test('full text-only stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { id: 'chatcmpl-1', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      { usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
    ];

    const allEvents = chunks.flatMap(c => normalizeOpenAIChunk(c, state));
    const types = allEvents.map(e => e.type);

    expect(types[0]).toBe('stream_start');
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_stop');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_stop');
    expect(types).toContain('stream_end');
    expect(types).toContain('usage');

    // thinking_start before text_start
    expect(types.indexOf('thinking_start')).toBeLessThan(types.indexOf('text_start'));
    // thinking_stop before text_start
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('text_start'));
    // text_stop before stream_end
    expect(types.indexOf('text_stop')).toBeLessThan(types.lastIndexOf('stream_end'));
  });

  test('full tool-call stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { id: 'chatcmpl-2', model: 'gpt-4o', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-xyz', function: { name: 'get_pods', arguments: '' } }] },
          index: 0,
        }],
      },
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"ns":"prod"}' } }] },
          index: 0,
        }],
      },
      { choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }] },
    ];

    const allEvents = chunks.flatMap(c => normalizeOpenAIChunk(c, state));
    const types = allEvents.map(e => e.type);

    expect(types[0]).toBe('stream_start');
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_stop');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_delta');
    expect(types).toContain('tool_stop');
    expect(types).toContain('stream_end');

    // thinking closes before tool_start
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('tool_start'));
    // tool_stop before stream_end
    expect(types.indexOf('tool_stop')).toBeLessThan(types.lastIndexOf('stream_end'));

    // tool_delta content is correct
    const toolDelta = allEvents.find(e => e.type === 'tool_delta');
    expect(toolDelta).toMatchObject({ type: 'tool_delta', argsFragment: '{"ns":"prod"}' });
  });
});
