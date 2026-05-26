/**
 * /api/code/ws/progress — Phase 3.8 extraction.
 *
 * WebSocket proxy for code progress events (Phase 3 side channel).
 * Structured tool/api events tailed from openagentic's pino log by the exec
 * daemon. Consumed by the CodeMode React UI's useOpenagenticProgress hook to
 * render floating tool cards over the xterm canvas without interfering with
 * the terminal byte stream.
 *
 * Direct-to-exec-pod proxy, mirroring /api/code/ws/terminal.
 * No code-manager relay.
 *
 * CCR-mode short-circuit: when CODEMODE_USE_CCR_RELAY=1, synthesizes the
 * minimum set of events the UI needs (session_started + init_status per step)
 * and holds the WS open with a 25s ping keepalive.
 *
 * Extracted from server.ts Phase 3.8 (lines ~807-999 in pre-extraction server.ts).
 * LOCATION CHANGE ONLY — logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { validateWsRequest } from './_auth.js';
import { prisma } from '../../utils/prisma.js';
import { featureFlags } from '../../config/featureFlags.js';

export async function registerProgressWsRoute(fastify: FastifyInstance): Promise<void> {
  // Hot-read the internal key per-handshake from the projected Secret mount (#416).
  const { getInternalKey } = await import('../../utils/internalKeyReader.js');
  const WebSocketModule = await import('ws');
  const WebSocket = WebSocketModule.default;

  fastify.get('/api/code/ws/progress', { websocket: true } as any, async (connection: any, request: any) => {
    const ws = connection?.socket || connection;
    const sessionId = (request.query as any)?.sessionId;
    const authToken = (request.query as any)?.token;
    loggers.routes.info({ sessionId, hasToken: !!authToken, hasSocket: !!ws }, 'Code progress WebSocket connection initiated');

    if (!ws || typeof ws.send !== 'function') {
      loggers.routes.error({ sessionId, wsType: typeof ws }, 'Client progress WebSocket is undefined or invalid');
      return;
    }

    // SECURITY: Verify user authentication and AWCode permission
    const authResult = await validateWsRequest(authToken, ws);
    if (!authResult) return;

    // Translate session.id → slice_id (manager's session ID). Same
    // lookup the terminal route does above.
    let managerSessionId = sessionId;
    if (sessionId) {
      try {
        const session = await prisma.codeSession.findFirst({
          where: { id: sessionId, status: 'active' },
          select: { slice_id: true }
        });
        if (session?.slice_id) {
          managerSessionId = session.slice_id;
        }
      } catch (dbError: any) {
        loggers.routes.error({ error: dbError.message, sessionId }, 'Progress: failed to look up session, using original sessionId');
      }
    }

    // Compute the deterministic exec pod service name —
    // openagentic-{sha256(userId)[:12]}-svc — same as the terminal
    // route. Both routes land on the same pod but on different
    // endpoints (/ws/terminal/:id vs /ws/progress/:id).
    const crypto = await import('crypto');
    const userIdHash = crypto.createHash('sha256')
      .update(authResult.user.userId)
      .digest('hex')
      .substring(0, 12);
    const execPodService = `openagentic-${userIdHash}-svc`;
    const K8S_NAMESPACE = featureFlags.k8sNamespace;

    // CCR-mode short-circuit: when CODEMODE_USE_CCR_RELAY=1, the exec pod
    // runs openagentic --remote-session on port 3070 — NOT the legacy v1
    // exec daemon on 3060 that served /ws/progress. Proxying to 3060
    // hangs forever and the UI never gets session_started → store's
    // activeSessionId stays null → chat WS effect never fires → LLM
    // never runs. So synthesize the minimum set of events the UI needs
    // to unblock: session_started (carries sessionId → store) + init
    // status=complete for all four checkpoints so the SessionBootScreen
    // transitions to chat-ready. The real CCR health gates live on the
    // /api/code/v2/boot-events endpoint the upcoming unified boot UI
    // consumes (task #218 follow-up mock).
    if (process.env.CODEMODE_USE_CCR_RELAY === '1' ||
        process.env.CODEMODE_USE_CCR_RELAY === 'true') {
      const emit = (obj: Record<string, unknown>) => {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify(obj)); } catch { /* best-effort */ }
        }
      };
      emit({
        type: 'session_started',
        sessionId,
        workspacePath: `/workspaces/${authResult.user.userId}`,
        cliBackend: 'ccr-daemon',
        storageType: 's3fs',
        podName: execPodService.replace(/-svc$/, ''),
        hostname: execPodService,
      });
      for (const step of ['storage', 'vscode', 'openagentic', 'llm', 'ready']) {
        emit({ type: 'init_status', step, status: 'complete', message: `${step}: ok (CCR)` });
      }
      // Keep the WS open so the UI's reconnect logic doesn't trigger;
      // it'll close it on unmount. No exec-pod proxy here — the chat
      // WS is the only transport CCR needs.
      const keepalive = setInterval(() => {
        if (ws.readyState !== 1) return clearInterval(keepalive);
        try { ws.ping?.(); } catch { /* tolerant */ }
      }, 25_000);
      ws.on('close', () => clearInterval(keepalive));
      ws.on('error', () => clearInterval(keepalive));
      loggers.routes.info({ sessionId, userId: authResult.user.userId },
        '[codemode-progress] CCR short-circuit: synthetic session_started + init events emitted');
      return;
    }

    const execWsUrl = `ws://${execPodService}.${K8S_NAMESPACE}.svc.cluster.local:3060/ws/progress/${managerSessionId}?internalKey=${encodeURIComponent(getInternalKey())}`;

    loggers.routes.info({ sessionId, managerSessionId, execPodService, userId: authResult.user.userId }, 'Direct progress WebSocket to exec pod');

    let execWs: InstanceType<typeof WebSocket> | null = null;

    try {
      execWs = new WebSocket(execWsUrl);

      execWs.on('open', () => {
        loggers.routes.info({ sessionId, execPodService }, 'Direct progress WebSocket connected to exec pod');
      });

      execWs.on('message', (data: any) => {
        if (ws && ws.readyState === 1) {
          // Progress events are small JSON text messages. Forward
          // as text (not binary) so the browser's `JSON.parse(evt.data)`
          // works without a Buffer → string conversion.
          ws.send(data.toString());
        }
      });

      execWs.on('close', (code: number, reason: Buffer) => {
        loggers.routes.info({ sessionId, code, reason: reason?.toString() }, 'Progress: exec pod WebSocket closed');
        if (ws && ws.readyState === 1) ws.close();
      });

      execWs.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, sessionId }, 'Progress: exec pod WebSocket error');
        if (ws && ws.readyState === 1) ws.close();
      });

      // Client → exec pod: progress is mostly server-initiated, but
      // the browser sends keepalives so we forward those too.
      ws.on('message', (message: any) => {
        if (execWs && execWs.readyState === 1) {
          execWs.send(message.toString());
        }
      });

      ws.on('close', () => {
        loggers.routes.info({ sessionId }, 'Progress: client WebSocket closed');
        if (execWs && execWs.readyState === 1) execWs.close();
      });

      ws.on('error', (error: Error) => {
        loggers.routes.error({ error: error.message, sessionId }, 'Progress: client WebSocket error');
        if (execWs && execWs.readyState === 1) execWs.close();
      });

    } catch (error: any) {
      loggers.routes.error({ error: error.message, sessionId, execPodService }, 'Failed to connect directly to exec pod progress WebSocket');
      if (ws && ws.readyState === 1) ws.close();
    }
  });

  loggers.routes.info('Code progress WebSocket proxy registered at /api/code/ws/progress');
}
