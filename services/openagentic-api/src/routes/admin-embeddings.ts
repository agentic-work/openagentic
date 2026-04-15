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
 * Admin Embedding Configuration Routes
 *
 * Provides admin endpoints for managing embedding provider configuration.
 * Embedding config is stored in the LLMProvider table (providers with embeddings capability).
 *
 * Routes:
 * - GET  /api/admin/embeddings/config  — current embedding provider, model, dimensions
 * - PUT  /api/admin/embeddings/config  — update which provider/model handles embeddings
 * - POST /api/admin/embeddings/test    — test embedding generation, returns latency + dimensions
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { UniversalEmbeddingService } from '../services/UniversalEmbeddingService.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminEmbeddings' });

interface EmbeddingConfigUpdateBody {
  providerName: string;
  embeddingModel?: string;
}

const adminEmbeddingsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/admin/embeddings/config
   * Returns the current embedding configuration from DB (or env fallback)
   */
  fastify.get('/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Find the active embedding provider from DB
      const providers = await prisma.lLMProvider.findMany({
        where: { enabled: true },
        orderBy: { priority: 'asc' },
      });

      // Find the provider with embeddings capability
      let embeddingProvider = null;
      for (const p of providers) {
        const caps = p.capabilities as Record<string, any> || {};
        if (caps.embeddings === true) {
          embeddingProvider = p;
          break;
        }
      }

      // Also get current runtime config from UniversalEmbeddingService
      let runtimeInfo: any = null;
      try {
        const svc = new UniversalEmbeddingService(logger);
        runtimeInfo = svc.getInfo();
      } catch { /* env may not be configured */ }

      if (embeddingProvider) {
        const modelConfig = embeddingProvider.model_config as Record<string, any> || {};
        const providerConfig = embeddingProvider.provider_config as Record<string, any> || {};
        return reply.send({
          source: 'database',
          providerName: embeddingProvider.name,
          providerType: embeddingProvider.provider_type,
          embeddingModel: modelConfig.embeddingModel || runtimeInfo?.model || 'unknown',
          dimensions: runtimeInfo?.dimensions || providerConfig.embeddingDimensions || null,
          baseUrl: providerConfig.baseUrl || providerConfig.endpoint || null,
          region: providerConfig.region || providerConfig.location || null,
          runtime: runtimeInfo,
        });
      }

      // No DB provider with embeddings — fall back to runtime config
      if (runtimeInfo) {
        return reply.send({
          source: 'environment',
          providerName: null,
          providerType: runtimeInfo.provider,
          embeddingModel: runtimeInfo.model,
          dimensions: runtimeInfo.dimensions,
          runtime: runtimeInfo,
        });
      }

      return reply.code(404).send({ error: 'No embedding provider configured' });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get embedding config');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/embeddings/config
   * Update which provider handles embeddings and optionally the model name
   */
  fastify.put('/config', async (request: FastifyRequest<{ Body: EmbeddingConfigUpdateBody }>, reply: FastifyReply) => {
    try {
      const { providerName, embeddingModel } = request.body;

      if (!providerName) {
        return reply.code(400).send({ error: 'providerName is required' });
      }

      // Find the target provider
      const provider = await prisma.lLMProvider.findUnique({
        where: { name: providerName },
      });

      if (!provider) {
        return reply.code(404).send({ error: `Provider "${providerName}" not found` });
      }

      // Update the provider's capabilities to include embeddings
      const caps = provider.capabilities as Record<string, any> || {};
      caps.embeddings = true;

      const modelConfig = provider.model_config as Record<string, any> || {};
      if (embeddingModel) {
        modelConfig.embeddingModel = embeddingModel;
      }

      await prisma.lLMProvider.update({
        where: { name: providerName },
        data: {
          capabilities: caps,
          model_config: modelConfig,
        },
      });

      // Optionally remove embeddings capability from other providers
      const otherProviders = await prisma.lLMProvider.findMany({
        where: { name: { not: providerName } },
      });
      for (const other of otherProviders) {
        const otherCaps = other.capabilities as Record<string, any> || {};
        if (otherCaps.embeddings === true) {
          otherCaps.embeddings = false;
          await prisma.lLMProvider.update({
            where: { name: other.name },
            data: { capabilities: otherCaps },
          });
        }
      }

      logger.info({ providerName, embeddingModel }, 'Embedding config updated');
      return reply.send({
        success: true,
        providerName,
        embeddingModel: modelConfig.embeddingModel,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update embedding config');
      return reply.code(500).send({ error: error.message });
    }
  });

  /**
   * POST /api/admin/embeddings/test
   * Test embedding generation with current config
   */
  fastify.post('/test', async (_request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    try {
      const svc = new UniversalEmbeddingService(logger);
      const info = svc.getInfo();

      const result = await svc.generateEmbedding('This is a test embedding for admin verification.');
      const latencyMs = Date.now() - startTime;

      return reply.send({
        success: true,
        provider: info.provider,
        model: info.model,
        dimensions: result.dimensions,
        embeddingLength: result.embedding.length,
        latencyMs,
        sampleValues: result.embedding.slice(0, 5),
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error({ error: error.message, latencyMs }, 'Embedding test failed');
      return reply.code(500).send({
        success: false,
        error: error.message,
        latencyMs,
      });
    }
  });
};

export default adminEmbeddingsRoutes;
