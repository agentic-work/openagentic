/**
 * stripCacheControl — deep-copy helper that removes `cache_control` fields
 * from every content block in a CanonicalMessage[]. Used by all adapters
 * targeting providers other than Anthropic-shape (OpenAI, Ollama, Vertex
 * Gemini, AIF Responses). Audit L5-4.
 *
 * the design notes
 *        §"Phase 0.2 — SDK shared canonical invariants"
 */
import { describe, it, expect } from 'vitest';
import { stripCacheControl } from '../stripCacheControl.js';
import type { CanonicalMessage } from '../types.js';

describe('stripCacheControl', () => {
  it('returns a deep copy — never mutates input', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      },
    ];
    const before = JSON.stringify(messages);
    stripCacheControl(messages);
    const after = JSON.stringify(messages);
    expect(after).toBe(before);
  });

  it('removes cache_control from text blocks', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'world' },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    expect(out[0]!.content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(out[0]!.content[1]).toEqual({ type: 'text', text: 'world' });
    expect('cache_control' in out[0]!.content[0]!).toBe(false);
  });

  it('removes cache_control from tool_use blocks', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_xyz',
            name: 'tool',
            input: { k: 'v' },
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    const block = out[0]!.content[0];
    expect(block).toEqual({
      type: 'tool_use',
      id: 'toolu_xyz',
      name: 'tool',
      input: { k: 'v' },
    });
  });

  it('removes cache_control from tool_result blocks', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_xyz',
            content: 'result',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    expect(out[0]!.content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_xyz',
      content: 'result',
    });
  });

  it('removes cache_control from image blocks', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    const block = out[0]!.content[0];
    expect('cache_control' in block!).toBe(false);
    expect(block).toMatchObject({ type: 'image' });
  });

  it('also strips cache_control from nested tool_result.content[] sub-blocks', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_xyz',
            content: [
              {
                type: 'text',
                text: 'inner',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    const tr = out[0]!.content[0] as { content: Array<{ type: string }> };
    expect(Array.isArray(tr.content)).toBe(true);
    const inner = (tr.content as Array<Record<string, unknown>>)[0]!;
    expect('cache_control' in inner).toBe(false);
    expect(inner['text']).toBe('inner');
  });

  it('is a no-op when no blocks carry cache_control', () => {
    const messages: CanonicalMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'think' },
          { type: 'text', text: 'reply' },
        ],
      },
    ];
    const out = stripCacheControl(messages);
    expect(out).toEqual(messages);
    expect(out).not.toBe(messages); // still a deep copy
  });

  it('handles an empty messages array', () => {
    expect(stripCacheControl([])).toEqual([]);
  });
});
