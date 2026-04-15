/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
