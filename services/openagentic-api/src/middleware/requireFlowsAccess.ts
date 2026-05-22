/**
 * Flows access gate (OSS edition).
 *
 * In the OSS edition Flows is open to any authenticated user — no per-role
 * gating. The enterprise edition swaps this stub for an RBAC-aware guard.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireFlowsAccess(_req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // No-op gate. authMiddleware has already verified the request is authenticated.
}
