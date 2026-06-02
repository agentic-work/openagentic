/**
 * Admin KPI Routes — Flows KPI dashboard
 *
 * Aggregates WorkflowExecution rows (public.workflow_executions) into the
 * FlowsKpiData shape the admin Flows dashboard consumes.
 *
 * Endpoints (self-prefixed; register with prefix `/api/admin`):
 *   GET /flows/kpis?window=1h|6h|24h|7d|30d|90d
 *     — aggregate KPIs across ALL flows
 *   GET /flows/:id/kpis?window=...
 *     — per-flow drill-down (filters where workflow_id = :id)
 *
 * Returns FlowsKpiData (matches services/openagentic-ui flowsAdminApi.ts):
 *   window, total_executions, success_rate (0-100),
 *   latency_p50_ms / p95_ms / p99_ms,
 *   total_cost_usd, avg_cost_per_execution_usd,
 *   top_failing_nodes  [{ nodeId, nodeType, failureCount }]   (top 10)
 *   top_expensive_flows[{ flowId, flowName, totalCostUsd }]   (top 10)
 *   executions_over_time[], cost_over_time[], time_labels[]   (time-bucketed series)
 *   delta { total_executions, success_rate, avg_cost_per_execution_usd, latency_p95_ms }
 *
 * Backing source: Prisma WorkflowExecution (public.workflow_executions) joined
 * to Workflow (public.workflows) for flow names + node types resolved from the
 * workflow ReactFlow `definition`. Admin-guarded.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminKpis' });

// ---------------------------------------------------------------------------
// Window handling — supports 1h | 6h | 24h | 7d | 30d | 90d
// ---------------------------------------------------------------------------

type WindowKey = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

const WINDOW_MS: Record<WindowKey, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

// Number of time buckets to slice the window into for the *_over_time[] series.
const SERIES_BUCKETS = 24;

function normalizeWindow(raw: string | undefined): WindowKey {
  if (raw && raw in WINDOW_MS) return raw as WindowKey;
  return '24h';
}

function windowMs(window: WindowKey): number {
  return WINDOW_MS[window];
}

// ---------------------------------------------------------------------------
// Percentile helper (operates on sorted ascending numeric array)
// ---------------------------------------------------------------------------

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.max(0, Math.min(idx, sortedAsc.length - 1))];
}

// ---------------------------------------------------------------------------
// Cost coercion — Prisma Decimal → number
// ---------------------------------------------------------------------------

function toCost(cost: unknown): number {
  if (cost == null) return 0;
  if (typeof cost === 'number') return cost;
  // Prisma.Decimal stringifies cleanly; also handles plain string costs.
  const n = parseFloat(String(cost));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Time-series bucketing
// ---------------------------------------------------------------------------

interface SeriesResult {
  executions_over_time: number[];
  cost_over_time: number[];
  time_labels: string[];
}

function buildSeries(
  executions: ExecRow[],
  windowStart: Date,
  windowEnd: Date,
): SeriesResult {
  const spanMs = Math.max(windowEnd.getTime() - windowStart.getTime(), 1);
  const bucketMs = spanMs / SERIES_BUCKETS;

  const execBuckets = new Array<number>(SERIES_BUCKETS).fill(0);
  const costBuckets = new Array<number>(SERIES_BUCKETS).fill(0);

  for (const e of executions) {
    const t = e.started_at.getTime() - windowStart.getTime();
    let idx = Math.floor(t / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= SERIES_BUCKETS) idx = SERIES_BUCKETS - 1;
    execBuckets[idx] += 1;
    costBuckets[idx] += toCost(e.cost);
  }

  // Sub-day windows label by time-of-day; multi-day windows label by date.
  const subDay = spanMs <= 24 * 60 * 60 * 1000;
  const time_labels = new Array<string>(SERIES_BUCKETS);
  for (let i = 0; i < SERIES_BUCKETS; i++) {
    const bucketStart = new Date(windowStart.getTime() + i * bucketMs);
    time_labels[i] = subDay
      ? bucketStart.toISOString().slice(11, 16) // HH:MM
      : bucketStart.toISOString().slice(5, 10);  // MM-DD
  }

  return {
    executions_over_time: execBuckets,
    cost_over_time: costBuckets.map((c) => parseFloat(c.toFixed(6))),
    time_labels,
  };
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

interface ExecRow {
  workflow_id: string;
  status: string;
  execution_time_ms: number | null;
  cost: unknown;
  error_node_id: string | null;
  started_at: Date;
}

interface CoreKpis {
  total_executions: number;
  success_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  total_cost_usd: number;
  avg_cost_per_execution_usd: number;
}

const FAILED_STATUSES = new Set(['failed', 'error', 'cancelled', 'timeout']);

function computeCore(executions: ExecRow[]): CoreKpis {
  const total = executions.length;
  if (total === 0) {
    return {
      total_executions: 0,
      success_rate: 0,
      latency_p50_ms: 0,
      latency_p95_ms: 0,
      latency_p99_ms: 0,
      total_cost_usd: 0,
      avg_cost_per_execution_usd: 0,
    };
  }

  const failedCount = executions.filter((e) => FAILED_STATUSES.has(e.status)).length;
  const successRate = ((total - failedCount) / total) * 100;

  const latencies = executions
    .map((e) => e.execution_time_ms ?? 0)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);

  const totalCost = executions.reduce((acc, e) => acc + toCost(e.cost), 0);
  const totalCostRounded = parseFloat(totalCost.toFixed(6));
  const avgCost = parseFloat((totalCost / total).toFixed(6));

  return {
    total_executions: total,
    success_rate: parseFloat(successRate.toFixed(2)),
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
    latency_p99_ms: percentile(latencies, 99),
    total_cost_usd: totalCostRounded,
    avg_cost_per_execution_usd: avgCost,
  };
}

/**
 * Resolve node id -> node type from a workflow ReactFlow `definition`.
 * definition shape: { nodes: [{ id, type, data }], edges: [...] }
 */
