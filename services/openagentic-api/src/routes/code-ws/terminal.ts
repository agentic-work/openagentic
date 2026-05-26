/**
 * /api/code/ws/terminal — Phase 3.8 extraction.
 *
 * Legacy WebSocket proxy (kept for backward compat). Direct-to-exec-pod
 * proxy that bypasses code-manager relay and eliminates 2 network hops.
 *
 * Extracted from server.ts Phase 3.8 (lines ~659-805 in pre-extraction server.ts).
 * LOCATION CHANGE ONLY — logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { validateWsRequest } from './_auth.js';
import { prisma } from '../../utils/prisma.js';
import { getInternalKey } from '../../utils/internalKeyReader.js';
import { featureFlags } from '../../config/featureFlags.js';

export async function registerTerminalWsRoute(fastify: FastifyInstance): Promise<void> {
  const CODE_MANAGER_WS_URL = process.env.CODE_MANAGER_URL || 'http://openagentic-manager:3050';
  const WebSocketModule = await import('ws');
  const WebSocket = WebSocketModule.default;

  fastify.get('/api/code/ws/terminal', { websocket: true } as any, async (connection: any, request: any) => {
    // Handle both @fastify/websocket v10 (connection.socket) and v11 (connection is the socket)
    const ws = connection?.socket || connection;
    const sessionId = (request.query as any)?.sessionId;
    const authToken = (request.query as any)?.token;
    loggers.routes.info({ sessionId, hasToken: !!authToken, hasSocket: !!ws, connectionType: typeof connection }, 'Code terminal WebSocket connection initiated');

    // Guard against undefined ws (can happen if connection failed during setup)
    if (!ws || typeof ws.send !== 'function') {
      loggers.routes.error({ sessionId, wsType: typeof ws }, 'Client WebSocket is undefined or invalid - connection may have failed during setup');
      return;
    }

    // SECURITY: Verify user authentication and AWCode permission
    const authResult = await validateWsRequest(authToken, ws);
    if (!authResult) return;

    loggers.routes.info({
      sessionId,
      userId: authResult.user.userId,
      email: authResult.user.email
    }, 'AWCode terminal WebSocket authorized');

    // CRITICAL FIX: Look up the sliceId from the session in database
    // The UI sends the session.id but the manager expects the sliceId (manager's session ID)
    let managerSessionId = sessionId;
    if (sessionId) {
      try {
        const session = await prisma.codeSession.findFirst({
          where: { id: sessionId, status: 'active' },
          select: { slice_id: true }
        });
        if (session?.slice_id) {
          managerSessionId = session.slice_id;
          loggers.routes.info({ sessionId, sliceId: managerSessionId }, 'Translated session ID to slice ID for manager');
        } else {
          loggers.routes.warn({ sessionId }, 'Session not found in database, using original sessionId');
        }
      } catch (dbError: any) {
        loggers.routes.error({ error: dbError.message, sessionId }, 'Failed to look up session, using original sessionId');
      }
    }

    // DIRECT CONNECTION: Connect browser WebSocket directly to exec pod,
    // bypassing code-manager relay. Eliminates 2 network hops (~40-80ms per keystroke).
    // The exec pod service name is deterministic: openagentic-{sha256(userId)[:12]}-svc
    const crypto = await import('crypto');
    const userIdHash = crypto.createHash('sha256')
      .update(authResult.user.userId)
      .digest('hex')
      .substring(0, 12);
    const execPodService = `openagentic-${userIdHash}-svc`;
    const namespace = featureFlags.k8sNamespace;
    // Read fresh per connection so projected-secret rotation (#416)
    // takes effect without a pod restart.
    const internalKey = getInternalKey();
    const execWsUrl = `ws://${execPodService}.${namespace}.svc.cluster.local:3060/ws/terminal/${managerSessionId}?internalKey=${encodeURIComponent(internalKey)}`;

    loggers.routes.info({ sessionId, managerSessionId, execPodService, userId: authResult.user.userId }, 'Direct WebSocket to exec pod (bypassing code-manager relay)');

    let execWs: InstanceType<typeof WebSocket> | null = null;

    try {
      execWs = new WebSocket(execWsUrl);

      execWs.on('open', () => {
        loggers.routes.info({ sessionId, execPodService }, 'Direct WebSocket connected to exec pod');
      });

      execWs.on('message', (data: any) => {
        if (ws && ws.readyState === 1) {
          // Forward as binary for maximum efficiency (no toString() conversion)
          ws.send(data, { binary: Buffer.isBuffer(data) });
        }
      });

      execWs.on('close', (code: number, reason: Buffer) => {
        loggers.routes.info({ sessionId, code, reason: reason?.toString() }, 'Exec pod WebSocket closed');
        if (ws && ws.readyState === 1) ws.close();
      });

      execWs.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, sessionId }, 'Exec pod WebSocket error');
        if (ws && ws.readyState === 1) ws.close();
      });

      // Forward client → exec pod (binary passthrough, no toString())
      ws.on('message', (message: any) => {
        if (execWs && execWs.readyState === 1) {
          execWs.send(message, { binary: Buffer.isBuffer(message) });
        }
      });

      ws.on('close', () => {
        loggers.routes.info({ sessionId }, 'Client WebSocket closed');
        if (execWs && execWs.readyState === 1) execWs.close();
      });

      ws.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, sessionId }, 'Client WebSocket error');
        if (execWs && execWs.readyState === 1) execWs.close();
      });

    } catch (error: any) {
      loggers.routes.error({ error: error.message, sessionId, execPodService }, 'Failed to connect directly to exec pod WebSocket');
      if (ws && ws.readyState === 1) ws.close();
    }
  });

  loggers.routes.info('Code terminal WebSocket proxy registered at /api/code/ws/terminal');
}
