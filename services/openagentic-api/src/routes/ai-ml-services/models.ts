/**
 * Model Management and Discovery Routes
 *
 * SoT: `model_role_assignments` (the model registry) + `llm_providers` (the
 * provider registry). Per #915, this route enumerates the model SoT, joins
 * provider metadata, and groups multi-role rows into one entry per (model,
 * provider) with `roles[]` populated.
 *
 * Fallback order (only when registry is empty):
 *   1. ProviderManager runtime discovery (legacy compat)
 *   2. Environment variables (oldest legacy path)
 *
 * @see {@link https://docs.openagentic.io/api/ai-ml-services/models}
 */

import { FastifyPluginAsync } from 'fastify';
import type { ProviderManager } from '../../services/llm-providers/ProviderManager.js';

export interface ModelsRouteOptions {
  providerManager?: ProviderManager;
}

interface ModelRowGrouped {
  id: string;
  name: string;
  provider: string;
  providerId?: string;
  providerName?: string;
  providerType?: string;
  type: string;
  roles?: string[];
  capabilities: string[];
  status: string;
  description: string;
  config?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export const modelsRoutes: FastifyPluginAsync<ModelsRouteOptions> = async (fastify, options) => {
  const logger = fastify.log;
  const providerManager = options.providerManager;

  /**
   * GET /models - Returns the active model SoT.
   *
   * Reads model_role_assignments (the model SoT) and groups by (model,
   * provider). Each output row carries `roles[]` populated from the
   * grouped rows. Provider metadata joined from llm_providers by name.
   */
  fastify.get('/', async (request, reply) => {
    try {
      const models: ModelRowGrouped[] = [];
      let providerStatus = 'not_configured';

      // =========================================================================
      // PRIORITY 1: Load models from model_role_assignments (the model SoT)
      // Group by (model, provider) and join llm_providers for metadata.
      // =========================================================================
      try {
        const { prisma } = await import('../../utils/prisma.js');

        const assignments = await (prisma as any).modelRoleAssignment.findMany({
          where: { enabled: true },
          orderBy: { priority: 'asc' },
        });

        if (assignments.length > 0) {
          const dbProviders = await prisma.lLMProvider.findMany({
            where: { enabled: true, deleted_at: null },
          });
          const providerByName = new Map<string, typeof dbProviders[number]>();
          for (const p of dbProviders) providerByName.set(p.name, p);

          // Group assignments by (provider, model). Each (provider, model)
          // pair becomes ONE output row with roles[] collected.
          const grouped = new Map<string, ModelRowGrouped>();
          for (const a of assignments as Array<{
            role: string;
            model: string;
            provider: string;
            capabilities?: any;
          }>) {
            const provRow = providerByName.get(a.provider);
            if (!provRow) continue; // skip orphaned model rows
            const key = `${a.provider}::${a.model}`;
            const caps = (a.capabilities || {}) as Record<string, unknown>;
            const existing = grouped.get(key);
            if (existing) {
              if (!existing.roles.includes(a.role)) existing.roles.push(a.role);
              continue;
            }
            const capList = [
              'text',
              'chat',
              caps.tools !== false ? 'function_calling' : null,
              caps.vision ? 'vision' : null,
              caps.tools !== false ? 'tool_use' : null,
              caps.embeddings ? 'embeddings' : null,
              caps.streaming ? 'streaming' : null,
            ].filter((v): v is string => Boolean(v));
            grouped.set(key, {
              id: a.model,
              name: a.model,
              provider: provRow.provider_type,
              providerId: provRow.id,
              providerName: provRow.name,
              providerType: provRow.provider_type,
              type: 'chat',
              roles: [a.role],
              capabilities: capList,
              status: 'active',
              description: `${provRow.display_name || provRow.name} :: ${a.model}`,
              config: (provRow.model_config as Record<string, unknown>) || {},
              metadata: {
                created: provRow.created_at?.getTime() || Date.now(),
                owned_by: provRow.provider_type,
                model_id: a.model,
                source: 'registry',
              },
            });
          }
          for (const row of grouped.values()) models.push(row);
          if (models.length > 0) providerStatus = 'database';
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