function nodeTypeFromDefinition(definition: unknown, nodeId: string): string {
  if (!definition || typeof definition !== 'object') return 'unknown';
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return 'unknown';
  for (const n of nodes) {
    if (n && typeof n === 'object' && (n as { id?: unknown }).id === nodeId) {
      const t = (n as { type?: unknown }).type;
      return typeof t === 'string' && t ? t : 'unknown';
    }
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Percentage delta vs prior window (null-safe)
// ---------------------------------------------------------------------------

function pctDelta(current: number, prior: number): number | undefined {
  if (prior === 0) {
    if (current === 0) return 0;
    return undefined; // no meaningful baseline
  }
  return parseFloat((((current - prior) / prior) * 100).toFixed(2));
}

// ---------------------------------------------------------------------------
// Full KPI build (current window + prior window for delta)
// ---------------------------------------------------------------------------

interface BuildArgs {
  window: WindowKey;
  workflowId?: string;
}

async function buildKpis({ window, workflowId }: BuildArgs): Promise<Record<string, unknown>> {
  const now = new Date();
  const span = windowMs(window);
  const windowStart = new Date(now.getTime() - span);
  const priorStart = new Date(now.getTime() - 2 * span);

  const baseWhere: Record<string, unknown> = {};
  if (workflowId) baseWhere.workflow_id = workflowId;

  const select = {
    workflow_id: true,
    status: true,
    execution_time_ms: true,
    cost: true,
    error_node_id: true,
    started_at: true,
  } as const;

  // Current-window + prior-window executions (prior used only for delta).
  const [executions, priorExecutions] = await Promise.all([
    prisma.workflowExecution.findMany({
      where: { ...baseWhere, started_at: { gte: windowStart } },
      select,
    }) as Promise<ExecRow[]>,
    prisma.workflowExecution.findMany({
      where: { ...baseWhere, started_at: { gte: priorStart, lt: windowStart } },
      select,
    }) as Promise<ExecRow[]>,
  ]);

  const core = computeCore(executions);
  const priorCore = computeCore(priorExecutions);
  const series = buildSeries(executions, windowStart, now);

  // ── Top failing nodes (group by error_node_id, resolve nodeType) ──────────
  const nodeFailCounts = new Map<string, { count: number; workflowId: string }>();
  for (const e of executions) {
    if (e.error_node_id) {
      const existing = nodeFailCounts.get(e.error_node_id);
      if (existing) existing.count += 1;
      else nodeFailCounts.set(e.error_node_id, { count: 1, workflowId: e.workflow_id });
    }
  }

  // ── Top expensive flows (group by workflow_id) ────────────────────────────
  const flowCosts = new Map<string, number>();
  for (const e of executions) {
    flowCosts.set(e.workflow_id, (flowCosts.get(e.workflow_id) ?? 0) + toCost(e.cost));
  }

  // Resolve workflow names + definitions for the flows/nodes we are about to
  // surface (only the ones we need, not the whole table).
  const workflowIdsNeeded = new Set<string>([
    ...[...nodeFailCounts.values()].map((v) => v.workflowId),
    ...flowCosts.keys(),
  ]);

  const workflowRows = workflowIdsNeeded.size
    ? await prisma.workflow.findMany({
        where: { id: { in: [...workflowIdsNeeded] } },
        select: { id: true, name: true, definition: true },
      })
    : [];

  const wfById = new Map(workflowRows.map((w) => [w.id, w]));

  const top_failing_nodes = [...nodeFailCounts.entries()]
    .map(([nodeId, { count, workflowId: wfId }]) => {
      const wf = wfById.get(wfId);
      return {
        nodeId,
        nodeType: wf ? nodeTypeFromDefinition(wf.definition, nodeId) : 'unknown',
        failureCount: count,
      };
    })
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 10);

  const top_expensive_flows = [...flowCosts.entries()]
    .map(([flowId, total]) => ({
      flowId,
      flowName: wfById.get(flowId)?.name ?? flowId,
      totalCostUsd: parseFloat(total.toFixed(6)),
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, 10);

  // ── Delta vs prior window (percentage change; absent when no baseline) ────
  const delta: Record<string, number> = {};
  const dExec = pctDelta(core.total_executions, priorCore.total_executions);
  const dSucc = pctDelta(core.success_rate, priorCore.success_rate);
  const dCost = pctDelta(core.avg_cost_per_execution_usd, priorCore.avg_cost_per_execution_usd);
  const dLat = pctDelta(core.latency_p95_ms, priorCore.latency_p95_ms);
  if (dExec !== undefined) delta.total_executions = dExec;
  if (dSucc !== undefined) delta.success_rate = dSucc;
  if (dCost !== undefined) delta.avg_cost_per_execution_usd = dCost;
  if (dLat !== undefined) delta.latency_p95_ms = dLat;

  return {
    window,
    ...core,
    top_failing_nodes,
    top_expensive_flows,
    executions_over_time: series.executions_over_time,
    cost_over_time: series.cost_over_time,
    time_labels: series.time_labels,
    delta,
  };
}

// ---------------------------------------------------------------------------
// Routes (self-prefixed; register with prefix `/api/admin`)
// ---------------------------------------------------------------------------

export default async function adminKpisRoutes(fastify: FastifyInstance) {
  // ── GET /api/admin/flows/kpis ─────────────────────────────────────────────
  fastify.get(
    '/flows/kpis',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string>;
      const window = normalizeWindow(query.window);
      try {
        const kpis = await buildKpis({ window });
        return reply.send(kpis);
      } catch (err) {
        logger.error({ err }, '[KPI] Failed to compute global KPIs');
        return reply.code(500).send({
          error: 'Failed to compute KPIs',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // ── GET /api/admin/flows/:id/kpis ─────────────────────────────────────────
  fastify.get(
    '/flows/:id/kpis',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const query = request.query as Record<string, string>;
      const window = normalizeWindow(query.window);
      try {
        const kpis = await buildKpis({ window, workflowId: id });
        return reply.send(kpis);
      } catch (err) {
        logger.error({ err, workflowId: id }, '[KPI] Failed to compute per-workflow KPIs');
        return reply.code(500).send({
          error: 'Failed to compute KPIs',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
