/**
 * POST /api/admin/test-harness/run-e2e — TDD spec.
 *
 * Pins the wire contract for the REAL E2E sweep that GH Actions calls.
 *
 *  - admin-only (403 without admin OR static TEST_HARNESS_API_KEY)
 *  - NDJSON content-type
 *  - emits {type:'test_start'} → {type:'test_done'} pairs, ONE pair per
 *    category test (provider, chat_model, embedding_model, t1_tool,
 *    cache_verify, etc.)
 *  - emits one final {type:'summary'} frame with passed/failed counts
 *  - per-test_done shape carries durationMs and (when present) ttftMs,
 *    tokensIn/tokensOut, embeddingDim, evidence, error
 *
 * The actual provider calls are mocked — we only assert the wire shape.
 * Real-provider behaviour is covered by the bulletproof harness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = [
    'server',
    'auth',
    'chat',
    'mcp',
    'database',
    'admin',
    'routes',
    'middleware',
    'services',
    'pipeline',
    'storage',
    'prompt',
  ];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub — return one provider, one chat row, one embedding row.
// ---------------------------------------------------------------------------
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    lLMProvider: {
      findMany: vi.fn().mockResolvedValue([
        {
          name: 'test-provider',
          provider_type: 'anthropic',
          model_config: { chatModel: 'test-model-1' },
        },
      ]),
    },
    modelRoleAssignment: {
      findMany: vi.fn().mockImplementation(async (args: any) => {
        const role = args?.where?.role;
        if (role?.in?.includes('embedding') || role?.in?.includes('embeddings')) {
          return [
            {
              model: 'test-embed',
              provider: 'test-provider',
              role: 'embedding',
              priority: 1,
              capabilities: { embeddingDimensions: 1024 },
            },
          ];
        }
        return [
          {
            model: 'test-model-1',
            provider: 'test-provider',
            role: 'chat',
            priority: 1,
            capabilities: {
              functionCallingAccuracy: 0.95,
              contextWindowTokens: 200000,
            },
          },
        ];
      }),
      findFirst: vi.fn().mockResolvedValue({ model: 'test-model-1', provider: 'test-provider' }),
    },
    chatSession: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
  default: {
    lLMProvider: { findMany: vi.fn().mockResolvedValue([]) },
    modelRoleAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    chatSession: { upsert: vi.fn() },
  },
}));

// ---------------------------------------------------------------------------
// ProviderManager stub — yields one chunk with text.
// ---------------------------------------------------------------------------
vi.mock('../../services/llm-providers/ProviderManager.js', () => ({
  getProviderManager: () => ({
    async createCompletion(_req: any) {
      async function* gen() {
        yield { choices: [{ delta: { content: '4' } }] };
        yield { choices: [{ delta: { content: '.' } }] };
      }
      return gen();
    },
  }),
}));

// ---------------------------------------------------------------------------
// UniversalEmbeddingService stub — fixed-dim vector.
// ---------------------------------------------------------------------------
vi.mock('../../services/UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: class {
    async generateEmbedding(_text: string) {
      return { embedding: new Array(1024).fill(0.1), usage: { prompt_tokens: 5, total_tokens: 5 } };
    }
  },
}));

// ---------------------------------------------------------------------------
// MCPProxyClient stub
// ---------------------------------------------------------------------------
vi.mock('../../services/MCPProxyClient.js', () => ({
  MCPProxyClient: class {
    async getAvailableTools() {
      return ['azure_list_subscriptions', 'aws_get_account', 'gcp_list_projects'];
    }
    async callTool(_s: string, _t: string, _a: any) {
      return { ok: true, items: [] };
    }
  },
}));

// ---------------------------------------------------------------------------
// ToolResultCacheService stub
// ---------------------------------------------------------------------------
vi.mock('../../services/ToolResultCacheService.js', () => ({
  getToolResultCacheService: () => ({
    getStats: () => ({ hits: 0, misses: 0, sets: 0 }),
    isReady: () => true,
  }),
}));

// ---------------------------------------------------------------------------
// NDJSON parse helper
// ---------------------------------------------------------------------------
function parseNdjson(s: string): Array<Record<string, any>> {
  return s
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Fastify harness
// ---------------------------------------------------------------------------
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const mod = await import('../admin-test-harness-run-e2e.js');
  // Synthesize admin user so the preHandler passes.
  app.addHook('preHandler', async (req: any) => {
    req.user = { userId: 'unit-admin', isAdmin: true, email: 'x@y' };
  });
  await app.register(mod.default, { prefix: '/api/admin/test-harness' });
  return app;
}

describe('POST /api/admin/test-harness/run-e2e', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves NDJSON content-type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type'] || '').toContain('application/x-ndjson');
  });

  it('emits test_start + test_done pairs per category and a final summary frame', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    const frames = parseNdjson(res.body);
    const starts = frames.filter((f) => f.type === 'test_start');
    const dones = frames.filter((f) => f.type === 'test_done');
    const summary = frames.find((f) => f.type === 'summary');
    expect(starts.length).toBeGreaterThan(0);
    expect(dones.length).toBe(starts.length);
    expect(summary).toBeTruthy();
    expect(typeof summary?.passed).toBe('number');
    expect(typeof summary?.failed).toBe('number');
    expect(Array.isArray(summary?.models)).toBe(true);
  });

  it('every test_done carries durationMs and an ok boolean', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    const frames = parseNdjson(res.body);
    const dones = frames.filter((f) => f.type === 'test_done');
    for (const d of dones) {
      expect(typeof d.durationMs).toBe('number');
      expect(typeof d.ok).toBe('boolean');
    }
  });

  it('runs all four critical categories: provider, chat_model, embedding_model, t1_tool', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    const frames = parseNdjson(res.body);
    const kinds = new Set(frames.filter((f) => f.type === 'test_start').map((f) => f.kind));
    expect(kinds.has('provider')).toBe(true);
    expect(kinds.has('chat_model')).toBe(true);
    expect(kinds.has('embedding_model')).toBe(true);
    expect(kinds.has('t1_tool')).toBe(true);
    expect(kinds.has('cache_verify')).toBe(true);
  });

  it('embedding test_done carries embeddingDim', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    const frames = parseNdjson(res.body);
    const embed = frames.find((f) => f.type === 'test_done' && f.kind === 'embedding_model');
    expect(embed).toBeTruthy();
    expect(embed?.embeddingDim).toBe(1024);
  });

  it('chat_model test_done carries ttftMs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/test-harness/run-e2e',
      headers: { 'content-type': 'application/json' },
      payload: { mode: 'smoke', includeFlows: false, includeMcpTools: false, includeT3: false },
    });
    const frames = parseNdjson(res.body);
    const chat = frames.find((f) => f.type === 'test_done' && f.kind === 'chat_model');
    expect(chat).toBeTruthy();
    expect(typeof chat?.ttftMs).toBe('number');
  });
});

describe('POST /api/admin/test-harness/run-e2e — auth', () => {
  it('returns 403 for non-admin users', async () => {
    const app = Fastify();
    const mod = await import('../admin-test-harness-run-e2e.js');
    app.addHook('preHandler', async (req: any) => {
      req.user = { userId: 'plain-user', isAdmin: false };
    });
    await app.register(mod.default, { prefix: '/api/admin/test-harness' });
    const res = await app.inject({ method: 'POST', url: '/api/admin/test-harness/run-e2e', payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
