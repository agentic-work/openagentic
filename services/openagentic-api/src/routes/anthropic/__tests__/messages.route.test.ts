/**
 * Unit tests for POST /v1/messages (Anthropic Messages API).
 *
 * Fastify is stood up in-process. Deps are injected via plugin options:
 * - providerManager: stub that returns controlled CompletionResponse or AsyncGenerator
 * - resolveModel: stub that bypasses DB
 *
 * Tests:
 * 1. Non-stream: text response → Anthropic message shape
 * 2. Stream: canonical events → Anthropic SSE frames (event: <type>\ndata: <json>)
 * 3. Unknown model → smart-route fallback (no 400)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createLoggerMock } from '../../../test/mocks/logger.js';

vi.mock('../../../utils/logger.js', () => createLoggerMock());

// Mock prisma so the registry guard import doesn't fail
vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    modelRoleAssignment: {
      findFirst: async () => null,
      count: async () => 0,
    },
  },
}));

// Stub TaskAnalysisService (used by ProviderManager smart-router paths)
vi.mock('../../../services/TaskAnalysisService.js', () => ({
  TaskAnalysisService: class {
    constructor() {}
    async analyzeTask(_input: unknown) {
      return { suggestedModel: 'stub-model', complexity: 'low', reasoning: 'test' };
    }
  },
}));

// ---------------------------------------------------------------------------
// Stub ProviderManager helpers
// ---------------------------------------------------------------------------

function makeTextStubPM(text: string, model = 'stub-model') {
  return {
    initialized: true,
    listModels: async () => [{ id: model, provider: 'stub' }],
    createCompletion: async (_req: any) => ({
      id: 'cmpl-stub-123',
      object: 'chat.completion',
      created: 1700000000,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }),
    getStreamFormatForModel: () => 'openai',
    getHealthStatus: async () => ({}),
  };
}

function makeStreamStubPM(texts: string[], model = 'stub-model') {
  return {
    initialized: true,
    listModels: async () => [{ id: model, provider: 'stub' }],
    createCompletion: async (_req: any) => {
      async function* gen() {
        yield {
          type: 'message_start',
          message: {
            id: 'msg_stream_test',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 5, output_tokens: 0 },
          },
        };
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        for (const t of texts) {
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } };
        }
        yield { type: 'content_block_stop', index: 0 };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: texts.length },
        };
        yield { type: 'message_stop' };
      }
      return gen();
    },
    getStreamFormatForModel: () => 'openai',
    getHealthStatus: async () => ({}),
  };
}

// Stub resolveRequestedModel — returns 'registry' for 'known-model', 'not-in-registry' for others
function makeStubResolveModel(behavior: 'registry' | 'smart-router' | 'not-in-registry' = 'registry') {
  return async (model: string | null | undefined, _prisma: any) => {
    if (behavior === 'registry') {
      return { kind: 'registry' as const, id: 'row-1', model: model ?? 'stub-model', provider: 'stub', role: 'chat' };
    }
    if (behavior === 'smart-router') {
      return { kind: 'smart-router' as const };
    }
    return { kind: 'not-in-registry' as const, requested: String(model), availableCount: 2 };
  };
}

// ---------------------------------------------------------------------------
// Helpers to parse SSE
// ---------------------------------------------------------------------------

function parseSseFrames(payload: string): Array<{ event: string; data: any }> {
  const frames: Array<{ event: string; data: any }> = [];
  const blocks = payload.split('\n\n').filter((b) => b.trim());
  for (const block of blocks) {
    const lines = block.split('\n');
    let event = '';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length).trim();
      if (line.startsWith('data: ')) dataStr = line.slice('data: '.length).trim();
    }
    if (dataStr) {
      try {
        frames.push({ event, data: JSON.parse(dataStr) });
      } catch {
        frames.push({ event, data: dataStr });
      }
    }
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /messages — non-stream', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });

    // Inject a stub user so authMiddleware doesn't block
    server.addHook('preHandler', async (request) => {
      (request as any).user = { id: 'u1', email: 'test@example.com' };
    });

    const { anthropicMessagesRoute } = await import('../messages.route.js');
    await server.register(anthropicMessagesRoute, {
      providerManager: makeTextStubPM('Hello, world!') as any,
      resolveModel: makeStubResolveModel('registry'),
    }, );
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns Anthropic message shape with type:message', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hi!' }],
      },
    });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.payload);
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
  });

  it('content[0] is a text block with the response text', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hi!' }],
      },
    });
    const body = JSON.parse(resp.payload);
    expect(body.content).toHaveLength(1);
    expect(body.content[0]).toEqual({ type: 'text', text: 'Hello, world!' });
  });

  it('stop_reason is end_turn for a normal response', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hi!' }],
      },
    });
    const body = JSON.parse(resp.payload);
    expect(body.stop_reason).toBe('end_turn');
    expect(body.stop_sequence).toBeNull();
  });

  it('usage contains input_tokens and output_tokens', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Hi!' }],
      },
    });
    const body = JSON.parse(resp.payload);
    expect(typeof body.usage.input_tokens).toBe('number');
    expect(typeof body.usage.output_tokens).toBe('number');
  });
});

describe('POST /messages — streaming', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });

    server.addHook('preHandler', async (request) => {
      (request as any).user = { id: 'u1', email: 'test@example.com' };
    });

    const { anthropicMessagesRoute } = await import('../messages.route.js');
    await server.register(anthropicMessagesRoute, {
      providerManager: makeStreamStubPM(['Hello', ', world', '!']) as any,
      resolveModel: makeStubResolveModel('registry'),
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('responds with text/event-stream content type', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.headers['content-type']).toContain('text/event-stream');
  });

  it('first frame is message_start with event: message_start', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    const frames = parseSseFrames(resp.payload);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].event).toBe('message_start');
    expect(frames[0].data.type).toBe('message_start');
    expect(frames[0].data.message?.role).toBe('assistant');
  });

  it('emits content_block_delta frames with text_delta', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    const frames = parseSseFrames(resp.payload);
    const deltas = frames.filter((f) => f.event === 'content_block_delta');
    expect(deltas.length).toBeGreaterThan(0);
    for (const d of deltas) {
      expect(d.data.delta?.type).toBe('text_delta');
      expect(typeof d.data.delta?.text).toBe('string');
    }
  });

  it('last event-typed frame is message_stop', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    const frames = parseSseFrames(resp.payload);
    const eventFrames = frames.filter((f) => f.event !== '');
    const last = eventFrames[eventFrames.length - 1];
    expect(last.event).toBe('message_stop');
    expect(last.data.type).toBe('message_stop');
  });

  it('SSE format uses event: line before data: line', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    // The raw payload should contain "event: message_start\ndata: {"
    expect(resp.payload).toContain('event: message_start\ndata: {');
  });

  it('does NOT emit openai-shape choices[] in any frame', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-opus-4-5',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      },
    });
    const frames = parseSseFrames(resp.payload);
    for (const f of frames) {
      if (typeof f.data === 'object' && f.data !== null) {
        expect((f.data as any).choices).toBeUndefined();
      }
    }
  });
});

describe('POST /messages — unknown model smart-route fallback', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.DATABASE_URL ??= 'postgresql://stub:stub@localhost:5432/stub';

    server = Fastify({ logger: false });

    server.addHook('preHandler', async (request) => {
      (request as any).user = { id: 'u1', email: 'test@example.com' };
    });

    const { anthropicMessagesRoute } = await import('../messages.route.js');
    await server.register(anthropicMessagesRoute, {
      providerManager: makeTextStubPM('Smart routed response') as any,
      // not-in-registry → should NOT 400, should smart-route
      resolveModel: makeStubResolveModel('not-in-registry'),
    });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns 200 (not 400) for an unknown model', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-unknown-model-xyz',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    expect(resp.statusCode).toBe(200);
  });

  it('returns valid Anthropic message shape after smart-route', async () => {
    const resp = await server.inject({
      method: 'POST',
      url: '/messages',
      payload: {
        model: 'claude-unknown-model-xyz',
        messages: [{ role: 'user', content: 'Hi' }],
      },
    });
    const body = JSON.parse(resp.payload);
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
  });
});
