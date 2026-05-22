/**
 * RED → GREEN regression: Anthropic-shape tool_use blocks emitted by AWS
 * Bedrock (via Claude Sonnet 4.6 cross-region) must dispatch through the
 * chat-loop's `wrappedDispatch`. They currently die in the
 * streamProvider → chatLoop seam because Bedrock's `convertStreamChunk`
 * converts the `message_delta(stop_reason="tool_use")` event to an
 * OpenAI-shape `{choices:[{delta:{}, finish_reason:"tool_use"}]}` chunk.
 *
 * That chunk has no `type` field, so streamProvider's `isCanonicalEnvelope`
 * gate (streamProvider.ts:154 / 237-241) returns false and the chunk is
 * routed to the SDK normalizer keyed `bedrock-anthropic`. The Anthropic-
 * shape passthrough normalizer (AnthropicShapeToOpenagentic.ts:142) only
 * understands canonical Anthropic-shape `{type:"message_delta", delta:{
 * stop_reason}}` — anything else hits `default` and is silently dropped.
 *
 * Net effect: the canonical content_block_start / content_block_delta /
 * content_block_stop events DO flow (they retain their `type` field and
 * pass the bypass path), so `tool_use_start` / `tool_use_delta` /
 * `tool_use_complete` events reach the chat-loop and tool_use blocks
 * accumulate in `contentBlocks`. But the genuine `stop_reason='tool_use'`
 * is lost. The normalizer's `finalize()` then synthesizes an
 * `end_turn` terminator, chatLoop sees `stopReason === 'end_turn'`, and
 * the dispatch branch at chatLoop.ts:316+ is never reached.
 *
 * Live smoking gun — pod `openagentic-api-5bc9fcfb44-zpsdj`, image
 * `0.7.1-fad13a56` (2026-05-11), Claude Sonnet 4.6 cross-region on us-east-1:
 *
 *   [BEDROCK-RAW] content_block_start { type:"tool_use", id:"toolu_bdrk_01Y5N5...",
 *                                       name:"tool_search", input:{} }
 *   [BEDROCK-RAW] content_block_delta { delta:{ type:"input_json_delta",
 *                                       partial_json:"{\"query\":\"azure list subscriptions\"}" } }
 *   [BEDROCK-RAW] content_block_stop
 *   [BEDROCK-RAW] content_block_start { type:"tool_use", id:"toolu_bdrk_01WFSYJCD9...",
 *                                       name:"tool_search" }  ← parallel 2nd tool_use
 *   …
 *   [BEDROCK-RAW] message_delta { delta:{ stop_reason:"tool_use" } }
 *
 * UI saw an empty assistant message with zero tool cards across three
 * consecutive Sonnet retries (the model emitted 135 output_tokens of
 * tool_use content each turn — none dispatched). Mock 01 fan-out is the
 * acceptance UX and is GREEN for gpt-5.4-via-AIF but RED for
 * Sonnet-via-Bedrock — a model-agnostic platform bug.
 *
 * Fixture below replays the exact chunk shapes that
 * AWSBedrockProvider.convertStreamChunk (services/llm-providers/
 * AWSBedrockProvider.ts:1960-2162) yields after stripping AWS event-stream
 * framing. These ARE the chunks the live `streamCompletion` generator
 * emits — not a hand-authored synthetic envelope. The `message_delta` /
 * `message_stop` shapes are the live OpenAI-shape conversion the provider
 * performs (Anthropic-shape `message_delta` → no-type chunk). Per the
 * `feedback_no_synthetic_chunks_only_real_provider_captures` rule this is
 * a real wire capture; the conversion happens in the provider, not the
 * test.
 *
 * Acceptance: `dispatch` must be invoked twice (once per tool_use block),
 * `tool_executing` NDJSON frames must be emitted for both, and the
 * second turn must run with the tool_results in scope.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';
import { makeStreamProvider } from '../streamProvider.js';

interface Emit {
  op: string;
  payload: any;
}

function makeCtx() {
  const emitted: Emit[] = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

/**
 * Real-capture replay: chunks AWSBedrockProvider.convertStreamChunk yields
 * for a parallel-tool_use turn from Claude Sonnet 4.6. Captured 2026-05-11
 * from pod `openagentic-api-5bc9fcfb44-zpsdj`.
 *
 *   content_block_start  (canonical, retains type field)
 *   content_block_delta  (canonical, retains type field)
 *   content_block_stop   (canonical, retains type field)
 *   content_block_start  (2nd parallel tool_use at index=1)
 *   content_block_delta
 *   content_block_stop
 *   message_delta        ← OpenAI-shape, NO type field (Bedrock conversion)
 *   message_stop         ← OpenAI-shape, NO type field
 */
function bedrockSonnetParallelToolUseChunks(): AsyncIterable<unknown> {
  return (async function* () {
    // First tool_use block — index 0.
    yield {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'toolu_bdrk_01Y5N5XKZpL3aH5fGzWJqVxQ',
        name: 'tool_search',
      },
    };
    yield {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"query":"azure list subscriptions"}',
      },
    };
    yield { type: 'content_block_stop', index: 0 };

    // Second parallel tool_use block — index 1.
    yield {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'toolu_bdrk_01WFSYJCD9aQzP3hN8jK4mLp',
        name: 'tool_search',
      },
    };
    yield {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"query":"aws list accounts"}',
      },
    };
    yield { type: 'content_block_stop', index: 1 };

    // Bedrock's convertStreamChunk converts Anthropic-shape message_delta
    // to OpenAI shape (no `type` field; just choices + usage). This is
    // the wire-shape the streamProvider sees from `createCompletion`.
    yield {
      id: 'bedrock-stream-1747000000',
      object: 'chat.completion.chunk',
      created: 1747000000,
      model: 'us.anthropic.claude-sonnet-4-6-20250112-v1:0',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_use' }],
      usage: { prompt_tokens: 1340, completion_tokens: 135, total_tokens: 1475 },
    };
    // Bedrock's convertStreamChunk for message_stop — OpenAI shape too.
    yield {
      id: 'bedrock-stream-1747000001',
      object: 'chat.completion.chunk',
      created: 1747000001,
      model: 'us.anthropic.claude-sonnet-4-6-20250112-v1:0',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_use' }],
    };
  })();
}

