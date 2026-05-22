/**
 * convertAnthropicMessagesToOpenAI — coverage for the AIF chat-completions
 * Anthropic→OpenAI message translator.
 *
 * Live repro (2026-05-06, mcp-tester pod openagentic-2cb1bf3f719f):
 *   AIF API error: 400 Bad Request - "Model does not support request
 *   argument supplied: Message has tool role, but there was no previous
 *   assistant message with a tool call!"
 *
 * Root cause: openagentic persists parallel tool batches as CONSECUTIVE
 * `{role:'assistant', content:[{type:'tool_use'}]}` rows (one per parallel
 * call). Sonnet/Anthropic accepts this; Azure AI Foundry rejects unless
 * parallel calls are folded into a single `tool_calls[]` array on a single
 * assistant message. This test pins the fix so the regression can't return.
 */
import { describe, it, expect } from 'vitest';
import { convertAnthropicMessagesToOpenAI } from '../AzureAIFoundryProvider.js';

describe('convertAnthropicMessagesToOpenAI', () => {
  it('passes plain user/assistant string-content messages through unchanged', () => {
    const out = convertAnthropicMessagesToOpenAI([
      { role: 'user', content: 'hi' } as any,
      { role: 'assistant', content: 'hello' } as any,
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('hoists Anthropic system-shape into a system OpenAI message', () => {
    const out = convertAnthropicMessagesToOpenAI([
      { role: 'system', content: 'you are helpful' } as any,
      { role: 'user', content: 'hi' } as any,
    ]);
    expect(out[0]).toEqual({ role: 'system', content: 'you are helpful' });
  });

  it('splits a user `tool_result` content block into a top-level tool message', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_A', name: 'Bash', input: { command: 'ls' } },
        ],
      } as any,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'a.txt b.txt' }],
      } as any,
    ]);
    expect(out).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'toolu_A', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } }],
      },
      { role: 'tool', tool_call_id: 'toolu_A', content: 'a.txt b.txt' },
    ]);
  });

  // ────────────────────────────────────────────────────────────────────
  // The bug. Two consecutive assistant tool_use rows MUST become a
  // single assistant message with two entries in tool_calls[].
  // ────────────────────────────────────────────────────────────────────
  it('merges consecutive parallel-batch assistant tool_use rows into one tool_calls[]', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_A', name: 'Read', input: { path: '/a' } }],
      } as any,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_B', name: 'Read', input: { path: '/b' } }],
      } as any,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'A' }],
      } as any,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_B', content: 'B' }],
      } as any,
    ]);
    // Must be exactly: 1 assistant + 2 tool. Three or four messages would
    // be the broken shape AIF rejects.
    expect(out).toHaveLength(3);
    const assistant = out[0] as any;
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls[0].id).toBe('toolu_A');
    expect(assistant.tool_calls[1].id).toBe('toolu_B');
    expect(out[1]).toMatchObject({ role: 'tool', tool_call_id: 'toolu_A' });
    expect(out[2]).toMatchObject({ role: 'tool', tool_call_id: 'toolu_B' });
  });

  it('does NOT merge across an intervening tool/user message (preserves real turn breaks)', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_A', name: 'Read', input: { path: '/a' } }],
      } as any,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'A' }],
      } as any,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_B', name: 'Read', input: { path: '/b' } }],
      } as any,
    ]);
    expect(out).toHaveLength(3);
    expect((out[0] as any).tool_calls).toHaveLength(1);
    expect((out[2] as any).tool_calls).toHaveLength(1);
  });

  it('passes through pre-existing OpenAI-shape assistant.tool_calls + tool messages', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_X', type: 'function', function: { name: 'F', arguments: '{}' } }],
      } as any,
      { role: 'tool', tool_call_id: 'call_X', content: 'ok' } as any,
    ]);
    expect(out).toEqual([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_X', type: 'function', function: { name: 'F', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_X', content: 'ok' },
    ]);
  });

  it('drops thinking blocks from assistant content (OpenAI shape has no thinking)', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'plan...' },
          { type: 'text', text: 'final' },
        ],
      } as any,
    ]);
    expect(out).toEqual([{ role: 'assistant', content: 'final' }]);
  });

  it('skips tool_use blocks with empty/missing id (cannot map to call_id)', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: '', name: 'Bad', input: {} }],
      } as any,
    ]);
    // No emitted message — no text, no valid tool_calls
    expect(out).toEqual([]);
  });

  it('skips tool_result blocks with empty tool_use_id rather than emit invalid tool message', () => {
    const out = convertAnthropicMessagesToOpenAI([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: '', content: 'orphan' }],
      } as any,
    ]);
    expect(out).toEqual([]);
  });

  // Multimodal drag-drop regression — RED 2026-05-08.
  //
  // V2 chat pipeline (post-fix fb7a748) emits OpenAI-shape user content
  // arrays `[{type:'text'}, {type:'image_url', image_url:{url:…}}]` when
  // attachments are present. AIF's normalizer used to drop the image_url
  // block silently — the model received text-only and replied "please
  // upload the image first". Live evidence: dev 2026-05-08 11:31,
  // gpt-5.4 deployment, VISION DEBUG logged 111080-byte base64 reaching
  // the handler but model still asked for upload.
  describe('multimodal user content (image_url passthrough)', () => {
    it('preserves image_url blocks alongside text in user content array', () => {
      const out = convertAnthropicMessagesToOpenAI([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this image' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0K' } },
          ],
        } as any,
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].role).toBe('user');
      expect(Array.isArray(out[0].content)).toBe(true);
      const blocks = out[0].content as any[];
      expect(blocks).toEqual(
        expect.arrayContaining([
          { type: 'text', text: 'describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0K' } },
        ]),
      );
    });

    it('passes through Anthropic-style image source blocks as image_url', () => {
      const out = convertAnthropicMessagesToOpenAI([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' },
            },
          ],
        } as any,
      ]);
      expect(out).toHaveLength(1);
      expect(Array.isArray(out[0].content)).toBe(true);
      const blocks = out[0].content as any[];
      const img = blocks.find((b: any) => b.type === 'image_url');
      expect(img).toBeTruthy();
      expect(img.image_url.url).toBe('data:image/jpeg;base64,/9j/4AAQ');
    });

    it('still flattens to string content when no image blocks are present', () => {
      const out = convertAnthropicMessagesToOpenAI([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        } as any,
      ]);
      expect(out).toEqual([{ role: 'user', content: 'hello\nworld' }]);
    });
  });
});
