/**
 * API v1 Router
 *
 * Central router for all v1 API endpoints.
 * Provides standardized routing under /api/v1/* namespace.
 *
 * @module routes/v1
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authMiddleware, adminMiddleware } from '../../middleware/unifiedAuth.js';
import { loggers } from '../../utils/logger.js';

/**
 * V1 API Router Plugin
 *
 * Registers all v1 routes under the /api/v1 prefix.
 * This plugin should be registered with prefix: '/api/v1'
 */
export const v1Router: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  logger.info('📚 Initializing API v1 router...');

  // ============================================================================
  // HEALTH / STATUS (No auth required)
  // ============================================================================

  fastify.get('/status', async () => {
    return {
      version: 'v1',
      status: 'operational',
      timestamp: new Date().toISOString()
    };
  });

  // ============================================================================
  // AUTH ROUTES
  // These are registered separately with their own logic
  // ============================================================================

  // ============================================================================
  // MCP ROUTES (Unified)
  // ============================================================================

  try {
    const { mcpRoutes } = await import('./mcp.js');
    await fastify.register(mcpRoutes, { prefix: '/mcp' });
    logger.info('✅ MCP routes registered at /api/v1/mcp/*');
  } catch (error) {
    logger.error({ err: error }, 'Failed to register MCP routes');
  }

  // ============================================================================
  // CHAT ROUTES
  // ============================================================================

  // Chat routes are registered directly from the main server.ts
  // as they have complex initialization requirements (storage, redis, milvus)
  // We'll add a redirect from v1 to the existing routes

  // ============================================================================
  // ADMIN ROUTES
  // ============================================================================

  // Admin routes are registered with adminMiddleware in server.ts
  // We'll consolidate them here in future iterations

  // ============================================================================
  // MODELS ROUTES
  // ============================================================================

  try {
    const { modelsRoutes } = await import('./models.js');
    await fastify.register(modelsRoutes, { prefix: '/models' });
    logger.info('✅ Models routes registered at /api/v1/models/*');
  } catch (error) {
    logger.warn({ err: error }, 'Models routes not available (optional)');
  }

  // ============================================================================
  // GITHUB OAUTH ROUTES
  // ============================================================================

  try {
    const { githubRoutes } = await import('./github.js');
    await fastify.register(githubRoutes, { prefix: '/github' });
    logger.info('✅ GitHub OAuth routes registered at /api/v1/github/*');
  } catch (error) {
    logger.warn({ err: error }, 'GitHub OAuth routes not available (optional)');
  }

  // ============================================================================
  // VECTOR SEARCH ROUTES
  // Semantic search via Milvus for CLI and other clients
  // ============================================================================

  try {
    const { vectorRoutes } = await import('./vector.js');
    await fastify.register(vectorRoutes, { prefix: '/vector' });
    logger.info('✅ Vector search routes registered at /api/v1/vector/*');
  } catch (error) {
    logger.warn({ err: error }, 'Vector search routes not available (Milvus may not be configured)');
  }

  // ============================================================================
  // OPENAI-COMPATIBLE ROUTES
  // For external integrations
  // ============================================================================

  // These are registered at /api/v1/openai/* via openai-compatible.ts
  // Note: Legacy /v1/chat/completions still works for backward compatibility

  // ============================================================================
  // WEBHOOK TRIGGER ROUTES
  // External webhook receivers that trigger workflow executions
  // ============================================================================

  try {
    const { webhookRoutes } = await import('./webhooks.js');
    await fastify.register(webhookRoutes, { prefix: '/hooks' });
    logger.info('✅ Webhook routes registered at /api/v1/hooks/*');
  } catch (error) {
    logger.warn({ err: error }, 'Webhook routes not available');
  }

  // ============================================================================
  // USER ANALYTICS ROUTES
  // Per-user tool usage statistics (non-admin, user-facing)
  // ============================================================================

  try {
    const { userAnalyticsRoutes } = await import('./user-analytics.js');
    await fastify.register(userAnalyticsRoutes, { prefix: '/me' });
    logger.info('✅ User analytics routes registered at /api/v1/me/*');
  } catch (error) {
    logger.warn({ err: error }, 'User analytics routes not available');
  }

  logger.info('✅ API v1 router initialized');
};

export default v1Router;
