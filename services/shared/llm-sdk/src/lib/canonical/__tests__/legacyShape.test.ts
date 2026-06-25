/**
 * Tests for `legacyShape.ts` — the bridge that lets api providers stop
 * hand-rolling wire conversion and instead delegate to `selectOutboundAdapter`.
 *
 * Input: legacy `CompletionRequest`-like shape (OpenAI-flat OR mixed
 * Anthropic content blocks — see `convertAnthropicMessagesToOpenAI` for the
 * heterogeneous reality this helper has to normalize).
 *
 * Output: a `CanonicalRequest` ready to hand to any of the 6 adapters.
 */

import { describe, it, expect } from 'vitest';
import { completionRequestToCanonical } from '../legacyShape.js';

describe('completionRequestToCanonical', () => {
  it('OpenAI-flat: system + user text', () => {
    const out = completionRequestToCanonical({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi.' },
      ],
      max_tokens: 1024,
    });
    expect(out.system).toBe('You are helpful.');
    expect(out.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi.' }] },
    ]);
    expect(out.max_tokens).toBe(1024);
    expect(out.tools).toEqual([]);
    expect(out.tool_choice).toEqual({ type: 'auto' });
  });

  it('OpenAI-flat: assistant with tool_calls → tool_use blocks (toolu_* ids)', () => {
    const out = completionRequestToCanonical({
      messages: [
        { role: 'user', content: 'list files' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc123',
              type: 'function',
              function: { name: 'ls', arguments: '{"path":"/"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_abc123', content: 'file1\nfile2' },
      ],
      max_tokens: 256,
    });

    // assistant message has tool_use block with canonical id
    const assistant = out.messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toHaveLength(1);
    expect(assistant.content[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_call_abc123',
      name: 'ls',
      input: { path: '/' },
    });

    // tool role → user with tool_result block, same canonical id
    const toolResult = out.messages[2];
    expect(toolResult.role).toBe('user');
    expect(toolResult.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_call_abc123',
      content: 'file1\nfile2',
    });
  });

  it('Anthropic-shape input: tool_use + tool_result blocks pass through with canonical ids', () => {
    const out = completionRequestToCanonical({
      messages: [
        { role: 'user', content: 'list files' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'sure' },
            { type: 'tool_use', id: 'toolu_xyz', name: 'ls', input: { path: '/' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'file1' },
          ],
        },
      ],
      max_tokens: 256,
    });

    expect(out.messages[1].content).toHaveLength(2);
    expect((out.messages[1].content[1] as any).id).toBe('toolu_xyz');
    expect((out.messages[2].content[0] as any).tool_use_id).toBe('toolu_xyz');
  });

  it('tools[]: OpenAI-shape function defs → CanonicalTool[]', () => {
    const out = completionRequestToCanonical({
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
    });

    expect(out.tools).toEqual([
      {
        name: 'ls',
        description: 'List files',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
  });

  it('tool_choice mapping: required→any, none→none, named function→tool', () => {
    const t = (
      tc: any,
    ): any =>
      completionRequestToCanonical({
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 100,
        tool_choice: tc,
      }).tool_choice;

    expect(t('auto')).toEqual({ type: 'auto' });
    expect(t('required')).toEqual({ type: 'any' });
    expect(t('none')).toEqual({ type: 'none' });
    expect(t({ type: 'function', function: { name: 'ls' } })).toEqual({
      type: 'tool',
      name: 'ls',
    });
  });

  it('multimodal user: text + image_url block preserved as image with url source', () => {
    const out = completionRequestToCanonical({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
      max_tokens: 100,
    });

    expect(out.messages[0].content).toEqual([
      { type: 'text', text: 'describe this' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'abc',
        },
      },
    ]);
  });

  it('parallel tool batch: assistant with multiple tool_calls preserved as multiple tool_use blocks', () => {
    const out = completionRequestToCanonical({
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'a', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'b', arguments: '{}' } },
          ],
        },
      ],
      max_tokens: 100,
    });

    expect(out.messages[0].content).toHaveLength(2);
    expect((out.messages[0].content[0] as any).id).toBe('toolu_call_1');
    expect((out.messages[0].content[1] as any).id).toBe('toolu_call_2');
  });

  it('multiple system messages: concatenated with newlines', () => {
    const out = completionRequestToCanonical({
      messages: [
        { role: 'system', content: 'rule 1' },
        { role: 'system', content: 'rule 2' },
        { role: 'user', content: 'hi' },
      ],
      max_tokens: 100,
    });
    expect(out.system).toBe('rule 1\nrule 2');
  });

  it('no system: system field is null', () => {
    const out = completionRequestToCanonical({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    });
    expect(out.system).toBeNull();
  });

  it('stop sequences pass through', () => {
    const out = completionRequestToCanonical({
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
      stop: ['END', 'STOP'],
    });
    expect(out.stop_sequences).toEqual(['END', 'STOP']);
  });

  it('thinking block in assistant: preserved with signature', () => {
    const out = completionRequestToCanonical({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me think', signature: 'sig-base64' },
            { type: 'text', text: 'answer' },
          ],
        },
      ],
      max_tokens: 100,
    });

    expect(out.messages[0].content[0]).toEqual({
      type: 'thinking',
      thinking: 'let me think',
      signature: 'sig-base64',
    });
  });

  it('default max_tokens when omitted: 4096', () => {
    const out = completionRequestToCanonical({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.max_tokens).toBe(4096);
  });

  it('malformed tool_call arguments: parses as empty object instead of throwing', () => {
    const out = completionRequestToCanonical({
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_bad', type: 'function', function: { name: 'x', arguments: 'NOT_JSON' } },
          ],
        },
      ],
      max_tokens: 100,
    });

    expect((out.messages[0].content[0] as any).input).toEqual({});
  });
});
