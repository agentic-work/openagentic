/**
 * Admin model discovery / catalog / SDK-option routes.
 *
 *   GET    /llm-providers/:nameOrId/discover-models
 *   GET    /llm-providers/ollama-instance/models
 *   POST   /llm-providers/ollama-instance/models/pull
 *   DELETE /llm-providers/ollama/models/:model
 *   GET    /llm-providers/vertex-ai/catalog
 *   GET    /llm-providers/model-capabilities
 *   GET    /llm-providers/model-capabilities/:modelId
 *   GET    /llm-providers/discovery/status
 *   GET    /llm-providers/sdk-options
 *   GET    /llm-providers/:providerName/model-defaults/:modelId
 *   POST   /llm-providers/discover
 *   GET    /llm-providers/available-models
 *
 * NOTE: the vertex-ai/catalog + available-models handlers carry curated model-id
 * literals (UI catalog data) — allow-listed in the no-hardcoded-models cage.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import { Prisma } from '@prisma/client';
import { ProviderManager, invalidateAllModelCaches } from '../../../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../../../services/llm-providers/ProviderConfigService.js';
import { encryptAuthConfig, decryptAuthConfig } from '../../../services/llm-providers/CredentialEncryptionService.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../../../utils/auditTrail.js';
import { credentialAuditService } from '../../../services/CredentialAuditService.js';
import { OllamaProvider } from '../../../services/llm-providers/OllamaProvider.js';
import { AWSBedrockProvider } from '../../../services/llm-providers/AWSBedrockProvider.js';
import { AzureOpenAIProvider } from '../../../services/llm-providers/AzureOpenAIProvider.js';
import { GoogleVertexProvider } from '../../../services/llm-providers/GoogleVertexProvider.js';
import { AnthropicProvider } from '../../../services/llm-providers/AnthropicProvider.js';
import { OpenAIProvider } from '../../../services/llm-providers/OpenAIProvider.js';
import { AzureAIFoundryProvider } from '../../../services/llm-providers/AzureAIFoundryProvider.js';
import type { ProviderDefaultConfig } from '../../../services/llm-providers/ILLMProvider.js';
import type { ModelDiscoveryRecord } from '../../../services/llm-providers/discovery/ModelDiscoveryRecord.js';
import {
  upsertDiscoveredModels,
  type RegistryUpsertPrismaLike,
} from '../../../services/model-routing/RegistryUpsertService.js';
import { shouldAutoSyncRegistry } from '../../../services/model-routing/registryAutoSyncPolicy.js';
import { PricingService } from '../../../services/pricing/PricingService.js';
import {
  validateDiscriminator,
  isGenericName,
  buildAutoDisplayName,
} from '../../../services/llm-providers/ProviderDiscriminatorSchema.js';
import { asJson, asRecord } from './shared.js';
import type {
  ProviderRoutesOptions,
  ProviderConfigBag,
  AuthConfigBag,
  ModelConfigBag,
  ModelLike,
  ProviderRuntime,
} from './types.js';


export const discoveryRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  /**
   * GET /api/admin/llm-providers/:nameOrId/discover-models
   * Discover available models from a provider's SDK/API
   * Accepts either provider name or database UUID
   */
  fastify.get<{
    Params: { nameOrId: string };
  }>('/llm-providers/:nameOrId/discover-models', async (request, reply) => {
    const { nameOrId } = request.params;
    try {
      // Resolve provider by name or ID
      const { prisma } = await import('../../../utils/prisma.js');

      // Try by UUID first, then by name
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
      const dbRecord = isUuid
        ? await prisma.lLMProvider.findFirst({ where: { id: nameOrId, deleted_at: null } })
        : await prisma.lLMProvider.findFirst({ where: { name: nameOrId, deleted_at: null } });

      if (!dbRecord) {
        return reply.code(404).send({ error: 'Provider not found', message: `Provider '${nameOrId}' not found` });
      }

      // Try to use the in-memory provider first
      let models: ModelLike[] = [];

      if (providerManager?.hasProvider(dbRecord.name)) {
        const provider = (providerManager as unknown as { providers?: Map<string, ProviderRuntime> }).providers?.get(dbRecord.name);
        if (provider) {
          // Prefer discoverModels() for Model Garden (returns full catalog), fall back to listModels()
          if (typeof provider.discoverModels === 'function') {
            models = (await provider.discoverModels()) as ModelLike[];
          } else if (typeof provider.listModels === 'function') {
            models = (await provider.listModels()) as ModelLike[];
          }
        }
      } else {
        // Create a temp provider instance
        const providerType = dbRecord.provider_type;
        const authConfig = decryptAuthConfig(dbRecord.auth_config) || {};
        const providerConfig = (dbRecord.provider_config as ProviderConfigBag) || {};

        let tempProvider: ProviderRuntime | null = null;
        if (providerType === 'ollama') {
          tempProvider = new OllamaProvider(logger);
        } else if (providerType === 'aws-bedrock') {
          tempProvider = new AWSBedrockProvider(logger);
        } else if (providerType === 'vertex-ai' || providerType === 'google-vertex') {
          tempProvider = new GoogleVertexProvider(logger);
        } else if (providerType === 'azure-openai') {
          tempProvider = new AzureOpenAIProvider(logger);
        } else if (providerType === 'anthropic') {
          tempProvider = new AnthropicProvider(logger);
        } else if (providerType === 'openai') {
          tempProvider = new OpenAIProvider(logger);
        } else if (providerType === 'azure-ai-foundry') {
          tempProvider = new AzureAIFoundryProvider(logger);
        }

        if (tempProvider) {
          try {
            await tempProvider.initialize({ ...authConfig, ...providerConfig });
            // Prefer discoverModels() for Model Garden, fall back to listModels()
            if (typeof tempProvider.discoverModels === 'function') {
              models = (await tempProvider.discoverModels()) as ModelLike[];
            } else {
              models = (await tempProvider.listModels()) as ModelLike[];
            }
          } catch (initErr) {
            logger.warn({ error: initErr, provider: dbRecord.name }, 'Failed to initialize temp provider for model discovery');
          }
        }
      }

      // (#73) STALENESS FIX: only merge SystemConfiguration stored models when
      // live SDK discovery returned ZERO results. The previous behavior
      // ALWAYS appended stored models, which caused models the admin removed
      // from the provider's own console (Azure portal, AWS console) to keep
      // appearing here forever — because they were also stored via the
      // legacy POST /models flow.
      //
      // For providers with working discoverModels() (which is now all of
      // them: AIF, Bedrock, Vertex, OpenAI, Anthropic, Ollama), the SDK is
      // the single source of truth. SystemConfiguration is only consulted
      // as a defensive fallback when discovery returns empty (e.g., transient
      // 5xx from the provider).
      if (models.length === 0) {
        try {
          const { prisma: prisma2 } = await import('../../../utils/prisma.js');
          const configKey = `llm_provider_${dbRecord.name}_models`;
          const storedConfig = await prisma2.systemConfiguration.findFirst({ where: { key: configKey } });
          if (storedConfig?.value) {
            const storedModels = (storedConfig.value as unknown as { models?: ModelLike[] }).models || [];
            for (const sm of storedModels) {
              if (sm.id) {
                models.push({
                  id: sm.id,
                  name: sm.name || sm.id,
                  provider: dbRecord.name,
                  ...(sm.capabilities && { capabilities: sm.capabilities }),
                  ...(sm.maxTokens && { maxTokens: sm.maxTokens }),
                  ...(sm.contextWindow && { contextWindow: sm.contextWindow }),
                  ...(sm.description && { description: sm.description }),
                } as ModelLike);
              }
            }
            logger.warn(
              { provider: dbRecord.name, fellBackToStored: storedModels.length },
              'Live discovery returned empty — fell back to SystemConfiguration. Provider may be unreachable.'
            );
          }
        } catch (mergeErr) {
          logger.debug({ error: mergeErr }, 'Failed to load SystemConfiguration fallback (non-fatal)');
        }
      }

      // Enrich models with tier classification
      function guessTier(modelId: string): 'economy' | 'balanced' | 'premium' {
        const m = modelId.toLowerCase();
        if (m.includes('opus') || m.includes('o1') || m.includes('o3') || m.includes('ultra') || m.includes('pro')) return 'premium';
        if (m.includes('haiku') || m.includes('mini') || m.includes('flash') || m.includes('lite') || m.includes('nano') || m.includes('small') || m.includes('embed') || m.includes('titan-text-lite')) return 'economy';
        return 'balanced';
      }

      const enrichedModels = models.map((m) => ({
        ...m,
        tier: m.tier || guessTier(m.id || m.name || ''),
      }));

      // Registry policy (user-directed): ONLY admin-added models live in
      // provider_config.models[]. The /discover response is a READ-ONLY
      // catalog view for the UI's Add-Model dropdown — it MUST NOT write
      // back to the registry. Previously this endpoint auto-persisted the
      // full discovered catalog (117 entries for Bedrock alone) which
      // bypassed the explicit-add gate. Registry remains authoritative.
      //
      // Stamp a lastDiscoveryAt so the UI can show "catalog refreshed X
      // min ago" without touching the models array itself.
      (async () => {
        try {
          const existingConfig = (dbRecord.provider_config as ProviderConfigBag) || {};
          await prisma.lLMProvider.update({
            where: { id: dbRecord.id },
            data: {
              provider_config: {
                ...existingConfig,
                lastDiscoveryAt: new Date().toISOString(),
              },
            } as unknown as Prisma.LLMProviderUpdateInput,
          });
        } catch (persistErr) {
          logger.warn({ error: persistErr, provider: dbRecord.name }, 'Failed to stamp lastDiscoveryAt (non-fatal)');
        }
      })();

      return reply.send({
        provider: dbRecord.name,
        providerId: dbRecord.id,
        providerType: dbRecord.provider_type,
        models: enrichedModels.map((m) => m.id || m.name),
        modelDetails: enrichedModels,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, provider: nameOrId }, 'Failed to discover models');
      return reply.code(500).send({
        error: 'Model discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/ollama-instance/models
   * List all models currently available in Ollama
   */
  fastify.get('/llm-providers/ollama-instance/models', async (request, reply) => {
    try {
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error('Failed to fetch Ollama models');

      const data = await res.json();

      return reply.send({
        models: data.models || [],
        totalModels: data.models?.length || 0
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list Ollama models');
      return reply.code(500).send({
        error: 'Failed to list Ollama models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/ollama/models/pull
   * Pull (download) a new model from Ollama registry
   * Returns streaming progress updates
   */
  fastify.post<{
    Body: {
      model: string;
    };
  }>('/llm-providers/ollama-instance/models/pull', async (request, reply): Promise<void> => {
    try {
      const { model } = request.body;

      if (!model) {
        reply.code(400).send({
          error: 'Missing model name',
          message: 'Please provide a model name to pull'
        });
        return;
      }

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Pulling Ollama model');

      // Start the pull (this is async and streams progress)
      const res = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      // Stream progress back to client
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked'
      });

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        reply.raw.write(chunk);
      }

      reply.raw.end();

      logger.info({ model }, 'Ollama model pull completed');
    } catch (error) {
      logger.error({ error, model: request.body?.model }, 'Failed to pull Ollama model');

      if (!reply.sent) {
        reply.code(500).send({
          error: 'Failed to pull model',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });


  /**
   * DELETE /api/admin/llm-providers/ollama/models/:model
   * Delete a model from Ollama
   */
  fastify.delete<{
    Params: { model: string };
  }>('/llm-providers/ollama/models/:model', async (request, reply) => {
    try {
      const { model } = request.params;

      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      logger.info({ model }, 'Deleting Ollama model');

      const res = await fetch(`${ollamaUrl}/api/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: model })
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.statusText}`);
      }

      logger.info({ model }, 'Ollama model deleted');

      return reply.send({
        message: 'Model deleted successfully',
        model
      });
    } catch (error) {
      logger.error({ error, model: request.params.model }, 'Failed to delete Ollama model');
      return reply.code(500).send({
        error: 'Failed to delete model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Legacy GET /llm-providers/:name/models route removed — replaced by new CRUD routes above

  // Legacy POST /llm-providers/:name/models route removed — replaced by new CRUD routes above

  // Legacy DELETE /llm-providers/:name/models/:modelId route removed — replaced by new CRUD routes above


  /**
   * GET /api/admin/llm-providers/vertex-ai/catalog
   * Get full Gemini model catalog with capabilities
   */
  fastify.get('/llm-providers/vertex-ai/catalog', async (request, reply) => {
    try {
      // Comprehensive Gemini model catalog
      const catalog = {
        chat: [
          {
            id: 'gemini-2.5-pro-preview-06-05',
            name: 'Gemini 2.5 Pro Preview',
            description: 'Most capable model for complex reasoning, coding, and multimodal tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.5-flash-preview-05-20',
            name: 'Gemini 2.5 Flash Preview',
            description: 'Fast and efficient model with strong reasoning capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 65536,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            description: 'Fast multimodal model for everyday tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-2.0-flash-lite',
            name: 'Gemini 2.0 Flash Lite',
            description: 'Cost-effective model for high-volume tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            description: 'Powerful model with 2M token context window',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 2097152
          },
          {
            id: 'gemini-1.5-flash',
            name: 'Gemini 1.5 Flash',
            description: 'Fast and versatile multimodal model',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-1.5-flash-8b',
            name: 'Gemini 1.5 Flash-8B',
            description: 'Compact and efficient for high-frequency tasks',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 8192,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-flash-preview',
            name: 'Gemini 3 Flash Preview',
            description: 'Next-gen Flash preview with improved capabilities',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          },
          {
            id: 'gemini-3-pro-preview',
            name: 'Gemini 3 Pro Preview',
            description: 'Next-gen Pro preview with advanced reasoning',
            capabilities: { chat: true, vision: true, tools: true, streaming: true },
            maxTokens: 32768,
            contextWindow: 1048576
          }
        ],
        imageGeneration: [
          {
            id: 'imagen-3.0-generate-002',
            name: 'Imagen 3.0',
            description: 'High-quality image generation model',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'imagen-3.0-fast-generate-001',
            name: 'Imagen 3.0 Fast',
            description: 'Fast image generation for rapid iteration',
            capabilities: { imageGeneration: true }
          },
          {
            id: 'gemini-2.0-flash-preview-image-generation',
            name: 'Gemini 2.0 Flash Image Gen',
            description: 'Multimodal with native image generation',
            capabilities: { chat: true, vision: true, imageGeneration: true }
          }
        ],
        embeddings: [
          {
            id: 'text-embedding-004',
            name: 'Text Embedding 004',
            description: 'Latest text embedding model for semantic search',
            dimensions: 768
          },
          {
            id: 'text-embedding-005',
            name: 'Text Embedding 005',
            description: 'Improved text embedding with better performance',
            dimensions: 768
          },
          {
            id: 'text-multilingual-embedding-002',
            name: 'Multilingual Embedding 002',
            description: 'Multilingual embedding supporting 100+ languages',
            dimensions: 768
          }
        ]
      };

      return reply.send({
        catalog,
        totalModels: catalog.chat.length + catalog.imageGeneration.length + catalog.embeddings.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get Vertex AI model catalog');
      return reply.code(500).send({
        error: 'Failed to get model catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/model-capabilities
   * Get model capabilities from the centralized ModelCapabilityRegistry
   * Returns context windows, provider types, and capabilities for all known models
   * This endpoint allows the UI to fetch model info dynamically instead of hardcoding
   */
  fastify.get('/llm-providers/model-capabilities', async (request, reply) => {
    try {
      const { getModelCapabilityRegistry } = await import('../../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      // Get all registered models with their capabilities
      const allModels = registry.getAllModelCapabilities();

      // Group by provider type for easier UI consumption
      const modelsByProvider: Record<string, unknown[]> = {};
      for (const model of allModels) {
        const provider = model.providerType || 'unknown';
        if (!modelsByProvider[provider]) {
          modelsByProvider[provider] = [];
        }
        modelsByProvider[provider].push(model);
      }

      return reply.send({
        models: allModels,
        modelsByProvider,
        totalModels: allModels.length,
        providers: Object.keys(modelsByProvider),
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/model-capabilities/:modelId
   * Get capabilities for a specific model
   */
  fastify.get<{ Params: { modelId: string } }>('/llm-providers/model-capabilities/:modelId', async (request, reply) => {
    try {
      const { modelId } = request.params;
      const { getModelCapabilityRegistry } = await import('../../../services/ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();

      if (!registry) {
        return reply.code(503).send({
          error: 'ModelCapabilityRegistry not initialized',
          message: 'The model capability registry is not available'
        });
      }

      const capabilities = registry.getCapabilities(modelId);
      const providerType = registry.detectProviderType(modelId);
      const contextWindow = registry.getContextWindow(modelId);

      return reply.send({
        modelId,
        providerType,
        contextWindow,
        capabilities,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, modelId: request.params.modelId }, 'Failed to get model capabilities');
      return reply.code(500).send({
        error: 'Failed to get model capabilities',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // /llm-providers/slider-tiers endpoint removed in 0.6.7 — slider rip
  // (task #144 + umbrella #210). Was only consumed by SystemSettingsView's
  // tier recommendation strip; removed along with the rest of slider
  // residue. registry.getSliderTierRecommendations() may still exist
  // in ModelCapabilityRegistry but is unreferenced after this edit.


  /**
   * GET /api/admin/llm-providers/discovery/status
   * Get status of model capability discovery service
   * Returns discovery mode, rate limit status, and cached model count
   */
  fastify.get('/llm-providers/discovery/status', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.send({
          mode: process.env.CAPABILITY_DISCOVERY_MODE || 'lazy',
          isDiscovering: false,
          lastDiscovery: null,
          cachedModels: 0,
          providers: [],
          message: 'Discovery service not initialized (DISABLE_MODEL_DISCOVERY=true or startup in progress)',
          timestamp: new Date().toISOString()
        });
      }

      const status = discoveryService.getDiscoveryStatus();

      return reply.send({
        ...status,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get discovery status');
      return reply.code(500).send({
        error: 'Failed to get discovery status',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/sdk-options
   * Get all available SDK configuration options for each provider type
   * Used by UI to dynamically render provider-specific configuration controls
   */
  fastify.get('/llm-providers/sdk-options', async (request, reply) => {
    const sdkOptions = {
      // Common options available to all providers
      common: {
        temperature: { type: 'number', min: 0, max: 2, step: 0.1, default: 1, description: 'Controls randomness in responses' },
        maxTokens: { type: 'number', min: 1, max: 200000, default: 4096, description: 'Maximum tokens to generate' },
        topP: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Nucleus sampling threshold' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 4, description: 'Stop generation on these sequences' },
        stream: { type: 'boolean', default: true, description: 'Enable streaming responses' },
      },

      // Azure OpenAI / OpenAI specific
      'azure-openai': {
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens based on frequency' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize tokens that have appeared at all' },
        seed: { type: 'number', min: 0, max: 2147483647, description: 'Seed for deterministic sampling (beta)' },
        responseFormat: {
          type: 'object',
          properties: {
            type: { type: 'enum', values: ['text', 'json_object', 'json_schema'], default: 'text', description: 'Response format type' },
            jsonSchema: { type: 'object', optional: true, description: 'JSON schema when type is json_schema' }
          },
          description: 'Output format (JSON mode)'
        },
        logprobs: { type: 'boolean', default: false, description: 'Return log probabilities of tokens' },
        topLogprobs: { type: 'number', min: 0, max: 20, default: 0, description: 'Number of top logprobs to return per token' },
        logitBias: { type: 'object', description: 'Token ID to bias value (-100 to 100) mapping' },
      },

      // AWS Bedrock (Anthropic Claude)
      'aws-bedrock': {
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Only sample from top K tokens' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking mode' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Token budget for thinking (requires enableThinking)' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 8191, description: 'Custom stop sequences' },
      },

      // Google Vertex AI (Gemini)
      'google-vertex': {
        topK: { type: 'number', min: 1, max: 40, default: 40, description: 'Only sample from top K tokens' },
        safetySettings: {
          type: 'array',
          itemType: 'object',
          properties: {
            category: {
              type: 'enum',
              values: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'],
              description: 'Content safety category'
            },
            threshold: {
              type: 'enum',
              values: ['BLOCK_NONE', 'BLOCK_LOW_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_ONLY_HIGH'],
              default: 'BLOCK_MEDIUM_AND_ABOVE',
              description: 'Block threshold'
            }
          },
          description: 'Content safety filter settings'
        },
        enableThinking: { type: 'boolean', default: false, description: 'Enable Gemini thinking mode' },
        thinkingBudget: { type: 'number', min: 0, max: 24576, default: 8000, description: 'Token budget for thinking' },
        groundingConfig: {
          type: 'object',
          properties: {
            googleSearchRetrieval: {
              type: 'object',
              optional: true,
              description: 'Enable Google Search grounding'
            }
          },
          description: 'Configure grounding with Google Search'
        },
      },

      // Ollama (local models)
      'ollama': {
        numCtx: { type: 'number', min: 128, max: 131072, default: 4096, description: 'Context window size' },
        repeatPenalty: { type: 'number', min: 0, max: 2, step: 0.1, default: 1.1, description: 'Penalize repeated tokens' },
        numPredict: { type: 'number', min: -2, max: 131072, default: 128, description: 'Number of tokens to predict (-1 = infinite, -2 = fill context)' },
        mirostat: { type: 'enum', values: [0, 1, 2], default: 0, description: 'Mirostat sampling mode (0=disabled, 1=v1, 2=v2)' },
        mirostatEta: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.1, description: 'Mirostat learning rate' },
        mirostatTau: { type: 'number', min: 0, max: 10, step: 0.1, default: 5.0, description: 'Mirostat target entropy' },
        seed: { type: 'number', min: 0, default: 0, description: 'Random seed (0 = random)' },
        topK: { type: 'number', min: 1, max: 100, default: 40, description: 'Reduces the probability of generating nonsense' },
        tfsZ: { type: 'number', min: 0, max: 1, step: 0.01, default: 1, description: 'Tail-free sampling (1=disabled)' },
      },

      // Anthropic direct
      'anthropic': {
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Only sample from top K tokens' },
        enableThinking: { type: 'boolean', default: true, description: 'Enable extended thinking mode' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 10000, description: 'Token budget for thinking' },
        stopSequences: { type: 'array', itemType: 'string', maxItems: 8191, description: 'Custom stop sequences' },
      },

      // OpenAI direct
      'openai': {
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens based on frequency' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize tokens that have appeared at all' },
        seed: { type: 'number', min: 0, max: 2147483647, description: 'Seed for deterministic sampling (beta)' },
        logprobs: { type: 'boolean', default: false, description: 'Return log probabilities of tokens' },
        topLogprobs: { type: 'number', min: 0, max: 20, default: 0, description: 'Number of top logprobs to return per token' },
      },

      // Azure AI Foundry (supports both Anthropic and OpenAI formats)
      'azure-ai-foundry': {
        // Inherits from both azure-openai and aws-bedrock
        frequencyPenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize repeated tokens (OpenAI models)' },
        presencePenalty: { type: 'number', min: -2, max: 2, step: 0.1, default: 0, description: 'Penalize token presence (OpenAI models)' },
        topK: { type: 'number', min: 1, max: 500, default: 40, description: 'Top-K sampling (Claude models)' },
        enableThinking: { type: 'boolean', default: false, description: 'Enable extended thinking (Claude models)' },
        thinkingBudget: { type: 'number', min: 1024, max: 128000, default: 8000, description: 'Thinking budget (Claude models)' },
      },
    };

    // Pull defaults dynamically from each provider's static getDefaultConfig() method
    // These values come from the actual provider implementations, not hardcoded here
    const providerDefaults: Record<string, ProviderDefaultConfig> = {
      'anthropic': AnthropicProvider.getDefaultConfig(),
      'openai': OpenAIProvider.getDefaultConfig(),
      'azure-openai': AzureOpenAIProvider.getDefaultConfig(),
      'vertex-ai': GoogleVertexProvider.getDefaultConfig(),
      'aws-bedrock': AWSBedrockProvider.getDefaultConfig(),
      'ollama': OllamaProvider.getDefaultConfig(),
      'azure-ai-foundry': AzureAIFoundryProvider.getDefaultConfig(),
    };

    return reply.send({
      options: sdkOptions,
      defaults: providerDefaults,
      providerTypes: Object.keys(sdkOptions).filter(k => k !== 'common'),
      timestamp: new Date().toISOString()
    });
  });


  /**
   * GET /api/admin/llm-providers/:providerName/model-defaults/:modelId
   * Query a specific configured provider's SDK for a model's actual capabilities.
   * Falls back to ModelCapabilityRegistry if the provider doesn't support live queries.
   */
  fastify.get<{
    Params: { providerName: string; modelId: string };
  }>('/llm-providers/:providerName/model-defaults/:modelId', async (request, reply) => {
    const { providerName, modelId } = request.params;

    if (!providerManager) {
      return reply.status(503).send({ error: 'ProviderManager not available' });
    }

    try {
      // Try to get live defaults from the provider's SDK
      const providersMap = providerManager.getProviders();
      const provider = providersMap.get(providerName);

      let sdkDefaults: Partial<ProviderDefaultConfig> | null = null;

      if (provider && typeof provider.getModelDefaults === 'function') {
        sdkDefaults = await provider.getModelDefaults(modelId);
      }

      // Also check ModelCapabilityRegistry for pattern-matched capabilities
      let registryDefaults: Record<string, unknown> | null = null;
      try {
        const { ModelCapabilityRegistry } = await import('../../../services/ModelCapabilityRegistry.js');
        const registry = new ModelCapabilityRegistry(logger);
        const caps = registry.getCapabilities(modelId);
        if (caps && caps.maxOutputTokens) {
          registryDefaults = {
            maxTokens: caps.maxOutputTokens,
            maxTokensRange: [256, caps.maxOutputTokens],
            supportsThinking: caps.thinking || false,
          };
          if (caps.thinkingCapabilities) {
            registryDefaults.thinkingBudget = caps.thinkingCapabilities.defaultBudgetTokens;
            registryDefaults.supportsThinking = true;
          }
        }
      } catch (e) {
        // ModelCapabilityRegistry may not be available
      }

      // Merge: SDK response takes priority, then registry, then provider static defaults
      const providerType = provider?.type;
      const staticDefaults = providerType ? (() => {
        const classMap: Record<string, { getDefaultConfig?: () => ProviderDefaultConfig }> = {
          'ollama': OllamaProvider,
          'aws-bedrock': AWSBedrockProvider,
          'azure-openai': AzureOpenAIProvider,
          'google-vertex': GoogleVertexProvider,
          'anthropic': AnthropicProvider,
          'openai': OpenAIProvider,
          'azure-ai-foundry': AzureAIFoundryProvider,
        };
        return classMap[providerType]?.getDefaultConfig?.() || {};
      })() : {};

      const merged = {
        ...staticDefaults,
        ...(registryDefaults || {}),
        ...(sdkDefaults || {}),
      };

      return reply.send({
        modelId,
        providerName,
        defaults: merged,
        source: sdkDefaults ? 'sdk' : registryDefaults ? 'registry' : 'provider-static',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ providerName, modelId, error }, 'Failed to get model defaults');
      return reply.status(500).send({
        error: 'Failed to get model defaults',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/discover
   * Trigger manual model capability discovery
   * Respects rate limiting unless force=true is passed
   *
   * Query params:
   *   - force: boolean - Bypass rate limiting (use with caution)
   *   - provider: string - Only discover from specific provider
   */
  fastify.post<{
    Querystring: { force?: string; provider?: string };
  }>('/llm-providers/discover', async (request, reply) => {
    try {
      const { getModelCapabilityDiscoveryService } = await import('../../../services/ModelCapabilityDiscoveryService.js');
      const discoveryService = getModelCapabilityDiscoveryService();

      if (!discoveryService) {
        return reply.code(503).send({
          error: 'Discovery service not initialized',
          message: 'Model capability discovery is not available. Check if DISABLE_MODEL_DISCOVERY=true',
          suggestion: 'Set CAPABILITY_DISCOVERY_MODE=lazy (default) to enable lazy discovery'
        });
      }

      const force = request.query.force === 'true';

      // Check rate limiting status before discovery
      const statusBefore = discoveryService.getDiscoveryStatus();
      const rateLimitedProviders = statusBefore.providers.filter(p => !p.canDiscover);

      if (!force && rateLimitedProviders.length > 0 && rateLimitedProviders.length === statusBefore.providers.length) {
        return reply.code(429).send({
          error: 'Rate limited',
          message: 'All providers are rate limited. Wait or use force=true to bypass',
          providers: rateLimitedProviders.map(p => ({
            name: p.name,
            waitTimeMs: p.waitTimeMs,
            waitTimeHuman: `${Math.ceil(p.waitTimeMs / 1000)}s`
          })),
          suggestion: 'Wait for the cooldown period or use ?force=true to bypass rate limiting'
        });
      }

      logger.info({ force, user: request.user?.email }, 'Starting manual model discovery');

      const startTime = Date.now();
      const models = await discoveryService.discoverAllModels(force);
      const duration = Date.now() - startTime;

      const statusAfter = discoveryService.getDiscoveryStatus();

      return reply.send({
        success: true,
        modelsDiscovered: models.length,
        totalCached: statusAfter.cachedModels,
        durationMs: duration,
        providers: statusAfter.providers,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Manual discovery failed');
      return reply.code(500).send({
        error: 'Discovery failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/available-models
   * Fetch live list of available models from all configured providers
   * This allows admins to search and add models without knowing exact model IDs
   *
   * Query params:
   *   - provider: Filter by specific provider (aws-bedrock, google-vertex, azure-openai, ollama)
   *   - search: Search term to filter models by name
   *   - category: Filter by category (chat, embedding, image, code)
   *   - limit: Max number of models to return (default 50)
   */
  fastify.get<{
    Querystring: {
      provider?: string;
      search?: string;
      category?: string;
      limit?: string;
    };
  }>('/llm-providers/available-models', async (request, reply) => {
    try {
      const { provider, search, category, limit: limitStr } = request.query;
      const limit = Number.parseInt(limitStr || '50', 10);

      const allModels: Array<{
        id: string;
        name: string;
        provider: string;
        category: string;
        description?: string;
        inputCostPer1M?: number;
        outputCostPer1M?: number;
        maxTokens?: number;
        capabilities?: string[];
      }> = [];

      // Fetch from AWS Bedrock if enabled and matches filter
      if ((!provider || provider === 'aws-bedrock') && process.env.AWS_BEDROCK_ENABLED === 'true') {
        try {
          const { BedrockClient, ListFoundationModelsCommand } = await import('@aws-sdk/client-bedrock');
          const client = new BedrockClient({ region: process.env.AWS_REGION || 'us-east-1' });
          const response = await client.send(new ListFoundationModelsCommand({}));

          for (const model of response.modelSummaries || []) {
            const modelId = model.modelId || '';
            const modelName = model.modelName || modelId;
            const providerName = model.providerName || 'Unknown';

            // Determine category
            let modelCategory = 'chat';
            if (modelId.includes('embed')) modelCategory = 'embedding';
            else if (modelId.includes('image') || modelId.includes('stable')) modelCategory = 'image';

            // Get pricing from BedrockPricingService
            const { bedrockPricingService } = await import('../../../services/BedrockPricingService.js');
            const pricing = bedrockPricingService.getModelPricing(modelId);

            allModels.push({
              id: modelId,
              name: `${providerName} ${modelName}`,
              provider: 'aws-bedrock',
              category: modelCategory,
              description: `${providerName} model via AWS Bedrock`,
              inputCostPer1M: pricing.inputPricePer1k * 1000,
              outputCostPer1M: pricing.outputPricePer1k * 1000,
              capabilities: [
                ...(model.outputModalities || []),
                ...(model.inputModalities || []),
                model.responseStreamingSupported ? 'streaming' : ''
              ].filter(Boolean)
            });
          }
          logger.info({ count: response.modelSummaries?.length }, 'Fetched Bedrock models');
        } catch (bedrockError) {
          logger.warn({ error: bedrockError }, 'Failed to fetch Bedrock models');
        }
      }

      // Fetch from Google Vertex AI if enabled
      if ((!provider || provider === 'google-vertex') && process.env.GOOGLE_CLOUD_PROJECT) {
        try {
          // Use the Vertex AI publisher models API
          const accessToken = await getGoogleAccessToken();
          if (accessToken) {
            const project = process.env.GOOGLE_CLOUD_PROJECT;
            const location = process.env.VERTEX_AI_LOCATION || 'us-central1';

            // Fetch Gemini models
            const geminiModels = [
              { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', category: 'chat', inputCost: 0.10, outputCost: 0.40 },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', category: 'chat', inputCost: 0.075, outputCost: 0.30 },
              { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'gemini-3-flash-preview', name: 'Gemini 3.0 Flash (Preview)', category: 'chat', inputCost: 0.15, outputCost: 0.60 },
              { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro (Preview)', category: 'chat', inputCost: 1.25, outputCost: 5.00 },
              { id: 'text-embedding-005', name: 'Text Embedding 005', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'text-embedding-004', name: 'Text Embedding 004', category: 'embedding', inputCost: 0.025, outputCost: 0 },
              { id: 'imagen-3.0-generate-001', name: 'Imagen 3.0', category: 'image', inputCost: 0, outputCost: 0 },
              { id: 'imagen-3.0-fast-generate-001', name: 'Imagen 3.0 Fast', category: 'image', inputCost: 0, outputCost: 0 },
            ];

            for (const model of geminiModels) {
              allModels.push({
                id: model.id,
                name: model.name,
                provider: 'google-vertex',
                category: model.category,
                description: `Google ${model.name} via Vertex AI`,
                inputCostPer1M: model.inputCost,
                outputCostPer1M: model.outputCost,
                capabilities: ['streaming', 'json-mode', model.category === 'chat' ? 'function-calling' : ''].filter(Boolean)
              });
            }
            logger.info({ count: geminiModels.length }, 'Added Vertex AI models');
          }
        } catch (vertexError) {
          logger.warn({ error: vertexError }, 'Failed to fetch Vertex AI models');
        }
      }

      // Fetch from Azure OpenAI if enabled
      if ((!provider || provider === 'azure-openai') && process.env.AZURE_OPENAI_ENDPOINT) {
        try {
          const { AzureOpenAI } = await import('openai');
          const client = new AzureOpenAI({
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
          });

          // Azure doesn't have a list models API, so we use known deployments
          const deployments = (process.env.AZURE_OPENAI_DEPLOYMENTS || '').split(',').filter(Boolean);
          for (const deployment of deployments) {
            allModels.push({
              id: deployment,
              name: deployment,
              provider: 'azure-openai',
              category: 'chat',
              description: `Azure OpenAI deployment: ${deployment}`,
              capabilities: ['streaming', 'function-calling']
            });
          }
          logger.info({ count: deployments.length }, 'Added Azure OpenAI models');
        } catch (azureError) {
          logger.warn({ error: azureError }, 'Failed to fetch Azure OpenAI models');
        }
      }

      // Fetch from Ollama if enabled
      if ((!provider || provider === 'ollama') && process.env.OLLAMA_BASE_URL) {
        try {
          const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
            for (const model of data.models || []) {
              allModels.push({
                id: model.name,
                name: model.name,
                provider: 'ollama',
                category: 'chat',
                description: `Local Ollama model (${Math.round((model.size || 0) / 1e9)}GB)`,
                inputCostPer1M: 0, // Free
                outputCostPer1M: 0,
                capabilities: ['streaming']
              });
            }
            logger.info({ count: data.models?.length }, 'Added Ollama models');
          }
        } catch (ollamaError) {
          logger.warn({ error: ollamaError }, 'Failed to fetch Ollama models');
        }
      }

      // Apply filters
      let filtered = allModels;

      // Category filter
      if (category) {
        filtered = filtered.filter(m => m.category === category);
      }

      // Search filter (case-insensitive)
      if (search) {
        const searchLower = search.toLowerCase();
        filtered = filtered.filter(m =>
          m.id.toLowerCase().includes(searchLower) ||
          m.name.toLowerCase().includes(searchLower) ||
          m.description?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by provider, then name
      filtered.sort((a, b) => {
        if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
        return a.name.localeCompare(b.name);
      });

      // Apply limit
      const limited = filtered.slice(0, limit);

      return reply.send({
        models: limited,
        total: filtered.length,
        providers: [...new Set(allModels.map(m => m.provider))],
        categories: [...new Set(allModels.map(m => m.category))],
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to fetch available models');
      return reply.code(500).send({
        error: 'Failed to fetch available models',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });

};


// Helper function to get Google access token
async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token || null;
  } catch {
    return null;
  }
}


export default discoveryRoutes;