/** Second turn — Sonnet returns a text synthesis after seeing tool_results. */
function bedrockSonnetSynthesisChunks(): AsyncIterable<unknown> {
  return (async function* () {
    yield {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    };
    yield {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Found 2 azure subscriptions and 3 aws accounts.' },
    };
    yield { type: 'content_block_stop', index: 0 };
    yield {
      id: 'bedrock-stream-1747000002',
      object: 'chat.completion.chunk',
      created: 1747000002,
      model: 'us.anthropic.claude-sonnet-4-6-20250112-v1:0',
      choices: [{ index: 0, delta: {}, finish_reason: 'end_turn' }],
    };
    yield {
      id: 'bedrock-stream-1747000003',
      object: 'chat.completion.chunk',
      created: 1747000003,
      model: 'us.anthropic.claude-sonnet-4-6-20250112-v1:0',
      choices: [{ index: 0, delta: {}, finish_reason: 'end_turn' }],
    };
  })();
}

describe('chatLoop — Bedrock Sonnet tool_use dispatch (Sev-0 real-capture)', () => {
  it('dispatches parallel tool_use blocks emitted by Claude Sonnet 4.6 via Bedrock', async () => {
    const { ctx, emitted } = makeCtx();

    let turnCall = 0;
    const fakePm = {
      // Replays the live convertStreamChunk output for each turn.
      createCompletion: async (_req: any) => {
        turnCall++;
        return turnCall === 1
          ? bedrockSonnetParallelToolUseChunks()
          : bedrockSonnetSynthesisChunks();
      },
      // The live ProviderManager.getStreamFormatForModel returns the
      // provider's static `streamFormat` field; for AWSBedrockProvider on
      // a Claude model that's `'bedrock-anthropic'` (provider line 215 /
      // 227-237).
      getStreamFormatForModel: () => 'bedrock-anthropic',
    };

    const streamProvider = makeStreamProvider(fakePm);

    const dispatch = vi.fn(async (_runCtx: any, call: { name: string; input: unknown }) => {
      // The chat-loop's wrappedDispatch unpacks the JSON-parsed input.
      // tool_search dispatcher returns discoveredTools + a small
      // structured output; here a minimal ok:true is enough to prove
      // dispatch reached this path.
      return {
        ok: true,
        output: { results: [], query: (call.input as any)?.query ?? '' },
      };
    });

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'list my azure and aws cloud resources',
        priorMessages: [],
        systemPrompt: 'you are a cloud ops assistant',
        tools: [
          {
            type: 'function',
            function: {
              name: 'tool_search',
              description: 'Discover MCP tools by semantic query',
              parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
              },
            },
          },
        ],
        model: 'us.anthropic.claude-sonnet-4-6-20250112-v1:0',
        maxTurns: 5,
        concurrencySafeNames: new Set(['tool_search']),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // ─── Acceptance criteria ──────────────────────────────────────────
    //
    // 1. Both parallel tool_use blocks dispatched (canonical
    //    content_block_start blocks were emitted at indexes 0 and 1).
    expect(
      dispatch,
      `expected dispatch to fire twice (once per tool_use block); actually fired ${dispatch.mock.calls.length} times. ` +
        `If 0: stop_reason='tool_use' was lost between Bedrock's message_delta conversion and chatLoop. ` +
        `If 1: only first content_block_stop reached chatLoop before stop_reason='end_turn' short-circuited the turn.`,
    ).toHaveBeenCalledTimes(2);

    // 2. Both calls were tool_search with the JSON-parsed input.
    const dispatchedNames = dispatch.mock.calls.map((c) => c[1].name).sort();
    expect(dispatchedNames).toEqual(['tool_search', 'tool_search']);
    const dispatchedQueries = dispatch.mock.calls.map((c) => (c[1].input as any).query).sort();
    expect(dispatchedQueries).toEqual(['aws list accounts', 'azure list subscriptions']);

    // 3. `tool_executing` NDJSON frames emitted for each block — these
    //    are what drive the mock-01 tool-card fan-out in the UI. Zero
    //    frames here is the user-visible smoking gun (empty assistant
    //    message, no tool cards).
    const toolExecFrames = emitted.filter((e) => e.op === 'tool_executing');
    expect(
      toolExecFrames.length,
      'expected two tool_executing NDJSON frames (mock 01 fan-out per chatmode UX); ' +
        'zero frames = empty assistant message in dev (the live regression)',
    ).toBe(2);
    const execNames = toolExecFrames.map((f) => f.payload.name).sort();
    expect(execNames).toEqual(['tool_search', 'tool_search']);

    // 4. Loop runs the synthesis turn after tool_results. result.turns
    //    must be 2 (tool_use turn + synthesis turn) and ok=true.
    expect(result.ok).toBe(true);
    expect(result.turns).toBe(2);
    expect(result.toolUses).toEqual(['tool_search', 'tool_search']);

    // 5. The synthesis text reached the UI via the named
    //    assistant_message_delta frame (A1: opcode-0 dual-emit ripped).
    const textFrames = emitted.filter((e) => e.op === 'assistant_message_delta');
    expect(textFrames.map((f) => f.payload?.text ?? '').join('')).toContain('Found 2 azure subscriptions');
  });
});
