/**
 * Pipeline Configuration Admin Routes
 *
 * Admin routes for viewing and updating pipeline configuration.
 * Manages settings for all chat pipeline stages.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { prisma } from '../../utils/prisma.js';
import { getRedisClient } from '../../utils/redis-client.js';
import { getPipelineConfigService } from '../../services/PipelineConfigService.js';
import { PipelineConfiguration, BUILT_IN_SKILLS } from '../chat/pipeline/pipeline-config.schema.js';
import { getModelCapabilityRegistry } from '../../services/ModelCapabilityRegistry.js';

interface UpdateConfigBody {
  stages?: Partial<PipelineConfiguration['stages']>;
  [key: string]: any;
}

interface UpdateStageParams {
  stageName: string;
}

interface UpdateStageBody {
  [key: string]: any;
}

const pipelineConfigRoutes: FastifyPluginAsync = async (fastify, opts) => {
  const logger = fastify.log as Logger;

  // Get services
  const redis = getRedisClient();
  const configService = getPipelineConfigService(prisma, redis);

  /**
   * GET /api/admin/pipeline-config
   * Get current pipeline configuration
   */
  fastify.get('/pipeline-config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await configService.getConfiguration();
      // Include built-in skills in the prompt stage config
      // This allows the UI to display all available skills
      const enrichedConfig = {
        ...config,
        stages: {
          ...config.stages,
          prompt: {
            ...config.stages.prompt,
            builtInSkills: BUILT_IN_SKILLS
          }
        }
      };
      return reply.send({
        success: true,
        config: enrichedConfig
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get pipeline configuration');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch pipeline configuration',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/admin/pipeline-config
   * Update pipeline configuration (full or partial)
   */
  fastify.put<{ Body: UpdateConfigBody }>(
    '/pipeline-config',
    async (request: FastifyRequest<{ Body: UpdateConfigBody }>, reply: FastifyReply) => {
      try {
        // Get user info from request (assuming authentication middleware sets this)
        const user = (request as any).user;
        const updatedBy = user?.email || user?.id || 'admin';

        const updates = request.body;
        const config = await configService.updateConfiguration(updates as Partial<PipelineConfiguration>, updatedBy);

        logger.info({ updatedBy }, 'Pipeline configuration updated');

        return reply.send({
          success: true,
          config,
          message: 'Configuration updated successfully'
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update pipeline configuration');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update pipeline configuration',
          message: error.message
        });
      }
    }
  );

  /**
   * PATCH /api/admin/pipeline-config/stages/:stageName
   * Update a specific stage configuration
   */
  fastify.patch<{ Params: UpdateStageParams; Body: UpdateStageBody }>(
    '/pipeline-config/stages/:stageName',
    async (
      request: FastifyRequest<{ Params: UpdateStageParams; Body: UpdateStageBody }>,
      reply: FastifyReply
    ) => {
      try {
        const { stageName } = request.params;
        const stageConfig = request.body;

        // Validate stage name
        const validStages = [
          'auth', 'validation', 'rag', 'memory', 'prompt',
          'mcp', 'messagePreparation', 'completion', 'multiModel',
          'toolExecution', 'response'
        ];

        if (!validStages.includes(stageName)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid stage name',
            message: `Stage must be one of: ${validStages.join(', ')}`
          });
        }

        const user = (request as any).user;
        const updatedBy = user?.email || user?.id || 'admin';

        const config = await configService.updateStageConfig(
          stageName as keyof PipelineConfiguration['stages'],
          stageConfig,
          updatedBy
        );

        logger.info({ stageName, updatedBy }, 'Pipeline stage configuration updated');

        return reply.send({
          success: true,
          config,
          message: `Stage '${stageName}' configuration updated successfully`
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update stage configuration');
        return reply.code(400).send({
          success: false,
          error: 'Failed to update stage configuration',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/admin/pipeline-config/reset
   * Reset configuration to defaults
   */
  fastify.post('/pipeline-config/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const updatedBy = user?.email || user?.id || 'admin';

      const config = await configService.resetToDefaults(updatedBy);

      logger.info({ updatedBy }, 'Pipeline configuration reset to defaults');

      return reply.send({
        success: true,
        config,
        message: 'Configuration reset to defaults'
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to reset pipeline configuration');
      return reply.code(500).send({
        success: false,
        error: 'Failed to reset configuration',
        message: error.message
      });
    }
  });

  /**
   * GET /api/admin/pipeline-config/stages
   * Get list of available stages with descriptions
   */
  fastify.get('/pipeline-config/stages', async (request: FastifyRequest, reply: FastifyReply) => {
    const stages = [
      { name: 'auth', description: 'Authentication and authorization', order: 1 },
      { name: 'validation', description: 'Input validation and sanitization', order: 2 },
      { name: 'rag', description: 'Retrieval-Augmented Generation', order: 3 },
      { name: 'memory', description: 'Memory retrieval and injection', order: 4 },
      { name: 'prompt', description: 'Prompt template processing', order: 5 },
      { name: 'mcp', description: 'MCP tool discovery and injection', order: 6 },
      { name: 'messagePreparation', description: 'Message formatting and context window management', order: 7 },
      { name: 'completion', description: 'LLM completion request', order: 8 },
      { name: 'multiModel', description: 'Multi-model orchestration', order: 9 },
      { name: 'toolExecution', description: 'Tool call execution and synthesis', order: 10 },
      { name: 'response', description: 'Response formatting and storage', order: 11 }
    ];

    return reply.send({
      success: true,
      stages
    });
  });

  /**
   * GET /api/admin/pipeline-config/models
   * Get list of available models for pipeline configuration dropdowns
   * Dynamically fetched from ModelCapabilityRegistry - no hardcoded values
   */
  fastify.get('/pipeline-config/models', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const registry = getModelCapabilityRegistry();
      if (!registry) {
        return reply.code(503).send({
          success: false,
          error: 'Model capability registry not initialized',
          message: 'Please try again later'
        });
      }
      const allModels = registry.getAllModels();

      // Group models by provider for easier UI display
      const modelsByProvider: Record<string, Array<{
        id: string;
        displayName: string;
        provider: string;
        thinking: boolean;
        vision: boolean;
        maxContextTokens: number;
      }>> = {};

      for (const model of allModels) {
        if (!model.isAvailable) continue;

        const provider = model.provider || 'unknown';
        if (!modelsByProvider[provider]) {
          modelsByProvider[provider] = [];
        }

        modelsByProvider[provider].push({
          id: model.modelId,
          displayName: model.displayName || model.modelId,
          provider: model.provider,
          thinking: model.thinking,
          vision: model.vision,
          maxContextTokens: model.maxContextTokens
        });
      }

      // Also get slider tier recommendations for guidance
      const sliderTiers = registry.getSliderTierRecommendations();

      return reply.send({
        success: true,
        models: allModels.filter(m => m.isAvailable).map(m => ({
          id: m.modelId,
          displayName: m.displayName || m.modelId,
          provider: m.provider,
          thinking: m.thinking,
          vision: m.vision,
          maxContextTokens: m.maxContextTokens
        })),
        modelsByProvider,
        sliderTiers
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get available models');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch available models',
        message: error.message
      });
    }
  });
};

export default pipelineConfigRoutes;
