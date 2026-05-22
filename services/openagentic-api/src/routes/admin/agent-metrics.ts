/**
 * Agent Metrics Routes — Real time-series data for AgentExecutionDashboard
 *
 * Queries admin.agent_executions directly via raw SQL for aggregated
 * time-series and per-agent-type breakdowns.
 */
import { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';

export default async function agentMetricsRoutes(fastify: FastifyInstance) {

  // GET /admin/agents/metrics/timeseries
  fastify.get<{ Querystring: { days?: string; agentId?: string } }>(
    '/agents/metrics/timeseries',
    async (request, reply) => {
      const days = parseInt(request.query.days || '7');
      const since = new Date(Date.now() - days * 86400000);
      const interval = days <= 1 ? 'hour' : 'day';

      try {
        // Query agentic_loop_executions — this is where AgentRegistry records real agent runs
        const executions = await prisma.$queryRawUnsafe<Array<any>>(`
          SELECT
            date_trunc('${interval}', started_at) as bucket,
            COUNT(*) FILTER (WHERE status = 'completed') as success,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            AVG(duration_ms)
              FILTER (WHERE duration_ms IS NOT NULL) as avg_latency,
            COALESCE(SUM(total_tokens), 0) as total_tokens
          FROM admin.agentic_loop_executions
          WHERE started_at >= $1
          GROUP BY bucket
          ORDER BY bucket
        `, since);

        return reply.send({
          timeSeries: executions.map((e: any) => ({
            time: e.bucket,
            success: Number(e.success || 0),
            failed: Number(e.failed || 0),
            avgLatencyMs: Math.round(Number(e.avg_latency) || 0),
            totalTokens: Number(e.total_tokens || 0),
            // No prompt/completion token split in schema — derive approximate split
            promptTokens: Math.round(Number(e.total_tokens || 0) * 0.6),
            completionTokens: Math.round(Number(e.total_tokens || 0) * 0.4),
            cost: 0,
          })),
          interval,
          days,
        });
      } catch (error: any) {
        // Table may not exist yet or schema not migrated
        fastify.log.warn({ err: error }, 'agent-metrics timeseries query failed');
        return reply.send({ timeSeries: [], interval, days });
      }
    }
  );

  // GET /admin/agents/metrics/fleet — backs the AgentOpsView (#54).
  // Returns the exact { agents, runs } shape AgentOpsView consumes,
  // rolled up from admin.agentic_loops (the agent SOT for runtime
  // executions) joined to admin.agentic_loop_executions over a 24h
  // window. Falls back to empty arrays when the schema isn't migrated
  // (matches the by-agent endpoint's defensive pattern).
  fastify.get('/agents/metrics/fleet', async (_request, reply) => {
    try {
      // Per-agent 24h roll-up
      const agents = await prisma.$queryRawUnsafe<Array<any>>(`
        SELECT
          a.id            AS "agentId",
          a.display_name  AS "displayName",
          a.name          AS "name",
          a.agent_type    AS "agentType",
          COUNT(e.id)::int AS "runCount24h",
          ROUND(
            COUNT(*) FILTER (WHERE e.status = 'completed')::numeric /
              NULLIF(COUNT(e.id), 0),
            4
          )::float8 AS "successRate",
          COALESCE(
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY e.duration_ms
            ) FILTER (WHERE e.duration_ms IS NOT NULL),
            0
          )::int AS "p50DurationMs",
          COALESCE(SUM(e.estimated_cost), 0)::float8 AS "totalCostDollars"
        FROM admin.agentic_loops a
        LEFT JOIN admin.agentic_loop_executions e
          ON e.loop_id = a.id
         AND e.started_at >= NOW() - INTERVAL '24 hours'
        GROUP BY a.id, a.display_name, a.name, a.agent_type
        ORDER BY "runCount24h" DESC, a.display_name
      `);

      // Latest 50 runs across the fleet
      const runs = await prisma.$queryRawUnsafe<Array<any>>(`
        SELECT
          e.id,
          e.loop_id        AS "agentId",
          COALESCE(a.display_name, a.name, 'unknown') AS "agentName",
          e.status,
          COALESCE(e.duration_ms, 0)::int AS "durationMs",
          COALESCE(e.estimated_cost * 100, 0)::float8 AS "costCents",
          e.started_at     AS "startedAt",
          e.error
        FROM admin.agentic_loop_executions e
        LEFT JOIN admin.agentic_loops a ON a.id = e.loop_id
        ORDER BY e.started_at DESC NULLS LAST
        LIMIT 50
      `);

      return reply.send({
        agents: agents.map((a: any) => ({
          agentId: a.agentId,
          agentName: a.displayName || a.name,
          agentType: a.agentType || 'agent',
          runCount24h: Number(a.runCount24h ?? 0),
          successRate: Number(a.successRate ?? 0),
          p50DurationMs: Number(a.p50DurationMs ?? 0),
          // The view consumes cents — convert dollars → cents.
          totalCostCents: Math.round(Number(a.totalCostDollars ?? 0) * 100),
        })),
        runs: runs.map((r: any) => ({
          id: r.id,
          agentId: r.agentId,
          agentName: r.agentName,
          status:
            r.error
              ? 'error'
              : r.status === 'completed' || r.status === 'success'
                ? 'success'
                : r.status === 'running'
                  ? 'running'
                  : 'queued',
          durationMs: Number(r.durationMs ?? 0),
          costCents: Number(r.costCents ?? 0),
          startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : '',
          error: r.error || undefined,
        })),
      });
    } catch (error: any) {
      fastify.log.warn({ err: error }, 'agent-metrics fleet query failed');
      return reply.send({ agents: [], runs: [] });
    }
  });

  // GET /admin/agents/metrics/by-agent
  fastify.get('/agents/metrics/by-agent', async (request, reply) => {
    try {
      // Query agentic_loop_executions joined with agents to get agent type
      const breakdown = await prisma.$queryRawUnsafe<Array<any>>(`
        SELECT
          COALESCE(a.type, 'unknown') as agent_type,
          COUNT(*)::int as executions,
          AVG(e.duration_ms) as avg_latency,
          COALESCE(SUM(e.total_tokens), 0)::int as total_tokens,
          COALESCE(SUM(e.estimated_cost), 0)::numeric as total_cost,
          ROUND(
            COUNT(*) FILTER (WHERE e.status = 'completed')::numeric /
            NULLIF(COUNT(*), 0) * 100,
            1
          ) as success_rate
        FROM admin.agentic_loop_executions e
        LEFT JOIN admin.agents a ON a.id = e.loop_id
        WHERE e.started_at >= NOW() - INTERVAL '30 days'
        GROUP BY a.type
        ORDER BY executions DESC
      `);

      return reply.send({
        agents: breakdown.map((b: any) => ({
          type: b.agent_type,
          executions: Number(b.executions || 0),
          avgLatencyMs: Math.round(Number(b.avg_latency) || 0),
          totalTokens: Number(b.total_tokens || 0),
          // Convert cents to dollars
          cost: Math.round(Number(b.total_cost || 0)) / 100,
          successRate: Number(b.success_rate || 0),
        })),
      });
    } catch (error: any) {
      fastify.log.warn({ err: error }, 'agent-metrics by-agent query failed');
      return reply.send({ agents: [] });
    }
  });
}
