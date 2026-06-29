/**
 * V3 streamProvider unit tests — Phase 2, Task 2.3.
 *
 * Exercises the SDK normalizer wire-in for the two most-used provider
 * formats (openai + ollama). The closure built by `makeStreamProvider`
 * must:
 *   1. resolve `format` via `providerManager.getStreamFormatForModel(model)`,
 *   2. construct the matching SDK `selectCanonicalNormalizer(format)`,
 *   3. yield V3 `StreamEvent`s (text_delta, message_stop, tool_use_*)
 *      translated from canonical SDK events.
 *
 * The test mocks only the ProviderManager — the real SDK normalizer is
 * exercised end-to-end so a regression in the SDK→V3 boundary surfaces
 * here.
 *
 * the design notes
 * the design notes
 *       Phase 2, Task 2.3.
 */

import { describe, it, expect } from 'vitest';
import { makeStreamProvider } from '../streamProvider.js';
import type { ProviderRequest, StreamEvent } from '../types.js';

const baseReq: ProviderRequest = {
  system: '',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
  tool_choice: 'auto',
  model: 'test-model',
};

describe('makeStreamProvider — SDK normalizer wire-in', () => {
  it('yields canonical StreamEvents for openai-format provider stream', async () => {
    // Build a fake provider stream using OpenAI Chat Completions chunk
    // shape — content + finish_reason. The SDK OpenAI normalizer must
    // translate this into canonical content_block_delta(text_delta) +
    // message_stop, which streamProvider then maps to V3's StreamEvent
    // union (text_delta + message_stop).
    async function* openaiChunks() {
      yield {
        choices: [{ index: 0, delta: { role: 'assistant', content: 'hello ' } }],
      };
      yield {
        choices: [{ index: 0, delta: { content: 'world' } }],
      };
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
    }

    const fakePm = {
      createCompletion: async (_req: any) => openaiChunks(),
      getStreamFormatForModel: () => 'openai',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    const textDeltas = events.filter(
      (e): e is Extract<StreamEvent, { type: 'text_delta' }> => e.type === 'text_delta',
    );
    const stops = events.filter(e => e.type === 'message_stop');

    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas.map(e => e.text).join('')).toBe('hello world');
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0]).toMatchObject({ type: 'message_stop', stop_reason: 'end_turn' });
  });

  it('yields canonical StreamEvents for ollama-format provider stream', async () => {
    // Ollama native NDJSON shape: { message: { content }, done, done_reason }.
    // The SDK Ollama normalizer must translate into the same canonical
    // event taxonomy as OpenAI; streamProvider must map to identical
    // V3 StreamEvent shape — provider-format independence is the
    // contract Phase 2 ships.
    async function* ollamaChunks() {
      yield { message: { role: 'assistant', content: 'ollama ' }, done: false };
      yield { message: { role: 'assistant', content: 'out' }, done: false };
      yield { done: true, done_reason: 'stop' };
    }

    const fakePm = {
      createCompletion: async (_req: any) => ollamaChunks(),
      getStreamFormatForModel: () => 'ollama',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    const textDeltas = events.filter(
      (e): e is Extract<StreamEvent, { type: 'text_delta' }> => e.type === 'text_delta',
    );
    const stops = events.filter(e => e.type === 'message_stop');

    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas.map(e => e.text).join('')).toBe('ollama out');
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0]).toMatchObject({ type: 'message_stop', stop_reason: 'end_turn' });
  });

  it('falls back to openai format when getStreamFormatForModel is missing', async () => {
    // Defensive default: when the ProviderManager surface doesn't expose
    // `getStreamFormatForModel`, streamProvider must fall through to
    // 'openai' (the most common shape). This protects unit-test deps
    // and any older PM instance from breaking the V3 boundary.
    async function* openaiChunks() {
      yield {
        choices: [{ index: 0, delta: { content: 'fallback ok' } }],
      };
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
    }

    const fakePm = {
      createCompletion: async (_req: any) => openaiChunks(),
      // intentionally no getStreamFormatForModel
    };

    const stream = makeStreamProvider(fakePm as any)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThan(0);
  });

  it('Sev-0 — passes through openagentic-sdk CanonicalEvent envelopes that AIF interleaves on chat/completions', async () => {
    // AzureAIFoundryProvider's chat/completions stream yields
    // openagentic-sdk CanonicalEvent envelopes ({type:'content_block_delta',
    // delta:{type:'text_delta', text}}) interleaved with its native chunks.
    // The format-keyed `openai` normalizer can't read those — it expects
    // {choices:[{delta}]}. Without an envelope-passthrough, those text
    // deltas were silently dropped → 0 tokens → "Model finished without
    // producing an answer".
    //
    // V3 must detect canonical-shape chunks and forward them directly to
    // translateCanonicalEvent, bypassing the format-specific normalizer.
    async function* aifMixedChunks() {
      // Simulate AIF's content_block_start (openagentic-sdk CanonicalEvent
      // shape, `type` at top level).
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      };
      // First text delta — Anthropic envelope.
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello ' },
      };
      // Second text delta — Anthropic envelope.
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'from AIF' },
      };
      // Stop the block.
      yield {
        type: 'content_block_stop',
        index: 0,
      };
      // Final OpenAI-shape finish_reason chunk that AIF emits to close
      // the stream. The normalizer handles this for stop_reason mapping.
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
    }

    const fakePm = {
      createCompletion: async (_req: any) => aifMixedChunks(),
      getStreamFormatForModel: () => 'openai',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    const textDeltas = events.filter(
      (e): e is Extract<StreamEvent, { type: 'text_delta' }> => e.type === 'text_delta',
    );
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas.map(e => e.text).join('')).toBe('hello from AIF');
    const stops = events.filter(e => e.type === 'message_stop');
    expect(stops.length).toBeGreaterThan(0);
  });

  it('emits no V3 events when provider returns a non-iterable response', async () => {
    // Some PM call paths short-circuit streaming (cached response, etc).
    // streamProvider's runtime asyncIterator guard must drop through to
    // normalizer.finalize() without throwing — chat-loop sees an empty
    // turn and the synthesis-fallback handles it.
    const fakePm = {
      createCompletion: async (_req: any) => ({ /* not iterable */ } as any),
      getStreamFormatForModel: () => 'openai',
    };

    const stream = makeStreamProvider(fakePm)(baseReq);
    const events: StreamEvent[] = [];
    for await (const ev of stream) events.push(ev);

    // No text_delta / tool_use_* events expected. message_stop may or
    // may not appear depending on whether finalize() synthesizes one;
    // chat-loop tolerates either.
    expect(events.filter(e => e.type === 'text_delta')).toHaveLength(0);
    expect(events.filter(e => e.type === 'tool_use_start')).toHaveLength(0);
  });
});
