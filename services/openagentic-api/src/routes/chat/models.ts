/**
 * Chat Models API Route
 *
 * Returns ALL available models from DATABASE FIRST, then ProviderManager.
 * The llm_providers table is the source of truth for available models.
 *
 * Priority Order:
 * 1. Database llm_providers table (admin-configured providers)
 * 2. ProviderManager (runtime-discovered models)
 * 3. Environment variables (legacy fallback only)
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../../middleware/unifiedAuth.js';
import { IChatStorageService } from './index.js';
import { logger } from '../../utils/logger.js';

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: string[];
  isAvailable: boolean;
  type: 'chat' | 'embedding' | 'image' | 'vision';
  thinking?: boolean;
  cost?: {
    input: number;
    output: number;
  };
}

/**
 * Get available chat models - DATABASE FIRST approach
 */
export async function getModelsHandler(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  chatStorage: IChatStorageService
): Promise<void> {
  try {
    const models: ModelInfo[] = [];
    const providerManager = (global as any).providerManager;
    let providerStatus = 'not_configured';

    // =========================================================================
    // PRIORITY 1: Load models from DATABASE (llm_providers table)
    // This is the source of truth for admin-configured providers
    // ALSO calls provider.listModels() to get ALL configured models (e.g., AWS_BEDROCK_AVAILABLE_MODELS)
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
        request.log.info({ count: dbProviders.length }, '[CHAT-MODELS] Loading models from database llm_providers table');
        providerStatus = 'database';

        const addedModelIds = new Set<string>();

        for (const dbProvider of dbProviders) {
          const capabilities = dbProvider.capabilities as any || {};
          const modelConfig = dbProvider.model_config as any || {};
          const providerConfig = dbProvider.provider_config as any || {};
          const disabledModels: string[] = Array.isArray(modelConfig.disabledModels) ? modelConfig.disabledModels : [];

          // Check if this provider has chat capability
          if (capabilities.chat === false) continue;

          // =====================================================================
          // BUILD MODEL LIST FROM DATABASE ONLY — not provider.listModels()
          // Sources (in order of precedence, deduped):
          //   1. model_config routing slots (chatModel, premium, reasoning, ...)
          //   2. model_config.additionalModels[] (admin-added via Model Registry)
          //   3. provider_config.modelId (primary configured model)
          //   4. provider_config.models[] — models auto-discovered from the
          //      upstream provider's ARM/API (e.g. Azure AI Foundry deployments).
          //      Embedding + image-gen models are filtered out below.
          //      Previously excluded as "could be 50+" which concerned the OpenAI
          //      public model catalog; in practice the AIF discovery only returns
          //      deployments the user actually provisioned (usually 2-5), so
          //      surfacing them is desirable — otherwise a user has to manually
          //      Add Model for every single new foundry deployment.
          // =====================================================================
          const registryModelIds: string[] = [];
          const mc = modelConfig;
          const configFields = [
            'chatModel', 'defaultModel', 'thinkingModel',
            'premiumModel', 'ultraPremiumModel', 'economicalModel',
            'visionModel', 'toolModel', 'reasoningModel',
          ];
          for (const field of configFields) {
            if (mc[field] && typeof mc[field] === 'string') {
              registryModelIds.push(mc[field]);
            }
          }
          // Include additionalModels from model_config (admin-added via Model Registry)
          if (Array.isArray(mc.additionalModels)) {
            for (const m of mc.additionalModels) {
              if (typeof m === 'string') registryModelIds.push(m);
              else if (m?.id) registryModelIds.push(m.id);
            }
          }
          // Fallback: provider_config.modelId (primary configured model)
          if (providerConfig.modelId) {
            registryModelIds.push(providerConfig.modelId);
          }
          // Auto-discovered models from provider_config.models[] (AIF ARM discovery,
          // Bedrock foundation-model list, OpenAI /v1/models, etc.). Filtered
          // for embedding/image-gen below.
          if (Array.isArray(providerConfig.models)) {
            for (const m of providerConfig.models) {
              if (typeof m === 'string') registryModelIds.push(m);
              else if (m?.id) registryModelIds.push(m.id);
            }
          }

          // Deduplicate and filter
          const uniqueRegistryModels = [...new Set(registryModelIds)].filter(id => {
            if (!id) return false;
            if (disabledModels.includes(id)) return false;
            const lower = id.toLowerCase();
            if (lower.includes('embed') || lower.includes('embedding')) return false;
            if (lower.startsWith('imagen') || lower.includes('image-generation')) return false;
            return true;
          });

          // Get enriched model info from ProviderManager if available
          let providerModelMap = new Map<string, any>();
          if (providerManager) {
            try {
              const provider = providerManager.getProvider?.(dbProvider.name);
              if (provider && typeof provider.listModels === 'function') {
                const providerModels = await provider.listModels();
                for (const m of (providerModels || [])) {
                  providerModelMap.set(m.id, m);
                }
              }
            } catch { /* non-fatal */ }
          }

          request.log.info({
            provider: dbProvider.name,
            registryModels: uniqueRegistryModels,
          }, '[CHAT-MODELS] Using REGISTRY-ONLY models (not provider.listModels catalog)');

          for (const modelId of uniqueRegistryModels) {
            if (addedModelIds.has(modelId)) continue;
            addedModelIds.add(modelId);

            const enriched = providerModelMap.get(modelId);
            models.push({
              id: modelId,
              name: enriched?.name || modelId,
              description: `${dbProvider.display_name || dbProvider.name} - ${enriched?.name || modelId}`,
              provider: dbProvider.provider_type,
              contextWindow: enriched?.contextWindow || modelConfig.contextWindow || 128000,
              maxOutputTokens: modelConfig.maxOutputTokens || enriched?.maxTokens || 8192,
              capabilities: [
                'text',
                'chat',
                capabilities.tools !== false ? 'function-calling' : null,
                capabilities.vision ? 'vision' : null,
              ].filter(Boolean) as string[],
              isAvailable: true,
              type: 'chat',
              thinking: modelConfig.thinking || modelId.includes('claude') || modelId.includes('gemini'),
            });
          }

          // FALLBACK: If no models were found from registry, try provider_config.modelId directly
          if (uniqueRegistryModels.length === 0 && providerConfig.modelId) {
            const modelId = providerConfig.modelId;
            if (!addedModelIds.has(modelId) && !modelId.includes('embed') && !modelId.includes('embedding') && !disabledModels.includes(modelId)) {
              addedModelIds.add(modelId);
              request.log.info({
                provider: dbProvider.name,
                modelId
              }, '[CHAT-MODELS] Using configured modelId from database as fallback');

              models.push({
                id: modelId,
                name: modelId,
                description: `${dbProvider.display_name || dbProvider.name} - ${modelId}`,
                provider: dbProvider.provider_type,
                contextWindow: providerConfig.contextWindow || modelConfig.contextWindow || 128000,
                maxOutputTokens: providerConfig.maxTokens || modelConfig.maxOutputTokens || 8192,
                capabilities: [
                  'text',
                  'chat',
                  capabilities.tools !== false ? 'function-calling' : null,
                  capabilities.vision ? 'vision' : null,
                ].filter(Boolean) as string[],
                isAvailable: true, // Mark as available since it's configured in database
                type: 'chat',
                thinking: modelConfig.thinking || modelId.includes('claude') || modelId.includes('gemini')
              });
            }
          }
        }
      }
    } catch (dbError) {
      request.log.warn({ error: dbError }, '[CHAT-MODELS] Failed to load from database, continuing with other sources');
    }

    // =========================================================================
    // PRIORITY 2: Load models from ProviderManager (runtime discovery)
    // Only if database returned no models
    // =========================================================================
    if (models.length === 0 && providerManager) {
      request.log.info('[CHAT-MODELS] No database providers, fetching from ProviderManager');
      providerStatus = 'provider_manager';
      try {
        const providers = providerManager.getProviders?.() || [];
        request.log.info({ providerCount: providers.length }, '[CHAT-MODELS] Getting models from ProviderManager');

        for (const [providerName, provider] of providers) {
          try {
            if (typeof provider.listModels === 'function') {
              const providerModels = await provider.listModels();
              request.log.info({
                provider: providerName,
                modelCount: providerModels?.length || 0
              }, '[CHAT-MODELS] Got models from provider');

              for (const model of providerModels || []) {
                models.push({
                  id: model.id,
                  name: model.name || model.id,
                  description: `${providerName} - ${model.name || model.id}`,
                  provider: providerName,
                  contextWindow: model.contextWindow || 128000,
                  maxOutputTokens: model.maxOutputTokens || 8192,
                  capabilities: model.capabilities || ['chat', 'function-calling'],
                  isAvailable: true,
                  type: 'chat',
                  thinking: model.thinking || false
                });
              }
            }
          } catch (error) {
            request.log.warn({
              provider: providerName,
              error: error instanceof Error ? error.message : String(error)
            }, '[CHAT-MODELS] Failed to get models from provider');
          }
        }
      } catch (error) {
        request.log.error({ error: error instanceof Error ? error.message : String(error) },
          '[CHAT-MODELS] Failed to get providers from ProviderManager');
      }
    }

    // =========================================================================
    // PRIORITY 3: Legacy fallback to environment variables
    // Only if no database providers AND no ProviderManager models
    // =========================================================================
    if (models.length === 0) {
      request.log.info('[CHAT-MODELS] No models from database or ProviderManager, using environment config');
      providerStatus = 'env_fallback';

      // AWS Bedrock models - ONLY add models that are explicitly configured in env vars
      // NO HARDCODED MODEL IDs - they must come from environment configuration
      if (process.env.AWS_BEDROCK_ENABLED === 'true') {
        const bedrockModels = [
          process.env.AWS_BEDROCK_CHAT_MODEL && { id: process.env.AWS_BEDROCK_CHAT_MODEL, name: 'Bedrock Default' },
          process.env.ECONOMICAL_MODEL && { id: process.env.ECONOMICAL_MODEL, name: 'Economical' },
          process.env.DEFAULT_MODEL && { id: process.env.DEFAULT_MODEL, name: 'Default' },
          process.env.PREMIUM_MODEL && { id: process.env.PREMIUM_MODEL, name: 'Premium' },
          process.env.ULTRA_PREMIUM_MODEL && { id: process.env.ULTRA_PREMIUM_MODEL, name: 'Ultra Premium' },
          process.env.SECONDARY_MODEL && { id: process.env.SECONDARY_MODEL, name: 'Secondary' },
        ].filter(Boolean) as { id: string; name: string }[];

        for (const model of bedrockModels) {
          if (model.id) {
            models.push({
              id: model.id,
              name: model.name,
              description: `AWS Bedrock - ${model.name}`,
              provider: 'aws-bedrock',
              contextWindow: 200000,
              maxOutputTokens: 16000,
              capabilities: ['chat', 'function-calling', 'vision'],
              isAvailable: true,
              type: 'chat',
              thinking: model.id.includes('claude')
            });
          }
        }
      }

      // Google Vertex AI models - ONLY add models explicitly configured in env vars
      // NO HARDCODED MODEL IDs - they must come from environment configuration
      if (process.env.VERTEX_AI_ENABLED === 'true') {
        const vertexModels = [
          process.env.VERTEX_AI_CHAT_MODEL && { id: process.env.VERTEX_AI_CHAT_MODEL, name: 'Vertex AI Default' },
          process.env.VERTEX_AI_MODEL && { id: process.env.VERTEX_AI_MODEL, name: 'Vertex AI' },
          process.env.VERTEX_DEFAULT_MODEL && { id: process.env.VERTEX_DEFAULT_MODEL, name: 'Vertex Default' },
        ].filter(Boolean) as { id: string; name: string }[];

        for (const model of vertexModels) {
          models.push({
            id: model.id,
            name: model.name,
            description: `Google Vertex AI - ${model.name}`,
            provider: 'vertex-ai',
            contextWindow: 1000000,
            maxOutputTokens: 65536,
            capabilities: ['chat', 'function-calling', 'vision', 'thinking'],
            isAvailable: true,
            type: 'chat',
            thinking: true
          });
        }
      }

      // Azure AI Foundry models
      if (process.env.AIF_ENABLED === 'true') {
        const aifModel = process.env.AIF_MODEL || process.env.DEFAULT_MODEL!;
        models.push({
          id: aifModel,
          name: 'Model Router',
          description: 'Azure AI Foundry - Intelligent Model Router',
          provider: 'azure-ai-foundry',
          contextWindow: 128000,
          maxOutputTokens: 16000,
          capabilities: ['chat', 'function-calling'],
          isAvailable: true,
          type: 'chat'
        });
      }

      // Ollama models
      if (process.env.OLLAMA_ENABLED === 'true') {
        const ollamaModel = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL || process.env.DEFAULT_MODEL!;
        models.push({
          id: ollamaModel,
          name: ollamaModel,
          description: `Ollama - ${ollamaModel} (Local)`,
          provider: 'ollama',
          contextWindow: 128000,
          maxOutputTokens: 8192,
          capabilities: ['chat'],
          isAvailable: true,
          type: 'chat'
        });
      }
    }

    // Determine default model
    const defaultModelId = process.env.DEFAULT_MODEL ||
                          process.env.VERTEX_AI_MODEL ||
                          models[0]?.id || null;

    request.log.info({
      totalModels: models.length,
      defaultModel: defaultModelId,
      providers: [...new Set(models.map(m => m.provider))],
      providerStatus
    }, '[CHAT-MODELS] Returning available models');

    reply.send({
      models,
      defaultModel: defaultModelId,
      count: models.length,
      availableCount: models.filter(m => m.isAvailable).length,
      capabilities: [...new Set(models.flatMap(m => m.capabilities))].sort(),
      providers: [...new Set(models.map(m => m.provider))],
      lastUpdated: new Date(),
      provider_status: providerStatus,
      metadata: {
        dynamicDiscovery: true,
        multiProvider: true,
        source: providerStatus
      }
    });

  } catch (error) {
    request.log.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to get models');

    reply.code(500).send({
      error: {
        code: 'MODELS_ERROR',
        message: 'Failed to retrieve available models'
      }
    });
  }
}
