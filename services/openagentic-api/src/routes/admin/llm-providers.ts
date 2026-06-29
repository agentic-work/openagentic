/**
 * LLM Provider Management API Routes — thin registrar + public re-export barrel.
 *
 * The former 6 078-LOC monolith was decomposed (behaviour-preserving) into
 * per-domain sub-plugins under `routes/admin/llm-providers/`. This file keeps
 * the public seam intact:
 *   - `llmProviderRoutes`          the Fastify plugin (default export)
 *   - `isEmbeddingOnlyModel`       pure helper (re-exported for tests/callers)
 *   - `sanitizeProviderModelConfig` pure helper (re-exported for tests/callers)
 *
 * Admin authentication is applied UPSTREAM (admin.plugin.ts wraps adminRoutes
 * with the `adminMiddleware` preHandler; this plugin and every sub-plugin it
 * registers inherit that hook through Fastify's encapsulation chain) — so this
 * registrar deliberately does NOT re-add an auth hook, exactly as the monolith
 * did not.
 *
 * CRITICAL: every sub-plugin is registered with the SAME `opts` object — i.e.
 * the SAME singleton ProviderManager admin CRUD must reload so chat-side
 * provider/model caches invalidate. Never construct a new ProviderManager here.
 *
 * Route surface (unchanged — every method + path is byte-identical to the
 * pre-split monolith). See each sub-module's header for its slice.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import type { ProviderRoutesOptions } from './llm-providers/types.js';
import { providersCrudRoutes } from './llm-providers/providers-crud.routes.js';
import { registryRoutes } from './llm-providers/registry.routes.js';
import { testingRoutes } from './llm-providers/testing.routes.js';
import { modelsCrudRoutes } from './llm-providers/models-crud.routes.js';
import { discoveryRoutes } from './llm-providers/discovery.routes.js';
import { providersLifecycleRoutes } from './llm-providers/providers-lifecycle.routes.js';
import { defaultModelsRoutes } from './llm-providers/default-models.routes.js';

const llmProviderRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;

  if (!opts.providerManager) {
    logger.warn('ProviderManager not provided - LLM provider routes will return mock data');
  }

  // Forward ONLY the singleton ProviderManager to every sub-plugin (the SAME
  // instance admin CRUD must reload so chat-side caches invalidate). We
  // deliberately do NOT forward the whole `opts` object: a caller may pass a
  // `prefix` in opts (Fastify includes it there), and re-forwarding it would
  // double-apply the prefix to each sub-plugin. The prefix is already in force
  // via this plugin's own encapsulation, which the sub-plugins inherit.
  const subOpts: ProviderRoutesOptions = { providerManager: opts.providerManager };

  await fastify.register(providersCrudRoutes, subOpts);
  await fastify.register(registryRoutes, subOpts);
  await fastify.register(testingRoutes, subOpts);
  await fastify.register(modelsCrudRoutes, subOpts);
  await fastify.register(discoveryRoutes, subOpts);
  await fastify.register(providersLifecycleRoutes, subOpts);
  await fastify.register(defaultModelsRoutes, subOpts);
};

// ── Public seam — preserve every symbol other modules / tests import from this
//    path. `isEmbeddingOnlyModel` + `sanitizeProviderModelConfig` are pure
//    helpers consumed by the route handlers AND unit-tested via this path. ──
export { isEmbeddingOnlyModel } from './llm-providers/testing.routes.js';
export { sanitizeProviderModelConfig } from './llm-providers/providers-crud.routes.js';

export default llmProviderRoutes;
