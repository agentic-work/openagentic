/**
 * GemmaToOpenagentic — canonical normalizer for Gemma 3 on AWS Bedrock.
 *
 * Tool-call shape was captured live against `google.gemma-3-27b-it`:
 * Gemma emits a fenced markdown code-block with language tag `tool_calls`
 * and an OpenAI-style function-call JSON array. NOT inline `<tool_call>` XML
 * (initial assumption was wrong).
 *
 * These tests pin the extractor against the REAL emission shapes:
 *   - single fenced ```tool_calls block
 *   - multi-call array in a single block
 *   - chunk-boundary splits inside the fence
 *   - chat-template token strip
 *   - end-to-end live capture replay
 */
import { describe, it, expect } from 'vitest';
import { createGemmaToOpenagenticNormalizer } from '../GemmaToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function drive(chunks: Array<Parameters<ReturnType<typeof createGemmaToOpenagenticNormalizer>['consume']>[0]>): CanonicalEvent[] {
  const n = createGemmaToOpenagenticNormalizer({ messageId: 'msg_test', model: 'google.gemma-3-27b-it' });
  const all: CanonicalEvent[] = [];
  for (const c of chunks) all.push(...n.consume(c));
  all.push(...n.finalize());
  return all;
}

describe('GemmaToOpenagentic', () => {
  it('emits message_start + text deltas + message_stop for plain text', () => {
    const events = drive([
      { textDelta: 'Hello' },
      { textDelta: ' world' },
      { done: true, finishReason: 'end_turn', outputTokens: 4 },
    ]);
    expect(events[0].type).toBe('message_start');
    const textDeltas = events.filter((e) => e.type === 'content_block_delta' && (e as any).delta.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe('message_stop');
    const toolUses = events.filter((e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use');
    expect(toolUses).toHaveLength(0);
  });

  it('extracts a single ```tool_calls fenced block as canonical tool_use (real Gemma3 shape)', () => {
    const events = drive([
      { textDelta: 'I will list subscriptions.\n' },
      { textDelta: '```tool_calls\n[\n  {\n    "type": "function",\n    "function": {\n      "name": "azure_list_subscriptions",\n      "arguments": "{}"\n    }\n  }\n]\n```' },
      { done: true, finishReason: 'end_turn' },
    ]);
    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    const block = (toolStart as any).content_block;
    expect(block.name).toBe('azure_list_subscriptions');
    expect(block.input).toEqual({});
    expect(block.id).toMatch(/^toolu_/);
    const msgDelta = events.find((e) => e.type === 'message_delta');
    expect((msgDelta as any).delta.stop_reason).toBe('tool_use');
  });

  it('extracts a multi-call array (Gemma fan-out in one fence block)', () => {
    const events = drive([
      {
        textDelta:
          '```tool_calls\n[\n  {"type":"function","function":{"name":"azure_list_subscriptions","arguments":"{}"}},\n  {"type":"function","function":{"name":"aws_list_accounts","arguments":"{\\"region\\":\\"us-east-1\\"}"}}\n]\n```',
      },
      { done: true, finishReason: 'end_turn' },
    ]);
    const toolStarts = events.filter(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStarts).toHaveLength(2);
    expect((toolStarts[0] as any).content_block.name).toBe('azure_list_subscriptions');
    expect((toolStarts[0] as any).content_block.input).toEqual({});
    expect((toolStarts[1] as any).content_block.name).toBe('aws_list_accounts');
    expect((toolStarts[1] as any).content_block.input).toEqual({ region: 'us-east-1' });
  });

  it('handles a fence-block spanning chunk boundaries (live emission shape)', () => {
    // Real Gemma3 emits the fence in many tiny chunks. This case mirrors the
    // captured wire — opener split across chunk 1+2, body across 2+3+4.
    const events = drive([
      { textDelta: 'Listing now: ```tool_' },
      { textDelta: 'calls\n[\n  {\n    "type": "function' },
      { textDelta: '",\n    "function": {\n      "name": "k8s_list_pods",' },
      { textDelta: '\n      "arguments": "{\\"namespace\\":\\"default\\"}"\n    }\n  }\n]\n``' },
      { textDelta: '`' },
      { done: true, finishReason: 'end_turn' },
    ]);
    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    expect((toolStart as any).content_block.name).toBe('k8s_list_pods');
    expect((toolStart as any).content_block.input).toEqual({ namespace: 'default' });
  });

  it('surfaces malformed fence body as text (no_confab, no silent drop)', () => {
    const events = drive([
      { textDelta: '```tool_calls\n[bad json]\n```' },
      { done: true, finishReason: 'end_turn' },
    ]);
    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStart).toBeUndefined();
    const text = events
      .filter((e) => e.type === 'content_block_delta' && (e as any).delta.type === 'text_delta')
      .map((e) => (e as any).delta.text)
      .join('');
    expect(text).toContain('tool_calls');
    expect(text).toContain('bad json');
  });

  it('strips <start_of_turn>/<end_of_turn> chat-template tokens that leak', () => {
    const events = drive([
      { textDelta: '<start_of_turn>model\nHello' },
      { textDelta: ' there<end_of_turn>' },
      { done: true, finishReason: 'end_turn' },
    ]);
    const text = events
      .filter((e) => e.type === 'content_block_delta' && (e as any).delta.type === 'text_delta')
      .map((e) => (e as any).delta.text)
      .join('');
    expect(text).not.toContain('<start_of_turn>');
    expect(text).not.toContain('<end_of_turn>');
    expect(text).toContain('Hello');
    expect(text).toContain('there');
  });

  it('text before the fence is preserved (real-emission interleave)', () => {
    const events = drive([
      { textDelta: 'I will list subscriptions.\n```tool_calls\n[{"type":"function","function":{"name":"x","arguments":"{}"}}]\n```' },
      { done: true, finishReason: 'end_turn' },
    ]);
    const text = events
      .filter((e) => e.type === 'content_block_delta' && (e as any).delta.type === 'text_delta')
      .map((e) => (e as any).delta.text)
      .join('');
    expect(text).toContain('I will list subscriptions');
    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    expect((toolStart as any).content_block.name).toBe('x');
  });

  it('REAL LIVE CAPTURE — replays the actual Gemma3 wire stream', () => {
    // Captured from `google.gemma-3-27b-it` on Bedrock.
    // Prompt: "List my Azure subscriptions. Use the azure_list_subscriptions tool."
    const wireChunks = [
      '```tool_calls\n[\n  {\n    "type": "function',
      '",\n    "function": {\n      "name": "azure',
      '_list_subscriptions",\n      "arguments": "{}"\n    ',
      '}\n  }\n]\n```',
    ];
    const events = drive([
      ...wireChunks.map((textDelta) => ({ textDelta })),
      { done: true, finishReason: 'end_turn' },
    ]);
    const toolStart = events.find(
      (e) => e.type === 'content_block_start' && (e as any).content_block?.type === 'tool_use',
    );
    expect(toolStart).toBeDefined();
    expect((toolStart as any).content_block.name).toBe('azure_list_subscriptions');
    expect((toolStart as any).content_block.input).toEqual({});
    const msgDelta = events.find((e) => e.type === 'message_delta');
    // Even though Gemma reported end_turn, the normalizer promotes to tool_use
    // because we emitted a tool block (mirrors OllamaToOpenagentic G7).
    expect((msgDelta as any).delta.stop_reason).toBe('tool_use');
  });

  it('finalize emits message_stop exactly once (idempotent)', () => {
    const n = createGemmaToOpenagenticNormalizer({ messageId: 'msg_idem', model: 'gemma' });
    const first = [...n.consume({ textDelta: 'x' }), ...n.finalize()];
    const second = n.finalize();
    expect(first.filter((e) => e.type === 'message_stop')).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('ignores null / non-object chunks without crashing (malformed-chunk resilience)', () => {
    const n = createGemmaToOpenagenticNormalizer({ messageId: 'msg_null', model: 'gemma' });
    const out: CanonicalEvent[] = [];
    out.push(...n.consume(null as any));
    out.push(...n.consume(undefined as any));
    out.push(...n.consume('keep-alive' as any));
    out.push(...n.consume({ textDelta: 'ok' }));
    out.push(...n.finalize());
    const text = out
      .filter((e) => e.type === 'content_block_delta' && (e as any).delta.type === 'text_delta')
      .map((e) => (e as any).delta.text)
      .join('');
    expect(text).toContain('ok');
    expect(out[out.length - 1].type).toBe('message_stop');
  });
});
