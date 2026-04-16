/**
 * Admin Tiered Function Calling Routes
 *
 * Provides endpoints for managing tiered function calling configuration:
 * - GET /api/admin/tiered-fc - Get current configuration
 * - PUT /api/admin/tiered-fc - Update configuration
 * - GET /api/admin/tiered-fc/stats - Get cache statistics
 * - POST /api/admin/tiered-fc/clear-cache - Clear decision cache
 *
 * All models are configurable via this API (no hardcoded fallbacks).
 * Changes are stored in SystemConfiguration table and take effect immediately.
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  TieredFunctionCallingService,
  getTieredFunctionCallingService,
  initializeTieredFunctionCalling,
  TieredFunctionCallingConfig
} from '../services/TieredFunctionCallingService.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

interface ConfigUpdateBody {
  cheapModel?: string;
  balancedModel?: string;
  premiumModel?: string;
  toolStrippingEnabled?: boolean;
  decisionCacheEnabled?: boolean;
  decisionCacheTtlSeconds?: number;
}

export const adminTieredFunctionCallingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Ensure service is initialized
  const getService = (): TieredFunctionCallingService => {
    let service = getTieredFunctionCallingService();
    if (!service) {
      service = initializeTieredFunctionCalling(logger, prisma);
    }
    return service;
  };

  /**
   * GET /api/admin/tiered-fc
   * Get current tiered function calling configuration
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getService();
      const config = await service.getConfig();
      const stats = service.getCacheStats();

      return reply.send({
        config: {
          cheapModel: config.cheapModel || null,
          balancedModel: config.balancedModel || null,
          premiumModel: config.premiumModel || null,
          toolStrippingEnabled: config.toolStrippingEnabled,
          decisionCacheEnabled: config.decisionCacheEnabled,
          decisionCacheTtlSeconds: config.decisionCacheTtlSeconds,
        },
        cacheStats: stats,
        tiers: {
          cheap: {
            sliderRange: '0-40%',
            model: config.cheapModel || '(default model)',
            description: 'Fast, low-cost models for simple function calls',
            // Models configured via env vars (ECONOMICAL_MODEL, CHEAP_MODEL)
            recommended: [process.env.ECONOMICAL_MODEL || process.env.CHEAP_MODEL || 'See env config'].filter(Boolean)
          },
          balanced: {
            sliderRange: '41-60%',
            model: config.balancedModel || '(default model)',
            description: 'Good accuracy, moderate cost',
            // Models configured via env vars (BALANCED_MODEL, DEFAULT_MODEL)
            recommended: [process.env.BALANCED_MODEL || process.env.DEFAULT_MODEL || 'See env config'].filter(Boolean)
          },
          premium: {
            sliderRange: '61-100%',
            model: config.premiumModel || '(default model)',
            description: 'Best accuracy, higher cost',
            // Models configured via env vars (PREMIUM_MODEL)
            recommended: [process.env.PREMIUM_MODEL || 'See env config'].filter(Boolean)
          }
        },
        features: {
          toolStripping: {
            enabled: config.toolStrippingEnabled,
            description: 'Strip tools from requests when message doesn\'t need them. Saves ~2000+ tokens per pure chat request.'
          },
          decisionCaching: {
            enabled: config.decisionCacheEnabled,
            ttlSeconds: config.decisionCacheTtlSeconds,
            description: 'Cache function calling decisions to avoid repeated analysis'
          }
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[TieredFC] Failed to get configuration');
      return reply.code(500).send({
        error: 'Failed to get tiered function calling configuration',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/admin/tiered-fc
   * Update tiered function calling configuration
   */
  fastify.put<{ Body: ConfigUpdateBody }>('/', async (request, reply) => {
    try {
      const service = getService();
      const updates = request.body;

      // Validate model names if provided (basic validation)
      const modelFields = ['cheapModel', 'balancedModel', 'premiumModel'] as const;
      for (const field of modelFields) {
        if (updates[field] !== undefined && typeof updates[field] !== 'string') {
          return reply.code(400).send({
            error: 'Invalid configuration',
            message: `${field} must be a string`
          });
        }
      }

      // Get previous config for audit
      const previousConfig = await service.getConfig();

      // Update config
      await service.updateConfig(updates);

      // Get new config
      const newConfig = await service.getConfig();

      logger.info({
        previousConfig,
        newConfig,
        updates
      }, '[TieredFC] Configuration updated');

      return reply.send({
        success: true,
        config: newConfig,
        previousConfig,
        message: 'Tiered function calling configuration updated successfully'
      });
    } catch (error: any) {
      logger.error({ error }, '[TieredFC] Failed to update configuration');
      return reply.code(500).send({
        error: 'Failed to update tiered function calling configuration',
        message: error.message
      });
    }
  });

  /**
   * GET /api/admin/tiered-fc/stats
   * Get cache statistics
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getService();
      const stats = service.getCacheStats();

      return reply.send({
        cache: stats,
        description: 'Function call decision cache statistics'
      });
    } catch (error: any) {
      logger.error({ error }, '[TieredFC] Failed to get stats');
      return reply.code(500).send({
        error: 'Failed to get statistics',
        message: error.message
      });
    }
  });

  /**
   * POST /api/admin/tiered-fc/clear-cache
   * Clear the decision cache
   */
  fastify.post('/clear-cache', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const service = getService();
      const statsBefore = service.getCacheStats();

      service.clearCache();

      const statsAfter = service.getCacheStats();

      logger.info({
        entriesCleared: statsBefore.size
      }, '[TieredFC] Cache cleared');

      return reply.send({
        success: true,
        entriesCleared: statsBefore.size,
        cacheNowEmpty: statsAfter.size === 0,
        message: `Cleared ${statsBefore.size} cached function call decisions`
      });
    } catch (error: any) {
      logger.error({ error }, '[TieredFC] Failed to clear cache');
      return reply.code(500).send({
        error: 'Failed to clear cache',
        message: error.message
      });
    }
  });

  /**
   * POST /api/admin/tiered-fc/test
   * Test the function calling decision for a given message
   */
  fastify.post<{
    Body: {
      message: string;
      toolCount?: number;
      sliderPosition?: number;
    }
  }>('/test', async (request, reply) => {
    try {
      const service = getService();
      const { message, toolCount = 10, sliderPosition = 50 } = request.body;

      if (!message) {
        return reply.code(400).send({
          error: 'Missing required field: message'
        });
      }

      // Create mock tools array
      const mockTools = Array.from({ length: toolCount }, (_, i) => ({
        function: { name: `mock_tool_${i}` }
      }));

      // Create mock slider config
      const mockSliderConfig = {
        position: sliderPosition,
        costWeight: 1 - (sliderPosition / 100),
        qualityWeight: sliderPosition / 100,
        enableThinking: sliderPosition > 40,
        enableCascading: sliderPosition > 60,
        maxThinkingBudget: sliderPosition <= 40 ? 0 : sliderPosition <= 60 ? 8000 : 16000,
        source: 'default' as const  // Use 'default' for test mock config
      };

      const decision = await service.makeDecision(message, mockTools, mockSliderConfig);

      return reply.send({
        input: {
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
          toolCount,
          sliderPosition
        },
        decision: {
          requiresTools: decision.requiresTools,
          selectedModel: decision.selectedModel || '(use default)',
          tier: decision.tier,
          stripTools: decision.stripTools,
          reasoning: decision.reasoning,
          cachedDecision: decision.cachedDecision
        },
        costSavings: decision.stripTools
          ? 'Estimated ~2000+ tokens saved by stripping tools'
          : 'Tools included in request'
      });
    } catch (error: any) {
      logger.error({ error }, '[TieredFC] Failed to test decision');
      return reply.code(500).send({
        error: 'Failed to test function calling decision',
        message: error.message
      });
    }
  });

  // Cleanup on server shutdown
  fastify.addHook('onClose', async () => {
    const service = getTieredFunctionCallingService();
    if (service) {
      service.shutdown();
    }
  });
};

export default adminTieredFunctionCallingRoutes;
