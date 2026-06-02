import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { AppContext } from '../context/AppContext.js';
import { authMiddleware, adminMiddleware } from '../middleware/unifiedAuth.js';
import { settingsRoutes } from '../routes/settings.js';
import { versionRoutes } from '../routes/version.js';
import { feedbackRoutes } from '../routes/feedback.js';
import { internalRefreshModelsRoutes } from '../routes/internal/refresh-models.js';
import openaiCompatibleRoutes from '../routes/openai-compatible.js';
import canonicalCompletionsRoutes from '../routes/canonical-completions.js';
import adminApiTokenRoutes from '../routes/admin-api-tokens.js';
import adminWorkflowRoutes from '../routes/admin/workflows.js';
import { adminAgentRoutes } from '../routes/admin-agents.js';
import { agentRoutes } from '../routes/agents.js';
import artifactsRoutes from '../routes/artifacts.js';
import userSettingsRoutes from '../routes/user-settings.js';
import formattingRoutes from '../routes/formatting.js';
import renderRoutes from '../routes/render.js';
import agentAdminRoutes from '../routes/admin/agentic-loops.js';
import { embedRoutes } from '../routes/embed.js';

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

// No additional configuration needed for this plugin — all route files obtain
// their dependencies from AppContext (decorated onto the server) at request
// time. The empty interface is exported for consistent plugin shape.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface MiscRoutesPluginOptions {}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const miscRoutesPluginImpl: FastifyPluginAsync<MiscRoutesPluginOptions> = async (fastify) => {
  loggers.routes.info('Registering misc routes plugin...');

  // ── 1: Settings routes ────────────────────────────────────────────────────
  try {
    await fastify.register(settingsRoutes, { prefix: '/api/settings' });
    loggers.routes.info('Settings routes registered at /api/settings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register settings routes');
  }

  // ── 2: Version routes (public — no auth required) ─────────────────────────
  try {
    await fastify.register(versionRoutes, { prefix: '/api' });
    loggers.routes.info('Version routes registered at /api/version, /api/version/changelog, /api/version/latest');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register version routes');
  }

  // ── 2b: Internal-key-authed routes (cluster-only, e.g. CronJobs) ──────────
  try {
    const ctx = fastify.app as AppContext | undefined;
    await fastify.register(internalRefreshModelsRoutes, {
      prefix: '/api/internal',
      providerManager: ctx?.providerManager,
    });
    loggers.routes.info('Internal refresh routes registered at /api/internal/* (Bearer internal-key)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register internal refresh routes');
  }

  // ── 3: Feedback routes (thumbs up/down, copy tracking) ────────────────────
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      await instance.register(feedbackRoutes);
    }, { prefix: '/api/feedback' });
    loggers.routes.info('Feedback routes registered at /api/feedback/* with auth middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register feedback routes');
  }

  // ── 4: OpenAI-Compatible API routes (external integrations) ───────────────
  // Provides /api/v1/chat/completions and /api/v1/models endpoints that route
  // through ProviderManager for multi-provider LLM support.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', async (request, reply) => {
        return authMiddleware(request, reply);
      });
      await instance.register(openaiCompatibleRoutes, {
        providerManager: (fastify.app as AppContext | undefined)?.providerManager,
        logger: loggers.routes,
      });
    }, { prefix: '/api' });
    loggers.routes.info('OpenAI-compatible routes registered at /api/v1/chat/completions, /api/v1/models');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register OpenAI-compatible routes');
  }

  // ── 4b: Path D — Canonical SSE route (workflows-svc primary consumer) ────
  // POST /api/v1/canonical/completions emits canonical events
  // (Anthropic-Messages SSE wire shape) DIRECTLY — no openai-shape
  // repackage. Removes the double-normalization documented in the
  // SDK leverage study (GH #143 ship list). Same auth + Smart Router +
  // ProviderManager dispatch path as the OpenAI shim; only the wire
  // shape of streamed chunks differs.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', async (request, reply) => {
        return authMiddleware(request, reply);
      });
      await instance.register(canonicalCompletionsRoutes, {
        providerManager: (fastify.app as AppContext | undefined)?.providerManager,
        logger: loggers.routes,
      });
    });
    loggers.routes.info('Canonical SSE route registered at /api/v1/canonical/completions (Path D)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register canonical SSE route');
  }

  // ── 5: Admin API Token Management routes ─────────────────────────────────
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminApiTokenRoutes);
    });
    loggers.routes.info('Admin API Token Management routes registered at /api/admin/tokens/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin API token routes');
  }

  // ── 6: Admin Workflow Management routes ───────────────────────────────────
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminWorkflowRoutes);
    }, { prefix: '/api/admin/workflows' });
    loggers.routes.info('Admin workflow routes registered at /api/admin/workflows with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin workflow routes');
  }

  // ── 7: Admin Agent Management routes ─────────────────────────────────────
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAgentRoutes);
    }, { prefix: '/api/admin/agents' });
    loggers.routes.info('Admin agent routes registered at /api/admin/agents');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin agent routes');
  }

  // ── 9: Agent routes (non-admin, accessible to all authenticated users) ─────
  try {
    await fastify.register(agentRoutes, { prefix: '/api/agents' });
    loggers.routes.info('Agent routes registered at /api/agents');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register agent routes');
  }

  // ── 10: Artifacts routes (integrated with MilvusVectorService) ───────────
  try {
    await fastify.register(artifactsRoutes, { prefix: '' });
    loggers.routes.info('Artifacts routes registered at /api/artifacts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register artifacts routes');
  }

  // ── 11: User Settings routes (integrated with UserSettingsService) ─────────
  try {
    await fastify.register(userSettingsRoutes, { prefix: '' });
    loggers.routes.info('User Settings routes registered at /api/user/settings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user settings routes');
  }

  // ── 12: Formatting Capabilities routes ───────────────────────────────────
  try {
    await fastify.register(formattingRoutes, { prefix: '/api/formatting' });
    loggers.routes.info('Formatting capabilities routes registered at /api/formatting/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register formatting routes');
  }

  // ── 13: Rendering routes for Pure Frontend Architecture ───────────────────
  try {
    await fastify.register(renderRoutes, { prefix: '/api/render' });
    loggers.routes.info('Rendering routes registered at /api/render/* (charts, diagrams, markdown, code)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register rendering routes');
  }

  // ── 14: Agent Admin routes (agent registry, dashboard, execution history) ──
  try {
    await fastify.register(async (instance) => {
      await instance.register(agentAdminRoutes);
    }, { prefix: '/api' });
    loggers.routes.info('Agent admin routes registered at /api/admin/agentic/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Agent admin routes');
  }

  // ── 15: Embed routes (embeddable workflow widgets) ────────────────────────
  try {
    await fastify.register(embedRoutes, { prefix: '/embed' });
    loggers.routes.info('Embed routes registered at /embed/* (widget, iframe, execute)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register embed routes');
  }

  loggers.routes.info('Misc routes plugin registered successfully (15 route groups)');
};

export const miscRoutesPlugin = fp(miscRoutesPluginImpl, {
  name: 'misc-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
