import { describe, it, expect } from 'vitest';
import {
  createAIFResponsesToOpenagenticNormalizer,
  type AIFResponsesEnvelope,
} from '../AIFResponsesToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function normalize(envelope: AIFResponsesEnvelope): CanonicalEvent[] {
  const n = createAIFResponsesToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: envelope.model || 'gpt-5.4-mini',
  });
  const out: CanonicalEvent[] = [];
  out.push(...n.consume(envelope));
  out.push(...n.finalize());
  return out;
}

describe('AIFResponsesToOpenagenticNormalizer', () => {
  it('text-only response → message_start, content_block_start(text), text_delta, content_block_stop, message_delta, message_stop', () => {
    const events = normalize({
      id: 'resp_1',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          id: 'msg_xxx',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello world' }],
        },
      ],
      status: 'completed',
    });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');

    const start = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'text',
    );
    expect(start).toBeDefined();

    const delta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    );
    expect(delta && delta.type === 'content_block_delta' && delta.delta.type === 'text_delta' && delta.delta.text).toBe('Hello world');
  });

  it('function_call output → tool_use block with id/name + input_json_delta carrying parsed-then-stringified args', () => {
    const events = normalize({
      id: 'resp_2',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'function_call',
          id: 'fc_xxx',
          call_id: 'call_xxx',
          name: 'azure_list_subscriptions',
          arguments: '{"tenantId":"examplecorp"}',
        },
      ],
      status: 'completed',
    });
    const start = events.find(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(start).toBeDefined();
    if (start && start.type === 'content_block_start' && start.content_block.type === 'tool_use') {
      expect(start.content_block.name).toBe('azure_list_subscriptions');
      expect(start.content_block.id).toBe('call_xxx');
    }
    const delta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(delta).toBeDefined();
    if (delta && delta.type === 'content_block_delta' && delta.delta.type === 'input_json_delta') {
      expect(JSON.parse(delta.delta.partial_json)).toEqual({ tenantId: 'examplecorp' });
    }

    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('tool_use');
  });

  it('mixed message + function_call → text block, then tool_use block, in order', () => {
    const events = normalize({
      id: 'resp_3',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          id: 'msg_xxx',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Calling tool now.' }],
        },
        {
          type: 'function_call',
          id: 'fc_xxx',
          call_id: 'call_xxx',
          name: 'k8s_list_pods',
          arguments: '{}',
        },
      ],
      status: 'completed',
    });
    const blockStarts = events.filter((e) => e.type === 'content_block_start');
    expect(blockStarts).toHaveLength(2);
    expect(blockStarts[0].type === 'content_block_start' && blockStarts[0].content_block.type).toBe('text');
    expect(blockStarts[1].type === 'content_block_start' && blockStarts[1].content_block.type).toBe('tool_use');

    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('tool_use');
  });

  it('status incomplete + reason max_output_tokens → stop_reason max_tokens', () => {
    const events = normalize({
      id: 'resp_4',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          id: 'msg_xxx',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'truncated...' }],
        },
      ],
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('max_tokens');
  });

  it('multiple output_text fragments inside one message → one text block, multiple text_deltas concatenating', () => {
    const events = normalize({
      id: 'resp_5',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'message',
          id: 'msg_xxx',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Hello ' },
            { type: 'output_text', text: 'world' },
            { type: 'output_text', text: '!' },
          ],
        },
      ],
      status: 'completed',
    });
    const textStarts = events.filter(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'text',
    );
    expect(textStarts).toHaveLength(1);
    const deltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta',
    );
    expect(deltas).toHaveLength(3);
    const concat = deltas
      .map((e) => (e.type === 'content_block_delta' && e.delta.type === 'text_delta' ? e.delta.text : ''))
      .join('');
    expect(concat).toBe('Hello world!');
  });

  it('parallel function_calls → multiple tool_use blocks', () => {
    const events = normalize({
      id: 'resp_6',
      model: 'gpt-5.4-mini',
      output: [
        {
          type: 'function_call',
          id: 'fc_a',
          call_id: 'call_a',
          name: 'tool_a',
          arguments: '{"x":1}',
        },
        {
          type: 'function_call',
          id: 'fc_b',
          call_id: 'call_b',
          name: 'tool_b',
          arguments: '{"y":2}',
        },
      ],
      status: 'completed',
    });
    const toolStarts = events.filter(
      (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolStarts).toHaveLength(2);
    if (toolStarts[0].type === 'content_block_start' && toolStarts[0].content_block.type === 'tool_use') {
      expect(toolStarts[0].content_block.name).toBe('tool_a');
    }
    if (toolStarts[1].type === 'content_block_start' && toolStarts[1].content_block.type === 'tool_use') {
      expect(toolStarts[1].content_block.name).toBe('tool_b');
    }
  });

  it('finalize is idempotent — second call emits nothing', () => {
    const n = createAIFResponsesToOpenagenticNormalizer({
      messageId: 'msg_idem',
      model: 'gpt-5.4-mini',
    });
    n.consume({
      id: 'r',
      output: [
        {
          type: 'message',
          id: 'm',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hi' }],
        },
      ],
      status: 'completed',
    });
    const first = n.finalize();
    const second = n.finalize();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual([]);
  });

  it('empty output → message_start, message_delta(end_turn), message_stop (no blocks)', () => {
    const events = normalize({ id: 'r', output: [], status: 'completed' });
    const types = events.map((e) => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');
    expect(types).not.toContain('content_block_start');
    const md = events.find((e) => e.type === 'message_delta');
    expect(md && md.type === 'message_delta' && md.delta.stop_reason).toBe('end_turn');
  });

  it('arguments fail to JSON.parse → still emits input_json_delta with raw fragment (resilient)', () => {
    const events = normalize({
      id: 'r',
      output: [
        {
          type: 'function_call',
          id: 'fc',
          call_id: 'call_x',
          name: 'tool_a',
          arguments: 'NOT JSON {{',
        },
      ],
      status: 'completed',
    });
    const delta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
    );
    expect(delta).toBeDefined();
    if (delta && delta.type === 'content_block_delta' && delta.delta.type === 'input_json_delta') {
      expect(delta.delta.partial_json).toBe('NOT JSON {{');
    }
  });

  it('honors caller model in message_start', () => {
    const evs = normalize({
      id: 'r',
      model: 'gpt-5-codex',
      output: [
        {
          type: 'message',
          id: 'm',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'x' }],
        },
      ],
      status: 'completed',
    });
    const start = evs.find((e) => e.type === 'message_start');
    expect(start && start.type === 'message_start' && start.message.model).toBe('gpt-5-codex');
  });

  // G3 — AIF Responses API reasoning output items.
  //
  // Per MS Learn Azure AI Foundry Responses API spec, gpt-5 / o-series
  // models emit a `reasoning` output item alongside `message` and
  // `function_call`. Shape:
  //   {
  //     type: 'reasoning',
  //     id: 'rs_...',
  //     summary: [{ type: 'summary_text', text: '...' }, ...]
  //   }
  //
  // The normalizer must:
  //   - emit a thinking content block (type='thinking') for the reasoning
  //     item, in arrival order BEFORE the assistant message text block
  //   - concatenate every summary_text fragment into thinking_delta events
  //
  // Root cause for gpt-5.4 no-thinking UX surface flagged 2026-05-10.
  // Tracked as G3 in reference_sdk_normalizer_gap_analysis.md.
  describe('G3 — reasoning output items → thinking_delta canonical events', () => {
    function envelope(): AIFResponsesEnvelope {
      return {
        id: 'resp_r1',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'reasoning',
            id: 'rs_abc123',
            summary: [
              { type: 'summary_text', text: 'Let me think step by step. ' },
              { type: 'summary_text', text: 'The user is asking about X.' },
            ],
          } as any,
          {
            type: 'message',
            id: 'msg_xxx',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'The answer is Y.' }],
          },
        ],
        status: 'completed',
      };
    }

    it('emits a thinking block with thinking_delta events from summary fragments', () => {
      const events = normalize(envelope());
      const thinkingDeltas = events.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && (e.delta as any).type === 'thinking_delta',
      );
      expect(thinkingDeltas.length).toBeGreaterThanOrEqual(2);
      const joined = thinkingDeltas.map((d) => (d.delta as any).thinking as string).join('');
      expect(joined).toBe('Let me think step by step. The user is asking about X.');
    });

    it('thinking block precedes text block (arrival-order)', () => {
      const events = normalize(envelope());
      const starts = events.filter((e) => e.type === 'content_block_start') as Array<
        Extract<CanonicalEvent, { type: 'content_block_start' }>
      >;
      const thinkingStart = starts.find((s) => s.content_block.type === 'thinking');
      const textStart = starts.find((s) => s.content_block.type === 'text');
      expect(thinkingStart).toBeDefined();
      expect(textStart).toBeDefined();
      expect(thinkingStart!.index).toBeLessThan(textStart!.index);
    });

    it('reasoning-only envelope (no message item) still emits thinking + end_turn', () => {
      const evs = normalize({
        id: 'resp_r2',
        model: 'gpt-5.4-mini',
        output: [
          {
            type: 'reasoning',
            id: 'rs_only',
            summary: [{ type: 'summary_text', text: 'Working...' }],
          } as any,
        ],
        status: 'completed',
      });
      const thinkingDeltas = evs.filter(
        (e): e is Extract<CanonicalEvent, { type: 'content_block_delta' }> =>
          e.type === 'content_block_delta' && (e.delta as any).type === 'thinking_delta',
      );
      expect(thinkingDeltas.length).toBe(1);
      const md = evs.find((e) => e.type === 'message_delta') as any;
      expect(md.delta.stop_reason).toBe('end_turn');
    });
  });
});
