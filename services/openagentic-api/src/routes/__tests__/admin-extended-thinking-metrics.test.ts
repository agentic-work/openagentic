/**
 * RED → GREEN spec for Task B.3: admin extended thinking analytics route.
 *
 * GET /api/admin/analytics/extended-thinking?window=7d&groupBy=model|user|day
 *
 * Response shape:
 *   {
 *     windowStart: ISO,
 *     windowEnd: ISO,
 *     totals: {
 *       requested: N, delivered: N, requestedNotDelivered: N,
 *       avgThinkingTokens: N, avgThinkingDurationMs: N
 *     },
 *     byModel: [{ model, requested, delivered, avgTokens }],
 *     byDay:   [{ date: 'YYYY-MM-DD', requested, delivered }]
 *   }
 *
 * RED: route doesn't exist yet → 404.
 * GREEN: route exists, prisma mock drives the response shape.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// ─── logger stub ─────────────────────────────────────────────────────────────
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

// ─── Prisma mock: extendedThinkingMetric.findMany ────────────────────────────
const { etFindManyMock } = vi.hoisted(() => ({
  etFindManyMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    chatMessage: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    user: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    chatSession: { count: vi.fn().mockResolvedValue(0) },
    lLMRequestLog: { findMany: vi.fn().mockResolvedValue([]) },
    mCPUsage: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    extendedThinkingMetric: {
      findMany: etFindManyMock,
    },
  },
}));

import adminAnalyticsRoutes from '../admin-analytics.js';

// ─── Sample metric rows ───────────────────────────────────────────────────────
const NOW = new Date('2026-05-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const sampleRows = [
  {
    id: 'c1',
    created_at: new Date(NOW.getTime() - 2 * DAY),
    user_id: 'u1',
    model: 'model-alpha',
    requested: true,
    delivered: true,
    thinking_tokens: 400,
    thinking_duration_ms: 1200,
    total_turn_ms: 3000,
  },
  {
    id: 'c2',
    created_at: new Date(NOW.getTime() - 2 * DAY + 60_000),
    user_id: 'u1',
    model: 'model-alpha',
    requested: true,
    delivered: false,  // C2 case: requested but not delivered
    thinking_tokens: null,
    thinking_duration_ms: null,
    total_turn_ms: 2500,
  },
  {
    id: 'c3',
    created_at: new Date(NOW.getTime() - 1 * DAY),
    user_id: 'u2',
    model: 'model-beta',
    requested: true,
    delivered: true,
    thinking_tokens: 800,
    thinking_duration_ms: 2400,
    total_turn_ms: 5000,
  },
  {
    id: 'c4',
    created_at: NOW,
    user_id: 'u2',
    model: 'model-beta',
    requested: false,
    delivered: false,
    thinking_tokens: null,
    thinking_duration_ms: null,
    total_turn_ms: 1000,
  },
];

// ─── Fastify instance ─────────────────────────────────────────────────────────
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  // Skip admin middleware in tests
  app.addHook('preHandler', async (req: any) => { req.user = { isAdmin: true }; });
  await app.register(adminAnalyticsRoutes);
  await app.ready();
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('GET /extended-thinking — admin analytics route (B.3)', () => {
  it('returns 200 with correct totals shape', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('windowStart');
    expect(body).toHaveProperty('windowEnd');
    expect(body).toHaveProperty('totals');
    expect(body).toHaveProperty('byModel');
    expect(body).toHaveProperty('byDay');
  });

  it('computes totals.requested correctly (only rows with requested=true)', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const { totals } = res.json();

    // sampleRows: c1=requested, c2=requested, c3=requested, c4=NOT requested
    expect(totals.requested).toBe(3);
  });

  it('computes totals.delivered correctly (only rows with delivered=true)', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const { totals } = res.json();

    // c1=delivered, c3=delivered → 2
    expect(totals.delivered).toBe(2);
  });

  it('computes requestedNotDelivered (C2 case count)', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const { totals } = res.json();

    // requested=true AND delivered=false: c2 only → 1
    expect(totals.requestedNotDelivered).toBe(1);
  });

  it('computes byModel grouping with requested and delivered counts', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const { byModel } = res.json();

    expect(Array.isArray(byModel)).toBe(true);
    const alpha = byModel.find((r: any) => r.model === 'model-alpha');
    expect(alpha).toBeDefined();
    expect(alpha.requested).toBe(2); // c1 + c2
    expect(alpha.delivered).toBe(1); // c1 only

    const beta = byModel.find((r: any) => r.model === 'model-beta');
    expect(beta).toBeDefined();
    expect(beta.requested).toBe(1); // c3 only
    expect(beta.delivered).toBe(1); // c3 only
  });

  it('computes byDay grouping with YYYY-MM-DD date keys', async () => {
    etFindManyMock.mockResolvedValue(sampleRows);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const { byDay } = res.json();

    expect(Array.isArray(byDay)).toBe(true);
    const entry = byDay.find((d: any) => typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date));
    expect(entry).toBeDefined();
    expect(typeof entry.requested).toBe('number');
    expect(typeof entry.delivered).toBe('number');
  });

  it('returns empty byModel and byDay on empty dataset', async () => {
    etFindManyMock.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    const body = res.json();

    expect(body.totals.requested).toBe(0);
    expect(body.totals.delivered).toBe(0);
    expect(body.byModel).toHaveLength(0);
    expect(body.byDay).toHaveLength(0);
  });

  it('respects the window query parameter', async () => {
    etFindManyMock.mockResolvedValue([]);

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=30d' });
    expect(res.statusCode).toBe(200);
    // Verify prisma was called with a `since` date ~30 days ago
    const call = etFindManyMock.mock.calls[0][0];
    const since = call?.where?.created_at?.gte;
    expect(since).toBeDefined();
    const daysAgo = (Date.now() - new Date(since).getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeCloseTo(30, 0); // within 1 day
  });

  it('returns 500 when prisma throws', async () => {
    etFindManyMock.mockRejectedValue(new Error('DB error'));

    const res = await app.inject({ method: 'GET', url: '/extended-thinking?window=7d' });
    expect(res.statusCode).toBe(500);
  });
});
