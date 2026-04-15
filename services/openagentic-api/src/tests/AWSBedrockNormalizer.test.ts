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
 * AWSBedrockNormalizer Unit Tests
 * TDD: written before implementation to drive the normalizeBedrockChunk API.
 *
 * AWSBedrockProvider emits TWO kinds of chunks:
 *   Format A — Anthropic-style (Claude path via InvokeModelWithResponseStream)
 *   Format B — OpenAI-style   (Converse API path for non-Claude models)
 */

import { describe, test, expect } from 'vitest';
import { createNormalizerState } from '../services/llm-providers/ILLMProvider.js';
import { normalizeBedrockChunk } from '../services/llm-providers/AWSBedrockProvider.js';

// ---------------------------------------------------------------------------
// Format A — Anthropic-style events (Claude path)
// ---------------------------------------------------------------------------

describe('AWS Bedrock normalizer — Format A (Anthropic-style)', () => {
  test('message_start emits stream_start', () => {
    const state = createNormalizerState();
    const chunk = {
      type: 'message_start',
      message: { id: 'msg-bedrock-1', model: 'us.anthropic.claude-sonnet-4-6', usage: { input_tokens: 200 } },
    };
    const events = normalizeBedrockChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'stream_start',
      messageId: 'msg-bedrock-1',
      model: 'us.anthropic.claude-sonnet-4-6',
      provider: 'aws-bedrock',
    });
    expect(state.streamStartEmitted).toBe(true);
  });

  test('content_block_start with thinking emits thinking_start', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    const chunk = { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } };
    const events = normalizeBedrockChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'thinking_start', id: 'tk-0' });
  });

  test('content_block_delta with thinking_delta emits thinking_delta with accumulated', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    // Setup thinking block
    normalizeBedrockChunk({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, state);
    const events = normalizeBedrockChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'analyzing...' } },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('analyzing...');
      expect(events[0].accumulated).toBe('analyzing...');
    }
  });

  test('thinking accumulates across multiple deltas', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, state);
    normalizeBedrockChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'first ' } },
      state,
    );
    const events = normalizeBedrockChunk(
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'second' } },
      state,
    );
    expect(events[0].type).toBe('thinking_delta');
    if (events[0].type === 'thinking_delta') {
      expect(events[0].content).toBe('second');
      expect(events[0].accumulated).toBe('first second');
    }
  });

  test('content_block_stop after thinking emits thinking_stop with elapsedMs', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, state);
    const events = normalizeBedrockChunk({ type: 'content_block_stop', index: 0 }, state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('thinking_stop');
    if (events[0].type === 'thinking_stop') {
      expect(events[0].id).toBe('tk-0');
      expect(events[0].elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('content_block_start with text emits text_start', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    const chunk = { type: 'content_block_start', index: 1, content_block: { type: 'text' } };
    const events = normalizeBedrockChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_start', id: 'txt-1' });
  });

  test('content_block_delta with text_delta emits text_delta', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }, state);
    const events = normalizeBedrockChunk(
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'hello ' } },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', id: 'txt-1', content: 'hello ' });
  });

  test('content_block_stop after text emits text_stop', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }, state);
    const events = normalizeBedrockChunk({ type: 'content_block_stop', index: 1 }, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_stop', id: 'txt-1' });
  });

  test('content_block_start with tool_use emits tool_start', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    const chunk = {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'call-bedrock-1', name: 'list_pods' },
    };
    const events = normalizeBedrockChunk(chunk, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_start', id: 'call-bedrock-1', toolName: 'list_pods', serverName: '' });
  });

  test('content_block_delta with input_json_delta emits tool_delta', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk(
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-bedrock-1', name: 'list_pods' } },
      state,
    );
    const events = normalizeBedrockChunk(
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"namespace":' } },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_delta', id: 'call-bedrock-1', argsFragment: '{"namespace":' });
  });

  test('content_block_stop after tool_use emits tool_stop', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    normalizeBedrockChunk(
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-bedrock-1', name: 'list_pods' } },
      state,
    );
    const events = normalizeBedrockChunk({ type: 'content_block_stop', index: 2 }, state);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tool_stop', id: 'call-bedrock-1', result: null, durationMs: 0 });
  });

  test('message_delta with usage emits usage event', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    state.inputTokens = 200;
    const chunk = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } };
    const events = normalizeBedrockChunk(chunk, state);
    expect(events.some(e => e.type === 'usage')).toBe(true);
    const usageEvent = events.find(e => e.type === 'usage');
    if (usageEvent?.type === 'usage') {
      expect(usageEvent.tokensIn).toBe(200);
      expect(usageEvent.tokensOut).toBe(300);
    }
  });

  test('message_stop emits stream_end', () => {
    const state = createNormalizerState();
    state.streamStartEmitted = true;
    const events = normalizeBedrockChunk({ type: 'message_stop' }, state);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('unknown event type returns empty array', () => {
    const state = createNormalizerState();
    const events = normalizeBedrockChunk({ type: 'ping' }, state);
    expect(events).toHaveLength(0);
  });

  test('full Claude-style stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { type: 'message_start', message: { id: 'msg-1', model: 'us.anthropic.claude-sonnet-4-6', usage: { input_tokens: 100 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'let me think' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello!' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } },
      { type: 'message_stop' },
    ];

    const allEvents = chunks.flatMap(c => normalizeBedrockChunk(c, state));
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
});

