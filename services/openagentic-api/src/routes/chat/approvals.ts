import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPendingApprovalStore } from '../../services/PendingApprovalStore.js';
import { getPermissionService } from '../../services/PermissionService.js';
import { getRedisClient } from '../../utils/redis-client.js';

/**
 * Resolve an approval against EVERY in-process store + Redis listeners.
 * Three back-ends share the requestId space:
 *
 *   1. `PendingApprovalStore` — inline chat ReAct loop approvals.
 *   2. `PermissionService.submitApproval` — MCP tool-call approvals via
 *      hitl_approval frame (Audit §10 step 15/16; rollout 2026-05-12).
 *   3. Redis `hitl:result:{id}` channel — sub-agent HITL via openagentic-proxy.
 *
 * Run all three unconditionally — they no-op on misses. The UI POSTs ONE
 * decision; ONE of the three picks it up. Without this fan-out the UI's
 * Approve/Deny buttons orphaned on the PermissionService path (audit Sev-0
 * 2026-05-12 #85).
 */
async function resolveApprovalEverywhere(
  requestLog: FastifyRequest['log'],
  id: string,
  approved: boolean,
  userId: string,
): Promise<{ inProcess: boolean; permission: boolean; redis: boolean }> {
  const store = getPendingApprovalStore();
  const inProcess = store.resolve(id, approved);

  let permission = false;
  try {
    permission = getPermissionService(requestLog as any).submitApproval(id, approved, userId);
  } catch (err) {
    requestLog.debug({ err, id }, '[approvals] PermissionService.submitApproval threw');
  }

  let redis = false;
  try {
    const redisClient = getRedisClient();
    const channel = `hitl:result:${id}`;
    const payload = JSON.stringify({
      decision: approved ? 'approved' : 'denied',
      approvedBy: 'user',
      requestId: id,
      timestamp: Date.now(),
    });
    await redisClient.publish(channel, payload);
    redis = true;
  } catch (err) {
    requestLog.debug({ err, id }, '[approvals] Redis publish failed (sub-agent listeners may miss event)');
  }

  return { inProcess, permission, redis };
}

export async function approvalsRoutes(fastify: FastifyInstance) {
  // POST /api/chat/approvals/:id  body: { approved: boolean }
  // Legacy chat-pipeline endpoint. Resolves against all 3 stores so a
  // single UI POST works regardless of which back-end issued the
  // approval ask.
  fastify.post<{ Params: { id: string }; Body: { approved: boolean } }>(
    '/approvals/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { approved: boolean } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { approved } = request.body;
      const userId = (request as any).user?.id ?? 'unknown';
      const result = await resolveApprovalEverywhere(request.log, id, approved, userId);
      if (!result.inProcess && !result.permission && !result.redis) {
        return reply.status(404).send({ error: 'Approval not found or already resolved' });
      }
      return reply.send({ ok: true, id, approved, ...result });
    },
  );
}

/**
 * Top-level permissions-approvals routes — registered separately at the
 * `/api` prefix in chat.plugin.ts so the URLs match what the v3 UI emits
 * (`POST /api/permissions/approvals/:id/(approve|deny)` from
 * ChatContainer ca76ab76).
 */
export async function permissionsApprovalsRoutes(fastify: FastifyInstance) {
  for (const verb of ['approve', 'deny'] as const) {
    fastify.post<{ Params: { id: string } }>(
      `/permissions/approvals/:id/${verb}`,
      async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
        const { id } = request.params;
        const approved = verb === 'approve';
        const userId = (request as any).user?.id ?? 'unknown';
        const result = await resolveApprovalEverywhere(request.log, id, approved, userId);
        if (!result.inProcess && !result.permission && !result.redis) {
          return reply.status(404).send({ error: 'Approval not found or already resolved' });
        }
        return reply.send({ ok: true, id, approved, ...result });
      },
    );
  }
}
