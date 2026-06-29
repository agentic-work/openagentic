/**
 * Admin KPI Routes — TDD spec.
 *
 * A12. GET /api/admin/flows/kpis?window=24h aggregates WorkflowExecution:
 *       total_executions, success_rate, failed_count,
 *       latency_p50/p95/p99, total_cost_usd, avg_cost_per_execution_usd,
 *       top_failing_nodes (top 10), top_expensive_flows (top 10)
 * A13. GET /api/admin/flows/:id/kpis?window=... — same shape, per-workflow.
 * A14. Returns 200 with empty/zero stats if no executions in window (not 404).
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
// Prisma stub
// ---------------------------------------------------------------------------
const { findManyMock, aggregateMock, groupByMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  aggregateMock: vi.fn(),
  groupByMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    workflowExecution: {
      findMany: findManyMock,
      aggregate: aggregateMock,
      groupBy: groupByMock,
      count: countMock,
    },
  },
}));

// ---------------------------------------------------------------------------
// Admin middleware stub
// ---------------------------------------------------------------------------
vi.mock('../../middleware/unifiedAuth.js', () => ({
  adminMiddleware: vi.fn().mockImplementation(async () => {}),
  unifiedAuthHook: vi.fn(),
}));

import adminKpisRoutes from '../admin-kpis.js';

// ---------------------------------------------------------------------------
// Sample executions
// ---------------------------------------------------------------------------
const SAMPLE_EXECUTIONS = [
  { id: 'e1', workflow_id: 'wf-1', status: 'completed', execution_time_ms: 200, cost: 0.01, error_node_id: null, started_at: new Date() },
  { id: 'e2', workflow_id: 'wf-1', status: 'completed', execution_time_ms: 400, cost: 0.02, error_node_id: null, started_at: new Date() },
  { id: 'e3', workflow_id: 'wf-2', status: 'failed',    execution_time_ms: 600, cost: 0.03, error_node_id: 'node-A', started_at: new Date() },
  { id: 'e4', workflow_id: 'wf-2', status: 'failed',    execution_time_ms: 800, cost: 0.04, error_node_id: 'node-A', started_at: new Date() },
  { id: 'e5', workflow_id: 'wf-3', status: 'completed', execution_time_ms: 100, cost: 0.05, error_node_id: null, started_at: new Date() },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Admin KPI routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue(SAMPLE_EXECUTIONS);
    countMock.mockResolvedValue(SAMPLE_EXECUTIONS.length);

    app = Fastify();
    await app.register(adminKpisRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // A12 — aggregate all flows ------------------------------------------------

  it('A12: GET /api/admin/flows/kpis returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    expect(res.statusCode).toBe(200);
  });

  it('A12: response includes total_executions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(body.total_executions).toBe(5);
  });

  it('A12: response includes success_rate and failed_count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(typeof body.success_rate).toBe('number');
    expect(body.failed_count).toBe(2); // e3 + e4
  });

  it('A12: response includes latency_p50, latency_p95, latency_p99', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(body.latency_p50).toBeGreaterThan(0);
    expect(body.latency_p95).toBeGreaterThanOrEqual(body.latency_p50);
    expect(body.latency_p99).toBeGreaterThanOrEqual(body.latency_p95);
  });

  it('A12: response includes total_cost_usd and avg_cost_per_execution_usd', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(typeof body.total_cost_usd).toBe('number');
    expect(typeof body.avg_cost_per_execution_usd).toBe('number');
    expect(body.total_cost_usd).toBeCloseTo(0.15, 5);
  });

  it('A12: response includes top_failing_nodes array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(body.top_failing_nodes).toBeInstanceOf(Array);
    // node-A appears in e3 + e4
    const nodeA = body.top_failing_nodes.find((n: any) => n.node_id === 'node-A');
    expect(nodeA).toBeDefined();
    expect(nodeA.fail_count).toBe(2);
  });

  it('A12: response includes top_expensive_flows array', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis' });
    const body = res.json();
    expect(body.top_expensive_flows).toBeInstanceOf(Array);
    // wf-2 is most expensive: 0.03 + 0.04 = 0.07
    const wf2 = body.top_expensive_flows.find((f: any) => f.workflow_id === 'wf-2');
    expect(wf2).toBeDefined();
    expect(wf2.total_cost_usd).toBeGreaterThan(0);
  });

  it('A12: window=7d parameter is accepted without error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis?window=7d' });
    expect(res.statusCode).toBe(200);
    // Verify the query scoped to 7 days of data
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where.started_at.gte).toBeDefined();
  });

  it('A12: window=30d parameter is accepted without error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis?window=30d' });
    expect(res.statusCode).toBe(200);
  });

  // A13 — per-workflow -------------------------------------------------------

  it('A13: GET /api/admin/flows/:id/kpis returns 200 scoped to one workflow', async () => {
    findManyMock.mockResolvedValue(SAMPLE_EXECUTIONS.filter((e) => e.workflow_id === 'wf-1'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/wf-1/kpis' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_executions).toBe(2);
  });

  it('A13: per-workflow query includes workflow_id filter in prisma call', async () => {
    findManyMock.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/wf-99/kpis' });
    expect(res.statusCode).toBe(200);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where.workflow_id).toBe('wf-99');
  });

  it('A13: per-workflow response has same shape as aggregate response', async () => {
    findManyMock.mockResolvedValue(SAMPLE_EXECUTIONS.filter((e) => e.workflow_id === 'wf-2'));
    const [aggRes, perRes] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/admin/flows/kpis' }),
      app.inject({ method: 'GET', url: '/api/admin/flows/wf-2/kpis' }),
    ]);
    const aggKeys = Object.keys(aggRes.json()).sort();
    const perKeys = Object.keys(perRes.json()).sort();
    expect(perKeys).toEqual(aggKeys);
  });

  // A14 — empty window -------------------------------------------------------

  it('A14: returns 200 with zero stats when no executions in window', async () => {
    findManyMock.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/kpis?window=24h' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_executions).toBe(0);
    expect(body.success_rate).toBe(0);
    expect(body.failed_count).toBe(0);
    expect(body.latency_p50).toBe(0);
    expect(body.total_cost_usd).toBe(0);
    expect(body.top_failing_nodes).toEqual([]);
    expect(body.top_expensive_flows).toEqual([]);
  });

  it('A14: per-workflow with no executions returns 200 not 404', async () => {
    findManyMock.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/api/admin/flows/nonexistent/kpis' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_executions).toBe(0);
  });
});
