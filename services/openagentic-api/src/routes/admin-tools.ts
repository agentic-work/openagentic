/**
 * Admin Tools Routes
 *
 * Global tool execution mode (read-only kill switch).
 * - GET  /api/admin/tools/readonly - Get current read-only mode status
 * - POST /api/admin/tools/readonly - Set read-only mode (persists to DB)
 */

import { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes || loggers;

const SETTING_KEY = 'mcp_tools_readonly';

async function getReadonlySetting(): Promise<{ enabled: boolean; source: 'database' | 'env' | 'default'; lastChanged?: string }> {
  try {
    const dbSetting = await prisma.systemConfiguration.findUnique({
      where: { key: SETTING_KEY },
    });
    if (dbSetting?.value) {
      const val = dbSetting.value as any;
      return {
        enabled: val.enabled === true,
        source: 'database',
        lastChanged: dbSetting.updated_at?.toISOString(),
      };
    }
  } catch {
    // Table may not exist yet
  }

  // Fall back to env var
  const envVal = process.env.MCP_TOOLS_READONLY_DEFAULT;
  if (envVal !== undefined) {
    return { enabled: envVal === 'true', source: 'env' };
  }

  // Default: false (full access)
  return { enabled: false, source: 'default' };
}

const adminToolsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * GET /api/admin/tools/readonly
   * Returns the current read-only mode status.
   */
  fastify.get('/tools/readonly', async (_request, reply) => {
    try {
      const result = await getReadonlySetting();
      return reply.send(result);
    } catch (error: any) {
      logger.error({ error }, '[AdminTools] Failed to get readonly status');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/tools/readonly
   * Set the read-only mode. Persists to system_configuration (DB is SOT).
   */
  fastify.post('/tools/readonly', async (request, reply) => {
    try {
      const { enabled } = request.body as { enabled: boolean };
      const user = (request as any).user;
      const userId = user?.userId || user?.id || 'unknown';

      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled must be a boolean' });
      }

      // Upsert into system_configuration
      await prisma.$executeRaw`
        INSERT INTO admin.system_configuration (key, value, description, is_active, updated_at)
        VALUES (
          ${SETTING_KEY},
          ${JSON.stringify({ enabled, changedBy: userId, changedAt: new Date().toISOString() })}::jsonb,
          'Global read-only kill switch for MCP tools. When enabled, tools that perform write/modify/delete operations are blocked.',
          true,
          NOW()
        )
        ON CONFLICT (key) DO UPDATE SET
          value = ${JSON.stringify({ enabled, changedBy: userId, changedAt: new Date().toISOString() })}::jsonb,
          updated_at = NOW()
      `;

      logger.info({
        enabled,
        changedBy: userId,
      }, `[AdminTools] MCP tools read-only mode ${enabled ? 'ENABLED' : 'DISABLED'}`);

      return reply.send({
        success: true,
        enabled,
        source: 'database',
        lastChanged: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error({ error }, '[AdminTools] Failed to set readonly mode');
      return reply.code(500).send({ error: error.message });
    }
  });
};

export default adminToolsRoutes;
