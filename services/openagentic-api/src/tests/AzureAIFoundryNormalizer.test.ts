/**
 * AzureAIFoundry Normalizer Unit Tests
 * TDD: written before implementation to drive the normalizeAzureAIFoundryChunk API.
 */

import { describe, test, expect } from 'vitest';
import { createNormalizerState } from '../services/llm-providers/ILLMProvider.js';
import { normalizeAzureAIFoundryChunk } from '../services/llm-providers/AzureAIFoundryProvider.js';

describe('AzureAIFoundry normalizer', () => {
  // -------------------------------------------------------------------------
  // Format A tests (Anthropic-style content_block events from reasoning models)
  // -------------------------------------------------------------------------

  test('content_block_start with thinking emits stream_start + thinking_start on first event', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      state
    );
    // First Format A chunk emits stream_start then thinking_start
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'azure-ai-foundry' });
    expect(events[1].type).toBe('thinking_start');
    expect(state.streamStartEmitted).toBe(true);
  });

  test('content_block_delta with thinking_delta emits thinking_delta', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true; // already emitted by prior chunk
    state.thinkingId = 'tk-0';
    state.thinkingStartTime = Date.now();
    state.blockTypes.set(0, { type: 'thinking', id: 'tk-0' });
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning...' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('reasoning...');
    }
  });

  test('content_block_start with text emits text_start (stream_start already emitted)', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true; // already emitted by prior thinking block
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text_start');
  });

  test('content_block_delta with text_delta emits text_delta', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true; // already emitted by prior chunk
    state.textBlockId = 'txt-1';
    state.blockTypes.set(1, { type: 'text', id: 'txt-1' });
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello ' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: 'hello ' });
  });

  test('content_block_stop after thinking emits thinking_stop', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_stop', index: 0 },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_stop');
    if (events[0].type === 'thinking_stop') {
      expect(events[0].elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('content_block_stop after text emits text_stop', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { type: 'content_block_stop', index: 1 },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_stop', id: 'txt-1' });
  });

  // -------------------------------------------------------------------------
  // Format B tests (OpenAI-style chunks from non-reasoning models)
  // -------------------------------------------------------------------------

  test('first chunk with role=assistant emits stream_start + synthetic thinking', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'azure-ai-foundry' });
    expect(events[1].type).toBe('thinking_start');
    expect(events[2].type).toBe('thinking_delta');
  });

  test('stream_start event includes messageId and model', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-abc', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events[0]).toMatchObject({ type: 'stream_start', messageId: 'chatcmpl-abc', model: 'gpt-41' });
  });

  test('synthetic thinking_delta content is Processing', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const thinkDelta = events.find(e => e.type === 'thinking_delta');
    expect(thinkDelta).toBeDefined();
    if (thinkDelta?.type === 'thinking_delta') {
      expect(thinkDelta.content).toBe('Processing');
    }
  });

  test('delta.content closes synthetic thinking and emits text', () => {
    const state = createNormalizerState();
    // First setup synthetic thinking
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    // Now send text
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'text_start')).toBe(true);
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
  });

  test('text_delta event has correct content', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    const textDelta = events.find(e => e.type === 'text_delta');
    expect(textDelta).toMatchObject({ type: 'text_delta', content: 'Hello' });
  });

  test('subsequent text deltas only emit text_delta', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeAzureAIFoundryChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: ' world' });
  });

  test('tool_calls with name emits tool_start (after closing synthetic thinking)', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'tool_start')).toBe(true);
  });

  test('tool_start event has correct toolName and id', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    const toolStart = events.find(e => e.type === 'tool_start');
    expect(toolStart).toMatchObject({ type: 'tool_start', id: 'call-1', toolName: 'list_pods' });
  });

  test('tool_calls with arguments emits tool_delta', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeAzureAIFoundryChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"ns":"default"}' } }] },
          index: 0
        }]
      },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_delta', argsFragment: '{"ns":"default"}' });
  });

  test('finish_reason=stop emits text_stop + stream_end', () => {
    const state = createNormalizerState();
    state.textBlockId = 'txt-0';
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'text_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('finish_reason=stop stream_end has finishReason=stop', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    const streamEnd = events.find(e => e.type === 'stream_end');
    expect(streamEnd).toMatchObject({ type: 'stream_end', finishReason: 'stop' });
  });

  test('finish_reason=tool_calls emits tool_stop for pending tools + stream_end', () => {
    const state = createNormalizerState();
    // Setup a pending tool
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeAzureAIFoundryChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fn', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'tool_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('usage chunk emits usage event', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'usage', tokensIn: 100, tokensOut: 50 });
  });

  test('usage event fields cost/contextUsed/contextMax are 0', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events[0]).toMatchObject({ type: 'usage', cost: 0, contextUsed: 0, contextMax: 0 });
  });

  test('unknown chunk type returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk({ type: 'ping' }, state);
    expect(events).toHaveLength(0);
  });

  test('empty choices array returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeAzureAIFoundryChunk({ choices: [] }, state);
    expect(events).toHaveLength(0);
  });

  test('streamStartEmitted is set after first assistant chunk', () => {
    const state = createNormalizerState();
    expect(state.streamStartEmitted).toBe(false);
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(state.streamStartEmitted).toBe(true);
  });

  test('second assistant role chunk does not re-emit stream_start', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    // Duplicate role chunk
    const events = normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.filter(e => e.type === 'stream_start')).toHaveLength(0);
  });

  test('thinking_stop closes synthetic thinking with elapsed time', () => {
    const state = createNormalizerState();
    normalizeAzureAIFoundryChunk(
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeAzureAIFoundryChunk(
      { choices: [{ delta: { content: 'Hi' }, index: 0 }] },
      state
    );
    const thinkStop = events.find(e => e.type === 'thinking_stop');
    expect(thinkStop).toBeDefined();
    if (thinkStop?.type === 'thinking_stop') {
      expect(thinkStop.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  // -------------------------------------------------------------------------
  // Full stream sequence test
  // -------------------------------------------------------------------------

  test('full Format B stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { id: 'chatcmpl-1', model: 'gpt-41', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      { usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
    ];

    const allEvents = chunks.flatMap(c => normalizeAzureAIFoundryChunk(c, state));
    const types = allEvents.map(e => e.type);

    // Must start with stream_start, have thinking block, then text, then end
    expect(types[0]).toBe('stream_start');
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_stop');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_stop');
    expect(types).toContain('stream_end');
    expect(types).toContain('usage');

    // thinking_start must come before text_start
    expect(types.indexOf('thinking_start')).toBeLessThan(types.indexOf('text_start'));
    // thinking_stop must come before text_start
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('text_start'));
    // stream_end must be last before usage (or last overall)
    const streamEndIdx = types.lastIndexOf('stream_end');
    expect(streamEndIdx).toBeGreaterThan(types.indexOf('text_stop'));
  });
});
