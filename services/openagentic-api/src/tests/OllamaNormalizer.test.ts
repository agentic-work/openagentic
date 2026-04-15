/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Ollama Normalizer Unit Tests
 * TDD: written before implementation to drive the normalizeOllamaChunk API.
 */

import { describe, test, expect } from 'vitest';
import { createNormalizerState } from '../services/llm-providers/ILLMProvider.js';
import { normalizeOllamaChunk } from '../services/llm-providers/OllamaProvider.js';

describe('Ollama normalizer', () => {
  // -------------------------------------------------------------------------
  // Format A tests (Anthropic-style content_block events)
  // -------------------------------------------------------------------------

  test('content_block_start with thinking emits stream_start + thinking_start on first event', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      state
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'ollama' });
    expect(events[1].type).toBe('thinking_start');
    expect(state.streamStartEmitted).toBe(true);
  });

  test('content_block_start with thinking stores block in blockTypes', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      state
    );
    expect(state.blockTypes.get(0)).toMatchObject({ type: 'thinking', id: 'tk-0' });
    expect(state.thinkingId).toBe('tk-0');
  });

  test('content_block_delta with thinking_delta emits thinking_delta with accumulated', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    state.thinkingId = 'tk-0';
    state.thinkingStartTime = Date.now();
    state.blockTypes.set(0, { type: 'thinking', id: 'tk-0' });
    const events = normalizeOllamaChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning...' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('reasoning...');
      expect(events[0].accumulated).toBe('reasoning...');
    }
  });

  test('content_block_delta thinking_delta accumulates across chunks', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    state.thinkingId = 'tk-0';
    state.thinkingStartTime = Date.now();
    state.thinkingAccumulated = 'first ';
    state.blockTypes.set(0, { type: 'thinking', id: 'tk-0' });
    const events = normalizeOllamaChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'second' } },
      state
    );
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].accumulated).toBe('first second');
    }
  });

  test('content_block_stop after thinking emits thinking_stop with elapsedMs', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      state
    );
    const events = normalizeOllamaChunk(
      { type: 'content_block_stop', index: 0 },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_stop');
    if (events[0].type === 'thinking_stop') {
      expect(events[0].elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(state.thinkingId).toBeNull();
  });

  test('content_block_start with text emits text_start (stream_start already emitted)', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    const events = normalizeOllamaChunk(
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('text_start');
    if (events[0].type === 'text_start') {
      expect(events[0].id).toBe('txt-1');
    }
  });

  test('content_block_delta with text_delta emits text_delta', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    state.textBlockId = 'txt-1';
    state.blockTypes.set(1, { type: 'text', id: 'txt-1' });
    const events = normalizeOllamaChunk(
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello ' } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: 'hello ' });
  });

  test('content_block_stop after text emits text_stop', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeOllamaChunk(
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      state
    );
    const events = normalizeOllamaChunk(
      { type: 'content_block_stop', index: 1 },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_stop', id: 'txt-1' });
  });

  // -------------------------------------------------------------------------
  // Format B tests (OpenAI-style chunks)
  // -------------------------------------------------------------------------

  test('first chunk with role=assistant emits stream_start + synthetic thinking', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'ollama' });
    expect(events[1].type).toBe('thinking_start');
    expect(events[2].type).toBe('thinking_delta');
  });

  test('stream_start includes messageId and model', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { id: 'chatcmpl-abc', model: 'qwen3:8b', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events[0]).toMatchObject({ type: 'stream_start', messageId: 'chatcmpl-abc', model: 'qwen3:8b' });
  });

  test('synthetic thinking_delta content is Processing', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const thinkDelta = events.find(e => e.type === 'thinking_delta');
    expect(thinkDelta).toBeDefined();
    if (thinkDelta?.type === 'thinking_delta') {
      expect(thinkDelta.content).toBe('Processing');
    }
  });

  test('delta.content closes synthetic thinking and emits text_start + text_delta', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOllamaChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'text_start')).toBe(true);
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
  });

  test('subsequent text deltas only emit text_delta', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOllamaChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state
    );
    const events = normalizeOllamaChunk(
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: ' world' });
  });

  test('tool_calls with name emits tool_start (closes synthetic thinking first)', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOllamaChunk(
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

  test('tool_start has correct toolName and id', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOllamaChunk(
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
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOllamaChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'list_pods', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    const events = normalizeOllamaChunk(
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
    const events = normalizeOllamaChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'text_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('finish_reason=stop stream_end has finishReason=stop', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state
    );
    const streamEnd = events.find(e => e.type === 'stream_end');
    expect(streamEnd).toMatchObject({ type: 'stream_end', finishReason: 'stop' });
  });

  test('finish_reason=tool_calls emits tool_stop for pending tools + stream_end', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    normalizeOllamaChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fn', arguments: '' } }] },
          index: 0
        }]
      },
      state
    );
    const events = normalizeOllamaChunk(
      { choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }] },
      state
    );
    expect(events.some(e => e.type === 'tool_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('usage chunk emits usage event', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'usage', tokensIn: 100, tokensOut: 50 });
  });

  test('usage event fields cost/contextUsed/contextMax are 0', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state
    );
    expect(events[0]).toMatchObject({ type: 'usage', cost: 0, contextUsed: 0, contextMax: 0 });
  });

  test('unknown chunk type returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk({ type: 'ping' }, state);
    expect(events).toHaveLength(0);
  });

  test('empty choices array returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeOllamaChunk({ choices: [] }, state);
    expect(events).toHaveLength(0);
  });

  test('second assistant role chunk does not re-emit stream_start', () => {
    const state = createNormalizerState();
    normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    const events = normalizeOllamaChunk(
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state
    );
    expect(events.filter(e => e.type === 'stream_start')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Full stream sequence test
  // -------------------------------------------------------------------------

  test('full Format A stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_stop', index: 1 },
    ];

    const allEvents = chunks.flatMap(c => normalizeOllamaChunk(c, state));
    const types = allEvents.map(e => e.type);

    expect(types[0]).toBe('stream_start');
    expect(types).toContain('thinking_start');
    expect(types).toContain('thinking_delta');
    expect(types).toContain('thinking_stop');
    expect(types).toContain('text_start');
    expect(types).toContain('text_delta');
    expect(types).toContain('text_stop');

    expect(types.indexOf('thinking_start')).toBeLessThan(types.indexOf('thinking_stop'));
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('text_start'));
  });

  test('full Format B stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { id: 'chatcmpl-1', model: 'devstral', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      { usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
    ];

    const allEvents = chunks.flatMap(c => normalizeOllamaChunk(c, state));
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

    expect(types.indexOf('thinking_start')).toBeLessThan(types.indexOf('text_start'));
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('text_start'));
    const streamEndIdx = types.lastIndexOf('stream_end');
    expect(streamEndIdx).toBeGreaterThan(types.indexOf('text_stop'));
  });
});
