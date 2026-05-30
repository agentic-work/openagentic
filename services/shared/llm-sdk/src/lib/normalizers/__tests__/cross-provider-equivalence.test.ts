/**
 * Cross-provider equivalence — the closing gate of the SDK contract.
 *
 * Take ONE conceptual model response — "I'll call a tool" + a tool_use
 * for `azure_list_subscriptions` + an end_turn — and pipe its NATIVE
 * provider-specific chunk shape through each normalizer. Assert that
 * every normalizer emits a canonical event sequence that's equivalent
 * (modulo synthesized ids and the natural single-vs-multi-chunk text
 * delta differences).
 *
 * This is the proof that "any provider/model produces identical
 * canonical OpenAgentic events at the model-stream layer." Downstream
 * code reads ONE shape regardless of source provider.
 *
 * Providers covered:
 *   1. Ollama (NDJSON, parsed-object tool args)
 *   2. OpenAI / Azure-OpenAI (streaming string tool args)
 *   3. Vertex Gemini (parts[].functionCall, parsed-object args)
 *   4. AIF Responses (envelope with output[]; non-streaming source synthesized into SSE shape)
 *   5. AnthropicShape passthrough (Bedrock / Vertex-Anthropic / Foundry-Anthropic)
 */

import { describe, it, expect } from 'vitest';
import { createOllamaToOpenagenticNormalizer, type OllamaChunk } from '../OllamaToOpenagentic.js';
import { createOpenAIToOpenagenticNormalizer, type OpenAIChunk } from '../OpenAIToOpenagentic.js';
import {
  createVertexGeminiToOpenagenticNormalizer,
  type GeminiChunk,
} from '../VertexGeminiToOpenagentic.js';
import {
  createAIFResponsesToOpenagenticNormalizer,
  type AIFResponsesEnvelope,
} from '../AIFResponsesToOpenagentic.js';
import {
  createAnthropicShapeToOpenagenticNormalizer,
  type AnthropicShapeChunk,
} from '../AnthropicShapeToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

const PROMPT_TOOL_NAME = 'azure_list_subscriptions';
const PROMPT_TOOL_ARGS = { tenantId: 'openagentic-test' };
const PROMPT_TEXT = "I'll call the subscription tool now.";

/**
 * Reduce a canonical event stream to its observable "shape" — drop
 * synthesized ids, timestamps, and per-chunk text-delta granularity that
 * varies legitimately by provider. What remains is the canonical
 * contract: same blocks in same order with same final text + same
 * tool_use name/args + same stop_reason.
 */
