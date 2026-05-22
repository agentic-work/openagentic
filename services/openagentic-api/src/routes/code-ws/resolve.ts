/**
 * /api/code/ws/resolve — Phase 3.8 extraction.
 *
 * Returns the exec-pod service address so the browser can connect directly
 * via nginx → pod, bypassing the API WebSocket proxy entirely.
 *
 * Extracted from server.ts Phase 3.8 (lines ~626-657 in pre-extraction server.ts).
 * LOCATION CHANGE ONLY — logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { prisma } from '../../utils/prisma.js';

export function registerResolveRoute(fastify: FastifyInstance): void {
  // ==========================================================================
  // DIRECT TERMINAL CONNECTION: Resolve endpoint
  // Returns the pod service address so the browser can connect directly
  // via nginx → pod, bypassing the API WebSocket proxy entirely.
  // ==========================================================================
  fastify.get('/api/code/ws/resolve', {
    preHandler: async (request: any, reply: any) => {
      // Validate auth
      const token = (request.query as any)?.token || request.headers?.authorization?.replace('Bearer ', '');
      if (!token) { reply.code(401).send({ error: 'No token' }); return; }
      const tokenResult = await validateAnyToken(token, { logger: loggers.routes });
      if (!tokenResult.isValid || !tokenResult.user) { reply.code(401).send({ error: 'Invalid token' }); return; }
      (request as any).resolvedUser = tokenResult.user;
    },
  }, async (request: any, reply: any) => {
    const user = (request as any).resolvedUser;
    const sessionId = (request.query as any)?.sessionId;
    const crypto = await import('crypto');
    const userIdHash = crypto.createHash('sha256').update(user.userId).digest('hex').substring(0, 12);
    const podService = `openagentic-${userIdHash}-svc`;
    const { getInternalKey } = await import('../../utils/internalKeyReader.js');
    const internalKey = getInternalKey();

    // Look up the manager session ID (slice_id) from the database
    let managerSessionId = sessionId;
    if (sessionId) {
      try {
        const session = await prisma.codeSession.findFirst({
          where: { id: sessionId, status: 'active' },
          select: { slice_id: true },
        });
        if (session?.slice_id) managerSessionId = session.slice_id;
      } catch {}
    }

    loggers.routes.info({ sessionId, podService, userId: user.userId }, 'WS resolve: returning pod address');
    return reply.send({ podService, sessionId: managerSessionId, internalKey });
  });
}
