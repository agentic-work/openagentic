/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Models Routes - API v1
 *
 * Endpoints for listing and querying available LLM models.
 *
 * @module routes/v1/models
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { loggers } from '../../utils/logger.js';

/**
 * Models Routes Plugin
 */
export const modelsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/v1/models
   * List all available models
   */
  fastify.get('/', {
    preHandler: authMiddleware,
    schema: {
      tags: ['Models'],
      summary: 'List available models',
      description: 'Returns all LLM models available through configured providers'
      // Response schema removed - providers return different formats
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get provider manager from global
      const providerManager = (global as any).providerManager;

      if (!providerManager) {
        return reply.send({
          models: [],
          message: 'Provider manager not initialized'
        });
      }

      // Get available models from all providers
      const models = await providerManager.listModels();

      return reply.send({ models });
    } catch (error) {
      logger.error({ err: error }, '[Models v1] Failed to list models');
      return reply.code(500).send({
        error: 'Failed to list models',
        message: error.message
      });
    }
  });

  /**
   * GET /api/v1/models/:id
   * Get model details
   */
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: authMiddleware,
    schema: {
      tags: ['Models'],
      summary: 'Get model details',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const providerManager = (global as any).providerManager;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'Provider manager not available'
        });
      }

      const model = await providerManager.getModel(id);

      if (!model) {
        return reply.code(404).send({
          error: 'Model not found',
          modelId: id
        });
      }

      return reply.send({ model });
    } catch (error) {
      logger.error({ err: error, modelId: id }, '[Models v1] Failed to get model');
      return reply.code(500).send({
        error: 'Failed to get model details',
        message: error.message
      });
    }
  });

  /**
   * GET /api/v1/models/capabilities
   * Get model capabilities matrix
   */
  fastify.get('/capabilities', {
    preHandler: authMiddleware,
    schema: {
      tags: ['Models'],
      summary: 'Get model capabilities',
      description: 'Returns capabilities matrix for all models'
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const providerManager = (global as any).providerManager;

      if (!providerManager) {
        return reply.send({
          capabilities: {},
          message: 'Provider manager not initialized'
        });
      }

      const capabilities = await providerManager.getCapabilities();

      return reply.send({ capabilities });
    } catch (error) {
      logger.error({ err: error }, '[Models v1] Failed to get capabilities');
      return reply.code(500).send({
        error: 'Failed to get capabilities',
        message: error.message
      });
    }
  });

  logger.info('✅ Models v1 routes registered');
};

export default modelsRoutes;
