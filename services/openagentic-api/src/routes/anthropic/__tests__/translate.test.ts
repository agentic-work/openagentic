/**
 * Unit tests for the pure Anthropic ↔ internal translation functions.
 * No Fastify, no DB, no providers — pure data mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  anthropicToCompletionRequest,
  completionResponseToAnthropic,
  type AnthropicRequestBody,
} from '../translate.js';
import type { CompletionResponse } from '../../../services/llm-providers/ILLMProvider.js';

// ---------------------------------------------------------------------------
// anthropicToCompletionRequest
// ---------------------------------------------------------------------------

describe('anthropicToCompletionRequest', () => {
  it('translates a simple string-content user message', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'Hello!' }],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]).toEqual({ role: 'user', content: 'Hello!' });
    expect(req.model).toBe('claude-opus-4-5');
    expect(req.stream).toBe(false);
  });

  it('translates stream:true', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.stream).toBe(true);
  });

  it('prepends system string as role:system', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(req.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(req.messages).toHaveLength(2);
  });

  it('prepends system as array of text blocks (joined)', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      system: [
        { type: 'text', text: 'Part one.' },
        { type: 'text', text: 'Part two.' },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages[0]).toEqual({ role: 'system', content: 'Part one.\nPart two.' });
  });

  it('translates multi-text-block user message (joined)', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: 'World' },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages[0]).toEqual({ role: 'user', content: 'Hello\nWorld' });
  });

  it('translates assistant tool_use block → tool_calls', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_123',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages).toHaveLength(1);
    const msg = req.messages[0];
    expect(msg.role).toBe('assistant');
    expect(msg.content).toBe('');
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toEqual({
      id: 'tu_123',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
    });
  });

  it('translates assistant message with text + tool_use', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check that.' },
            {
              type: 'tool_use',
              id: 'tu_456',
              name: 'search',
              input: { query: 'foo' },
            },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    const msg = req.messages[0];
    expect(msg.content).toBe('Let me check that.');
    expect(msg.tool_calls![0].function.name).toBe('search');
  });

  it('translates user tool_result block → role:tool message', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_123',
              content: 'Sunny, 72°F',
            },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]).toEqual({
      role: 'tool',
      content: 'Sunny, 72°F',
      tool_call_id: 'tu_123',
    });
  });

  it('translates user tool_result with array content', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_789',
              content: [
                { type: 'text', text: 'Line 1' },
                { type: 'text', text: 'Line 2' },
              ],
            },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages[0]).toMatchObject({
      role: 'tool',
      content: 'Line 1\nLine 2',
      tool_call_id: 'tu_789',
    });
  });

  it('emits separate tool messages for multiple tool_results', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_a', content: 'Result A' },
            { type: 'tool_result', tool_use_id: 'tu_b', content: 'Result B' },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]).toMatchObject({ role: 'tool', tool_call_id: 'tu_a', content: 'Result A' });
    expect(req.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'tu_b', content: 'Result B' });
  });

  it('user message with text blocks AND a tool_result emits both', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the result:' },
            { type: 'tool_result', tool_use_id: 'tu_c', content: 'Data' },
          ],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    // text block → user message, tool_result → tool message
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]).toEqual({ role: 'user', content: 'Here is the result:' });
    expect(req.messages[1]).toMatchObject({ role: 'tool', tool_call_id: 'tu_c' });
  });

  it('translates tools array', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.tools).toHaveLength(1);
    expect(req.tools![0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    });
  });

  it('translates tool_choice:auto', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: { type: 'auto' },
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.tool_choice).toBe('auto');
  });

  it('translates tool_choice:any → required', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: { type: 'any' },
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.tool_choice).toBe('required');
  });

  it('translates tool_choice:tool → {type:function, function:{name}}', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('copies max_tokens, temperature, top_p', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.9,
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.max_tokens).toBe(1024);
    expect(req.temperature).toBe(0.7);
    expect(req.top_p).toBe(0.9);
  });

  it('does not include tools key when no tools provided', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.tools).toBeUndefined();
  });

  it('full agentic round-trip: system + user + assistant tool_use + user tool_result', () => {
    const body: AnthropicRequestBody = {
      model: 'claude-opus-4-5',
      system: 'You are an assistant.',
      messages: [
        { role: 'user', content: 'What is the weather in NYC?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'NYC' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Sunny, 72°F' }],
        },
      ],
    };
    const req = anthropicToCompletionRequest(body);
    expect(req.messages[0]).toMatchObject({ role: 'system', content: 'You are an assistant.' });
    expect(req.messages[1]).toMatchObject({ role: 'user', content: 'What is the weather in NYC?' });
    expect(req.messages[2]).toMatchObject({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'tu_1' })] });
    expect(req.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'tu_1', content: 'Sunny, 72°F' });
  });
});

// ---------------------------------------------------------------------------
// completionResponseToAnthropic
// ---------------------------------------------------------------------------

describe('completionResponseToAnthropic', () => {
  const makeResp = (overrides: Partial<CompletionResponse> = {}): CompletionResponse => ({
    id: 'cmpl-abc123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'claude-opus-4-5',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello from Claude!' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  });

  it('maps a text response correctly', () => {
    const resp = makeResp();
    const out = completionResponseToAnthropic(resp, 'claude-opus-4-5');
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.model).toBe('claude-opus-4-5');
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({ type: 'text', text: 'Hello from Claude!' });
    expect(out.stop_reason).toBe('end_turn');
    expect(out.stop_sequence).toBeNull();
    expect(out.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('maps stop → end_turn', () => {
    const out = completionResponseToAnthropic(makeResp(), 'model');
    expect(out.stop_reason).toBe('end_turn');
  });

  it('maps length → max_tokens', () => {
    const resp = makeResp({ choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'length' }] });
    const out = completionResponseToAnthropic(resp, 'model');
    expect(out.stop_reason).toBe('max_tokens');
  });

  it('maps tool_calls → tool_use (finish_reason)', () => {
    const resp = makeResp({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_xyz',
                type: 'function',
                function: { name: 'my_tool', arguments: '{"k":"v"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const out = completionResponseToAnthropic(resp, 'claude-opus-4-5');
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_xyz',
      name: 'my_tool',
      input: { k: 'v' },
    });
  });

  it('maps tool_calls with text content to text + tool_use blocks', () => {
    const resp = makeResp({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Sure, let me look that up.',
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const out = completionResponseToAnthropic(resp, 'model');
    expect(out.content).toHaveLength(2);
    expect(out.content[0]).toEqual({ type: 'text', text: 'Sure, let me look that up.' });
    expect(out.content[1]).toMatchObject({ type: 'tool_use', id: 'call_abc', name: 'lookup' });
  });

  it('uses response id when present', () => {
    const out = completionResponseToAnthropic(makeResp({ id: 'chatcmpl-test-id' }), 'model');
    expect(out.id).toBe('chatcmpl-test-id');
  });

  it('generates an id when response id is missing', () => {
    const resp = makeResp({ id: '' });
    const out = completionResponseToAnthropic(resp, 'model');
    expect(out.id).toMatch(/^msg_/);
  });

  it('maps usage tokens correctly', () => {
    const resp = makeResp({ usage: { prompt_tokens: 42, completion_tokens: 17, total_tokens: 59 } });
    const out = completionResponseToAnthropic(resp, 'model');
    expect(out.usage.input_tokens).toBe(42);
    expect(out.usage.output_tokens).toBe(17);
  });
});
