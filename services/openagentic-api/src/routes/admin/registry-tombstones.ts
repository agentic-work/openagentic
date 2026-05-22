/**
 * Registry Tombstone Admin Routes — F2.6 Registry SoT v1
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.6)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * Endpoints:
 *   GET  /api/admin/registry/tombstones        — list current tombstones
 *   POST /api/admin/registry/tombstones/reset  — wipe all tombstones (destructive)
 *
 * The reset endpoint requires a confirmation string equal to
 * `RESET-TOMBSTONES-${CLUSTER_NAME}` (env) and a free-text reason ≥ 10 chars.
 * On success it emits a TOMBSTONE_RESET event to model_registry_events
 * (hash-chained to the prior event) so the destructive action is captured
 * in the FedRAMP AU-2/AU-9 audit trail.
 *
 * Auth: adminMiddleware preHandler — registered in admin.plugin.ts exactly
 * like every other /api/admin sub-route.
 */

import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(payload: string): string {
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Returns the hash of the most-recently-written audit event (for chain init). */
async function getLastEventHash(): Promise<string> {
  const row = await prisma.modelRegistryEvent.findFirst({
    orderBy: { id: 'desc' },
    select: { hash: true },
  });
  return row?.hash ?? '';
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export default async function registryTombstonesRoutes(fastify: FastifyInstance) {
  const logger = fastify.log.child({ component: 'admin-registry-tombstones' }) as any;

  // ── GET /registry/tombstones ──────────────────────────────────────────────
  fastify.get('/registry/tombstones', async (_request, reply) => {
    try {
      const rows = await prisma.modelRoleAssignmentTombstone.findMany({
        orderBy: { deleted_at: 'desc' },
      });

      return reply.send({
        count: rows.length,
        tombstones: rows.map((r: any) => ({
          provider_name: r.provider_name,
          model: r.model,
          role: r.role,
          deleted_at: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
          deleted_by: r.deleted_by ?? null,
        })),
      });
    } catch (error: any) {
      logger.error({ err: error }, '[registry-tombstones] GET failed');
      return reply.code(500).send({ error: 'Failed to list tombstones' });
    }
  });

  // ── POST /registry/tombstones/reset ──────────────────────────────────────
  fastify.post<{
    Body: { confirmation: string; reason: string };
  }>('/registry/tombstones/reset', async (request, reply) => {
    const { confirmation, reason } = request.body ?? {};
    const clusterName = process.env.CLUSTER_NAME ?? 'agentic-dev';
    const expected = `RESET-TOMBSTONES-${clusterName}`;

    // 1. Validate confirmation token
    if (!confirmation || confirmation !== expected) {
      logger.warn(
        { confirmation: confirmation ?? '(missing)' },
        '[registry-tombstones] INVALID_CONFIRMATION',
      );
      // Mask the expected value — don't echo cluster name in error body.
      return reply.code(400).send({
        error: 'INVALID_CONFIRMATION',
        expected: `RESET-TOMBSTONES-<cluster_name>`,
      });
    }

    // 2. Validate reason length
    if (!reason || reason.trim().length < 10) {
      return reply.code(400).send({ error: 'REASON_TOO_SHORT' });
    }

    const adminUserId = (request as any).user?.id ?? null;

    try {
      // 3. Single transaction: count → delete → audit
      const result = await prisma.$transaction(async (tx: any) => {
        // Count before delete (for audit record)
        const count = await tx.modelRoleAssignmentTombstone.count();

        // Wipe all tombstones
        await tx.modelRoleAssignmentTombstone.deleteMany({});

        // Build hash-chained audit event
        const prevHash = await getLastEventHash();
        const afterState = { count, reason: reason.trim(), admin_user_id: adminUserId };
        const hashPayload = `${prevHash}|TOMBSTONE_RESET|${JSON.stringify(afterState)}`;
        const newHash = sha256(hashPayload);

        const event = await tx.modelRegistryEvent.create({
          data: {
            action: 'TOMBSTONE_RESET',
            after_state: afterState,
            prev_hash: prevHash || null,
            hash: newHash,
            reason: reason.trim(),
            actor_id: adminUserId,
          },
        });

        return { count, auditEventId: String(event.id) };
      });

      logger.info(
        { deleted: result.count, adminUserId, auditEventId: result.auditEventId },
        '[registry-tombstones] TOMBSTONE_RESET complete',
      );

      return reply.send({
        deleted: result.count,
        audit_event_id: result.auditEventId,
      });
    } catch (error: any) {
      logger.error({ err: error }, '[registry-tombstones] reset transaction failed');
      return reply.code(500).send({ error: 'Failed to reset tombstones' });
    }
  });
}
