/**
 * F0-4 (2026-05-12 audit): streamProvider backstop block at
 * streamProvider.ts:244-252 is currently a no-op (comment-only body).
 *
 * Smoking gun: when a provider's stream ends WITHOUT yielding a
 * terminal `message_stop` envelope and WITH open tool_use blocks
 * pending in `toolBlockState`, the normalizer.finalize() flush either
 * (a) synthesizes a `message_delta(stop_reason='end_turn') + message_stop`
 * pair which silently downgrades the tool_use signal, or (b) emits
 * nothing — leaving `stopReason` at its default 'end_turn'.
 *
 * Either way chatLoop's for-await loop ends with stopReason='end_turn',
 * the synthesis-fallback at chatLoop.ts:343 fires (forces another
 * pointless turn), and the model's pending tool_use blocks are NEVER
 * dispatched. The user sees a hanging spinner; the operator sees no
 * tool execution in the audit log.
 *
 * Fix: in the backstop block, when toolBlockState has open entries AND
 * `stopReason !== 'tool_use'`, force the operative stop_reason by
 * yielding a corrective `message_stop` event with stop_reason='tool_use'.
 * chatLoop's last-event-wins consumer at chatLoop.ts:318 then picks up
 * the correct signal → dispatch fires.
 *
 * TDD-RED before fix.
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
  model: 'fake-model',
};

describe('streamProvider — F0-4 backstop forces tool_use stop when blocks pending', () => {
  it('emits message_stop(stop_reason=tool_use) when stream ends with open tool_use block', async () => {
    // Provider yields canonical envelopes opening a tool_use block,
    // then drops the connection — NO content_block_stop, NO message_delta,
    // NO message_stop. The normalizer's finalize() either yields nothing
    // (canonical bypass path was used, so it was never fed) or synthesizes
    // an end_turn pair. Either way, without the backstop, chatLoop ends
    // up with stopReason='end_turn' and the pending tool_use block is
    // never dispatched.
    async function* truncatedToolUseStream() {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_truncated', name: 'tool_search' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"azure"}' },
      };
      // stream ends here — provider crash / connection drop / etc.
    }

    const fakePm = {
      createCompletion: async (_req: any) => truncatedToolUseStream(),
      getStreamFormatForModel: () => 'anthropic',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    // The backstop MUST yield a final message_stop with tool_use so
    // chatLoop dispatches the pending block.
    const stops = events.filter(e => e.type === 'message_stop') as Array<
      Extract<StreamEvent, { type: 'message_stop' }>
    >;
    expect(stops.length, 'expected at least one message_stop from backstop').toBeGreaterThan(0);
    const finalStop = stops[stops.length - 1];
    expect(finalStop.stop_reason).toBe('tool_use');
  });

  it('does NOT force tool_use when no tool_use blocks are open (pure text stream)', async () => {
    // Regression guard: backstop should only kick in for pending tool_use.
    // A plain-text stream that ends cleanly without an explicit message_stop
    // should still settle on end_turn (default), NOT spuriously force tool_use.
    async function* truncatedTextStream() {
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
        usage: { input_tokens: 5, output_tokens: 1 },
      };
      yield { type: 'message_stop' };
    }

    const fakePm = {
      createCompletion: async (_req: any) => truncatedTextStream(),
      getStreamFormatForModel: () => 'anthropic',
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
