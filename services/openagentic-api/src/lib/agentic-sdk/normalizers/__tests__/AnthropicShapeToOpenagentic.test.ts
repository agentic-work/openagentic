import { describe, it, expect } from 'vitest';
import {
  createAnthropicShapeToOpenagenticNormalizer,
  createBedrockToOpenagenticNormalizer,
  createVertexAnthropicToOpenagenticNormalizer,
  createFoundryAnthropicToOpenagenticNormalizer,
  type AnthropicShapeChunk,
} from '../AnthropicShapeToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function normalize(chunks: AnthropicShapeChunk[]): CanonicalEvent[] {
  const n = createAnthropicShapeToOpenagenticNormalizer({
    messageId: 'msg_t',
    model: 'claude-sonnet-4-6',
  });
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

describe('AnthropicShapeToOpenagenticNormalizer — passthrough behavior', () => {
  it('full message_start → text deltas → message_delta → message_stop passes through unchanged', () => {
    const events = normalize([
      {
        type: 'message_start',
        message: {
          id: 'msg_orig',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    const start = events[0];
    expect(start.type === 'message_start' && start.message.id).toBe('msg_orig');
    expect(start.type === 'message_start' && start.message.model).toBe('claude-sonnet-4-6');
  });

  it('synthesizes message_start when source omits it (Bedrock skips it sometimes)', () => {
    const events = normalize([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    const synthesized = events[0];
    expect(synthesized.type === 'message_start' && synthesized.message.id).toBe('msg_t');
    expect(synthesized.type === 'message_start' && synthesized.message.model).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('overrides missing model on inbound message_start with caller fallback', () => {
    const events = normalize([
      {
        type: 'message_start',
        message: {
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          // model intentionally omitted (Bedrock pattern)
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        } as any,
      },
      { type: 'message_stop' },
    ]);
    const start = events.find((e) => e.type === 'message_start');
    expect(start && start.type === 'message_start' && start.message.model).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('synthesizes a message_delta(end_turn) when message_stop arrives without a prior message_delta', () => {
    const events = normalize([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]);
    const md = events.find((e) => e.type === 'message_delta');
    expect(md).toBeDefined();
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('end_turn');
  });

  it('finalize() handles abrupt stream cut: synthesizes end_turn + message_stop', () => {
    const n = createAnthropicShapeToOpenagenticNormalizer({
      messageId: 'msg_cut',
      model: 'claude-sonnet-4-6',
    });
    n.consume({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    n.consume({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'partial' },
    });
    const tail = n.finalize();
    const types = tail.map((e) => e.type);
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');
  });

  it('ping events are absorbed (heartbeat) but ensure message_start lazily', () => {
    const n = createAnthropicShapeToOpenagenticNormalizer({
      messageId: 'msg_p',
      model: 'claude-sonnet-4-6',
    });
    const before = n.consume({ type: 'ping' });
    expect(before.length).toBe(1);
    expect(before[0].type).toBe('message_start');
    // A second ping after message_start does NOT re-emit message_start.
    const after = n.consume({ type: 'ping' });
    expect(after).toEqual([]);
  });

  it('tool_use blocks pass through verbatim with input_json_delta accumulation', () => {
    const events = normalize([
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_abc',
          name: 'azure_list_subs',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"region":"' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'us-east-1"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 8 },
      },
      { type: 'message_stop' },
    ]);
    const start = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(start).toBeDefined();
    if (start && start.type === 'content_block_start' && start.content_block.type === 'tool_use') {
      expect(start.content_block.id).toBe('toolu_abc');
      expect(start.content_block.name).toBe('azure_list_subs');
    }

    const deltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(deltas).toHaveLength(2);

    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('tool_use');
  });

  it('thinking blocks pass through verbatim', () => {
    const events = normalize([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me reason... ' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' },
    ]);
    const start = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'thinking',
    );
    expect(start).toBeDefined();
    const delta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta',
    );
    expect(delta).toBeDefined();
  });

  it('finalize is idempotent — second call emits nothing', () => {
    const n = createAnthropicShapeToOpenagenticNormalizer({
      messageId: 'msg_i',
      model: 'claude-sonnet-4-6',
    });
    n.consume({ type: 'message_stop' });
    const second = n.finalize();
    expect(second).toEqual([]);
  });

  it('all three named factories share the same impl behavior', () => {
    const fixtures: AnthropicShapeChunk[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
      { type: 'message_stop' },
    ];
    const factories = [
      createBedrockToOpenagenticNormalizer,
      createVertexAnthropicToOpenagenticNormalizer,
      createFoundryAnthropicToOpenagenticNormalizer,
    ];
    const outputs = factories.map((f) => {
      const n = f({ messageId: 'm', model: 'claude-sonnet-4-6' });
      const out: CanonicalEvent[] = [];
      for (const c of fixtures) out.push(...n.consume(c));
      out.push(...n.finalize());
      return out.map((e) => e.type);
    });
    // All three produce the same canonical event sequence.
    expect(outputs[0]).toEqual(outputs[1]);
    expect(outputs[1]).toEqual(outputs[2]);
  });
});
