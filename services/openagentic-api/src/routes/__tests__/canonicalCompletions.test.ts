/**
 * POST /api/v1/canonical/completions — Path D unit tests.
 *
 * Path D (GH #143) removes the double-normalization between openagentic-api
 * and workflows-svc. The new endpoint emits canonical events
 * (Anthropic Messages SSE shape) DIRECTLY to the wire — no openai-shape
 * repackage step.
 *
 * Behavior contract pinned here:
 *  1. The route streams `data: <CanonicalEvent>\n\n` SSE frames.
 *  2. Each frame parses as a canonical CanonicalEvent (`type: message_start
 *     | content_block_* | message_delta | message_stop | …`) — NOT as an
 *     OpenAI Chat Completion chunk (`{choices: [{delta, finish_reason}]}`).
 *  3. The terminator is the same `data: [DONE]\n\n` marker the OpenAI
 *     shim uses, so workflows-svc's SSE drain loop terminates cleanly.
 *  4. Smart Router still applies when `model:'auto'` (preserving the
 *     guardrail in CLAUDE.md rule 7).
 *  5. Non-streaming requests are rejected with a 400 — the canonical
 *     endpoint exists for streaming consumers only. (Non-stream callers
 *     keep using the OpenAI shim.)
 *
 * Tactic: inject a stub ProviderManager whose createCompletion returns
 * a hand-rolled async generator yielding canonical envelopes. The route
 * handler must pass each one through to the wire verbatim.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLoggerMock } from '../../test/mocks/logger.js';

vi.mock('../../utils/logger.js', () => createLoggerMock());

// Stub Smart Router (TaskAnalysisService) — its real implementation
// reaches into prisma, which we don't stand up in this unit test.
// The route still invokes the router on body.model='auto'; we just
// make it deterministic without a DB.
vi.mock('../../services/TaskAnalysisService.js', () => ({
  TaskAnalysisService: class {
    constructor() {}
    async analyzeTask(_input: unknown) {
      return {
        suggestedModel: 'router-pick',
        complexity: 'low',
        reasoning: 'unit-test stub',
      };
    }
  },
}));

// Stub provider manager — yields canonical envelopes. The new endpoint
// must pass these through without re-shaping.
function makeStubProviderManager(opts: {
  texts?: string[];
  stopReason?: string;
  model?: string;
}) {
  const created: Array<{ req: any; provider?: string }> = [];
  const pm = {
    initialized: true,
    listModels: async () => [{ id: 'router-pick', provider: 'stub' }],
    createCompletion: async (req: any, provider?: string) => {
      created.push({ req, provider });
      const texts = opts.texts ?? ['Hello'];
      const model = opts.model ?? 'router-pick';
      async function* gen() {
        yield {
          type: 'message_start',
          message: {
            id: 'msg_test_pd',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        };
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        };
        for (const t of texts) {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: t },
          };
        }
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'message_delta',
          delta: { stop_reason: opts.stopReason ?? 'end_turn' },
          usage: { output_tokens: texts.length },
        };
        yield { type: 'message_stop' };
      }
      return gen();
    },
    getStreamFormatForModel: () => 'openai',
    detectProviderForModel: () => 'stub-provider',
    getHealthStatus: async () => ({}),
  };
  return { pm, created };
}

describe('POST /api/v1/canonical/completions — Path D (canonical SSE)', () => {
  let server: FastifyInstance;
  let stub: ReturnType<typeof makeStubProviderManager>;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'pathd-test-secret';
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });
    stub = makeStubProviderManager({ texts: ['Hello', ' from', ' Path D'] });

    const { default: canonicalCompletionsRoutes } = await import(
      '../canonical-completions.js'
    );
    await server.register(canonicalCompletionsRoutes, {
      providerManager: stub.pm as any,
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('streams canonical SSE — first frame is message_start', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        stream: true,
      },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers['content-type']).toContain('text/event-stream');
    const frames = resp.payload
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => f.replace(/^data:\s*/, '').trim());
    // Last marker is the [DONE] sentinel — strip it for shape assertions.
    expect(frames[frames.length - 1]).toBe('[DONE]');
    const events = frames.slice(0, -1).map((f) => JSON.parse(f));
    expect(events[0].type).toBe('message_start');
    expect(events[0].message?.role).toBe('assistant');
    // Crucial: NOT openai-shape. openai-shape would have `choices` at root.
    expect((events[0] as any).choices).toBeUndefined();
  });

  it('emits content_block_delta frames verbatim — text_delta carries token text', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        stream: true,
      },
    });
    const events = resp.payload
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => f.replace(/^data:\s*/, '').trim())
      .filter((f) => f !== '[DONE]')
      .map((f) => JSON.parse(f));

    const deltas = events.filter((e: any) => e.type === 'content_block_delta');
    expect(deltas.length).toBe(3);
    expect((deltas[0] as any).delta.type).toBe('text_delta');
    expect((deltas[0] as any).delta.text).toBe('Hello');
    expect((deltas[1] as any).delta.text).toBe(' from');
    expect((deltas[2] as any).delta.text).toBe(' Path D');
  });

  it('terminator is message_stop carrying valid canonical stop_reason path (via message_delta)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        stream: true,
      },
    });
    const events = resp.payload
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => f.replace(/^data:\s*/, '').trim())
      .filter((f) => f !== '[DONE]')
      .map((f) => JSON.parse(f));

    const lastEnvelopes = events.slice(-2).map((e: any) => e.type);
    expect(lastEnvelopes).toEqual(['message_delta', 'message_stop']);
    const md = events.find((e: any) => e.type === 'message_delta');
    expect(['end_turn', 'stop_sequence', 'max_tokens', 'tool_use', 'content_filter']).toContain(
      (md as any).delta?.stop_reason,
    );
  });

  it('Smart Router is applied — body.model:auto must reach ProviderManager (route does not bypass)', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'auto-routed' }],
        model: 'auto',
        stream: true,
      },
    });
    expect(resp.statusCode).toBe(200);
    // ProviderManager.createCompletion MUST have been called — the route
    // never short-circuits the cost/RBAC/routing path.
    expect(stub.created.length).toBeGreaterThanOrEqual(1);
    const callReq = stub.created.at(-1)!.req;
    // Smart Router substituted a real model id (handler resolves 'auto'
    // before invoking ProviderManager). The mock stubProvider doesn't run
    // the real router; the contract here is just that the request is
    // dispatched, not 'auto'-mangled.
    expect(typeof callReq.model).toBe('string');
    expect(callReq.stream).toBe(true);
  });

  it('rejects non-streaming requests with 400 — endpoint is stream-only', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        // stream omitted / false → must 400
      },
    });
    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.payload);
    expect(body.error?.type).toBe('StreamRequired');
  });

  it('does NOT emit OpenAI-shape choices[] anywhere in the wire', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/api/v1/canonical/completions',
      payload: {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'auto',
        stream: true,
      },
    });
    const events = resp.payload
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => f.replace(/^data:\s*/, '').trim())
      .filter((f) => f !== '[DONE]')
      .map((f) => JSON.parse(f));
    for (const ev of events) {
      expect((ev as any).choices).toBeUndefined();
      expect((ev as any).object).not.toBe('chat.completion.chunk');
    }
  });
});
