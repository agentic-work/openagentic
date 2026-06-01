/**
 * Sev-0 (2026-06-01) — Ollama native tool call dropped at the
 * translateOpenAIFinishChunk short-circuit.
 *
 * LIVE FAILURE (open-dev, gpt-oss:20b): the model emits a native tool
 * call (e.g. `web_search`). The OllamaProvider surfaces it as a SINGLE
 * OpenAI-compatible chunk that carries BOTH the `delta.tool_calls`
 * payload AND `finish_reason:'tool_calls'` in the same object
 * (OllamaProvider.ts:859-880 — "Emitting stored native tool calls at
 * stream completion").
 *
 * streamProvider's `translateOpenAIFinishChunk` triggers off
 * `choices[0].finish_reason`. For this chunk it returns a
 * `message_stop(tool_use)` and the caller does `yield finishMapped;
 * continue;` — which SKIPS `normalizer.consume(chunk)` for that chunk.
 * The `delta.tool_calls` payload (the tool NAME + ARGUMENTS) is never
 * normalized into `content_block_start`/`input_json_delta`/
 * `content_block_stop`, so chatLoop receives stop_reason='tool_use' but
 * ZERO tool_use blocks. No dispatch runs, no tool_result is appended,
 * and the model is left saying "I'm not seeing a tool response".
 *
 * Contract this test pins: a single OpenAI-shape chunk carrying both
 * `delta.tool_calls` and `finish_reason:'tool_calls'` MUST surface the
 * tool_use to chatLoop (tool_use_complete with the right name + parsed
 * input) AND set stop_reason='tool_use'.
 *
 * The Bedrock bare-finish-chunk case (empty delta + finish_reason) must
 * stay unaffected — that path is what the short-circuit was built for.
 */

import { describe, it, expect } from 'vitest';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest, StreamEvent } from '../types.js';

const baseReq: ProviderRequest = {
  system: 'sys',
  messages: [{ role: 'user', content: 'search the web' }],
  tools: [
    {
      type: 'function',
      function: { name: 'tool_search', description: 'discover tools', parameters: {} },
    },
  ],
  tool_choice: 'auto',
  model: 'gpt-oss:20b',
};

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of stream) out.push(ev);
  return out;
}

describe('streamProvider — Ollama native tool call in a single finish chunk', () => {
  it('surfaces tool_use_complete with name+input when delta.tool_calls and finish_reason ride the same chunk', async () => {
    // Exact shape OllamaProvider.ts:859-880 yields for a native tool call.
    async function* chunks() {
      yield { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] };
      yield {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        model: 'gpt-oss:20b',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'web_search',
                    arguments: '{"query":"kubernetes latest version"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };
    }
    const pm = {
      createCompletion: async () => chunks(),
      getStreamFormatForModel: () => 'openai',
    };

    const events = await drain(makeStreamProvider(pm)(baseReq));

    const completes = events.filter(
      (e): e is Extract<StreamEvent, { type: 'tool_use_complete' }> =>
        e.type === 'tool_use_complete',
    );
    expect(completes.length).toBe(1);
    expect(completes[0].name).toBe('web_search');
    expect(completes[0].input).toEqual({ query: 'kubernetes latest version' });

    const stops = events.filter(
      (e): e is Extract<StreamEvent, { type: 'message_stop' }> =>
        e.type === 'message_stop',
    );
    // At least one terminal message_stop and the operative one is tool_use.
    expect(stops.length).toBeGreaterThanOrEqual(1);
    expect(stops[stops.length - 1].stop_reason).toBe('tool_use');
  });

  it('preserves the Bedrock bare-finish-chunk path (empty delta + finish_reason → message_stop only)', async () => {
    // No tool_calls in the delta — this is the case the short-circuit was
    // built for. It must still produce a clean terminal message_stop and
    // emit NO spurious tool_use_complete.
    async function* chunks() {
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } };
      yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    }
    const pm = {
      createCompletion: async () => chunks(),
      getStreamFormatForModel: () => 'openai',
    };
    const events = await drain(makeStreamProvider(pm)(baseReq));
    expect(events.some((e) => e.type === 'tool_use_complete')).toBe(false);
    const stops = events.filter((e) => e.type === 'message_stop');
    expect(stops.length).toBeGreaterThanOrEqual(1);
  });
});