function shapeOf(events: CanonicalEvent[]): unknown {
  const blocks: Array<
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; thinking: string }
    | { kind: 'tool_use'; name: string; argsJson: string }
  > = [];

  let stopReason: string | null = null;
  let blockOrder: string[] = []; // 'text' | 'thinking' | 'tool_use', in start order
  // Accumulate deltas keyed by index → string
  const textByIndex = new Map<number, string>();
  const thinkingByIndex = new Map<number, string>();
  const toolByIndex = new Map<number, { name: string; argsJson: string }>();
  const blockKindByIndex = new Map<number, 'text' | 'thinking' | 'tool_use'>();
  const blockOrderByIndex: number[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'content_block_start': {
        if (!blockKindByIndex.has(e.index)) {
          blockOrderByIndex.push(e.index);
        }
        if (e.content_block.type === 'text') {
          blockKindByIndex.set(e.index, 'text');
          textByIndex.set(e.index, '');
        } else if (e.content_block.type === 'thinking') {
          blockKindByIndex.set(e.index, 'thinking');
          thinkingByIndex.set(e.index, '');
        } else if (e.content_block.type === 'tool_use') {
          blockKindByIndex.set(e.index, 'tool_use');
          toolByIndex.set(e.index, { name: e.content_block.name, argsJson: '' });
        }
        break;
      }
      case 'content_block_delta': {
        if (e.delta.type === 'text_delta') {
          textByIndex.set(e.index, (textByIndex.get(e.index) ?? '') + e.delta.text);
        } else if (e.delta.type === 'thinking_delta') {
          thinkingByIndex.set(
            e.index,
            (thinkingByIndex.get(e.index) ?? '') + e.delta.thinking,
          );
        } else if (e.delta.type === 'input_json_delta') {
          const cur = toolByIndex.get(e.index);
          if (cur) {
            cur.argsJson = cur.argsJson + e.delta.partial_json;
          }
        }
        break;
      }
      case 'message_delta': {
        stopReason = e.delta.stop_reason;
        break;
      }
      default:
        break;
    }
  }

  for (const idx of blockOrderByIndex) {
    const kind = blockKindByIndex.get(idx);
    if (kind === 'text') {
      blocks.push({ kind: 'text', text: textByIndex.get(idx) ?? '' });
      blockOrder.push('text');
    } else if (kind === 'thinking') {
      blocks.push({ kind: 'thinking', thinking: thinkingByIndex.get(idx) ?? '' });
      blockOrder.push('thinking');
    } else if (kind === 'tool_use') {
      const t = toolByIndex.get(idx);
      blocks.push({
        kind: 'tool_use',
        name: t?.name ?? '',
        // Reparse + re-stringify so OpenAI's streamed string args and
        // Ollama/Gemini/AIF's parsed-object args produce byte-identical
        // canonical args representation. THIS is the contract: downstream
        // gets the same parsed args regardless of how the model emitted them.
        argsJson: t ? JSON.stringify(JSON.parse(t.argsJson || '{}')) : '',
      });
      blockOrder.push('tool_use');
    }
  }

  return { blocks, blockOrder, stopReason };
}

function runOllama(): CanonicalEvent[] {
  const n = createOllamaToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gpt-oss:20b',
  });
  const chunks: OllamaChunk[] = [
    {
      model: 'gpt-oss:20b',
      message: { role: 'assistant', content: PROMPT_TEXT },
      done: false,
    },
    {
      model: 'gpt-oss:20b',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_xyz',
            type: 'function',
            function: { name: PROMPT_TOOL_NAME, arguments: PROMPT_TOOL_ARGS },
          },
        ],
      },
      done: true,
      done_reason: 'tool_calls',
    },
  ];
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

function runOpenAI(): CanonicalEvent[] {
  const n = createOpenAIToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gpt-5.4-mini',
  });
  const chunks: OpenAIChunk[] = [
    // First chunk: text delta
    {
      id: 'cmpl_1',
      model: 'gpt-5.4-mini',
      choices: [{ index: 0, delta: { role: 'assistant', content: PROMPT_TEXT } }],
    },
    // Tool call start
    {
      id: 'cmpl_1',
      model: 'gpt-5.4-mini',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_xyz',
                type: 'function',
                function: { name: PROMPT_TOOL_NAME, arguments: '{"tenantId":"' },
              },
            ],
          },
        },
      ],
    },
    // Tool call args continued
    {
      id: 'cmpl_1',
      model: 'gpt-5.4-mini',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: 'openagentic-test"}' },
              },
            ],
          },
        },
      ],
    },
    // Finish reason
    {
      id: 'cmpl_1',
      model: 'gpt-5.4-mini',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

function runVertexGemini(): CanonicalEvent[] {
  const n = createVertexGeminiToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gemini-2.5-flash',
  });
  const chunks: GeminiChunk[] = [
    {
      candidates: [
        {
          content: { role: 'model', parts: [{ text: PROMPT_TEXT }] },
        },
      ],
    },
    {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: { name: PROMPT_TOOL_NAME, args: PROMPT_TOOL_ARGS },
              },
            ],
          },
          // Gemini emits STOP even when a tool was called; SDK should
          // bias to tool_use because of the functionCall presence... but
          // VertexGemini currently sets STOP→end_turn. We document this
          // as the canonical behavior: the model's finishReason wins,
          // and downstream checks for tool_use blocks separately.
          finishReason: 'STOP',
        },
      ],
    },
  ];
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

