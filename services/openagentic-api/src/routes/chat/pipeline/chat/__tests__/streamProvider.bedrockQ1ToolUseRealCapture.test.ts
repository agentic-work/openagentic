/**
 * Q1-fix-5 (2026-05-12) RED → GREEN: real-capture replay of a Bedrock
 * Sonnet 4.5 turn that emitted 3 parallel `tool_search` tool_use blocks
 * with `stop_reason: 'tool_use'` — but chat-dev showed 0 tool_executing
 * frames and the conversation ended at the first model turn.
 *
 * Fixture is the verbatim 153-chunk NDJSON capture from pod
 * openagentic-api-cc8fc5cc8-j6htb (image 0.7.1-c7d2e9ef), msg id
 * `msg_bdrk_01RdfUa4u1Y538dhCLLzaUCd` — see
 * `reports/verify-cadence/Q1-redrive-2/0.7.1-c7d2e9ef/full-api-log.log`
 * `[BEDROCK-RAW]` lines.
 *
 * Why the existing chatLoop.bedrockToolUse.test.ts passes while live
 * traffic fails: that test's synthetic `message_stop` carries
 * `finish_reason: 'tool_use'` (post-conversion OpenAI shape from the
 * `message_delta`'s stop_reason). The REAL Bedrock raw `message_stop`
 * event has NO `stop_reason` field — it's just
 * `{type:"message_stop", "amazon-bedrock-invocationMetrics":{…}}`. The
 * Bedrock provider's `convertStreamChunk(modelId, chunk).finish_reason =
 * chunk.stop_reason || 'stop'` thus produces `finish_reason: 'stop'`.
 *
 * In streamProvider, `translateOpenAIFinishChunk` then maps `'stop'`
 * → `'end_turn'` and unconditionally writes `stopReason =
 * finishMapped.stop_reason`, OVERWRITING the prior `'tool_use'` that
 * came from the preceding `message_delta`. chatLoop's last-event-wins
 * consumer sees the final `message_stop(end_turn)` and skips dispatch.
 *
 * Real-data fixture only — no synthetic chunks per
 * `feedback_no_synthetic_chunks_only_real_provider_captures`.
 *
 * Acceptance:
 *   - All 3 tool_use blocks reach the consumer as `tool_use_complete`.
 *   - The terminal `stop_reason` observed by chatLoop is `'tool_use'`
 *     (NOT `'end_turn'`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest, StreamEvent } from '../types.js';

const FIXTURE_PATH = resolve(
  // SDK fixtures live in the openagentic-sdk source tree, mirrored into
  // node_modules at build time. For tests we resolve via the workspace
  // root.
  __dirname,
  '../../../../../../../../../openagentic-sdk/src/lib/normalizers/__tests__/fixtures/bedrock-claude-3-parallel-tool-use-real.ndjson',
);

function loadRealRawBedrockChunks(): unknown[] {
  const text = readFileSync(FIXTURE_PATH, 'utf8');
  const out: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed));
  }
  return out;
}

/**
 * Faithful re-implementation of the relevant branches of
 * `AWSBedrockProvider.convertStreamChunk()` for Claude (Anthropic-shape)
 * raw events. Returns the post-conversion chunk shape that the live
 * provider streams into `makeStreamProvider`.
 *
 * Source: `services/llm-providers/AWSBedrockProvider.ts:1999-2237`.
 * Pinned 2026-05-12 against image 0.7.1-c7d2e9ef.
 */
