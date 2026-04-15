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
 * Model Management and Discovery Routes
 *
 * Discovers and manages available AI models from DATABASE FIRST, then ProviderManager.
 * The llm_providers table is the source of truth for available models.
 *
 * Priority Order:
 * 1. Database llm_providers table (admin-configured providers)
 * 2. ProviderManager (runtime-discovered models)
 * 3. Environment variables (legacy fallback only)
 *
 * @see {@link https://docs.openagentics.io/api/ai-ml-services/models}
 */

import { FastifyPluginAsync } from 'fastify';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface ModelsRouteOptions {
  providerManager?: ProviderManager;
}

export const modelsRoutes: FastifyPluginAsync<ModelsRouteOptions> = async (fastify, options) => {
  const logger = fastify.log;
  const providerManager = options.providerManager;

  /**
   * GET /models - Returns chat models available for the model selector
   *
   * Priority: Database > ProviderManager > Environment Variables
   * This ensures admin-configured providers are always shown first.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const models: any[] = [];
      let providerStatus = 'not_configured';

      // =========================================================================
      // PRIORITY 1: Load models from DATABASE (llm_providers table)
      // This is the source of truth for admin-configured providers
      // =========================================================================
      try {
        const { prisma } = await import('../../utils/prisma.js');

        const dbProviders = await prisma.lLMProvider.findMany({
          where: {
            enabled: true,
            deleted_at: null
          },
          orderBy: {
            priority: 'asc'
          }
        });

        if (dbProviders.length > 0) {
          logger.info({ count: dbProviders.length }, '[MODELS] Loading models from database llm_providers table');
          providerStatus = 'database';

          for (const dbProvider of dbProviders) {
            const providerConfig = dbProvider.provider_config as any || {};
            const capabilities = dbProvider.capabilities as any || {};
            const modelConfig = dbProvider.model_config as any || {};

            // Get model ID from provider config
            const modelId = providerConfig.modelId ||
                           providerConfig.model ||
                           providerConfig.deployment ||
                           dbProvider.name;

            // Check if this provider has chat capability
            if (capabilities.chat !== false) {
              models.push({
                id: modelId,
                name: dbProvider.display_name || modelId,
                provider: dbProvider.provider_type,
                providerId: dbProvider.id,
                providerName: dbProvider.name,
                type: 'chat',
                capabilities: [
                  'text',
                  'chat',
                  capabilities.tools !== false ? 'function_calling' : null,
                  capabilities.vision ? 'vision' : null,
                  capabilities.tools !== false ? 'tool_use' : null,
                ].filter(Boolean),
                status: 'active',
                description: dbProvider.description || `${dbProvider.display_name} (${dbProvider.provider_type})`,
                config: modelConfig,
                metadata: {
                  created: dbProvider.created_at?.getTime() || Date.now(),
                  owned_by: dbProvider.provider_type,
                  model_id: modelId,
                  source: 'database'
                }
              });
            }
          }
        }
      } catch (dbError) {
        logger.warn({ error: dbError }, '[MODELS] Failed to load from database, continuing with other sources');
      }

      // =========================================================================
      // PRIORITY 2: Load models from ProviderManager (runtime discovery)
      // Only if database returned no models
      // =========================================================================
      if (models.length === 0 && providerManager) {
        logger.info('[MODELS] No database providers, fetching from ProviderManager');
        providerStatus = 'provider_manager';

        try {
          const providerModels = await providerManager.listModels();

          // Filter to only include chat-capable models
          const chatModels = providerModels.filter(model => {
            const id = model.id.toLowerCase();
            const name = (model.name || '').toLowerCase();
            if (id.includes('embed') || name.includes('embed')) return false;
            if (id.includes('titan-embed')) return false;
            if (id.includes('vision') && !id.includes('chat')) return false;
            return true;
          });

          for (const model of chatModels) {
            models.push({
              id: model.id,
              name: model.name || model.id,
              provider: model.provider,
              type: 'chat',
              capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
              status: 'active',
              description: `${model.provider} model: ${model.name}`,
              metadata: {
                created: Date.now(),
                owned_by: model.provider,
                model_id: model.id,
                source: 'provider_manager'
              }
            });
          }
        } catch (pmError) {
          logger.warn({ error: pmError }, '[MODELS] ProviderManager failed');
        }
      }

      // =========================================================================
      // PRIORITY 3: Legacy fallback to environment variables
      // Only if no database providers AND no ProviderManager models
      // =========================================================================
      if (models.length === 0) {
        const availableModelsEnv = process.env.AVAILABLE_MODELS;
        const defaultModel = process.env.DEFAULT_MODEL;

        if (availableModelsEnv) {
          logger.info('[MODELS] Using legacy AVAILABLE_MODELS environment variable');
          providerStatus = 'env_fallback';

          const allowedModels = availableModelsEnv.split(',').map(m => m.trim()).filter(m => m);
          for (const modelId of allowedModels) {
            models.push({
              id: modelId,
              name: modelId,
              provider: determineProvider(modelId),
              type: 'chat',
              capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
              status: 'active',
              description: `Chat model: ${modelId}`,
              metadata: {
                created: Date.now(),
                owned_by: determineProvider(modelId),
                model_id: modelId,
                source: 'environment'
              }
            });
          }
        } else if (defaultModel) {
          logger.info('[MODELS] Using legacy DEFAULT_MODEL environment variable');
          providerStatus = 'env_fallback';

          models.push({
            id: defaultModel,
            name: defaultModel,
            provider: determineProvider(defaultModel),
            type: 'chat',
            capabilities: ['text', 'chat', 'function_calling'],
            status: 'active',
            description: `Default model: ${defaultModel}`,
            metadata: {
              created: Date.now(),
              owned_by: 'system',
              model_id: defaultModel,
              source: 'environment'
            }
          });
        }
      }

      // Determine default model
      const defaultModel = process.env.DEFAULT_MODEL || models[0]?.id || null;
      const providers = [...new Set(models.map(m => m.provider))];

      logger.info({
        total: models.length,
        providers,
        defaultModel,
        providerStatus
      }, '[MODELS] Returning available models');

      return reply.send({
        models,
        total: models.length,
        providers,
        capabilities: ['text', 'chat', 'function_calling', 'vision', 'tool_use'],
        defaultModel,
        provider_status: providerStatus
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get models');

      return reply.code(500).send({
        error: 'Failed to fetch models',
        models: [],
        total: 0,
        providers: [],
        capabilities: ['text', 'chat'],
        defaultModel: process.env.DEFAULT_MODEL,
        provider_status: 'error'
      });
    }
  });

  /**
   * Helper to determine provider from model ID
   */
  function determineProvider(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.includes('gemini') || id.includes('imagen')) return 'google-vertex';
    if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'azure-openai';
    if (id.includes('claude') || id.includes('anthropic')) return 'aws-bedrock';
    if (id.includes('llama') || id.includes('qwen') || id.includes('mistral')) return 'ollama';
    return 'unknown';
  }

  /**
   * GET /models/:id - Get specific model information from Azure OpenAI
   */
  fastify.get('/:id', async (request: any, reply) => {
    try {
      const { id } = request.params;
      const azureDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL;

      // Check if requested model matches our deployment
      if (id === azureDeployment) {
        return reply.send({
          id: azureDeployment,
          object: 'model',
          created: Date.now(),
          owned_by: 'azure-openai',
          provider: 'azure-openai',
          type: 'chat',
          capabilities: ['text', 'chat', 'function_calling', 'vision'],
          status: 'active'
        });
      }

      return reply.code(404).send({
        error: 'Model not found',
        modelId: id,
        availableModels: [azureDeployment]
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get model info');
      return reply.code(500).send({
        error: 'Failed to get model information'
      });
    }
  });
};