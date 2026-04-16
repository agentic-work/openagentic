/**
 * Internal HITL Policy API
 *
 * Single source of truth for HITL approval timeout + risk-classification
 * config. Read by openagentic-proxy AgentRunner so the inline chat ReAct loop and
 * the sub-agent loop wait for the same duration on a HITL approval.
 *
 * Not exposed publicly — internal network only.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';

interface HitlPolicyRow {
  timeoutMs?: number;
  mediumRiskRequiresApproval?: boolean;
  trustThreshold?: number;
  minCallsForTrust?: number;
}

const DEFAULT_POLICY: HitlPolicyRow = {
  timeoutMs: 120_000,
  mediumRiskRequiresApproval: true,
  trustThreshold: 0.85,
  minCallsForTrust: 5,
};

export async function registerHitlPolicyRoutes(fastify: FastifyInstance) {
  // GET /api/internal/hitl/policy
  // Returns the current HITL policy from admin.system_configuration.hitl_policy.
  // Falls back to in-process defaults if the row is missing (matches the
  // ToolApprovalGate seed defaults).
  fastify.get('/api/internal/hitl/policy', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const row = await prisma.systemConfiguration.findFirst({
        where: { key: 'hitl_policy' },
      });
      if (row?.value) {
        const val = typeof row.value === 'string' ? JSON.parse(row.value) : (row.value as HitlPolicyRow);
        return reply.send({
          timeoutMs: val.timeoutMs ?? DEFAULT_POLICY.timeoutMs,
          mediumRiskRequiresApproval: val.mediumRiskRequiresApproval ?? DEFAULT_POLICY.mediumRiskRequiresApproval,
          trustThreshold: val.trustThreshold ?? DEFAULT_POLICY.trustThreshold,
          minCallsForTrust: val.minCallsForTrust ?? DEFAULT_POLICY.minCallsForTrust,
          source: 'db',
        });
      }
      return reply.send({ ...DEFAULT_POLICY, source: 'default' });
    } catch (err: any) {
      fastify.log.warn({ err: err.message }, '[hitl-policy] Failed to read DB, returning defaults');
      return reply.send({ ...DEFAULT_POLICY, source: 'fallback', error: err.message });
    }
  });
}
