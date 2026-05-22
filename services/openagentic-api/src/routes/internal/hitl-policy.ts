/**
 * Internal HITL Policy API
 *
 * Single source of truth for the approval timeout consumed by openagentic-proxy
 * AgentRunner so the inline chat ReAct loop and the sub-agent loop wait
 * for the same duration on a pending approval.
 *
 * Not exposed publicly — internal network only.
 *
 * The legacy regex-tier policy fields were ripped 2026-05-11 along with
 * the old gate; agents only need the timeout. The endpoint returns a `mode`
 * hint (`default`) for forward-compat with the PermissionService 5-mode shape.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../utils/prisma.js';

interface HitlPolicyRow {
  timeoutMs?: number;
  mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan';
}

const DEFAULT_POLICY: HitlPolicyRow = {
  timeoutMs: 120_000,
  mode: 'default',
};

export async function registerHitlPolicyRoutes(fastify: FastifyInstance) {
  // GET /api/internal/hitl/policy
  // Returns the current approval policy from admin.system_configuration.hitl_policy.
  // Falls back to in-process defaults if the row is missing (matches the
  // PermissionService seed defaults).
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
          mode: val.mode ?? DEFAULT_POLICY.mode,
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
