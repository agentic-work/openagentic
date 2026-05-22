/**
 * Admin KPI Routes
 *
 * Aggregates WorkflowExecution + WorkflowExecutionLog data into
 * KPI dashboards for admin visibility.
 *
 * Endpoints:
 *   GET /api/admin/flows/kpis?window=24h|7d|30d
 *     — aggregate KPIs across ALL flows
 *   GET /api/admin/flows/:id/kpis?window=...
 *     — per-flow drill-down
 *
 * Returns:
 *   total_executions, success_rate (%), failed_count
 *   latency_p50 / p95 / p99 (ms)
 *   total_cost_usd, avg_cost_per_execution_usd
 *   top_failing_nodes (top 10 by error count)
 *   top_expensive_flows (top 10 by total cost)
 *
 * All endpoints require admin auth.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes.child({ component: 'AdminKpis' });

// ---------------------------------------------------------------------------
// Window → Date cutoff
// ---------------------------------------------------------------------------

function windowToDate(window: string | undefined): Date {
  const now = new Date();
  switch (window) {
    case '7d':  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '24h':
    default:    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
}

// ---------------------------------------------------------------------------
// Percentile helper (operates on sorted numeric array)
// ---------------------------------------------------------------------------

function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

async function computeKpis(executions: any[]): Promise<Record<string, any>> {
  const total = executions.length;

  if (total === 0) {
    return {
      total_executions: 0,
      success_rate: 0,
      failed_count: 0,
      latency_p50: 0,
      latency_p95: 0,
      latency_p99: 0,
      total_cost_usd: 0,
      avg_cost_per_execution_usd: 0,
      top_failing_nodes: [],
      top_expensive_flows: [],
    };
  }

  const failedCount = executions.filter((e) => e.status === 'failed' || e.status === 'error').length;
  const successRate = ((total - failedCount) / total) * 100;

  // Latency percentiles
  const latencies = executions
    .map((e) => e.execution_time_ms ?? 0)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  // Cost
  const totalCostRaw = executions.reduce((acc, e) => {
    const cost = typeof e.cost === 'object' && e.cost !== null
      ? parseFloat(e.cost.toString())
      : (parseFloat(e.cost) || 0);
    return acc + cost;
  }, 0);

  const totalCost = parseFloat(totalCostRaw.toFixed(6));
  const avgCost   = total > 0 ? parseFloat((totalCost / total).toFixed(6)) : 0;

  // Top failing nodes (group by error_node_id)
  const nodeFailCounts: Map<string, number> = new Map();
  for (const e of executions) {
    if (e.error_node_id) {
      nodeFailCounts.set(e.error_node_id, (nodeFailCounts.get(e.error_node_id) ?? 0) + 1);
    }
  }
  const topFailingNodes = [...nodeFailCounts.entries()]
    .map(([node_id, fail_count]) => ({ node_id, fail_count }))
    .sort((a, b) => b.fail_count - a.fail_count)
    .slice(0, 10);

  // Top expensive flows (group by workflow_id)
  const flowCosts: Map<string, number> = new Map();
  for (const e of executions) {
    const wfId = e.workflow_id;
    const cost  = typeof e.cost === 'object' && e.cost !== null
      ? parseFloat(e.cost.toString())
      : (parseFloat(e.cost) || 0);
    flowCosts.set(wfId, (flowCosts.get(wfId) ?? 0) + cost);
  }
  const topExpensiveFlows = [...flowCosts.entries()]
    .map(([workflow_id, total_cost_usd]) => ({
      workflow_id,
      total_cost_usd: parseFloat(total_cost_usd.toFixed(6)),
    }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 10);

  return {
    total_executions: total,
    success_rate: parseFloat(successRate.toFixed(2)),
    failed_count: failedCount,
    latency_p50: p50,
    latency_p95: p95,
    latency_p99: p99,
    total_cost_usd: totalCost,
    avg_cost_per_execution_usd: avgCost,
    top_failing_nodes: topFailingNodes,
    top_expensive_flows: topExpensiveFlows,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const adminKpisRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /api/admin/flows/kpis ────────────────────────────────────────────

  fastify.get(
    '/api/admin/flows/kpis',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query  = request.query as Record<string, string>;
      const cutoff = windowToDate(query.window);

      try {
        const executions = await prisma.workflowExecution.findMany({
          where: {
            started_at: { gte: cutoff },
          },
          select: {
            id: true,
            workflow_id: true,
            status: true,
            execution_time_ms: true,
            cost: true,
            error_node_id: true,
            started_at: true,
          },
        });

        const kpis = await computeKpis(executions);
        reply.send(kpis);
      } catch (err: any) {
        logger.error({ err }, '[KPI] Failed to compute global KPIs');
        reply.code(500).send({ error: 'Failed to compute KPIs', message: err.message });
      }
    },
  );

  // ── GET /api/admin/flows/:id/kpis ────────────────────────────────────────

  fastify.get(
    '/api/admin/flows/:id/kpis',
    { onRequest: adminMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id }   = request.params as { id: string };
      const query    = request.query as Record<string, string>;
      const cutoff   = windowToDate(query.window);

      try {
        const executions = await prisma.workflowExecution.findMany({
          where: {
            workflow_id: id,
            started_at: { gte: cutoff },
          },
          select: {
            id: true,
            workflow_id: true,
            status: true,
            execution_time_ms: true,
            cost: true,
            error_node_id: true,
            started_at: true,
          },
        });

        const kpis = await computeKpis(executions);
        reply.send(kpis);
      } catch (err: any) {
        logger.error({ err, workflowId: id }, '[KPI] Failed to compute per-workflow KPIs');
        reply.code(500).send({ error: 'Failed to compute KPIs', message: err.message });
      }
    },
  );
};

export default adminKpisRoutes;
