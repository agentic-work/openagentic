/**
 * /api/code/ws/events — Phase 3.8 extraction.
 *
 * WebSocket proxy for code manager events (for new Code Mode UI with
 * real-time activity visualization). Proxies /api/code/ws/events to
 * CODE_MANAGER_URL/ws/events.
 *
 * Extracted from server.ts Phase 3.8 (lines ~1122-1260 in pre-extraction server.ts).
 * LOCATION CHANGE ONLY — logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { validateWsRequest } from './_auth.js';

export async function registerEventsWsRoute(fastify: FastifyInstance): Promise<void> {
  const CODE_MANAGER_WS_URL = process.env.CODE_MANAGER_URL || 'http://openagentic-manager:3050';
  // Hot-read internal key per-handshake from projected Secret (#416).
  const { getInternalKey } = await import('../../utils/internalKeyReader.js');

  const WebSocketModule = await import('ws');
  const WebSocket = WebSocketModule.default;

  fastify.get('/api/code/ws/events', { websocket: true } as any, async (connection: any, request: any) => {
    // Handle both @fastify/websocket v10 (connection.socket) and v11 (connection is the socket)
    const ws = connection?.socket || connection;
    const userId = request.query.userId;
    const sessionId = request.query.sessionId;
    const userToken = request.query.token; // Auth token for API mode
    loggers.routes.info({ userId, sessionId, hasToken: !!userToken, hasSocket: !!ws, connectionType: typeof connection }, 'Code events WebSocket connection initiated');

    // Guard against undefined ws (can happen if connection failed during setup)
    if (!ws || typeof ws.send !== 'function') {
      loggers.routes.error({ userId, wsType: typeof ws }, 'Client WebSocket is undefined or invalid - connection may have failed during setup');
      return;
    }

    // SECURITY: Verify user authentication and AWCode permission
    const authResult = await validateWsRequest(userToken, ws);
    if (!authResult) return;

    loggers.routes.info({
      userId: authResult.user.userId,
      email: authResult.user.email,
      sessionId
    }, 'AWCode events WebSocket authorized');

    // Connect to code manager WebSocket
    const wsBaseUrl = `${CODE_MANAGER_WS_URL.replace(/^http/, 'ws')}/ws/events`;
    const wsParams = new URLSearchParams();
    if (userId) wsParams.set('userId', userId);
    if (sessionId) wsParams.set('sessionId', sessionId);
    if (userToken) wsParams.set('token', userToken); // Forward auth token to code manager
    const _key = getInternalKey();
    if (_key) wsParams.set('internalKey', _key);
    const managerWsUrl = `${wsBaseUrl}?${wsParams.toString()}`;
    loggers.routes.info({ managerWsUrl: wsBaseUrl, userId, sessionId, hasToken: !!userToken }, 'Connecting to code manager events WebSocket');

    let managerWs: InstanceType<typeof WebSocket> | null = null;

    try {
      managerWs = new WebSocket(managerWsUrl);

      managerWs.on('open', () => {
        loggers.routes.info({ userId, sessionId }, 'Connected to code manager events WebSocket');
      });

      managerWs.on('message', (data: any) => {
        // Forward events from manager to client
        if (ws && ws.readyState === 1) { // WebSocket.OPEN
          ws.send(data.toString());
        }
      });

      managerWs.on('close', () => {
        loggers.routes.info({ userId, sessionId }, 'Code manager events WebSocket closed');
        if (ws && ws.readyState === 1) {
          ws.close();
        }
      });

      managerWs.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, userId, sessionId }, 'Code manager events WebSocket error');
        if (ws && ws.readyState === 1) {
          ws.close();
        }
      });

      ws.on('message', (message: any) => {
        const msgStr = message.toString();
        loggers.routes.info({ userId, sessionId, msgPreview: msgStr.substring(0, 100) }, 'Forwarding client message to code manager');
        if (managerWs && managerWs.readyState === 1) {
          managerWs.send(msgStr);
        } else {
          loggers.routes.warn({ userId, sessionId, managerState: managerWs?.readyState }, 'Cannot forward - manager WebSocket not ready');
        }
      });

      ws.on('close', () => {
        loggers.routes.info({ userId, sessionId }, 'Client events WebSocket closed');
        if (managerWs && managerWs.readyState === 1) {
          managerWs.close();
        }
      });

      ws.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, userId, sessionId }, 'Client events WebSocket error');
        if (managerWs && managerWs.readyState === 1) {
          managerWs.close();
        }
      });

    } catch (error: any) {
      loggers.routes.error({ error: error.message, userId, sessionId }, 'Failed to connect to code manager events WebSocket');
      if (ws && ws.readyState === 1) {
        ws.close();
      }
    }
  });

  loggers.routes.info('Code events WebSocket proxy registered at /api/code/ws/events');
}
