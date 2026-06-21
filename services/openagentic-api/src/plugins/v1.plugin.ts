import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { v1Router } from '../routes/v1/index.js';

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

// No additional configuration needed for this plugin — v1Router handles its
// own sub-route initialization internally. The empty interface is exported for
// consistent plugin shape across all Phase 3 plugins.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface V1RoutesPluginOptions {}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const v1RoutesPluginImpl: FastifyPluginAsync<V1RoutesPluginOptions> = async (fastify) => {
  loggers.routes.info('Registering v1 routes plugin...');

  // ── 1: Primary mount — /api/v1/* ──────────────────────────────────────────
  // All new development targets /api/v1/*. Legacy /api/* routes remain for
  // backward compatibility but will be deprecated over time.
  try {
    await fastify.register(v1Router, { prefix: '/api/v1' });
    loggers.routes.info('API v1 router registered at /api/v1/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register API v1 router at /api/v1');
  }

  // ── 2: SDK/CLI compat alias mount — /v1/* ─────────────────────────────────
  // Openagentic CLI's modelAliases populator hits ${BASE}/v1/models
  // (platform/modelAliases.ts:197); Anthropic-SDK clients default to /v1 too.
  // Mounting the same router at /v1 gives drop-in compat without forking route
  // definitions. Independent try/catch (lesson 4) so a failure here does NOT
  // prevent the primary /api/v1 mount from staying live.
  try {
    await fastify.register(v1Router, { prefix: '/v1' });
    loggers.routes.info('API v1 router alias registered at /v1/* (SDK/CLI compat)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register API v1 router alias at /v1');
  }

  loggers.routes.info('V1 routes plugin registered successfully');
};

export const v1RoutesPlugin = fp(v1RoutesPluginImpl, {
  name: 'v1-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