function runAIFResponses(): CanonicalEvent[] {
  const n = createAIFResponsesToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gpt-5.4-mini',
  });
  const envelope: AIFResponsesEnvelope = {
    id: 'resp_xyz',
    model: 'gpt-5.4-mini',
    output: [
      {
        type: 'message',
        id: 'msg_inner',
        role: 'assistant',
        content: [{ type: 'output_text', text: PROMPT_TEXT }],
      },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_xyz',
        name: PROMPT_TOOL_NAME,
        arguments: JSON.stringify(PROMPT_TOOL_ARGS),
      },
    ],
    status: 'completed',
  };
  const out: CanonicalEvent[] = [];
  out.push(...n.consume(envelope));
  out.push(...n.finalize());
  return out;
}

function runAnthropicShape(): CanonicalEvent[] {
  const n = createAnthropicShapeToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'claude-sonnet-4-6',
  });
  const chunks: AnthropicShapeChunk[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_inner',
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
      delta: { type: 'text_delta', text: PROMPT_TEXT },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'call_xyz', name: PROMPT_TOOL_NAME, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(PROMPT_TOOL_ARGS) },
    },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 8 },
    },
    { type: 'message_stop' },
  ];
  const out: CanonicalEvent[] = [];
  for (const c of chunks) out.push(...n.consume(c));
  out.push(...n.finalize());
  return out;
}

