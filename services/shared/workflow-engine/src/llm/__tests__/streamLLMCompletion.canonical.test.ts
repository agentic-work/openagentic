/**
 * streamLLMCompletion — canonical SSE consumer (Path D).
 *
 * Path D (GH #143 ship list) removes the double-normalization in the
 * Flow ↔ api streaming path. The api now exposes a new endpoint
 * `/api/v1/canonical/completions` that emits canonical events as SSE
 * frames directly (no openai-shape repackage). workflows-svc
 * `streamLLMCompletion` consumes those frames 1:1, skipping the
 * `selectCanonicalNormalizer('openai')` re-parse it currently runs on
 * the OpenAI-shape shim's output.
 *
 * Behavior contract (this file pins it):
 *   1. `format: 'canonical'` POSTs to `/api/v1/canonical/completions`,
 *      NOT `/api/v1/chat/completions`.
 *   2. Each SSE `data:` frame parses as a canonical CanonicalEvent and
 *      is forwarded VERBATIM to `onCanonical(...)` — no normalizer in
 *      between.
 *   3. `result.fullText` accumulates from `content_block_delta.delta.
 *      text_delta.text` events the SAME way as the openai-shape path
 *      so executor return contracts stay intact.
 *   4. `result.stopReason` + `result.usage` come from the canonical
 *      `message_delta` event, not from a normalizer's synthetic
 *      finalize() flush.
 *   5. The OpenAI-shape path (`format` unset or `'openai'`) keeps
 *      working unchanged — workflows-svc must remain compatible with
 *      both endpoints during the transition / for any emergency
 *      rollback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamLLMCompletion } from '../streamLLMCompletion.js';

interface Capture {
  url?: string;
  init?: RequestInit;
}

function mockCanonicalSSE(cap: Capture, opts: {
  texts?: string[];
  stopReason?: string;
  usage?: { input_tokens?: number; output_tokens: number };
  model?: string;
}): void {
  const model = opts.model ?? 'router-pick';
  const messageId = 'msg_canonical_test';
  const frames: string[] = [];
  frames.push(
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: opts.usage?.input_tokens ?? 0, output_tokens: 0 },
      },
    })}\n\n`,
  );
  frames.push(
    `data: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}\n\n`,
  );
  for (const t of opts.texts ?? []) {
    frames.push(
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: t },
      })}\n\n`,
    );
  }
  frames.push(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
  frames.push(
    `data: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: opts.stopReason ?? 'end_turn' },
      usage: opts.usage ?? { output_tokens: 3 },
    })}\n\n`,
  );
  frames.push(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
  frames.push(`data: [DONE]\n\n`);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
    async (input: unknown, init?: RequestInit) => {
      cap.url = typeof input === 'string' ? input : (input as Request).url;
      cap.init = init;
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  );
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('streamLLMCompletion — canonical-format SSE consumer (Path D)', () => {
  it('POSTs to /api/v1/canonical/completions when format is canonical', async () => {
    const cap: Capture = {};
    mockCanonicalSSE(cap, { texts: ['hi'] });
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-1',
      onCanonical: () => {},
      format: 'canonical',
    });
    expect(cap.url).toBe('http://test/api/v1/canonical/completions');
  });

  it('defaults to /api/v1/chat/completions when format is unset (back-compat)', async () => {
    const cap: Capture = {};
    // Reuse the openai-shape mock from the antiCot test pattern.
    const chunks = [
      `data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' } }] })}\n\n`,
      `data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
      cap.url = typeof input === 'string' ? input : (input as Request).url;
      cap.init = init;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-2',
      onCanonical: () => {},
    });
    expect(cap.url).toBe('http://test/api/v1/chat/completions');
  });

  it('forwards canonical events verbatim to onCanonical — no openai-shape re-normalize', async () => {
    const cap: Capture = {};
    mockCanonicalSSE(cap, { texts: ['Hello', ' world'] });
    const seenTypes: string[] = [];
    const fullEvents: any[] = [];
    await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-3',
      onCanonical: (ev) => { seenTypes.push(ev.type); fullEvents.push(ev); },
      format: 'canonical',
    });
    // Must include the canonical envelope types from the wire — same
    // ordering, no extra synthesizing.
    expect(seenTypes[0]).toBe('message_start');
    expect(seenTypes).toContain('content_block_start');
    expect(seenTypes).toContain('content_block_delta');
    expect(seenTypes).toContain('content_block_stop');
    expect(seenTypes).toContain('message_delta');
    expect(seenTypes).toContain('message_stop');
    // The two text deltas come through verbatim.
    const deltas = fullEvents.filter((e) => e.type === 'content_block_delta');
    expect(deltas.length).toBe(2);
    expect((deltas[0] as any).delta.text).toBe('Hello');
    expect((deltas[1] as any).delta.text).toBe(' world');
  });

  it('accumulates fullText from text_delta events and reports stop reason + usage', async () => {
    const cap: Capture = {};
    mockCanonicalSSE(cap, {
      texts: ['Hello', ' world', '!'],
      stopReason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const result = await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-4',
      onCanonical: () => {},
      format: 'canonical',
    });
    expect(result.fullText).toBe('Hello world!');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage?.input_tokens).toBe(5);
    expect(result.usage?.output_tokens).toBe(3);
  });

  it('captures model id from message_start when caller sends model=auto', async () => {
    const cap: Capture = {};
    mockCanonicalSSE(cap, { texts: ['x'], model: 'gpt-oss:20b' });
    const result = await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-5',
      onCanonical: () => {},
      format: 'canonical',
    });
    // Smart Router resolved the model server-side; surface it on result.model
    // so downstream nodes / tracing see the real id, not 'auto'.
    expect(result.model).toBe('gpt-oss:20b');
  });

  it('captures thinking text from thinking_delta canonical events', async () => {
    const cap: Capture = {};
    // Inject a thinking_delta block ahead of text deltas — reasoning
    // models (o1/o3/gpt-oss) emit this on the canonical wire.
    const enc = new TextEncoder();
    const frames: string[] = [
      `data: ${JSON.stringify({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'router-pick', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reasoning here' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`,
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } })}\n\n`,
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
      cap.url = typeof input === 'string' ? input : (input as Request).url;
      cap.init = init;
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const result = await streamLLMCompletion({
      apiUrl: 'http://test',
      model: 'auto',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      maxTokens: 200,
      headers: {},
      messageId: 'msg-D-6',
      onCanonical: () => {},
      format: 'canonical',
    });
    expect(result.thinking).toBe('reasoning here');
    expect(result.fullText).toBe('answer');
  });
});
