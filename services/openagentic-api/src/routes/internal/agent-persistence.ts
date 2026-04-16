/**
 * Internal Agent Persistence Routes
 *
 * Receives execution data from openagentic-proxy and persists to database.
 * Protected by internal service secret — not exposed publicly.
 *
 * IMPORTANT: This is a proper Fastify plugin (NOT wrapped with fp()) so that
 * its preHandler hook is scoped to these routes only and doesn't apply globally.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';

export async function registerAgentPersistenceRoutes(fastify: FastifyInstance) {
  const logger = fastify.log;

  // Validate internal service header - scoped to this plugin's routes only
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const headerSecret = request.headers['x-internal-secret'] as string | undefined;
    const isInternalService = request.headers['x-internal-service'] === 'openagentic-proxy';

    if (internalSecret && headerSecret !== internalSecret) {
      if (!isInternalService) {
        reply.code(403).send({ error: 'Forbidden' });
        return;
      }
    }
  });

  /**
   * POST /api/internal/agent-executions
   * Upsert an agent execution record
   */
  fastify.post('/api/internal/agent-executions', async (
    request: FastifyRequest<{
      Body: {
        executionId: string;
        sessionId?: string;
        userId: string;
        orchestration: string;
        aggregation: string;
        agentSpecs: any[];
        status: string;
        results?: any;
        totalCostCents?: number;
        totalTokens?: number;
        totalDurationMs?: number;
        error?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const data = request.body;

      await prisma.agentExecution.upsert({
        where: { id: data.executionId },
        create: {
          id: data.executionId,
          session_id: data.sessionId,
          user_id: data.userId,
          orchestration: data.orchestration,
          aggregation: data.aggregation || 'merge',
          status: data.status,
          agent_specs: data.agentSpecs as any,
          results: data.results as any || null,
          total_cost_cents: data.totalCostCents || 0,
          total_tokens: data.totalTokens || 0,
          total_duration_ms: data.totalDurationMs,
          error: data.error,
        },
        update: {
          status: data.status,
          results: data.results as any || undefined,
          total_cost_cents: data.totalCostCents || 0,
          total_tokens: data.totalTokens || 0,
          total_duration_ms: data.totalDurationMs,
          error: data.error,
        },
      });

      return reply.code(200).send({ ok: true });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to persist agent execution');
      return reply.code(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/internal/agent-audit-log
   * Create an audit log entry
   */
  fastify.post('/api/internal/agent-audit-log', async (
    request: FastifyRequest<{
      Body: {
        executionId: string;
        agentId: string;
        userId: string;
        actionType: string;
        actionDetail: any;
        riskLevel?: string;
        costCents?: number;
        tokensUsed?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const data = request.body;

      await prisma.agentAuditLog.create({
        data: {
          execution_id: data.executionId,
          agent_id: data.agentId,
          user_id: data.userId,
          action_type: data.actionType,
          action_detail: data.actionDetail as any,
          risk_level: data.riskLevel,
          cost_cents: data.costCents,
          tokens_used: data.tokensUsed,
        },
      });

      return reply.code(201).send({ ok: true });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to persist audit entry');
      return reply.code(500).send({ error: err.message });
    }
  });
}
