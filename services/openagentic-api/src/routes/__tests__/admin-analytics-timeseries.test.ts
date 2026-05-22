/**
 * Admin Analytics Timeseries Route — TDD spec for Sev-1 #929.
 *
 * Backs the "01 — Primary Metrics" section of the admin Analytics
 * Dashboard. Three metrics, one shared endpoint:
 *
 *   GET /api/admin/analytics/system/timeseries?metric=<metric>&window=<window>&bucket=<bucket>
 *
 *   metric ∈ { tokens, ttft, tools }
 *   window ∈ { 7d, 30d, 90d }   default 30d
 *   bucket ∈ { 1h, 1d }          default 1d
 *
 * Response shape (stable across all metrics — UI charts depend on it):
 *
 *   {
 *     metric: <metric>,
 *     window: <window>,
 *     bucket: <bucket>,
 *     buckets: [{ t: <iso>, byModel: { [model]: number } }],   // tokens, ttft
 *     topTools?: [{ tool: string, count: number }]              // tools only
 *   }
 *
 * Data sources:
 *  - tokens     → LLMRequestLog.total_tokens grouped by (model, time-bucket)
 *  - ttft       → LLMRequestLog.time_to_first_token_ms p50 grouped by (model, time-bucket)
 *  - tools      → MCPUsage.tool_name count over window
 *
 * No hardcoded model literals (CLAUDE.md Rule 7). Top-5 models surfaced
 * via aggregate query, not via prefix sniffing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Logger stub
// ---------------------------------------------------------------------------
vi.mock('../../utils/logger.js', () => {
  const noop: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  };
  noop.child = () => noop;
  noop.bindings = () => ({});
  const cats = ['server','auth','chat','mcp','database','admin','routes','middleware','services','pipeline','storage','prompt'];
  const loggers: Record<string, typeof noop> = {};
  for (const c of cats) {
    const cat: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    cat.child = () => cat;
    cat.bindings = () => ({});
    loggers[c] = cat;
  }
  return { default: noop, logger: noop, loggers, logError: vi.fn(), shutdown: vi.fn() };
});

// ---------------------------------------------------------------------------
// Prisma stub — LLMRequestLog + MCPUsage
// ---------------------------------------------------------------------------
const { llmFindManyMock, mcpGroupByMock, mcpFindManyMock } = vi.hoisted(() => ({
  llmFindManyMock: vi.fn(),
  mcpGroupByMock: vi.fn(),
  mcpFindManyMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    chatMessage: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    chatSession: {
      count: vi.fn().mockResolvedValue(0),
    },
    lLMRequestLog: {
      findMany: llmFindManyMock,
    },
    mCPUsage: {
      groupBy: mcpGroupByMock,
      findMany: mcpFindManyMock,
    },
  },
}));

// ---------------------------------------------------------------------------
// Skip admin middleware in tests — focus is on data shape, not auth
// ---------------------------------------------------------------------------

import adminAnalyticsRoutes from '../admin-analytics.js';

// ---------------------------------------------------------------------------
// Sample data — recent LLM requests across 3 models
// (no hardcoded production model literals — these are test-only strings)
// ---------------------------------------------------------------------------
const NOW = new Date('2026-05-17T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const SAMPLE_LLM_REQUESTS = [
  // model-alpha — 3 days of activity
  { model: 'model-alpha', total_tokens: 1000, time_to_first_token_ms: 300, latency_ms: 1200, created_at: new Date(NOW.getTime() - 3 * DAY) },
  { model: 'model-alpha', total_tokens: 1500, time_to_first_token_ms: 280, latency_ms: 1100, created_at: new Date(NOW.getTime() - 2 * DAY) },
  { model: 'model-alpha', total_tokens: 2000, time_to_first_token_ms: 350, latency_ms: 1400, created_at: new Date(NOW.getTime() - 1 * DAY) },
  // model-beta — same window, fewer tokens, higher TTFT
  { model: 'model-beta', total_tokens: 800, time_to_first_token_ms: 500, latency_ms: 1800, created_at: new Date(NOW.getTime() - 3 * DAY) },
  { model: 'model-beta', total_tokens: 900, time_to_first_token_ms: 520, latency_ms: 1850, created_at: new Date(NOW.getTime() - 1 * DAY) },
  // model-gamma — one day only
  { model: 'model-gamma', total_tokens: 500, time_to_first_token_ms: 200, latency_ms: 900, created_at: new Date(NOW.getTime() - 1 * DAY) },
];

const SAMPLE_MCP_USAGE = [
  { tool_name: 'azure_list_subscriptions', count: 47 },
  { tool_name: 'aws_list_regions',          count: 23 },
  { tool_name: 'k8s_get_pods',              count: 14 },
  { tool_name: 'azure_get_cost_by_service', count: 9 },
  { tool_name: 'gcp_list_projects',         count: 5 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /system/timeseries — Sev-1 #929 primary-metrics-over-time', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    llmFindManyMock.mockResolvedValue(SAMPLE_LLM_REQUESTS);
    mcpGroupByMock.mockResolvedValue(
      SAMPLE_MCP_USAGE.map((t) => ({ tool_name: t.tool_name, _count: { id: t.count } })),
    );
    mcpFindManyMock.mockResolvedValue(SAMPLE_MCP_USAGE.map((t) => ({ tool_name: t.tool_name })));

    app = Fastify();
    // Inject a stub admin user so the route's preHandler passes
    app.addHook('preHandler', async (req: any) => {
      req.user = { id: 'u-test', email: 'admin@test', isAdmin: true };
    });
    await app.register(adminAnalyticsRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── metric=tokens ────────────────────────────────────────────────────────

  it('returns 200 for metric=tokens', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tokens' });
    expect(res.statusCode).toBe(200);
  });

  it('tokens: response includes metric, window, bucket, and buckets array', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tokens&window=30d' });
    const body = res.json();
    expect(body.metric).toBe('tokens');
    expect(body.window).toBe('30d');
    expect(body.bucket).toBe('1d');
    expect(Array.isArray(body.buckets)).toBe(true);
  });

  it('tokens: each bucket has iso timestamp `t` and `byModel` map', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tokens' });
    const body = res.json();
    expect(body.buckets.length).toBeGreaterThan(0);
    for (const b of body.buckets) {
      expect(typeof b.t).toBe('string');
      // Must parse as a real date
      expect(Number.isNaN(Date.parse(b.t))).toBe(false);
      expect(b.byModel).toBeTypeOf('object');
    }
  });

  it('tokens: byModel sums total_tokens across all requests for that model+bucket', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tokens' });
    const body = res.json();
    // Sum tokens across all buckets per model — must equal the sample input total
    const totals: Record<string, number> = {};
    for (const b of body.buckets) {
      for (const [m, v] of Object.entries(b.byModel)) {
        totals[m] = (totals[m] ?? 0) + (v as number);
      }
    }
    expect(totals['model-alpha']).toBe(1000 + 1500 + 2000);
    expect(totals['model-beta']).toBe(800 + 900);
    expect(totals['model-gamma']).toBe(500);
  });

  // ── metric=ttft ──────────────────────────────────────────────────────────

  it('returns 200 for metric=ttft', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=ttft' });
    expect(res.statusCode).toBe(200);
  });

  it('ttft: buckets[].byModel values are p50 TTFT in ms (not sums)', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=ttft' });
    const body = res.json();
    expect(body.metric).toBe('ttft');
    // For a single-request bucket the p50 equals that request's TTFT
    // model-gamma has only one sample (200ms) on day -1
    const gammaPoint = body.buckets.find((b: any) => 'model-gamma' in b.byModel);
    expect(gammaPoint).toBeDefined();
    expect(gammaPoint.byModel['model-gamma']).toBe(200);
  });

  // ── metric=tools ─────────────────────────────────────────────────────────

  it('returns 200 for metric=tools', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tools' });
    expect(res.statusCode).toBe(200);
  });

  it('tools: response includes topTools array, slices sorted desc by count', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tools' });
    const body = res.json();
    expect(body.metric).toBe('tools');
    expect(Array.isArray(body.topTools)).toBe(true);
    expect(body.topTools.length).toBeGreaterThan(0);
    // Sorted descending by count
    for (let i = 1; i < body.topTools.length; i++) {
      expect(body.topTools[i - 1].count).toBeGreaterThanOrEqual(body.topTools[i].count);
    }
    // Top tool must be the most-invoked one in the sample
    expect(body.topTools[0].tool).toBe('azure_list_subscriptions');
    expect(body.topTools[0].count).toBe(47);
  });

  // ── input validation ─────────────────────────────────────────────────────

  it('returns 400 for an unknown metric', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=bogus' });
    expect(res.statusCode).toBe(400);
  });

  it('defaults to window=30d, bucket=1d when omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/system/timeseries?metric=tokens' });
    const body = res.json();
    expect(body.window).toBe('30d');
    expect(body.bucket).toBe('1d');
  });
});
