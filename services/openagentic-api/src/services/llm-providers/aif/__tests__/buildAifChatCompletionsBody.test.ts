/**
 * Tests for buildAifChatCompletionsBody — Phase 0.4 wire helper for AIF
 * Chat Completions API (non-Responses path). Routes through SDK's
 * `'openai'` adapter for the messages/tools shape; AIF model-family
 * surgery (gpt-5 temperature=1, o-series no top_p, max_completion_tokens
 * vs max_tokens) layered on top.
 */

import { describe, it, expect } from 'vitest';
import { buildAifChatCompletionsBody } from '../buildAifChatCompletionsBody.js';
import type { CompletionRequest } from '../../ILLMProvider.js';

const baseOpts = {
  model: 'gpt-5.4',
  defaultTemperature: 1.0,
};

describe('buildAifChatCompletionsBody', () => {
  it('basic text turn: model + messages + max_tokens + stream', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi.' },
        ],
        max_tokens: 64,
        stream: true,
      } as CompletionRequest,
      baseOpts,
    );
    expect(body.model).toBe('gpt-5.4');
    expect(body.stream).toBe(true);
    expect((body as any).stream_options).toEqual({ include_usage: true });
    // GPT-5.x uses max_completion_tokens, not max_tokens
    expect((body as any).max_completion_tokens).toBe(64);
    expect((body as any).max_tokens).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi.' },
    ]);
  });

  it('gpt-5.x: temperature is STRIPPED (Azure rejects temperature !== 1)', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.5,
      } as CompletionRequest,
      baseOpts,
    );
    expect((body as any).temperature).toBeUndefined();
  });

  it('non-gpt-5 model: temperature is preserved or defaulted', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.5,
      } as CompletionRequest,
      { ...baseOpts, model: 'gpt-4.1' },
    );
    expect((body as any).temperature).toBe(0.5);
  });

  it('o-series (o1/o3): no temperature, no top_p, max_completion_tokens', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        temperature: 0.5,
        top_p: 0.9,
      } as CompletionRequest,
      { ...baseOpts, model: 'o3-mini' },
    );
    expect((body as any).temperature).toBeUndefined();
    expect((body as any).top_p).toBeUndefined();
    expect((body as any).max_completion_tokens).toBe(100);
    expect((body as any).max_tokens).toBeUndefined();
  });

  it('non-gpt-5 non-reasoning model: max_tokens (not max_completion_tokens)', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      { ...baseOpts, model: 'gpt-4.1' },
    );
    expect((body as any).max_tokens).toBe(100);
    expect((body as any).max_completion_tokens).toBeUndefined();
  });

  it('tools array: OpenAI shape pass-through with normalizeAifToolParameters', () => {
    const body = buildAifChatCompletionsBody(
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
        tool_choice: 'auto',
      } as CompletionRequest,
      baseOpts,
    );
    expect((body as any).tools).toHaveLength(1);
    expect((body as any).tools[0].type).toBe('function');
    expect((body as any).tools[0].function.name).toBe('ls');
    expect((body as any).tools[0].function.parameters.type).toBe('object');
    expect((body as any).tool_choice).toBe('auto');
  });

  it('tool_choice none → tools array still present (model decides serial via the gate, not stripping)', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tools: [{ type: 'function', function: { name: 'x', description: '', parameters: {} } }],
        tool_choice: 'none',
      } as CompletionRequest,
      baseOpts,
    );
    // AIF honors tool_choice='none' (unlike Ollama), so we DON'T strip tools[]
    expect((body as any).tools).toHaveLength(1);
    expect((body as any).tool_choice).toBe('none');
  });

  it('parallel tool batch: SDK adapter folds multiple assistant tool_calls into single message', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [
          { role: 'user', content: 'list 3 clouds' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_a', type: 'function', function: { name: 'a', arguments: '{}' } },
              { id: 'call_b', type: 'function', function: { name: 'b', arguments: '{}' } },
              { id: 'call_c', type: 'function', function: { name: 'c', arguments: '{}' } },
            ],
          },
        ],
        max_tokens: 1024,
      } as CompletionRequest,
      baseOpts,
    );
    const asst = (body.messages as any[]).find((m) => m.role === 'assistant');
    expect(asst.tool_calls).toHaveLength(3);
    expect(asst.tool_calls.map((tc: any) => tc.id)).toEqual(['call_a', 'call_b', 'call_c']);
  });

  it('reasoning_effort: pass through when present', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        reasoning_effort: 'high',
      } as any,
      baseOpts,
    );
    expect((body as any).reasoning_effort).toBe('high');
  });

  it('stream=false: stream key OMITTED from body (Azure misinterprets explicit false)', () => {
    // Sev-1 audit (2026-05-12 round 2): Azure Chat Completions can
    // misinterpret an explicit `stream:false` body field on some
    // deployments — better to omit entirely (the default is non-stream).
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        stream: false,
      } as CompletionRequest,
      baseOpts,
    );
    expect('stream' in body).toBe(false);
    expect((body as any).stream_options).toBeUndefined();
  });

  it('stream=undefined: stream key OMITTED (default non-stream, same as stream=false)', () => {
    const body = buildAifChatCompletionsBody(
      {
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
      } as CompletionRequest,
      baseOpts,
    );
    // The 2026-05-12 round-1 contract was `stream: request.stream ?? true`,
    // which set stream:true here. Round-2 audit: default to non-streaming
    // when caller omits. The chat pipeline always sets stream:true
    // explicitly; non-streaming callers (admin Test Provider, batch
    // probe) leave it undefined.
    expect('stream' in body).toBe(false);
  });
});
