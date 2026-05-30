/**
 * #650 U8 — Internal-key-authed sweep endpoint for the daily k8s CronJob.
 *
 * The user-facing `/api/admin/llm-providers/refresh-all` is admin-gated
 * (good for human admins via the UI). The k8s CronJob can't carry an
 * admin JWT, so this sibling route accepts the internal key (Vault → ESO
 * → projected file) instead. Same RefreshModelDetailsJob underneath.
 *
 * Auth: `Authorization: Bearer <internal-key>` where the key is read
 * from `/var/run/secrets/openagentic/internal-key` by the api pod and
 * mounted into the CronJob pod as a projected secret.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface InternalRefreshRoutesOptions {
  providerManager?: ProviderManager;
}

export const internalRefreshModelsRoutes: FastifyPluginAsync<InternalRefreshRoutesOptions> = async (
  fastify,
  opts,
) => {
  const logger = fastify.log;
  const providerManager = opts.providerManager;

  fastify.post('/refresh-all-models', async (request: FastifyRequest, reply: FastifyReply) => {
    // Bearer auth against projected internal-key.
    const authHeader = request.headers.authorization || request.headers.Authorization;
    const headerStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const presented = headerStr?.replace(/^Bearer\s+/i, '').trim() ?? '';
    const expected = getInternalKey();
    if (!expected || presented !== expected) {
      return reply.code(401).send({ error: 'Unauthorized — internal-key required' });
    }

    if (!providerManager) {
      return reply.code(503).send({ error: 'ProviderManager not initialized' });
    }

    try {
      const { prisma } = await import('../../utils/prisma.js');
      const { RefreshModelDetailsJob } = await import('../../jobs/RefreshModelDetailsJob.js');
      const job = new RefreshModelDetailsJob(prisma as any, providerManager, logger as any);
      const result = await job.run();
      return reply.send({
        message: 'Refresh sweep complete',
        triggeredBy: 'internal-cron',
        ...result,
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[internal] refresh-all-models failed');
      return reply.code(500).send({
        error: 'Refresh sweep failed',
        message: (err as Error).message,
      });
    }
  });
};