// ---------------------------------------------------------------------------
// Format B — OpenAI-style events (Converse API path for non-Claude models)
// ---------------------------------------------------------------------------

describe('AWS Bedrock normalizer — Format B (Converse API / OpenAI-style)', () => {
  test('first chunk with role=assistant emits stream_start + synthetic thinking', () => {
    const state = createNormalizerState();
    const events = normalizeBedrockChunk(
      { id: 'bedrock-converse-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0]).toMatchObject({ type: 'stream_start', provider: 'aws-bedrock' });
    expect(events[1].type).toBe('thinking_start');
    expect(events[2].type).toBe('thinking_delta');
    expect(state.streamStartEmitted).toBe(true);
  });

  test('stream_start event includes messageId and model', () => {
    const state = createNormalizerState();
    const events = normalizeBedrockChunk(
      { id: 'bedrock-converse-abc', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    expect(events[0]).toMatchObject({ type: 'stream_start', messageId: 'bedrock-converse-abc', model: 'amazon.nova-pro-v1:0' });
  });

  test('synthetic thinking_delta content is Processing', () => {
    const state = createNormalizerState();
    const events = normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    const thinkDelta = events.find(e => e.type === 'thinking_delta');
    expect(thinkDelta).toBeDefined();
    if (thinkDelta?.type === 'thinking_delta') {
      expect(thinkDelta.content).toBe('Processing');
    }
  });

  test('delta.content closes synthetic thinking and emits text', () => {
    const state = createNormalizerState();
    normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    const events = normalizeBedrockChunk(
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      state,
    );
    expect(events.some(e => e.type === 'thinking_stop')).toBe(true);
    expect(events.some(e => e.type === 'text_start')).toBe(true);
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
    const textDelta = events.find(e => e.type === 'text_delta');
    if (textDelta?.type === 'text_delta') {
      expect(textDelta.content).toBe('Hello');
    }
  });

  test('subsequent text deltas only emit text_delta', () => {
    const state = createNormalizerState();
    normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    normalizeBedrockChunk({ choices: [{ delta: { content: 'Hello' }, index: 0 }] }, state);
    const events = normalizeBedrockChunk(
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'text_delta', content: ' world' });
  });

  test('finish_reason=stop emits text_stop + stream_end', () => {
    const state = createNormalizerState();
    state.textBlockId = 'txt-0';
    const events = normalizeBedrockChunk(
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      state,
    );
    expect(events.some(e => e.type === 'text_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
    const streamEnd = events.find(e => e.type === 'stream_end');
    expect(streamEnd).toMatchObject({ type: 'stream_end', finishReason: 'stop' });
  });

  test('finish_reason=tool_calls emits tool_stop for pending tools + stream_end', () => {
    const state = createNormalizerState();
    normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    normalizeBedrockChunk(
      {
        choices: [{
          delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fn', arguments: '' } }] },
          index: 0,
        }],
      },
      state,
    );
    const events = normalizeBedrockChunk(
      { choices: [{ finish_reason: 'tool_calls', delta: {}, index: 0 }] },
      state,
    );
    expect(events.some(e => e.type === 'tool_stop')).toBe(true);
    expect(events.some(e => e.type === 'stream_end')).toBe(true);
  });

  test('usage chunk emits usage event', () => {
    const state = createNormalizerState();
    const events = normalizeBedrockChunk(
      { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'usage', tokensIn: 100, tokensOut: 50, cost: 0, contextUsed: 0, contextMax: 0 });
  });

  test('second assistant role chunk does not re-emit stream_start', () => {
    const state = createNormalizerState();
    normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    const events = normalizeBedrockChunk(
      { id: 'bedrock-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      state,
    );
    expect(events.filter(e => e.type === 'stream_start')).toHaveLength(0);
  });

  test('full Converse-style stream sequence produces correct event order', () => {
    const state = createNormalizerState();
    const chunks = [
      { id: 'bedrock-converse-1', model: 'amazon.nova-pro-v1:0', choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      { choices: [{ delta: { content: 'Hello' }, index: 0 }] },
      { choices: [{ delta: { content: ' world' }, index: 0 }] },
      { choices: [{ finish_reason: 'stop', delta: {}, index: 0 }] },
      { usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 } },
    ];

    const allEvents = chunks.flatMap(c => normalizeBedrockChunk(c, state));
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

    // Ordering constraints
    expect(types.indexOf('thinking_start')).toBeLessThan(types.indexOf('text_start'));
    expect(types.indexOf('thinking_stop')).toBeLessThan(types.indexOf('text_start'));
    expect(types.lastIndexOf('stream_end')).toBeGreaterThan(types.indexOf('text_stop'));
  });
});
