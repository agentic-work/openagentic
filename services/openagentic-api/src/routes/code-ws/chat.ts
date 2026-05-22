/**
 * /api/code/ws/chat (legacy v1 4410 gate) and
 * /api/code/v2/ws/chat (CCR relay OR chat-pipeline-direct) — Phase 3.8 extraction.
 *
 * v1 chat path (/api/code/ws/chat):
 *   DEPRECATED in v0.6.7. Returns WS close code 4410 (Gone) with a hint
 *   pointing at v2. Clients on the legacy hook will reconnect against v2
 *   after one UI reload.
 *
 * v2 chat path (/api/code/v2/ws/chat) — CCR dual-mount:
 *   CODEMODE_USE_CCR_RELAY=1 → registerCodeModeRelayRoute (relay handler from
 *     routes/code-mode/relay-ws.handler.ts). Task #218.
 *   Default → registerCodeModeV2ChatRoute (chat-pipeline-direct handler from
 *     routes/code-mode/chat-stream.handler.ts).
 *   Only ONE handler can own /api/code/v2/ws/chat at a time — Fastify rejects
 *   duplicate registrations. Flip the env var + redeploy to cut traffic over.
 *
 * Boot-events stream:
 *   Unified boot-events NDJSON stream per docs/mocks/codemode-boot-v2.html contract.
 *   Registered via registerCodeModeBootEventsRoute (routes/code-mode/boot-events.handler.ts).
 *
 * The dual-mount branch decision is made INSIDE this module at call time based on
 * the runtime env var — NOT inside individual route definitions. This is the
 * "runtime branch INSIDE the plugin" strategy from the Phase 3.8 spec.
 *
 * Extracted from server.ts Phase 3.8 (lines ~1001-1120 in pre-extraction server.ts).
 * LOCATION CHANGE ONLY — logic is unchanged.
 */

import type { FastifyInstance } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { getRedisClient } from '../../utils/redis-client.js';
import type { ChatStorageService } from '../../services/ChatStorageService.js';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface ChatWsOptions {
  chatStorage?: ChatStorageService;
  providerManager?: ProviderManager;
}

/**
 * Registers the legacy v1 WS 4410 gate at /api/code/ws/chat.
 * Always registered regardless of CCR mode.
 */
export function registerChatV1LegacyGate(fastify: FastifyInstance): void {
  // v0.6.7: /api/code/ws/chat is DEPRECATED. It proxied to openagentic
  // CLI in the exec pod per turn; cold-boot cost made TTFT 1-3s too
  // slow. All new sessions use /api/code/v2/ws/chat (chat-pipeline-
  // direct) which runs the loop inside api and dispatches tool calls
  // to the pod over HTTP — no CLI boot, NDJSON-over-WS end-to-end.
  //
  // Returns WS close code 4410 (Gone) with a hint pointing at v2.
  // Clients on the legacy hook will reconnect against v2 after one
  // UI reload.
  fastify.get('/api/code/ws/chat', { websocket: true } as any, async (connection: any, request: any) => {
    const ws = connection?.socket || connection;
    const sessionId = (request.query as any)?.sessionId;
    loggers.routes.warn({ sessionId, path: '/api/code/ws/chat' }, '[codemode] Legacy v1 WS contacted — closing with 4410 Gone (use /api/code/v2/ws/chat)');
    if (ws && typeof ws.close === 'function') {
      try {
        ws.send(JSON.stringify({
          type: 'error',
          error: {
            type: 'gone',
            message: 'Codemode v1 (openagentic-cli backend) was removed in 0.6.7. Connect to /api/code/v2/ws/chat instead. Reload the page to re-pick the endpoint.',
            migratedTo: '/api/code/v2/ws/chat',
          },
        }) + '\n');
      } catch { /* no-op if send fails */ }
      ws.close(4410, 'Codemode v1 deprecated — use /api/code/v2/ws/chat');
    }
    return;
  });

  loggers.routes.info('Legacy codemode v1 WS at /api/code/ws/chat registered as 4410-gate (v2-only since 0.6.7, #217)');
}

/**
 * Registers the v2 /api/code/v2/ws/chat handler — dual-mount based on
 * CODEMODE_USE_CCR_RELAY env var. Also registers the boot-events NDJSON stream.
 *
 * CCR relay branch: registerCodeModeRelayRoute from relay-ws.handler.ts
 * Direct branch:    registerCodeModeV2ChatRoute from chat-stream.handler.ts
 *
 * Only ONE handler can be registered per startup (env var is read once).
 */
export async function registerChatV2DualMount(
  fastify: FastifyInstance,
  options: ChatWsOptions,
): Promise<void> {
  const ccrRelayEnabled =
    process.env.CODEMODE_USE_CCR_RELAY === '1' ||
    process.env.CODEMODE_USE_CCR_RELAY === 'true';

  if (ccrRelayEnabled) {
    try {
      const { registerCodeModeRelayRoute } = await import('../code-mode/relay-ws.handler.js');
      const redis = getRedisClient();
      if (!redis) {
        throw new Error('CODEMODE_USE_CCR_RELAY requires Redis — initializeRedis() must have run');
      }
      await registerCodeModeRelayRoute(fastify, { logger: loggers.routes, redis });
      loggers.routes.info('[codemode] CCR relay active at /api/code/v2/ws/chat (task #218)');
    } catch (error: any) {
      loggers.routes.error(
        { err: error.message },
        'Failed to register CodeMode CCR relay — continuing without codemode WS',
      );
    }
  } else {
    try {
      const { registerCodeModeV2ChatRoute } = await import('../code-mode/chat-stream.handler.js');
      registerCodeModeV2ChatRoute(fastify, {
        chatStorage: options.chatStorage,
        providerManager: options.providerManager,
        logger: loggers.routes,
      });
    } catch (error: any) {
      loggers.routes.error(
        { err: error.message },
        'Failed to register CodeMode v2 chat-pipeline-direct WebSocket — continuing without it',
      );
    }
  }

  // Unified boot-events stream (NDJSON) — the single init UX per the
  // docs/mocks/codemode-boot-v2.html contract. Streams live K8s events
  // for the user's pod plus 5 real health checks (pod scheduled,
  // workspace mount, daemon /health, model 1-token ping, relay WS
  // reachability). Emits {type:'all_ready'} only when every check is
  // 'ok'. UI gates the chat surface on it.
  try {
    const { registerCodeModeBootEventsRoute } = await import('../code-mode/boot-events.handler.js');
    await registerCodeModeBootEventsRoute(fastify, { logger: loggers.routes });
  } catch (error: any) {
    loggers.routes.error(
      { err: error.message },
      'Failed to register CodeMode boot-events route — the UI gate will fall back to the legacy progress WS',
    );
  }
}
