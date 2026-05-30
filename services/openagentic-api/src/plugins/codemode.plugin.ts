/**
 * codemode.plugin.ts — Task 2.5
 *
 * Domain plugin that groups all Code Mode routes under /api/code.
 *
 * Sub-routes registered:
 *  1. codeSessionsRoutes  (HTTP CRUD + resize) — /api/code/sessions/*
 *     Guarded by authMiddleware (onRequest) so the sub-routes themselves
 *     don't need to import it.
 *  2. codeTerminalWsRoute (WebSocket proxy) — /api/code/ws/terminal
 *     Authenticates via query-param token in the handler itself (browsers
 *     cannot set headers on WS upgrades).
 *
 * GATE: featureFlags.codemodeEnabled only — this feature is FREE.
 * This plugin must not be enterprise-gated (free funnel design).
 *
 * Plugin options allow injecting stubs for tests (same pattern as
 * chat.plugin.ts / ChatRoutesPluginOptions).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import codeSessionsRoutes from '../routes/code/sessions.js';
import { codeTerminalWsRoute } from '../routes/code/terminal-ws.js';
import type { CodeSessionsPluginOptions } from '../routes/code/sessions.js';
import type { TerminalWsPluginOptions } from '../routes/code/terminal-ws.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface CodemodeRoutesPluginOptions {
  /**
   * Injected stubs forwarded to codeSessionsRoutes.
   * In production these are left undefined and the route resolves real deps.
   */
  execClient?: CodeSessionsPluginOptions['execClient'];
  codeModeSettings?: CodeSessionsPluginOptions['codeModeSettings'];

  /**
   * Injected stubs forwarded to codeTerminalWsRoute.
   */
  validateToken?: TerminalWsPluginOptions['validateToken'];
  connectExec?: TerminalWsPluginOptions['connectExec'];
  codeExecWsUrl?: TerminalWsPluginOptions['codeExecWsUrl'];
  codeExecInternalKey?: TerminalWsPluginOptions['codeExecInternalKey'];
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const codemodeRoutesPlugin: FastifyPluginAsync<CodemodeRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: CodemodeRoutesPluginOptions,
) => {
  loggers.routes.info('Registering codemode routes plugin...');

  // ── 1. HTTP session CRUD routes — protected by authMiddleware ─────────────
  // Wrap in a child Fastify scope so authMiddleware only applies to these
  // routes and not to the WS route (which authenticates via query-param token).
  try {
    await fastify.register(async (instance) => {
      instance.addHook('onRequest', authMiddleware as any);
      await instance.register(codeSessionsRoutes, {
        execClient: options.execClient,
        codeModeSettings: options.codeModeSettings,
      });
    }, { prefix: '/api/code' });
    loggers.routes.info('Code sessions routes registered at /api/code/sessions/* (authMiddleware)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code sessions routes');
  }

  // ── 2. WebSocket terminal proxy — self-authenticates via query-param token ─
  try {
    await fastify.register(codeTerminalWsRoute, {
      prefix: '/api/code',
      validateToken: options.validateToken,
      connectExec: options.connectExec,
      codeExecWsUrl: options.codeExecWsUrl,
      codeExecInternalKey: options.codeExecInternalKey,
    });
    loggers.routes.info('Code terminal WS route registered at /api/code/ws/terminal');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register code terminal WS route');
  }

  loggers.routes.info('Codemode routes plugin registered successfully');
};

export { codemodeRoutesPlugin };
export default fp(codemodeRoutesPlugin, {
  name: 'codemode-routes',
  dependencies: [],
});
