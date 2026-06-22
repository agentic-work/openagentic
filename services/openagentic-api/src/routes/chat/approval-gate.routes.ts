import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getApprovalRegistry } from '../../services/approval/ApprovalRegistry.js';
import { decideAuditRow } from '../../services/approval/auditLog.js';

/**
 * Human-approval gate routes for MUTATING tool calls.
 *
 *   POST /api/approvals/:auditId/approve
 *   POST /api/approvals/:auditId/deny
 *
 * Each does a guarded single pending→decided UPDATE (loses to a concurrent
 * timeout-deny) AND resolves the in-process ApprovalRegistry Deferred so the
 * awaiting tool-call hook continues. Registered under /api with authMiddleware.
 */
export async function approvalGateRoutes(fastify: FastifyInstance) {
  for (const verb of ['approve', 'deny'] as const) {
    fastify.post<{ Params: { auditId: string } }>(
      `/approvals/:auditId/${verb}`,
      async (request: FastifyRequest<{ Params: { auditId: string } }>, reply: FastifyReply) => {
        const { auditId } = request.params;
        const approved = verb === 'approve';
        const userId = (request as any).user?.id ?? (request as any).user?.userId ?? 'unknown';

        // 1. Guarded single pending→decided UPDATE (returns true only on the
        //    winning transition — loses to a concurrent timeout-deny).
        const decided = await decideAuditRow(auditId, approved ? 'approved' : 'denied', userId);
        // 2. Resolve the in-process Deferred so the awaiting hook continues.
        const resolved = getApprovalRegistry().submit(auditId, approved);

        if (!decided && !resolved) {
          return reply.status(404).send({ error: 'Approval not found or already resolved' });
        }
        return reply.send({ ok: true, auditId, approved, decided, resolved });
      },
    );
  }
}