function convertStreamChunkAsBedrock(modelId: string, chunk: any): any {
  if (chunk.type === 'content_block_start') {
    const blockType = chunk.content_block?.type;
    const blockIndex = chunk.index ?? 0;
    if (blockType === 'thinking') {
      return { type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking' } };
    }
    if (blockType === 'text') {
      return { type: 'content_block_start', index: blockIndex, content_block: { type: 'text' } };
    }
    if (blockType === 'tool_use') {
      return {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'tool_use',
          id: chunk.content_block.id,
          name: chunk.content_block.name,
        },
      };
    }
    return null;
  }
  if (chunk.type === 'content_block_delta') {
    const blockIndex = chunk.index ?? 0;
    if (chunk.delta?.type === 'thinking_delta') {
      return {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking: chunk.delta.thinking },
      };
    }
    if (chunk.delta?.type === 'text_delta') {
      return {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'text_delta', text: chunk.delta.text },
      };
    }
    if (chunk.delta?.type === 'input_json_delta' || chunk.delta?.partial_json) {
      return {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: chunk.delta.partial_json || chunk.delta.input_json || '',
        },
      };
    }
    // signature_delta etc — provider returns null in production.
    return null;
  }
  if (chunk.type === 'content_block_stop') {
    return { type: 'content_block_stop', index: chunk.index ?? 0 };
  }
  if (chunk.type === 'message_start') {
    return {
      id: chunk.message?.id || `bedrock-stream-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    };
  }
  if (chunk.type === 'message_stop') {
    return {
      id: `bedrock-stream-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      // Bedrock's raw `message_stop` event has no top-level `stop_reason`
      // field — falls to the `'stop'` default. This is the production
      // bug surface: 'stop' maps to 'end_turn' downstream and clobbers
      // the prior 'tool_use' that came on `message_delta`.
      choices: [{ index: 0, delta: {}, finish_reason: chunk.stop_reason || 'stop' }],
    };
  }
  if (chunk.type === 'message_delta') {
    const result: any = {
      id: `bedrock-stream-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: chunk.delta?.stop_reason || null }],
    };
    if (chunk.usage) {
      result.usage = {
        prompt_tokens: chunk.usage.input_tokens || 0,
        completion_tokens: chunk.usage.output_tokens || 0,
        total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0),
      };
    }
    return result;
  }
  return null;
}

const baseReq: ProviderRequest = {
  system: 'you are a cloud ops assistant',
  messages: [
    { role: 'user', content: 'tri-cloud cost spike root-cause investigation' },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description: 'Discover MCP tools by semantic query',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, k: { type: 'number' } },
        },
      },
    },
  ],
  tool_choice: 'auto',
  model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
};

describe('streamProvider — Q1-fix-5 Bedrock parallel tool_use real-capture', () => {
  it('preserves stop_reason=tool_use through the full Bedrock convertStreamChunk pipeline', async () => {
    const rawChunks = loadRealRawBedrockChunks();
    expect(rawChunks.length).toBeGreaterThan(150);

    // Sanity: the captured stream really has 3 tool_use content blocks
    // and a message_delta(stop_reason=tool_use).
    const toolUseStarts = rawChunks.filter(
      (c: any) => c.type === 'content_block_start' && c.content_block?.type === 'tool_use',
    );
    expect(toolUseStarts.length).toBe(3);
    const md = rawChunks.find((c: any) => c.type === 'message_delta') as any;
    expect(md.delta.stop_reason).toBe('tool_use');
    const ms = rawChunks.find((c: any) => c.type === 'message_stop') as any;
    expect(ms.stop_reason).toBeUndefined();

    // Replay through the provider's convertStreamChunk, then the
    // streamProvider, exactly as the live request does.
    const fakePm = {
      createCompletion: async (_req: any) => {
        return (async function* () {
          for (const raw of rawChunks) {
            const converted = convertStreamChunkAsBedrock(baseReq.model, raw);
            if (converted !== null) {
              yield converted;
            }
          }
        })();
      },
      getStreamFormatForModel: () => 'bedrock-anthropic' as const,
    };

    const streamProvider = makeStreamProvider(fakePm);

    const events: StreamEvent[] = [];
    for await (const ev of streamProvider(baseReq)) {
      events.push(ev);
    }

    // 1. All 3 tool_use_complete events fire with assembled inputs.
    const completes = events.filter((e) => e.type === 'tool_use_complete') as any[];
    expect(
      completes.length,
      'expected 3 tool_use_complete events (one per parallel tool_search the model emitted)',
    ).toBe(3);
    for (const c of completes) {
      expect(c.name).toBe('tool_search');
      expect(c.input).toBeTypeOf('object');
      expect((c.input as any).query).toEqual(expect.any(String));
      expect((c.input as any).k).toBe(5);
    }
    const queries = completes.map((c) => (c.input as any).query).sort();
    expect(queries[0]).toMatch(/aws/i);
    expect(queries[1]).toMatch(/azure/i);
    expect(queries[2]).toMatch(/gcp/i);

    // 2. The TERMINAL message_stop reaching chatLoop must carry
    //    stop_reason='tool_use', not 'end_turn'. chatLoop's last-write
    //    -wins consumer is sensitive to event order.
    const stops = events.filter((e) => e.type === 'message_stop') as Array<
      Extract<StreamEvent, { type: 'message_stop' }>
    >;
    expect(stops.length).toBeGreaterThan(0);
    const terminalStop = stops[stops.length - 1]!;
    expect(
      terminalStop.stop_reason,
      `terminal message_stop.stop_reason was ${terminalStop.stop_reason} — ` +
        `expected 'tool_use'. If 'end_turn': Bedrock's bare message_stop chunk ` +
        `(which has no stop_reason field, so convertStreamChunk falls to 'stop' → ` +
        `translateOpenAIFinishChunk maps to 'end_turn') is overwriting the prior ` +
        `'tool_use' that came on message_delta. This is the live Q1 regression.`,
    ).toBe('tool_use');
  });
});
