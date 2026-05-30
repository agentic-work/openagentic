/**
 * Models Routes Plugin — Phase 3.4 of server.ts decomposition.
 *
 * This is the HIGH-LEVEL WRAPPER that groups all models-domain route
 * registrations behind a single Fastify plugin export.
 *
 * Sub-routes registered here:
 *  1. embeddingsRoutes      — OpenAI-compatible embeddings API  → /api/embeddings/*
 *  2. adminEmbeddingsRoutes — Admin embedding configuration     → /api/admin/embeddings/*
 *  3. aiMlServicesPlugin    — AI/ML model discovery             → /api/models/* (via /api prefix)
 *  4. capabilityRoutes      — Model capability catalog          → /api/models/*
 *  5. modelSelectorRoutes   — Dynamic model selector admin      → /api/models/model-selector/*
 *
 * NOTE on the /api/models prefix: both aiMlServicesPlugin (registered at /api,
 * with an internal /models sub-prefix) and capabilityRoutes + modelSelectorRoutes
 * (registered at /api/models) all result in routes under /api/models/*.  This
 * overlap existed pre-Phase-3.4 in server.ts and is deliberately preserved here
 * to maintain identical runtime behaviour.  Resolving the collision is a separate
 * concern (tracked in the Phase 0 audit).
 *
 * ProviderManager injection pattern (mirrors chat.plugin.ts Phase 3.1):
 *   - Inside the plugin body: read from options first, fall back to AppContext.
 *   - AppContext is decorated on the Fastify instance before this plugin is
 *     registered in server.ts (ordering is caller-guaranteed, not Fastify-enforced).
 *
 * All sub-registrations are wrapped in individual try/catch blocks (lesson 4)
 * matching the style established in server.ts so a single failing sub-route never
 * blocks the others.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { AppContext } from '../context/AppContext.js';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import embeddingsRoutes from '../routes/embeddings.js';
import adminEmbeddingsRoutes from '../routes/admin-embeddings.js';
import { aiMlServicesPlugin } from '../routes/ai-ml-services/index.js';
import capabilityRoutes from '../routes/capabilities.js';
import { modelSelectorRoutes } from '../routes/model-selector.js';

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

export interface ModelsRoutesPluginOptions {
  /**
   * Optional: override providerManager from AppContext.
   * When undefined the plugin reads ctx.providerManager from the decorated
   * Fastify instance (fastify.app.providerManager).
   */
  providerManager?: ProviderManager;
}

// ---------------------------------------------------------------------------
// The wrapper plugin
// ---------------------------------------------------------------------------

const modelsRoutesPluginImpl: FastifyPluginAsync<ModelsRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: ModelsRoutesPluginOptions,
) => {
  loggers.routes.info('Registering models routes plugin...');

  // Resolve ProviderManager — prefer explicit options, fall back to AppContext
  // decoration (lesson from chat.plugin.ts Phase 3.1 pattern).
  // AppContext decoration ordering is caller-guaranteed, not Fastify-enforced.
  const ctx: AppContext | undefined = fastify.app;
  const providerManager = options.providerManager ?? ctx?.providerManager;

  // ── 1. Embeddings routes ────────────────────────────────────────────────
  // OpenAI-compatible embeddings endpoint using UniversalEmbeddingService.
  try {
    await fastify.register(embeddingsRoutes, { prefix: '/api/embeddings' });
    loggers.routes.info('Embeddings routes registered at /api/embeddings (uses UniversalEmbeddingService)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register embeddings routes');
  }

  // ── 2. Admin Embeddings config routes ────────────────────────────────────
  // Admin endpoints for managing embedding provider configuration.
  try {
    await fastify.register(adminEmbeddingsRoutes, { prefix: '/api/admin/embeddings' });
    loggers.routes.info('Admin embeddings routes registered at /api/admin/embeddings/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin embeddings routes');
  }

  // ── 3. AI/ML Services routes ─────────────────────────────────────────────
  // Model discovery and capabilities routes. Registered at /api (prefix) with
  // an internal /models sub-prefix → effective path: /api/models/*.
  // NOTE: This creates an /api/models overlap with capabilityRoutes and
  // modelSelectorRoutes below.  This is pre-existing behaviour — do NOT fix here.
  try {
    await fastify.register(aiMlServicesPlugin, {
      prefix: '/api',
      providerManager,
    });
    loggers.routes.info('AI/ML Services routes registered at /api/models/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register AI/ML services routes');
  }

  // ── 4. Model Capabilities routes ─────────────────────────────────────────
  // Capability catalog and intelligent routing recommendations.
  try {
    await fastify.register(capabilityRoutes, { prefix: '/api/models' });
    loggers.routes.info('Model Capabilities routes registered at /api/models/capabilities/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model capability routes');
  }

  // ── 5. Dynamic Model Selector routes ─────────────────────────────────────
  // Administrative endpoints for monitoring and managing MCP Proxy models.
  try {
    await fastify.register(modelSelectorRoutes, { prefix: '/api/models' });
    loggers.routes.info('Dynamic Model Selector routes registered at /api/models/selector/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register model selector routes');
  }

  loggers.routes.info('Models routes plugin registered successfully');
};

export const modelsRoutesPlugin = fp(modelsRoutesPluginImpl, {
  name: 'models-routes',
  // AppContext decoration ordering is caller-guaranteed, not Fastify-enforced.
  dependencies: [],
});
