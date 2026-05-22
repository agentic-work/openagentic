/**
 * v3-extras-misc admin routes — TDD spec
 *
 * Covers the six DashboardV3 endpoints registered by
 * routes/admin/v3-extras-misc.ts:
 *   1. GET /cluster/health                       — k8s roll-up via Prometheus
 *   2. GET /storage                              — milvus/pgvector/redis
 *   3. GET /mcp-logs/histogram                   — MCP latency buckets
 *   4. GET /api-requests/throttles               — rate-limit roll-up
 *   5. GET /perf/throughput                      — tok/s + concurrency
 *   6. GET /router/escalation-triggers           — escalation-cause histogram
 *
 * 6 happy-path cases + a 503 (Prometheus unreachable) + a 500 (DB error)
 * per the implementer brief.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// vi.mock is hoisted so we wire a single shared `prisma` object whose model
// methods are vitest fns we can re-stub per test.
// ---------------------------------------------------------------------------

vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    mCPUsage:             { findMany: vi.fn() },
    rateLimitViolation:   { findMany: vi.fn() },
    lLMRequestLog:        { findMany: vi.fn() },
    adminAuditLog:        { findMany: vi.fn() },
    user:                 { findMany: vi.fn() },
    modelRoutingDecision: { findMany: vi.fn() },
    $queryRawUnsafe:      vi.fn(),
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  loggers: {
    routes: {
      child: () => ({
        info:  vi.fn(),
        warn:  vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    },
  },
}));

// Default redis mock — `isConnected()` true, `keys('*')` returns 3 keys.
const fakeRedis = {
  isConnected: vi.fn(() => true),
  keys:        vi.fn(async () => ['a', 'b', 'c']),
};
vi.mock('../../../utils/redis-client.js', () => ({
  getRedisClient: () => fakeRedis,
}));

// `redis` package — only used by the storage endpoint's INFO probe.
const fakeTmpRedis = {
  connect: vi.fn(async () => undefined),
  info:    vi.fn(async () => 'used_memory:1048576\r\nused_memory_human:1.00M\r\n'),
  quit:    vi.fn(async () => undefined),
};
vi.mock('redis', () => ({
  createClient: vi.fn(() => fakeTmpRedis),
}));

// `@zilliz/milvus2-sdk-node` — surface a fake MilvusClient with the two
// methods the storage endpoint calls.
const fakeMilvus = {
  showCollections:         vi.fn(async () => ({ data: [{ name: 'docs' }, { name: 'tools' }] })),
  getCollectionStatistics: vi.fn(async () => ({ stats: [{ key: 'row_count', value: '500' }] })),
};
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn().mockImplementation(() => fakeMilvus),
}));

import { prisma } from '../../../utils/prisma.js';
const p = prisma as any;

/** Build a Fastify app with an auth-stub preHandler that defaults to admin=true. */
async function buildApp(opts: { isAdmin?: boolean; noUserAttached?: boolean } = {}): Promise<FastifyInstance> {
  const { isAdmin = true, noUserAttached = false } = opts;
  const app = Fastify({ logger: false });

  if (!noUserAttached) {
    app.addHook('preHandler', async (request: any) => {
      request.user = {
        id: 'test-user',
        email: 'admin@openagentic.io',
        isAdmin,
        role: isAdmin ? 'admin' : 'user',
      };
    });
  }

  const { default: routes } = await import('../v3-extras-misc.js');
  await app.register(routes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the redis fakes that are re-used across tests.
  fakeRedis.isConnected.mockReturnValue(true);
  fakeRedis.keys.mockResolvedValue(['a', 'b', 'c']);
  fakeMilvus.showCollections.mockResolvedValue({ data: [{ name: 'docs' }, { name: 'tools' }] });
  fakeMilvus.getCollectionStatistics.mockResolvedValue({ stats: [{ key: 'row_count', value: '500' }] });
  // Default queryRawUnsafe: pgvector tables + reltuples lookups.
  p.$queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (/FROM pg_attribute/i.test(sql)) {
      return [{ relname: 'documents' }, { relname: 'mcp_tools' }];
    }
    if (/reltuples/i.test(sql)) {
      return [{ reltuples: 1234 }];
    }
    return [];
  });
});

