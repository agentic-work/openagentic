/**
 * RED → GREEN: when a provider yields the canonical envelope sequence
 * `message_delta(stop_reason='tool_use')` followed by a bare `message_stop`,
 * streamProvider must NOT downgrade the stop_reason to 'end_turn'.
 *
 * Smoking gun: 2026-05-10 wire capture against the dev environment gpt-5.4 (AIF
 * Responses path). After AzureAIFoundryProvider was fixed to map
 * function_call turns to stop_reason='tool_use' on message_delta, the
 * trailing bare message_stop event was still mapped to 'end_turn' by
 * `translateCanonicalEvent` at streamProvider.ts:331-332. chatLoop's
 * event loop assigns `stopReason = event.stop_reason` on every
 * message_stop, so the LAST event wins — and the LAST event was the
 * 'end_turn' override. Result: chatLoop saw end_turn and exited the
 * turn WITHOUT dispatching the tool_search the model had emitted.
 *
 * Fix: streamProvider must preserve a prior `tool_use` stop_reason set
 * by `message_delta` when the bare `message_stop` arrives. Equivalently:
 * the bare message_stop translation must NOT emit a `message_stop` event
 * carrying 'end_turn' if a previous message_delta carried a different
 * stop_reason.
 */
import { describe, it, expect } from 'vitest';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest, StreamEvent } from '../types.js';

const baseReq: ProviderRequest = {
  system: '',
  messages: [{ role: 'user', content: 'list azure subscriptions' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'tool_search',
        description: 'Discover MCP tools by semantic query',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    },
  ],
  tool_choice: 'auto',
  model: 'gpt-5.4',
};

describe('streamProvider — tool_use stop_reason preservation (Sev-0 fix)', () => {
  it('preserves stop_reason="tool_use" from message_delta when bare message_stop follows', async () => {
    // Synthesize the AIF Responses path: provider yields direct
    // Anthropic-shape canonical envelopes (the `isCanonicalEnvelope`
    // branch in streamProvider). Emission order matches the live
    // capture:
    //   1. content_block_start(tool_use)
    //   2. content_block_delta(input_json_delta)
    //   3. content_block_stop
    //   4. message_delta { stop_reason: 'tool_use' }   ← Sev-0 signal
    //   5. message_stop                                ← bare terminator
    async function* aifResponsesCanonical() {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'call_test', name: 'tool_search' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"azure"}' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { input_tokens: 100, output_tokens: 20 },
      };
      yield { type: 'message_stop' };
    }

    const fakePm = {
      createCompletion: async (_req: any) => aifResponsesCanonical(),
      getStreamFormatForModel: () => 'aif-responses',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    // Critical: the FINAL message_stop event (whatever its origin) must
    // NOT carry stop_reason='end_turn' when a prior message_delta
    // declared 'tool_use'. chatLoop assigns `stopReason` on EVERY
    // message_stop event (chatLoop.ts:220) — the LAST one wins.
    const stops = events.filter(e => e.type === 'message_stop') as Array<
      Extract<StreamEvent, { type: 'message_stop' }>
    >;
    expect(stops.length, 'expected at least one message_stop').toBeGreaterThan(0);
    const finalStop = stops[stops.length - 1];
    expect(finalStop.stop_reason).toBe('tool_use');
  });

  it('still emits stop_reason="end_turn" for plain text turn (no message_delta with tool_use)', async () => {
    // Sanity / regression: if the provider only emits text + bare
    // message_stop, end_turn remains the correct stop reason.
    async function* plainText() {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 5, output_tokens: 2 },
      };
      yield { type: 'message_stop' };
    }

    const fakePm = {
      createCompletion: async (_req: any) => plainText(),
      getStreamFormatForModel: () => 'aif-responses',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    const stops = events.filter(e => e.type === 'message_stop') as Array<
      Extract<StreamEvent, { type: 'message_stop' }>
    >;
    expect(stops.length).toBeGreaterThan(0);
    const finalStop = stops[stops.length - 1];
    expect(finalStop.stop_reason).toBe('end_turn');
  });
});
