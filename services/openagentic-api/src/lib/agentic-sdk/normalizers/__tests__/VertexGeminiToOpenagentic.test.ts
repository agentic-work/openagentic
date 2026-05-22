import { describe, it, expect } from 'vitest';
import {
  createVertexGeminiToOpenagenticNormalizer,
  type GeminiChunk,
} from '../VertexGeminiToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function normalize(chunks: GeminiChunk[]): CanonicalEvent[] {
  const n = createVertexGeminiToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gemini-2.5-flash',
  });
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

describe('VertexGeminiToOpenagenticNormalizer', () => {
  it('emits message_start exactly once on the first chunk', () => {
    const events = normalize([
      { candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] },
    ]);
    const starts = events.filter((e) => e.type === 'message_start');
    expect(starts).toHaveLength(1);
  });

  it('text-only stream → message_start, content_block_start(text), text_delta×N, content_block_stop, message_delta, message_stop', () => {
    const events = normalize([
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello ' }] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'world' }] } }] },
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '!' }] },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types[1]).toBe('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    const textBlock = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'text',
    );
    expect(textBlock).toBeDefined();

    const deltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    );
    expect(deltas).toHaveLength(3);
    const concat = deltas
      .map((e) => (e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? e.delta.text : ''))
      .join('');
    expect(concat).toBe('Hello world!');

    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('end_turn');
  });

  it('functionCall part → tool_use block with synthesized id + input_json_delta carrying serialized args', () => {
    const events = normalize([
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'azure_list_subscriptions',
                    args: { tenantId: 'phatoldsun' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ]);

    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    if (toolStart && toolStart.type === 'content_block_start' && toolStart.content_block.type === 'tool_use') {
      expect(toolStart.content_block.name).toBe('azure_list_subscriptions');
      expect(toolStart.content_block.id).toMatch(/^toolu_/);
    }

    const inputDelta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(inputDelta).toBeDefined();
    if (inputDelta && inputDelta.type === 'content_block_delta' && inputDelta.delta.type === 'input_json_delta') {
      expect(JSON.parse(inputDelta.delta.partial_json)).toEqual({ tenantId: 'phatoldsun' });
    }
  });

  it('parallel functionCalls in a single parts[] → multiple tool_use blocks with distinct indices + ids', () => {
    const events = normalize([
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { functionCall: { name: 'azure_list_subscriptions', args: {} } },
                { functionCall: { name: 'k8s_list_pods', args: { namespace: 'default' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    const toolStarts = events.filter(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStarts).toHaveLength(2);
    if (toolStarts[0].type === 'content_block_start' && toolStarts[0].content_block.type === 'tool_use') {
      expect(toolStarts[0].content_block.name).toBe('azure_list_subscriptions');
    }
    if (toolStarts[1].type === 'content_block_start' && toolStarts[1].content_block.type === 'tool_use') {
      expect(toolStarts[1].content_block.name).toBe('k8s_list_pods');
    }
    const ids = toolStarts.map((e) =>
      e.type === 'content_block_start' && e.content_block.type === 'tool_use' ? e.content_block.id : '',
    );
    expect(new Set(ids).size).toBe(2);

    const tool0Idx = (toolStarts[0] as Extract<CanonicalEvent, { type: 'content_block_start' }>).index;
    const tool1Idx = (toolStarts[1] as Extract<CanonicalEvent, { type: 'content_block_start' }>).index;
    expect(tool0Idx).not.toBe(tool1Idx);
  });

  it('thinking part (thought=true) → thinking content_block + thinking_delta', () => {
    const events = normalize([
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ thought: true, text: 'Let me reason about this... ' }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Final answer.' }] },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    const thinkingStart = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'thinking',
    );
    expect(thinkingStart).toBeDefined();

    const thinkingDelta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta',
    );
    expect(thinkingDelta).toBeDefined();
    if (thinkingDelta && thinkingDelta.type === 'content_block_delta' && thinkingDelta.delta.type === 'thinking_delta') {
      expect(thinkingDelta.delta.thinking).toBe('Let me reason about this... ');
    }
  });

  it('finishReason MAX_TOKENS → stop_reason max_tokens', () => {
    const events = normalize([
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'truncated...' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      },
    ]);
    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('max_tokens');
  });

  it('finishReason SAFETY → stop_reason end_turn (no canonical mapping; map to end_turn)', () => {
    const events = normalize([
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'partial...' }] },
            finishReason: 'SAFETY',
          },
        ],
      },
    ]);
    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('end_turn');
  });

  it('mixed: text → tool_use → text closes the prior text block before opening tool_use', () => {
    const events = normalize([
      { candidates: [{ content: { role: 'model', parts: [{ text: 'Calling tool. ' }] } }] },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'k8s_list_pods', args: {} } }],
            },
          },
        ],
      },
      {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Done.' }] },
            finishReason: 'STOP',
          },
        ],
      },
    ]);
    const stops = events.filter((e) => e.type === 'content_block_stop');
    // text(0) + tool_use(1) + text(2) — three blocks, three stops.
    expect(stops.length).toBeGreaterThanOrEqual(3);
    const blockStarts = events.filter((e) => e.type === 'content_block_start');
    expect(blockStarts).toHaveLength(3);
    expect(blockStarts[0].type === 'content_block_start' && blockStarts[0].content_block.type).toBe('text');
    expect(blockStarts[1].type === 'content_block_start' && blockStarts[1].content_block.type).toBe('tool_use');
    expect(blockStarts[2].type === 'content_block_start' && blockStarts[2].content_block.type).toBe('text');
  });

  it('finalize is idempotent — second call emits nothing', () => {
    const n = createVertexGeminiToOpenagenticNormalizer({
      messageId: 'msg_idem',
      model: 'gemini-2.5-flash',
    });
    n.consume({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] });
    const first = n.finalize();
    const second = n.finalize();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it('honors caller model in message_start', () => {
    const n = createVertexGeminiToOpenagenticNormalizer({
      messageId: 'm1',
      model: 'gemini-2.5-flash',
    });
    const evs = n.consume({ candidates: [{ content: { role: 'model', parts: [{ text: 'x' }] } }] });
    const start = evs.find((e) => e.type === 'message_start');
    expect(start && start.type === 'message_start' && start.message.model).toBe('gemini-2.5-flash');
  });

  it('empty-parts chunk does not emit phantom blocks', () => {
    const events = normalize([
      { candidates: [{ content: { role: 'model', parts: [] } }] },
      { candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] },
    ]);
    const blockStarts = events.filter((e) => e.type === 'content_block_start');
    expect(blockStarts).toHaveLength(1);
  });
});
