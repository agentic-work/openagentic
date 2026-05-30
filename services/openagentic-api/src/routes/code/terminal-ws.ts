/**
 * terminal-ws.ts — Task 2.4
 *
 * Registers a WebSocket route at /ws/terminal (parent plugin adds the
 * /api/code prefix → /api/code/ws/terminal).
 *
 * On client connect:
 *  1. Authenticates the user via the `token` query param (injectable
 *     `opts.validateToken`; defaults to validateAnyToken from tokenValidator.ts).
 *  2. Reads `sessionId` from the query.
 *  3. Opens an outbound `ws` connection to the exec service:
 *       ${codeExecWsUrl}/ws/terminal/${encodeURIComponent(sessionId)}
 *     with header `x-internal-api-key` (REQUIRED — exec rejects without it).
 *  4. Pipes bytes both directions (raw, no JSON framing).
 *     On either side close/error, closes the other.
 *
 * All dependencies are injectable via opts for test isolation:
 *   opts.validateToken   — (token: string) => Promise<{ ok: boolean; user: any }>
 *   opts.connectExec     — (url: string, headers: Record<string,string>) => WebSocket
 *   opts.codeExecWsUrl   — override featureFlags.codeExecWsUrl
 *   opts.codeExecInternalKey — override featureFlags.codeExecInternalKey
 *
 * Handler idiom: matches monitoring-websocket.ts exactly — `{ websocket: true,
 * onRequest: ... } as any` + `(connection: any, req: any)` with
 * `connection?.socket || connection` for v10/v11 compat.
 */

import { FastifyPluginAsync } from 'fastify';
import { WebSocket } from 'ws';
import { featureFlags } from '../../config/featureFlags.js';
import { validateAnyToken } from '../../auth/tokenValidator.js';
import { loggers } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface TerminalWsPluginOptions {
  /**
   * Factory for the outbound exec WebSocket.
   * Default: `(url, headers) => new WebSocket(url, { headers })`
   */
  connectExec?: (url: string, headers: Record<string, string>) => WebSocket;

  /**
   * Token validator for the query-param bearer token.
   * Must return `{ ok: boolean; user: any }`.
   * Default: wraps `validateAnyToken` from tokenValidator.ts.
   */
  validateToken?: (token: string) => Promise<{ ok: boolean; user: any }>;

  /** Override featureFlags.codeExecWsUrl (useful in tests). */
  codeExecWsUrl?: string;

  /** Override featureFlags.codeExecInternalKey (useful in tests). */
  codeExecInternalKey?: string;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

async function defaultValidateToken(token: string): Promise<{ ok: boolean; user: any }> {
  const result = await validateAnyToken(token);
  if (!result.isValid || !result.user) {
    return { ok: false, user: null };
  }
  return { ok: true, user: result.user };
}

function defaultConnectExec(url: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(url, { headers });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const codeTerminalWsRoute: FastifyPluginAsync<TerminalWsPluginOptions> = async (
  fastify,
  opts,
) => {
  const logger = loggers?.routes
    ? loggers.routes.child({ module: 'code/terminal-ws' })
    : (fastify.log as any);

  const validateToken = opts.validateToken ?? defaultValidateToken;
  const connectExec = opts.connectExec ?? defaultConnectExec;
  const wsBaseUrl = opts.codeExecWsUrl ?? featureFlags.codeExecWsUrl;
  const internalKey = opts.codeExecInternalKey ?? featureFlags.codeExecInternalKey;

  /**
   * GET /ws/terminal?sessionId=<id>&token=<jwt>
   *
   * Registration idiom copied exactly from monitoring-websocket.ts:
   *   { websocket: true, onRequest: ... } as any
   *   handler: (connection: any, req: any) => { ... }
   *   ws = connection?.socket || connection   ← v10/v11 compat
   */
  fastify.get(
    '/ws/terminal',
    { websocket: true } as any,
    async (connection: any, req: any) => {
      // v10: connection.socket  v11: connection is the socket directly
      const clientWs: WebSocket = connection?.socket || connection;

      const { token, sessionId } = (req.query ?? {}) as {
        token?: string;
        sessionId?: string;
      };

      logger.info?.({ sessionId, hasToken: !!token }, 'Terminal WS: client connected');

      // ── Auth ─────────────────────────────────────────────────────────────
      if (!token) {
        logger.warn?.({ sessionId }, 'Terminal WS: no token — closing 1008');
        clientWs.close(1008, 'Authentication required');
        return;
      }

      let authResult: { ok: boolean; user: any };
      try {
        authResult = await validateToken(token);
      } catch (err: any) {
        logger.warn?.({ err: err?.message, sessionId }, 'Terminal WS: validateToken threw — closing 1008');
        clientWs.close(1008, 'Authentication error');
        return;
      }

      if (!authResult.ok || !authResult.user) {
        logger.warn?.({ sessionId }, 'Terminal WS: invalid token — closing 1008');
        clientWs.close(1008, 'Invalid token');
        return;
      }

      const userId = authResult.user?.userId || authResult.user?.id || 'unknown';
      logger.info?.({ sessionId, userId }, 'Terminal WS: auth OK — opening exec connection');

      // ── Open outbound exec WS ────────────────────────────────────────────
      const execUrl = `${wsBaseUrl}/ws/terminal/${encodeURIComponent(sessionId ?? '')}`;
      let execWs: WebSocket | null = null;

      try {
        execWs = connectExec(execUrl, {
          'x-internal-api-key': internalKey,
        });
      } catch (err: any) {
        logger.error?.({ err: err?.message, sessionId, execUrl }, 'Terminal WS: failed to create exec WS');
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        return;
      }

      // ── Pipe: exec → client ──────────────────────────────────────────────
      execWs.on('message', (data: any) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      execWs.on('close', (_code: number, _reason: Buffer) => {
        logger.info?.({ sessionId }, 'Terminal WS: exec closed — closing client');
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      });

      execWs.on('error', (err: Error) => {
        logger.error?.({ err: err.message, sessionId }, 'Terminal WS: exec error — closing client');
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      });

      // ── Pipe: client → exec ──────────────────────────────────────────────
      clientWs.on('message', (data: any) => {
        if (execWs && execWs.readyState === WebSocket.OPEN) {
          execWs.send(data);
        }
      });

      clientWs.on('close', () => {
        logger.info?.({ sessionId }, 'Terminal WS: client closed — closing exec');
        if (execWs && execWs.readyState === WebSocket.OPEN) execWs.close();
      });

      clientWs.on('error', (err: Error) => {
        logger.error?.({ err: err.message, sessionId }, 'Terminal WS: client error — closing exec');
        if (execWs && execWs.readyState === WebSocket.OPEN) execWs.close();
      });
    },
  );

  logger.info?.('Terminal WS route registered at /ws/terminal (parent adds /api/code prefix)');
};

export default codeTerminalWsRoute;
