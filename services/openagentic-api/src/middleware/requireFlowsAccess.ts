/**
 * Flows access gate.
 *
 * Flows is open to any authenticated user — no per-role gating. This is a
 * seam where deployments can drop in an RBAC-aware guard if they need one.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireFlowsAccess(_req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // No-op gate. authMiddleware has already verified the request is authenticated.
}
