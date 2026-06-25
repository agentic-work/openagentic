/**
 * Sev-0 (2026-06-24) — Vertex Gemini function call dropped before chatLoop
 * dispatch (generate_image never surfaces an image).
 *
 * LIVE FAILURE (openagentic, gemini-2.5-flash via Vertex ADC): the model
 * emits a `generate_image` function call. GoogleVertexProvider.streamCompletion
 * pre-converts it to an OpenAI-shape chunk
 *   { choices:[{ delta:{ tool_calls:[...] }, finish_reason:null }] }
 * and then a terminator that USED to hardcode finish_reason:'stop'.
 *
 * In streamProvider the per-part chunk (finish_reason:null) is NOT a finish
 * chunk, so translateOpenAIFinishChunk returns null and the chunk falls to
 * normalizer.consume(chunk). The `gemini`-format normalizer reads
 * `chunk.candidates` (NOT `chunk.choices`) → [] → the tool call is silently
 * discarded. The old 'stop' terminator mapped to end_turn. chatLoop therefore
 * received stop_reason='end_turn' with ZERO tool_use blocks → no dispatch →
 * no image_render, no tool_result.
 *
 * The fix (GoogleVertexProvider.streamCompletion): buffer emitted tool calls
 * and REPLAY them on the terminating chunk with finish_reason:'tool_calls'.
 * streamProvider.extractInlineToolCalls (the existing Ollama path) then pulls
 * canonical tool_use_start/tool_use_complete and the terminator maps to
 * stop_reason:'tool_use' → dispatch fires.
 *
 * This test pins the streamProvider contract end-to-end with the SAME chunk
 * sequence the patched provider now yields, using format:'gemini' so the
 * gemini normalizer's drop-of-choices-shaped-chunks behavior is exercised.
 */

import { describe, it, expect } from 'vitest';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest, StreamEvent } from '../types.js';

const baseReq: ProviderRequest = {
  system: 'sys',
  messages: [{ role: 'user', content: 'generate an image of a red circle' }],
  tools: [
    {
      type: 'function',
      function: { name: 'generate_image', description: 'render an image', parameters: {} },
    },
  ],
  tool_choice: 'auto',
  model: 'gemini-2.5-flash',
};

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('streamProvider — Vertex Gemini function call drop fix', () => {
  it('surfaces tool_use_complete(generate_image) + stop_reason=tool_use from the patched provider chunk sequence', async () => {
    // Exact shape GoogleVertexProvider.streamCompletion now yields:
    //   1. per-part tool_call chunk (finish_reason:null) — gemini normalizer ignores it
    //   2. terminating chunk REPLAYING the buffered tool_calls with finish_reason:'tool_calls'
    const toolCall = {
      index: 0,
      id: 'call_1782_0',
      type: 'function',
      function: {
        name: 'generate_image',
        arguments: '{"prompt":"a red circle on a white background"}',
      },
    };
    async function* chunks() {
      // per-part chunk (the gemini normalizer reads .candidates, so this
      // OpenAI-shape chunk is a no-op — proves the replay is load-bearing)
      yield {
        id: 'vertex-stream-1',
        object: 'chat.completion.chunk',
        model: 'gemini-2.5-flash',
        choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }],
      };
      // terminating chunk — the fix: finish_reason:'tool_calls' + replayed tool_calls
      yield {
        id: 'vertex-stream-final-1',
        object: 'chat.completion.chunk',
        model: 'gemini-2.5-flash',
        choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    }
    const pm = {
      createCompletion: async () => chunks(),
      // Vertex Gemini resolves to the 'gemini' canonical stream format.
      getStreamFormatForModel: () => 'gemini',
    };

    const events = await drain(makeStreamProvider(pm)(baseReq));

    const completes = events.filter(
      (e): e is Extract<StreamEvent, { type: 'tool_use_complete' }> =>
        e.type === 'tool_use_complete',
    );
    // Exactly ONE dispatchable tool_use — not zero (the bug), not two (double-emit).
    expect(completes.length).toBe(1);
    expect(completes[0].name).toBe('generate_image');
    expect(completes[0].input).toEqual({ prompt: 'a red circle on a white background' });

    const stops = events.filter(
      (e): e is Extract<StreamEvent, { type: 'message_stop' }> =>
        e.type === 'message_stop',
    );
    expect(stops.length).toBeGreaterThanOrEqual(1);
    // The operative terminator must be tool_use so chatLoop reaches dispatch.
    expect(stops[stops.length - 1].stop_reason).toBe('tool_use');
  });

  it('a text-only Gemini turn (no function call) still terminates end_turn with no tool_use', async () => {
    // Regression guard: the unchanged non-tool path. Provider yields a
    // canonical text content_block then a finish_reason:'stop' terminator.
    async function* chunks() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'here you go' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        id: 'vertex-stream-final-2',
        object: 'chat.completion.chunk',
        model: 'gemini-2.5-flash',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      };
    }
    const pm = {
      createCompletion: async () => chunks(),
      getStreamFormatForModel: () => 'gemini',
    };
    const events = await drain(makeStreamProvider(pm)(baseReq));
    expect(events.some((e) => e.type === 'tool_use_complete')).toBe(false);
    const stops = events.filter(
      (e): e is Extract<StreamEvent, { type: 'message_stop' }> => e.type === 'message_stop',
    );
    expect(stops.length).toBeGreaterThanOrEqual(1);
    expect(stops[stops.length - 1].stop_reason).toBe('end_turn');
  });
});