describe('Cross-provider equivalence — same prompt × every normalizer = canonical', () => {
  it('text + tool_use + stop produces identical canonical SHAPE across all 5 providers', () => {
    const ollama = shapeOf(runOllama());
    const openai = shapeOf(runOpenAI());
    const vertex = shapeOf(runVertexGemini());
    const aif = shapeOf(runAIFResponses());
    const anthropic = shapeOf(runAnthropicShape());

    // The "shape" — block order, final text, tool name, parsed args — must
    // be byte-identical across providers, EXCEPT for stop_reason variance
    // where the upstream provider's enum forces our hand (Gemini emits STOP
    // even after a functionCall, AIF and OpenAI emit tool_calls/tool_use).
    // We pin the SHAPE (blocks + text + tool args) and assert stop_reason
    // separately with provider-specific tolerance.

    const shapesNoStopReason = [ollama, openai, vertex, aif, anthropic].map((s: any) => ({
      blocks: s.blocks,
      blockOrder: s.blockOrder,
    }));
    expect(shapesNoStopReason[1]).toEqual(shapesNoStopReason[0]); // Ollama == OpenAI
    expect(shapesNoStopReason[2]).toEqual(shapesNoStopReason[0]); // Ollama == Vertex
    expect(shapesNoStopReason[3]).toEqual(shapesNoStopReason[0]); // Ollama == AIF
    expect(shapesNoStopReason[4]).toEqual(shapesNoStopReason[0]); // Ollama == Anthropic

    // Stop reason: ALL FIVE normalizers must converge on 'tool_use' when
    // a tool_use block was emitted. This was a real bug (G7) — Ollama's
    // done_reason:"stop" and Vertex's finishReason:"STOP" both fired on
    // tool turns, and naïvely mapping them to end_turn meant the chat-loop
    // never dispatched the tool. The fix: tool_use precedence — if a
    // tool_use content block was emitted, stop_reason = 'tool_use'
    // regardless of upstream finish signal. Pinned by realCaptures.test.ts
    // which feeds verbatim Vertex 2.5-flash + Ollama gpt-oss:20b streams.
    expect((ollama as any).stopReason).toBe('tool_use');
    expect((openai as any).stopReason).toBe('tool_use');
    expect((aif as any).stopReason).toBe('tool_use');
    expect((anthropic as any).stopReason).toBe('tool_use');
    expect((vertex as any).stopReason).toBe('tool_use');
  });

  it('every provider produces a tool_use block with name + parsed-object args', () => {
    for (const events of [
      runOllama(),
      runOpenAI(),
      runVertexGemini(),
      runAIFResponses(),
      runAnthropicShape(),
    ]) {
      const start = events.find(
        (e) => e.type === 'content_block_start' && e.content_block.type === 'tool_use',
      );
      expect(start, 'tool_use start present').toBeDefined();
      if (start && start.type === 'content_block_start' && start.content_block.type === 'tool_use') {
        expect(start.content_block.name).toBe(PROMPT_TOOL_NAME);
      }

      // Find the corresponding input_json_delta + parse it.
      const delta = events.find(
        (e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta',
      );
      // OpenAI streams args across multiple deltas; we need to concat all of them.
      const allArgsParts = events
        .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta')
        .map((e) =>
          e.type === 'content_block_delta' && e.delta.type === 'input_json_delta'
            ? e.delta.partial_json
            : '',
        );
      const concatJson = allArgsParts.join('');
      expect(delta, 'input_json_delta present').toBeDefined();
      expect(JSON.parse(concatJson)).toEqual(PROMPT_TOOL_ARGS);
    }
  });

  it('every provider opens with message_start and closes with message_stop', () => {
    for (const events of [
      runOllama(),
      runOpenAI(),
      runVertexGemini(),
      runAIFResponses(),
      runAnthropicShape(),
    ]) {
      expect(events[0].type).toBe('message_start');
      expect(events[events.length - 1].type).toBe('message_stop');
      // Exactly one message_delta with stop_reason set.
      const messageDeltas = events.filter((e) => e.type === 'message_delta');
      expect(messageDeltas.length).toBe(1);
    }
  });

  it('canonical text content is identical across all 5 providers', () => {
    const collectText = (events: CanonicalEvent[]) =>
      events
        .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta')
        .map((e) =>
          e.type === 'content_block_delta' && e.delta.type === 'text_delta'
            ? e.delta.text
            : '',
        )
        .join('');
    const texts = [runOllama, runOpenAI, runVertexGemini, runAIFResponses, runAnthropicShape].map(
      (fn) => collectText(fn()),
    );
    expect(texts[0]).toBe(PROMPT_TEXT);
    for (const t of texts) {
      expect(t).toBe(PROMPT_TEXT);
    }
  });

  it('THE CONTRACT: same prompt + same model output → same downstream canonical sequence (modulo provider enum quirks)', () => {
    // This is the smoking gun: feed each provider its native shape for
    // the same conceptual response, run it through its normalizer, and
    // verify the canonical event sequence is downstream-equivalent.
    //
    // What "downstream-equivalent" means:
    //   - Same blocks in the same order (text, then tool_use)
    //   - Final text is byte-identical
    //   - Tool name is byte-identical
    //   - Tool args parse to the same object
    //   - Stop reason is 'tool_use' for providers whose finish signal
    //     carries tool intent (Ollama/OpenAI/AIF/Anthropic), 'end_turn'
    //     for Gemini (whose enum is strictly STOP)
    //
    // If this test breaks, the SDK's canonical-shape contract has drifted
    // and downstream UI components (mock 10 inline UX) will render
    // differently per provider.
    const allShapes = [
      runOllama,
      runOpenAI,
      runVertexGemini,
      runAIFResponses,
      runAnthropicShape,
    ].map((fn) => shapeOf(fn()));
    for (const s of allShapes) {
      const sh = s as any;
      expect(sh.blockOrder).toEqual(['text', 'tool_use']);
      expect(sh.blocks[0]).toEqual({ kind: 'text', text: PROMPT_TEXT });
      expect(sh.blocks[1].kind).toBe('tool_use');
      expect(sh.blocks[1].name).toBe(PROMPT_TOOL_NAME);
      expect(JSON.parse(sh.blocks[1].argsJson)).toEqual(PROMPT_TOOL_ARGS);
    }
  });
});
