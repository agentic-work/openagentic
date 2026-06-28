/**
 * Tests for buildOllamaWireBody — pins the wire shape OllamaProvider sends
 * to /api/chat now that the wire conversion lives in the SDK adapter.
 */

import { describe, it, expect } from 'vitest';
import { buildOllamaWireBody, sanitizeOllamaHistory } from '../buildOllamaWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseOpts = {
  modelName: 'gpt-oss:20b',
  keepAlive: '10m',
  modelSupportsTools: true,
  supportsThinking: false,
  stream: true,
};

describe('buildOllamaWireBody', () => {
  it('basic text turn: model + messages + options + stream + keep_alive', () => {
    const body = buildOllamaWireBody(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi.' },
        ],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );

    expect(body.model).toBe('gpt-oss:20b');
    expect(body.stream).toBe(true);
    expect(body.keep_alive).toBe('10m');
    expect((body.options as any).num_predict).toBe(100);
    expect((body.options as any).temperature).toBe(0.7);
    expect((body.options as any).top_p).toBe(1);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi.' },
    ]);
    expect(body.tools).toBeUndefined();
  });

  it('respects request.temperature + top_p overrides', () => {
    const body = buildOllamaWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.2,
        top_p: 0.95,
      } as CompletionRequest,
      baseOpts,
    );
    expect((body.options as any).temperature).toBe(0.2);
    expect((body.options as any).top_p).toBe(0.95);
  });

  it('tools present + model supports: tools array on wire', () => {
    const body = buildOllamaWireBody(
      {
        messages: [{ role: 'user', content: 'list files' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: {
              name: 'ls',
              description: 'List files',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
        ],
      } as CompletionRequest,
      baseOpts,
    );

    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'ls',
          description: 'List files',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
  });

  it('tools present + model does NOT support: tools stripped from wire', () => {
    const body = buildOllamaWireBody(
      {
        messages: [{ role: 'user', content: 'list files' }],
        max_tokens: 100,
        tools: [
          {
            type: 'function',
            function: { name: 'ls', description: 'x', parameters: {} },
          },
        ],
      } as CompletionRequest,
      { ...baseOpts, modelSupportsTools: false },
    );
    expect(body.tools).toBeUndefined();
  });

  it('tool_choice="none": Sev-0 — tools array stripped entirely (Ollama ignores tool_choice)', () => {
    const body = buildOllamaWireBody(
      {
        messages: [
          { role: 'user', content: 'sum these' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_x', type: 'function', function: { name: 'sum', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_x', content: '42' },
        ],
        max_tokens: 100,
        tool_choice: 'none',
        tools: [
          {
            type: 'function',
            function: { name: 'sum', description: 'x', parameters: {} },
          },
        ],
      } as CompletionRequest,
      baseOpts,
    );

    expect(body.tools).toBeUndefined();
  });

  it('supportsThinking: think=true on wire', () => {
    const body = buildOllamaWireBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      { ...baseOpts, supportsThinking: true },
    );
    expect((body as any).think).toBe(true);
  });

  it('!supportsThinking: no think key on wire', () => {
    const body = buildOllamaWireBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      baseOpts,
    );
    expect('think' in body).toBe(false);
  });

  it('assistant tool_calls preserved with id field via fromToolu(call_*)', () => {
    const body = buildOllamaWireBody(
      {
        messages: [
          { role: 'user', content: 'list' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_abc', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_abc', content: 'file1' },
        ],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );

    const messages = body.messages as any[];
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].id).toBe('call_abc');
    expect(assistantMsg.tool_calls[0].function.name).toBe('ls');

    // Ollama tool result message has NO tool_call_id field — paired by position
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg.content).toBe('file1');
    expect('tool_call_id' in toolMsg).toBe(false);
  });

  it('stream=false honored when caller asks for non-streaming', () => {
    const body = buildOllamaWireBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      { ...baseOpts, stream: false },
    );
    expect(body.stream).toBe(false);
  });

  it('response_format:{type:"json_object"} → Ollama format:"json"', () => {
    const body = buildOllamaWireBody(
      {
        messages: [{ role: 'user', content: 'Emit a JSON object.' }],
        max_tokens: 200,
        response_format: { type: 'json_object' },
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.format).toBe('json');
  });

  it('response_format:{type:"json_schema",json_schema:{schema}} → Ollama format:<schema>', () => {
    const schema = {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' } },
    };
    const body = buildOllamaWireBody(
      {
        messages: [{ role: 'user', content: 'Emit a typed object.' }],
        max_tokens: 200,
        response_format: { type: 'json_schema', json_schema: { schema } },
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.format).toEqual(schema);
  });

  it('no response_format → no format field on wire body', () => {
    const body = buildOllamaWireBody(
      { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 } as CompletionRequest,
      baseOpts,
    );
    expect(body.format).toBeUndefined();
  });
});

describe('sanitizeOllamaHistory', () => {
  it('drops orphan tool messages (no preceding assistant with tool_calls)', () => {
    const out = sanitizeOllamaHistory([
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'orphan' },
      { role: 'assistant', content: 'ok' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('drops empty assistants with no tool_calls', () => {
    const out = sanitizeOllamaHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: '  ' },
      { role: 'assistant', content: 'real answer' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'real answer' },
    ]);
  });

  it('keeps empty assistant with tool_calls', () => {
    const out = sanitizeOllamaHistory([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_x', function: { name: 'f', arguments: {} } }] },
      { role: 'tool', content: 'result' },
    ]);
    expect(out).toHaveLength(3);
  });

  it('keeps tool message when preceded by assistant with tool_calls', () => {
    const input = [
      { role: 'user', content: 'list' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_x', function: { name: 'ls', arguments: {} } }] },
      { role: 'tool', content: 'file1' },
    ];
    expect(sanitizeOllamaHistory(input)).toEqual(input);
  });

  it('does not mutate input array', () => {
    const input = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ];
    const frozenLen = input.length;
    sanitizeOllamaHistory(input);
    expect(input).toHaveLength(frozenLen);
  });
});
