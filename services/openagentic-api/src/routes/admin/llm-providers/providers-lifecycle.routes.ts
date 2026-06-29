/**
 * Admin provider lifecycle routes (pause / resume / capabilities / rotate /
 * env-sync / capability matrix).
 *
 *   POST   /llm-providers/sync-from-env
 *   POST   /llm-providers/:id/pause
 *   POST   /llm-providers/:id/resume
 *   PUT    /llm-providers/:id/capabilities
 *   GET    /capability-matrix
 *   POST   /llm-providers/:id/rotate-credentials
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
} from './types.js';


export const providersLifecycleRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  /**
   * POST /api/admin/llm-providers/sync-from-env
   * Sync LLM providers from environment variables to database
   * This creates database entries for any environment-configured providers
   * that don't already exist in the database.
   * 
   * Use this to migrate from env-based config to database-based config.
   */
  fastify.post<{
    Body: {
      overwrite?: boolean; // If true, update existing providers; if false, skip them
    };
  }>('/llm-providers/sync-from-env', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { overwrite = false } = request.body || {};

      // Load environment providers
      const { ProviderConfigService } = await import('../../../services/llm-providers/ProviderConfigService.js');
      const configService = new ProviderConfigService(logger);
      const config = await configService.loadProviderConfig();

      const results = {
        created: [] as string[],
        updated: [] as string[],
        skipped: [] as string[],
        errors: [] as { provider: string; error: string }[]
      };

      for (const envProvider of config.providers) {
        try {
          // Check if provider already exists in database
          const existing = await prisma.lLMProvider.findFirst({
            where: { name: envProvider.name }
          });

          // Build auth_config based on provider type
          let authConfig: Record<string, unknown> = { type: 'environment' };
          const providerConfig: Record<string, unknown> = {};
          const modelConfig: Record<string, unknown> = {};

          if (envProvider.type === 'azure-openai') {
            authConfig = {
              type: 'entra-id',
              tenantId: envProvider.config.tenantId,
              clientId: envProvider.config.clientId,
              clientSecret: envProvider.config.clientSecret
            };
            providerConfig.endpoint = envProvider.config.endpoint;
            providerConfig.apiVersion = envProvider.config.apiVersion;
            modelConfig.chatModel = envProvider.config.deployment;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'aws-bedrock') {
            authConfig = {
              type: envProvider.config.accessKeyId ? 'iam-keys' : 'irsa',
              region: envProvider.config.region,
              ...(envProvider.config.accessKeyId && {
                accessKeyId: envProvider.config.accessKeyId,
                secretAccessKey: envProvider.config.secretAccessKey
              })
            };
            if (envProvider.config.endpoint) {
              providerConfig.endpoint = envProvider.config.endpoint;
            }
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
            modelConfig.imageModel = envProvider.config.imageModel;
            modelConfig.compactionModel = envProvider.config.compactionModel;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'google-vertex') {
            authConfig = {
              type: 'service-account',
              credentials: envProvider.config.serviceAccountJson
            };
            providerConfig.projectId = envProvider.config.projectId;
            providerConfig.location = envProvider.config.location;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
            modelConfig.imageModel = envProvider.config.imageModel;
            modelConfig.maxTokens = envProvider.config.maxTokens;
            modelConfig.temperature = envProvider.config.temperature;
          } else if (envProvider.type === 'ollama') {
            authConfig = { type: 'none' };
            providerConfig.baseUrl = envProvider.config.baseUrl;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
          } else if (envProvider.type === 'azure-ai-foundry') {
            authConfig = envProvider.config.apiKey 
              ? { type: 'api-key', key: envProvider.config.apiKey }
              : {
                  type: 'entra-id',
                  tenantId: envProvider.config.tenantId,
                  clientId: envProvider.config.clientId,
                  clientSecret: envProvider.config.clientSecret
                };
            providerConfig.endpointUrl = envProvider.config.endpointUrl;
            modelConfig.chatModel = envProvider.config.chatModel;
            modelConfig.embeddingModel = envProvider.config.embeddingModel;
            modelConfig.visionModel = envProvider.config.visionModel;
          }

          const displayName = {
            'azure-openai': 'Azure OpenAI',
            'aws-bedrock': 'AWS Bedrock',
            'google-vertex': 'Google Vertex AI',
            'ollama': 'Ollama (Local)',
            'azure-ai-foundry': 'Azure AI Foundry'
          }[envProvider.type] || envProvider.name;

          const data = {
            name: envProvider.name,
            display_name: displayName,
            provider_type: envProvider.type,
            enabled: envProvider.enabled,
            priority: envProvider.priority,
            auth_config: encryptAuthConfig(authConfig),
            provider_config: providerConfig,
            model_config: modelConfig,
            capabilities: {
              chat: true,
              tools: true,
              streaming: true,
              vision: envProvider.type !== 'ollama',
              embeddings: true
            },
            description: `Synced from environment variables`,
            tags: ['synced', 'environment'],
            created_by: request.user?.id,
            updated_by: request.user?.id
          };

          if (existing) {
            if (overwrite) {
              await prisma.lLMProvider.update({
                where: { id: existing.id },
                data: {
                  ...data,
                  updated_at: new Date()
                } as unknown as Prisma.LLMProviderUpdateInput
              });
              results.updated.push(envProvider.name);
            } else {
              results.skipped.push(envProvider.name);
            }
          } else {
            await prisma.lLMProvider.create({ data: data as unknown as Prisma.LLMProviderCreateInput });
            results.created.push(envProvider.name);
          }
        } catch (err) {
          results.errors.push({
            provider: envProvider.name,
            error: err instanceof Error ? err.message : 'Unknown error'
          });
        }
      }

      // Reload provider manager if available
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded after sync');
      }

      logger.info(results, 'Environment providers synced to database');

      return reply.send({
        success: true,
        message: 'Environment providers synced to database',
        results,
        total: config.providers.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to sync providers from environment');
      return reply.code(500).send({
        error: 'Failed to sync providers',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });


  // ──────────────────────────────────────────────────────────────────────────────
  // Provider pause/resume endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/admin/llm-providers/:id/pause
   * Pause a provider with an optional duration (provider continues serving in-flight requests)
   */
  fastify.post<{ Params: { id: string }; Body: { durationMs?: number } }>(
    '/llm-providers/:id/pause',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { durationMs } = request.body || {};
        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const pausedUntil = durationMs ? new Date(Date.now() + durationMs) : null;

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            status: 'paused',
            paused_until: pausedUntil,
            updated_by: request.user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_paused',
          userId: request.user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, durationMs, pausedUntil },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name, pausedUntil }, 'Provider paused');

        return reply.send({
          success: true,
          message: `Provider ${provider.display_name} paused${pausedUntil ? ` until ${pausedUntil.toISOString()}` : ' indefinitely'}`,
          providerId: id,
          status: 'paused',
          pausedUntil
        });
      } catch (error) {
        logger.error({ error }, 'Failed to pause provider');
        return reply.code(500).send({
          error: 'Failed to pause provider',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );


  /**
   * POST /api/admin/llm-providers/:id/resume
   * Resume a paused provider
   */
  fastify.post<{ Params: { id: string } }>(
    '/llm-providers/:id/resume',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            status: 'active',
            paused_until: null,
            updated_by: request.user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_resumed',
          userId: request.user?.id || 'admin',
          details: { providerId: id, providerName: provider.name },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Provider resumed');

        return reply.send({
          success: true,
          message: `Provider ${provider.display_name} resumed`,
          providerId: id,
          status: 'active'
        });
      } catch (error) {
        logger.error({ error }, 'Failed to resume provider');
        return reply.code(500).send({
          error: 'Failed to resume provider',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );


  // ──────────────────────────────────────────────────────────────────────────────
  // Capability management endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * PUT /api/admin/llm-providers/:id/capabilities
   * Update capability assignments for a provider
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      is_chat_provider?: boolean;
      is_embedding_provider?: boolean;
      is_vision_provider?: boolean;
      is_image_provider?: boolean;
      is_compaction_provider?: boolean;
    };
  }>(
    '/llm-providers/:id/capabilities',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const {
          is_chat_provider,
          is_embedding_provider,
          is_vision_provider,
          is_image_provider,
          is_compaction_provider
        } = request.body || {};

        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        // Build update data - only include fields that were provided
        const updateData: Record<string, unknown> = {
          updated_by: request.user?.id || null
        };
        if (is_chat_provider !== undefined) updateData.is_chat_provider = is_chat_provider;
        if (is_embedding_provider !== undefined) updateData.is_embedding_provider = is_embedding_provider;
        if (is_vision_provider !== undefined) updateData.is_vision_provider = is_vision_provider;
        if (is_image_provider !== undefined) updateData.is_image_provider = is_image_provider;
        if (is_compaction_provider !== undefined) updateData.is_compaction_provider = is_compaction_provider;

        const updated = await prisma.lLMProvider.update({
          where: { id },
          data: updateData as unknown as Prisma.LLMProviderUpdateInput
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'provider_capabilities_updated',
          userId: request.user?.id || 'admin',
          details: {
            providerId: id,
            providerName: provider.name,
            capabilities: {
              is_chat_provider: updated.is_chat_provider,
              is_embedding_provider: updated.is_embedding_provider,
              is_vision_provider: updated.is_vision_provider,
              is_image_provider: updated.is_image_provider,
              is_compaction_provider: updated.is_compaction_provider
            }
          },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Provider capabilities updated');

        return reply.send({
          success: true,
          message: `Capabilities updated for provider ${provider.display_name}`,
          providerId: id,
          capabilities: {
            is_chat_provider: updated.is_chat_provider,
            is_embedding_provider: updated.is_embedding_provider,
            is_vision_provider: updated.is_vision_provider,
            is_image_provider: updated.is_image_provider,
            is_compaction_provider: updated.is_compaction_provider
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to update provider capabilities');
        return reply.code(500).send({
          error: 'Failed to update provider capabilities',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );


  /**
   * GET /api/admin/capability-matrix
   * Returns a matrix of all providers and their capability assignments
   */
  fastify.get('/capability-matrix', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');

      const providers = await prisma.lLMProvider.findMany({
        where: { deleted_at: null },
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          display_name: true,
          provider_type: true,
          enabled: true,
          status: true,
          priority: true,
          is_chat_provider: true,
          is_embedding_provider: true,
          is_vision_provider: true,
          is_image_provider: true,
          is_compaction_provider: true,
          disabled_models: true,
          capabilities: true,
          paused_until: true
        }
      });

      const capabilityTypes = [
        'chat', 'embedding', 'vision', 'image', 'compaction'
      ] as const;

      // Build the matrix
      const matrix = providers.map(p => ({
        id: p.id,
        name: p.name,
        displayName: p.display_name,
        providerType: p.provider_type,
        enabled: p.enabled,
        status: p.status,
        priority: p.priority,
        pausedUntil: p.paused_until,
        disabledModelCount: p.disabled_models.length,
        capabilities: {
          chat: p.is_chat_provider,
          embedding: p.is_embedding_provider,
          vision: p.is_vision_provider,
          image: p.is_image_provider,
          compaction: p.is_compaction_provider
        },
        legacyCapabilities: p.capabilities
      }));

      // Summarize which capabilities have coverage
      const coverage: Record<string, { assigned: number; active: number; providers: string[] }> = {};
      for (const cap of capabilityTypes) {
        const capKey = `is_${cap}_provider` as keyof typeof providers[0];
        const assigned = providers.filter(p => p[capKey] === true);
        const active = assigned.filter(p => p.enabled && p.status === 'active');
        coverage[cap] = {
          assigned: assigned.length,
          active: active.length,
          providers: active.map(p => p.name)
        };
      }

      return reply.send({
        matrix,
        coverage,
        totalProviders: providers.length,
        activeProviders: providers.filter(p => p.enabled && p.status === 'active').length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get capability matrix');
      return reply.code(500).send({
        error: 'Failed to get capability matrix',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  });


  // ──────────────────────────────────────────────────────────────────────────────
  // Credential rotation endpoint
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/admin/llm-providers/:id/rotate-credentials
   * Hot credential rotation - update credentials without downtime
   */
  fastify.post<{ Params: { id: string }; Body: { auth_config: Record<string, unknown>; credentials_expires_at?: string } }>(
    '/llm-providers/:id/rotate-credentials',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { auth_config, credentials_expires_at } = request.body || {};

        if (!auth_config || typeof auth_config !== 'object') {
          return reply.code(400).send({ error: 'auth_config object is required' });
        }

        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        // Encrypt credentials before storing
        let encryptedConfig: Record<string, unknown>;
        try {
          encryptedConfig = encryptAuthConfig(auth_config);
        } catch {
          // If encryption is not configured, store as-is (development mode)
          encryptedConfig = auth_config;
          logger.warn({ providerId: id }, 'Credential encryption not configured - storing credentials in plaintext');
        }

        const updateData: Record<string, unknown> = {
          auth_config: encryptedConfig,
          updated_by: request.user?.id || null
        };

        if (credentials_expires_at) {
          updateData.credentials_expires_at = new Date(credentials_expires_at);
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: updateData as unknown as Prisma.LLMProviderUpdateInput
        });

        // Log credential rotation to credential audit service
        try {
          await credentialAuditService.log({
            userId: request.user?.id || 'admin',
            userEmail: request.user?.email,
            action: 'update',
            entityType: 'llm_provider',
            entityId: id,
            entityName: provider.name,
            changes: { auth_config: { old: '***redacted***', new: '***rotated***' } },
            request: request
          });
        } catch {
          // Non-critical: don't fail rotation if audit logging fails
        }

        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'credentials_rotated',
          userId: request.user?.id || 'admin',
          details: {
            providerId: id,
            providerName: provider.name,
            credentialType: auth_config.type || 'unknown',
            expiresAt: credentials_expires_at || null
          },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, providerName: provider.name }, 'Credentials rotated successfully');

        return reply.send({
          success: true,
          message: `Credentials rotated for provider ${provider.display_name}`,
          providerId: id,
          credentialType: auth_config.type || 'unknown',
          expiresAt: credentials_expires_at || null,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to rotate credentials');
        return reply.code(500).send({
          error: 'Failed to rotate credentials',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

};


export default providersLifecycleRoutes;
