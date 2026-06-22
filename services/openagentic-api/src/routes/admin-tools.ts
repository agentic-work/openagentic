/**
 * Admin Tools Routes — global tool execution mode (read-only kill switch)
 *
 *   GET  /api/admin/tools/readonly  — current state + version + audit fields
 *   POST /api/admin/tools/readonly  — flip the switch with optimistic concurrency
 *
 * Phase 1 admin overhaul §11.5: every admin write goes through optimistic
 * concurrency. Body MUST include the `version` the client read; the UPDATE
 * is gated on `WHERE key = $key AND version = $clientVersion`. If the row
 * has moved on, we return 409 with the current row + per-field diff so the
 * UI can render a re-apply / take-theirs / merge dialog.
 *
 * `version=0` is the seeding sentinel — first write when no row exists.
 *
 * DB is SOT. No process.env.MCP_TOOLS_READONLY read at runtime; the env var
 * only seeds the GET fallback when the DB row is absent. Once the row exists
 * the env is ignored entirely (verified by the Phase-0 §6 audit).
 */

import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes || loggers;

const SETTING_KEY = 'mcp_tools_readonly';

interface ReadonlyState {
  enabled: boolean;
  source: 'database' | 'env' | 'default';
  version: number;
  updated_at?: string;
  updated_by?: string | null;
  lastChanged?: string;
}

async function readState(): Promise<ReadonlyState> {
  try {
    const row = await prisma.systemConfiguration.findUnique({
      where: { key: SETTING_KEY },
    });
    if (row?.value) {
      const val = row.value as any;
      return {
        enabled: val.enabled === true,
        source: 'database',
        version: typeof row.version === 'bigint' ? Number(row.version) : Number(row.version ?? 1),
        updated_at: row.updated_at?.toISOString(),
        updated_by: row.updated_by ?? null,
        lastChanged: row.updated_at?.toISOString(),
      };
    }
  } catch (e: any) {
    // Schema may not yet have version column on first deploy. Fall through
    // to env / default. The migration will land it.
    logger.warn?.({ err: e?.message }, '[AdminTools] systemConfiguration read fell through');
  }

  const envVal = process.env.MCP_TOOLS_READONLY_DEFAULT;
  if (envVal !== undefined) {
    return { enabled: envVal === 'true', source: 'env', version: 0 };
  }
  return { enabled: false, source: 'default', version: 0 };
}

const adminToolsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/tools/readonly', async (_request, reply) => {
    try {
      const state = await readState();
      return reply.send(state);
    } catch (error: any) {
      logger.error({ error }, '[AdminTools] Failed to get readonly status');
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post('/tools/readonly', async (request, reply) => {
    try {
      const body = request.body as { enabled?: boolean; version?: number };
      const user = (request as any).user;
      const userId = user?.userId || user?.id || null;

      if (typeof body.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled must be a boolean' });
      }
      if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) {
        return reply.code(400).send({
          error: 'version must be a non-negative integer (use 0 to seed when no row exists)',
        });
      }

      const desired = body.enabled;
      const clientVersion = body.version;

      // Read current state to know whether to INSERT (version=0) or UPDATE.
      const before = await readState();

      if (clientVersion === 0 && before.source !== 'database') {
        // Seeding case: no DB row yet. INSERT.
        const valueJson = JSON.stringify({ enabled: desired, changedBy: userId });
        await prisma.$executeRaw`
          INSERT INTO admin.system_configuration (key, value, description, is_active, created_at, updated_at, version, updated_by)
          VALUES (
            ${SETTING_KEY}, ${valueJson}::jsonb,
            'Global read-only kill switch for MCP tools.',
            true, NOW(), NOW(), 1,
            ${userId}::uuid
          )
          ON CONFLICT (key) DO NOTHING
        `;
      } else {
        // Update case: WHERE clause gates on version.
        const valueJson = JSON.stringify({ enabled: desired, changedBy: userId });
        const rowsAffected = await prisma.$executeRaw`
          UPDATE admin.system_configuration
          SET value = ${valueJson}::jsonb,
              updated_at = NOW(),
              version = version + 1,
              updated_by = ${userId}::uuid
          WHERE key = ${SETTING_KEY}
            AND version = ${clientVersion}
        `;

        if (rowsAffected === 0) {
          // Either the row doesn't exist (and client supplied version > 0), or
          // the version is stale. Re-read to attach context to the 409.
          const current = await readState();
          const conflictingFields: string[] = [];
          if (current.enabled !== desired) conflictingFields.push('enabled');
          logger.warn({
            clientVersion, currentVersion: current.version, userId,
          }, '[AdminTools] readonly write conflict — version mismatch');
          return reply.code(409).send({
            error: 'Conflict: another admin updated this setting before your save.',
            currentRow: current,
            conflictingFields,
          });
        }
      }

      const after = await readState();
      logger.info({
        enabled: after.enabled,
        version: after.version,
        userId,
      }, `[AdminTools] readonly mode ${after.enabled ? 'ENABLED' : 'DISABLED'} (v${after.version})`);

      return reply.send(after);
    } catch (error: any) {
      logger.error({ error }, '[AdminTools] Failed to set readonly mode');
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default adminToolsRoutes;