// ===========================================================================
// 1. GET /cluster/health
// ===========================================================================
describe('GET /api/admin/cluster/health', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('200: returns nodes/pods/cpu/memory rollup from Prometheus', async () => {
    process.env.PROM_URL = 'http://prom.test';

    const fakeFetch = vi.fn(async (url: string) => {
      // Return a deterministic scalar per query.
      const body = {
        status: 'success',
        data: { resultType: 'vector', result: [{ metric: {}, value: [Date.now() / 1000, '5'] }] },
      };
      // Match a couple of queries with distinct values for assertion.
      if (url.includes('kube_node_info')) {
        body.data.result[0].value = [Date.now() / 1000, '5'];
      } else if (url.includes('kube_pod_status_phase')) {
        body.data.result[0].value = [Date.now() / 1000, '42'];
      } else if (url.includes('node_cpu_seconds_total')) {
        body.data.result[0].value = [Date.now() / 1000, '67.5'];
      } else if (url.includes('node_memory_MemTotal_bytes')) {
        body.data.result[0].value = [Date.now() / 1000, '128.5'];
      }
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fakeFetch);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/cluster/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.nodes.total).toBe(5);
    expect(body.cpu.used_pct).toBeGreaterThan(0);
    expect(body.memory.capacity_gb).toBeGreaterThan(0);
    expect(body.source).toBe('prometheus');
    await app.close();
  });

  it('503: returns 503 when Prometheus URL is not configured', async () => {
    delete process.env.PROM_URL;
    delete process.env.PROMETHEUS_URL;
    delete process.env.PROMETHEUS_HOST;

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/cluster/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/Prometheus/);
    await app.close();
  });

  it('503: returns 503 when every PromQL sub-query throws (upstream down)', async () => {
    process.env.PROM_URL = 'http://prom.test';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/cluster/health' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

// ===========================================================================
// 2. GET /storage
// ===========================================================================
describe('GET /api/admin/storage', () => {
  it('200: returns milvus + pgvector + redis sub-summaries', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/storage' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.milvus).toMatchObject({ collections: 2, total_vectors: 1000 });
    expect(body.pgvector).toMatchObject({ tables: 2 });
    expect(body.pgvector.total_rows).toBeGreaterThanOrEqual(0);
    expect(body.redis.keys).toBe(3);
    expect(body.redis.memory_mb).toBe(1);
    await app.close();
  });

  it('200 with milvus.error: gracefully degrades when milvus probe throws', async () => {
    fakeMilvus.showCollections.mockRejectedValueOnce(new Error('milvus down'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/storage' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.milvus.error).toMatch(/milvus down/);
    // The other sections should still be present.
    expect(body.redis.keys).toBe(3);
    await app.close();
  });
});

// ===========================================================================
// 3. GET /mcp-logs/histogram
// ===========================================================================
describe('GET /api/admin/mcp-logs/histogram', () => {
  it('200: returns the 5 spec\'d latency buckets with counts', async () => {
    p.mCPUsage.findMany.mockResolvedValue([
      { execution_time_ms: 50    },  // bucket 0
      { execution_time_ms: 99    },  // bucket 0
      { execution_time_ms: 250   },  // bucket 1
      { execution_time_ms: 1500  },  // bucket 2
      { execution_time_ms: 5000  },  // bucket 3
      { execution_time_ms: 50000 },  // bucket 4 (>10k)
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp-logs/histogram?window=24h&buckets=20' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.buckets).toHaveLength(5);
    expect(body.buckets[0]).toMatchObject({ lo: 0, hi: 100, count: 2 });
    expect(body.buckets[1]).toMatchObject({ lo: 100, hi: 500, count: 1 });
    expect(body.buckets[2]).toMatchObject({ lo: 500, hi: 2000, count: 1 });
    expect(body.buckets[3]).toMatchObject({ lo: 2000, hi: 10000, count: 1 });
    expect(body.buckets[4]).toMatchObject({ lo: 10000, hi: null, count: 1 });
    await app.close();
  });

  it('500: surfaces Prisma error', async () => {
    p.mCPUsage.findMany.mockRejectedValue(new Error('db down'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/mcp-logs/histogram' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// 4. GET /api-requests/throttles
// ===========================================================================
describe('GET /api/admin/api-requests/throttles', () => {
  it('200: aggregates RateLimitViolation + LLMRequestLog + AdminAuditLog', async () => {
    p.rateLimitViolation.findMany.mockResolvedValue([
      { user_id: 'u1', user_email: 'a@x.io', violation_type: 'requests_per_minute' },
      { user_id: 'u1', user_email: 'a@x.io', violation_type: 'tokens_per_day'      },
      { user_id: 'u2', user_email: 'b@x.io', violation_type: 'requests_per_hour'   },
    ]);
    p.lLMRequestLog.findMany.mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u3' },  // no violation row, so email backfill kicks in
    ]);
    p.adminAuditLog.findMany.mockResolvedValue([
      { user: { id: 'u2', email: 'b@x.io' }, details: {} },
    ]);
    p.user.findMany.mockResolvedValue([
      { id: 'u3', email: 'c@x.io' },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-requests/throttles?window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.throttles).toBe(6);             // 3 + 2 + 1
    expect(body.rateLimitHits).toBe(5);         // 3 + 2
    expect(body.usersAtQuota[0]).toMatchObject({ userId: 'u1', email: 'a@x.io', hits: 3 });
    expect(body.usersAtQuota.find((u: any) => u.userId === 'u3')?.email).toBe('c@x.io');
    expect(body.sources).toMatchObject({
      rateLimitViolation: 3,
      llmRequestLog:      2,
      adminAuditLog:      1,
    });
    await app.close();
  });

  it('500: Prisma rejection bubbles', async () => {
    p.rateLimitViolation.findMany.mockRejectedValue(new Error('db'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-requests/throttles' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// 5. GET /perf/throughput
// ===========================================================================
describe('GET /api/admin/perf/throughput', () => {
  it('200: computes avg/p95 tok/s and uses the column-recorded max concurrency', async () => {
    p.lLMRequestLog.findMany.mockResolvedValue([
      { tokens_per_second: 50,  concurrent_requests: 1, request_started_at: new Date('2026-05-06T12:00:00Z'), request_completed_at: new Date('2026-05-06T12:00:01Z') },
      { tokens_per_second: 100, concurrent_requests: 5, request_started_at: new Date('2026-05-06T12:00:02Z'), request_completed_at: new Date('2026-05-06T12:00:03Z') },
      { tokens_per_second: 200, concurrent_requests: 3, request_started_at: new Date('2026-05-06T12:00:04Z'), request_completed_at: new Date('2026-05-06T12:00:05Z') },
      { tokens_per_second: 75,  concurrent_requests: 2, request_started_at: new Date('2026-05-06T12:00:06Z'), request_completed_at: new Date('2026-05-06T12:00:07Z') },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/perf/throughput?window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokens_per_sec_avg).toBeCloseTo((50 + 100 + 200 + 75) / 4, 2);
    expect(body.tokens_per_sec_p95).toBeGreaterThanOrEqual(body.tokens_per_sec_avg);
    expect(body.max_concurrency).toBe(5);
    expect(body.sample).toBe(4);
    await app.close();
  });

  it('200: falls back to overlap walk when concurrent_requests is null on every row', async () => {
    p.lLMRequestLog.findMany.mockResolvedValue([
      { tokens_per_second: null, concurrent_requests: null, request_started_at: new Date('2026-05-06T12:00:00Z'), request_completed_at: new Date('2026-05-06T12:00:10Z') },
      { tokens_per_second: null, concurrent_requests: null, request_started_at: new Date('2026-05-06T12:00:05Z'), request_completed_at: new Date('2026-05-06T12:00:15Z') },
      { tokens_per_second: null, concurrent_requests: null, request_started_at: new Date('2026-05-06T12:00:07Z'), request_completed_at: new Date('2026-05-06T12:00:09Z') },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/perf/throughput' });
    expect(res.statusCode).toBe(200);
    expect(res.json().max_concurrency).toBe(3);
    await app.close();
  });
});

// ===========================================================================
// 6. GET /router/escalation-triggers
// ===========================================================================
describe('GET /api/admin/router/escalation-triggers', () => {
  it('200: groups escalations by trigger string with count + avgDelta', async () => {
    p.modelRoutingDecision.findMany.mockResolvedValue([
      { model_from: 'gpt-oss:20b', model_to: 'claude-sonnet-4.6', reason: 'cloud-list',           context: { trigger: 'cloud-list',           scoreDelta: 0.30 } },
      { model_from: 'gpt-oss:20b', model_to: 'claude-sonnet-4.6', reason: 'cloud-list',           context: { trigger: 'cloud-list',           scoreDelta: 0.40 } },
      { model_from: 'gpt-oss:20b', model_to: 'claude-sonnet-4.6', reason: 'fca-floor',            context: { trigger: 'fca-floor-violation',  scoreDelta: 0.10 } },
      { model_from: 'gpt-oss:20b', model_to: 'gpt-oss:20b',       reason: 'no-op',                context: { escalated: false } },  // no escalation
      { model_from: 'gpt-oss:20b', model_to: 'gemini-2.5-flash',  reason: 'complexity-gate',      context: {} },                     // falls back to reason
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/router/escalation-triggers?window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const cl = body.triggers.find((t: any) => t.trigger === 'cloud-list');
    expect(cl).toMatchObject({ count: 2 });
    expect(cl.avgDelta).toBeCloseTo(0.35, 5);
    expect(body.triggers.find((t: any) => t.trigger === 'fca-floor-violation')?.count).toBe(1);
    expect(body.triggers.find((t: any) => t.trigger === 'complexity-gate')?.count).toBe(1);
    // sample size = total rows scanned (including the no-op one)
    expect(body.sample).toBe(5);
    await app.close();
  });

  it('500: Prisma rejection bubbles', async () => {
    p.modelRoutingDecision.findMany.mockRejectedValue(new Error('db'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/admin/router/escalation-triggers' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ===========================================================================
// AUTH: defence-in-depth admin guard
// ===========================================================================
describe('Defence-in-depth admin guard', () => {
  it('403 when authenticated user is not admin', async () => {
    const app = await buildApp({ isAdmin: false });
    const res = await app.inject({ method: 'GET', url: '/api/admin/storage' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

