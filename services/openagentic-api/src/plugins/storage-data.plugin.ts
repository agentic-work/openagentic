/**
 * Storage-Data Routes Plugin — Phase 3.3 of server.ts decomposition.
 *
 * Groups all storage-data-domain route registrations behind a single Fastify
 * plugin export.  Five sub-routes are registered here:
 *
 *  1. storageRoutes        — secure token/data storage (Vault-backed)
 *                             prefix: '' (absolute paths: /api/storage/*)
 *  2. imageRoutes          — Milvus-backed image storage with semantic search
 *                             prefix: '' (absolute paths: /api/images/*)
 *  3. faviconRoutes        — air-gap-safe favicon proxy with Redis cache
 *                             prefix: '' (absolute path: /api/favicon)
 *  4. fileAttachmentPlugin — file upload + processing endpoints
 *                             prefix: /api/files
 *  5. dataSourceRoutes     — data source CRUD (Postgres-backed)
 *                             prefix: /api (routes at /api/data-sources)
 *
 * Each sub-registration is wrapped in an INDEPENDENT try/catch block so a
 * partial mount failure logs accurately instead of masking the others (Phase
 * 3.1 lesson #4: split into independent try/catch per mount).
 *
 * None of the five route modules require constructor-time deps from AppContext —
 * they pull Prisma, vaultService, ImageStorageService, redis, etc. via
 * module-level singletons.  The StorageDataRoutesPluginOptions interface is
 * therefore empty but exported (per Phase 3.1 lesson #6) so callers can pass
 * future overrides without a breaking change.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import storageRoutes from '../routes/storage.js';
import { imageRoutes } from '../routes/images.js';
import { faviconRoutes } from '../routes/favicon.js';
import { fileAttachmentPlugin } from '../routes/file-attachment/index.js';
import dataSourceRoutes from '../routes/data-sources.js';

/**
 * Options for the storage-data routes plugin.
 *
 * Currently empty: all five sub-routes obtain their deps (Prisma, vaultService,
 * ImageStorageService, redis, DataSourceService) via module-level singletons, so
 * no constructor injection is needed.  Exported for caller extensibility without
 * a breaking API change.
 */
export interface StorageDataRoutesPluginOptions {
  // Reserved for future dep overrides (e.g. stubbed Prisma in integration tests).
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const storageDataRoutesPluginImpl: FastifyPluginAsync<StorageDataRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: StorageDataRoutesPluginOptions,
) => {
  loggers.routes.info('Registering storage-data routes plugin...');

  // ── 1. Storage routes ────────────────────────────────────────────────────
  // Provides secure storage operations: token management, encrypted data
  // storage, HashiCorp Vault and Azure Key Vault integration.
  // Routes defined internally at /api/storage/* — no prefix needed.
  try {
    await fastify.register(storageRoutes, { prefix: '' });
    loggers.routes.info('Storage routes registered at /api/storage/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register storage routes');
  }

  // ── 2. Image routes ──────────────────────────────────────────────────────
  // Milvus-backed image storage with semantic search capabilities.
  // Routes defined internally at /api/images/* — no prefix needed.
  try {
    await fastify.register(imageRoutes, { prefix: '' });
    loggers.routes.info('Image routes registered at /api/images/* (Milvus vector storage with semantic search)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register image routes');
  }

  // ── 3. Favicon proxy route ───────────────────────────────────────────────
  // Air-gap-safe favicon fetcher with Redis caching (24h TTL).
  // Route defined internally at /api/favicon — no prefix needed.
  // See openagentic#330 (Tier 3).
  try {
    await fastify.register(faviconRoutes, { prefix: '' });
    loggers.routes.info('Favicon proxy registered at /api/favicon (Redis-cached, airgap-safe)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register favicon proxy route');
  }

  // ── 4. File & Attachment Services routes ─────────────────────────────────
  // File upload, processing, and management endpoints.
  // Prefix: /api/files → routes at /api/files/*.
  try {
    await fastify.register(fileAttachmentPlugin, { prefix: '/api/files' });
    loggers.routes.info('File & Attachment Services routes registered at /api/files/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register file attachment routes');
  }

  // ── 5. Data Source routes ────────────────────────────────────────────────
  // CRUD endpoints for managing user data sources (Postgres-backed).
  // Prefix: /api → routes at /api/data-sources/*.
  try {
    await fastify.register(dataSourceRoutes, { prefix: '/api' });
    loggers.routes.info('Data Source routes registered at /api/data-sources/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register data source routes');
  }

  loggers.routes.info('Storage-data routes plugin registered successfully');
};

export const storageDataRoutesPlugin = fp(storageDataRoutesPluginImpl, {
  name: 'storage-data-routes',
  // AppContext decoration ordering is guaranteed by caller (server.ts decorateApp
  // runs before plugin registration), not by this field.
  dependencies: [],
});
