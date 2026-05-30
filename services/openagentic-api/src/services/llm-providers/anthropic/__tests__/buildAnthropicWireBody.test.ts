/**
 * Tests for buildAnthropicWireBody — pins the Anthropic Messages API
 * wire shape AnthropicProvider sends after Phase 0.4 migrated wire
 * conversion to the SDK adapter.
 *
 * Spec: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md §0.4
 */

import { describe, it, expect } from 'vitest';
import { buildAnthropicWireBody } from '../buildAnthropicWireBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseOpts = {
  model: 'claude-sonnet-4-5-20250929',
  parallelOn: true,
};

describe('buildAnthropicWireBody', () => {
  it('basic text turn: model + messages + max_tokens + temperature/top_p + system', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi.' },
        ],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 1,
      } as CompletionRequest,
      baseOpts,
    );

    expect(body.model).toBe('claude-sonnet-4-5-20250929');
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(1);
    // SDK adapter emits system as Anthropic-native array shape (the
    // Messages API accepts both string and array of text blocks).
    const system = body.system as any;
    if (typeof system === 'string') {
      expect(system).toBe('You are helpful.');
    } else {
      expect(system).toEqual([{ type: 'text', text: 'You are helpful.' }]);
    }
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
    ]);
  });

  it('tool_use parallel batch: 3 assistant tool_calls survive as 3 tool_use blocks in one message', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [
          { role: 'user', content: 'list 3 clouds' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'toolu_aws', type: 'function', function: { name: 'aws_ls', arguments: '{}' } },
              { id: 'toolu_gcp', type: 'function', function: { name: 'gcp_ls', arguments: '{}' } },
              { id: 'toolu_azure', type: 'function', function: { name: 'azure_ls', arguments: '{}' } },
            ],
          },
        ],
        max_tokens: 1024,
      } as CompletionRequest,
      baseOpts,
    );

    const assistantMsg = body.messages[1] as any;
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toHaveLength(3);
    expect(assistantMsg.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_aws',
      name: 'aws_ls',
      input: {},
    });
  });

  it('tool result: OpenAI role:tool → user with tool_result block (toolu_* id preserved)', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [
          { role: 'tool', tool_call_id: 'toolu_x', content: 'result' },
        ],
        max_tokens: 256,
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_x', content: 'result' },
      ],
    });
  });

  it('thinking block in assistant content is preserved with signature', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'let me think', signature: 'sig123' } as any,
              { type: 'text', text: 'answer' } as any,
            ] as any,
          },
        ],
        max_tokens: 256,
      } as CompletionRequest,
      baseOpts,
    );
    const msg = body.messages[0] as any;
    expect(msg.content[0]).toEqual({
      type: 'thinking',
      thinking: 'let me think',
      signature: 'sig123',
    });
    expect(msg.content[1]).toEqual({ type: 'text', text: 'answer' });
  });

  it('tools array: OpenAI shape → Anthropic shape with input_schema', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
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
        name: 'ls',
        description: 'List files',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
  });

  it('tool_choice auto + parallelOn=true → {type:auto, disable_parallel_tool_use:false}', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }],
        tool_choice: 'auto',
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: false });
  });

  it('tool_choice required + parallelOn=false → {type:any, disable_parallel_tool_use:true}', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }],
        tool_choice: 'required',
      } as CompletionRequest,
      { ...baseOpts, parallelOn: false },
    );
    expect(body.tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true });
  });

  it('tool_choice none → {type:none}', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }],
        tool_choice: 'none',
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.tool_choice).toEqual({ type: 'none' });
  });

  it('tool_choice named function → {type:tool, name, disable_parallel_tool_use}', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [{ type: 'function', function: { name: 'ls', description: '', parameters: {} } }],
        tool_choice: { type: 'function', function: { name: 'ls' } },
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'ls',
      disable_parallel_tool_use: false,
    });
  });

  it('thinking config: when supportsThinking AND budget provided, attaches thinking field', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      { ...baseOpts, supportsThinking: true, thinkingBudgetTokens: 8192 },
    );
    expect((body as any).thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
  });

  it('no thinking config: thinking field absent on wire', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );
    expect('thinking' in body).toBe(false);
  });

  it('outputSchema: structured-output configuration attached', () => {
    const body = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        outputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      } as CompletionRequest,
      baseOpts,
    );
    expect((body as any).output_config).toEqual({
      type: 'json_schema',
      schema: { type: 'object', properties: { x: { type: 'number' } } },
    });
  });

  it('stream: pass-through respects request.stream flag', () => {
    const stream = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        stream: true,
      } as CompletionRequest,
      baseOpts,
    );
    expect((stream as any).stream).toBe(true);

    const nonStream = buildAnthropicWireBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        stream: false,
      } as CompletionRequest,
      baseOpts,
    );
    expect((nonStream as any).stream).toBe(false);
  });
});
