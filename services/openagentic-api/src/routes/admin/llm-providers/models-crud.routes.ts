/**
 * Admin per-provider model CRUD routes.
 *
 *   GET    /llm-providers/:providerId/models
 *   POST   /llm-providers/:providerId/models
 *   POST   /llm-providers/:providerId/models/:modelId/refresh
 *   POST   /llm-providers/refresh-all
 *   POST   /llm-providers/:providerId/models/:modelId/test
 *   PUT    /llm-providers/:providerId/models/:modelId
 *   DELETE /llm-providers/:providerId/models/:modelId
 *   POST   /llm-providers/:name/models/add-from-catalog
 *   POST   /llm-providers/:name/deploy-model
 *   PUT    /llm-providers/:id/models/:modelId/disable
 *   PUT    /llm-providers/:id/models/:modelId/enable
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
  CompletionResultLike,
} from './types.js';


export const modelsCrudRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  // ─── Model CRUD on provider_config.models (by provider name or ID) ────────────

  /**
   * Resolve provider by name or UUID.
   * All model endpoints accept either format.
   */
  async function resolveProvider(prisma, nameOrId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
    return isUuid
      ? await prisma.lLMProvider.findFirst({ where: { id: nameOrId, deleted_at: null } })
      : await prisma.lLMProvider.findFirst({ where: { name: nameOrId, deleted_at: null } });
  }


  /**
   * GET /api/admin/llm-providers/:providerId/models
   * List configured models for a provider from the Registry SoT
   * (admin.model_role_assignments). Replaces the legacy
   * provider_config.models[] read.
   */
  fastify.get<{ Params: { providerId: string } }>('/llm-providers/:providerId/models', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const { prisma } = await import('../../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
        return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      const registryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name, enabled: true },
        orderBy: [{ priority: 'asc' }],
      });
      // #650 follow-up — surface discovery-time provenance + cost rates +
      // generation params so the UI can render "where does this number
      // come from?" badges and Smart Router has live cost data. Pre-fix
      // we dropped pricing_source/pricing_fetched_at/cost_per_*/temperature/
      // thinking_budget from the response shape. Decimal columns coerce
      // to JS number for clean JSON serialization.
      const toNum = (v): number | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === 'number') return v;
        const n = Number(v.toString());
        return Number.isFinite(n) ? n : undefined;
      };
      const models = registryRows.map(r => {
        const m: Record<string, unknown> = {
          id: r.model,
          name: r.description || r.model,
          capabilities: r.capabilities || {},
          config: { maxOutputTokens: r.max_tokens ?? undefined, enabled: r.enabled, role: r.role },
        };
        if (r.pricing_source) m.pricing_source = r.pricing_source;
        if (r.pricing_fetched_at) {
          m.pricing_fetched_at = r.pricing_fetched_at instanceof Date
            ? r.pricing_fetched_at.toISOString()
            : r.pricing_fetched_at;
        }
        const cIn = toNum((r as Record<string, unknown>).cost_per_input_token_usd);
        if (cIn !== undefined) m.cost_per_input_token_usd = cIn;
        const cOut = toNum((r as Record<string, unknown>).cost_per_output_token_usd);
        if (cOut !== undefined) m.cost_per_output_token_usd = cOut;
        const cCacheR = toNum((r as Record<string, unknown>).cost_per_cache_read_usd);
        if (cCacheR !== undefined) m.cost_per_cache_read_usd = cCacheR;
        const cCacheW = toNum((r as Record<string, unknown>).cost_per_cache_write_usd);
        if (cCacheW !== undefined) m.cost_per_cache_write_usd = cCacheW;
        const cThink = toNum((r as Record<string, unknown>).cost_per_thinking_token_usd);
        if (cThink !== undefined) m.cost_per_thinking_token_usd = cThink;
        const cEmb = toNum((r as Record<string, unknown>).cost_per_embedding_token_usd);
        if (cEmb !== undefined) m.cost_per_embedding_token_usd = cEmb;
        if (r.temperature !== null && r.temperature !== undefined) m.temperature = r.temperature;
        if (r.thinking_budget !== null && r.thinking_budget !== undefined) {
          m.thinking_budget = r.thinking_budget;
        }
        return m;
      });

      return reply.send({
        providerId: provider.id,
        providerName: provider.name,
        models,
        totalModels: models.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId }, 'Failed to list provider models');
      return reply.code(500).send({
        error: 'Failed to list provider models',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:providerId/models
   * Add a model to a provider. Appends to provider_config.models array.
   */
  fastify.post<{
    Params: { providerId: string };
    Querystring: { force?: string };
    Body: {
      modelId: string;
      displayName?: string;
      capabilities?: { chat?: boolean; vision?: boolean; tools?: boolean; streaming?: boolean; embeddings?: boolean };
      config?: {
        maxOutputTokens?: number;
        maxInputTokens?: number;
        rateLimitRequestsPerHour?: number;
        rateLimitTokensPerHour?: number;
        temperature?: number;
        topP?: number;
        enabled?: boolean;
        roles?: string[];
      };
      /**
       * Azure AI Foundry: when present, the admin backend will PUT a
       * CognitiveServices deployment with these parameters before the
       * DB write. Required for AIF models that aren't already deployed.
       */
      deployment?: {
        modelName: string;
        modelVersion: string;
        modelFormat?: string;
        sku?: string;
        capacity?: number;
      };
    };
  }>('/llm-providers/:providerId/models', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const { modelId, displayName } = request.body;
      // Body fields `capabilities` and `config.*` are accepted at the type
      // boundary for backward-compat, but they are NOT consumed here — live
      // discovery is the SoT (#650). Admin overrides go via the dedicated
      // PUT /llm-providers/:id/models/:modelId/override endpoint.

      if (!modelId) {
        return reply.code(400).send({ error: 'modelId is required' });
      }

      const { prisma } = await import('../../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Azure AI Foundry: if caller supplied deployment{ modelName,modelVersion,... }
      // in the body, ensure the Azure CognitiveServices deployment exists BEFORE
      // the DB write so the background ARM-discovery sync (which treats Azure as
      // authoritative) doesn't prune the row. Callers that don't need provisioning
      // (model is already deployed) simply omit the field. The dedicated
      // /deploy-model endpoint remains the primary path used by the UI; this
      // branch is a safety net for clients that POST /models directly.
      if (provider.provider_type === 'azure-ai-foundry' && providerManager) {
        const meta = request.body?.deployment;
        if (meta && meta.modelVersion) {
          try {
            const providerInstance = providerManager.getProvider(provider.name) as unknown as ProviderRuntime;
            if (providerInstance?.ensureArmDeployment) {
              await providerInstance.ensureArmDeployment({
                deploymentName: modelId,
                modelName: meta.modelName || modelId,
                modelVersion: meta.modelVersion,
                modelFormat: meta.modelFormat || 'OpenAI',
                sku: meta.sku || 'GlobalStandard',
                capacity: meta.capacity ?? 1,
              });
            }
          } catch (err) {
            logger.error({ err: err?.message, modelId, providerId }, '[admin] ensureArmDeployment failed — aborting add');
            return reply.code(502).send({
              error: 'Azure deployment create failed',
              message: err?.message || String(err),
            });
          }
        }
      }

      const providerConfig = (provider.provider_config as ProviderConfigBag) || {};
      // Registry SoT: query admin.model_role_assignments to detect existing
      // model rows, not the legacy provider_config.models[]. The Registry
      // write below replaces the legacy field entirely.
      const existingRegistryRow = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: modelId },
      });
      const existingIdx = existingRegistryRow ? 0 : -1;
      let isUpdate = false;
      // List of currently-registered model ids (Registry rows for this provider)
      // for family-conflict detection. Replaces the legacy
      // provider_config.models[].map(m=>m.id) approach.
      const existingRegistryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name },
        select: { model: true },
      });
      const models = existingRegistryRows; // alias used by family-conflict block below

      // Family-level dedupe: if the provider already has a model in the same
      // model family (e.g. user tries to add Sonnet 4.5 when 4.6 is already
      // registered), refuse with 409 unless the client passes ?force=true.
      // Root cause of the 2026-04-21 "TWO sonnets in registry" incident.
      if (existingIdx < 0) {
        const force = (request.query as Record<string, unknown>)?.force === 'true';
        if (!force) {
          const { findFamilyConflict } = await import('../../../services/model-routing/modelFamily.js');
          const existingIds = models.map((m) => typeof m?.model === 'string' ? m.model : '').filter(Boolean);
          const conflict = findFamilyConflict(modelId, existingIds);
          if (conflict) {
            return reply.code(409).send({
              error: 'MODEL_FAMILY_CONFLICT',
              message: `Provider "${provider.name}" already has "${conflict}" in the same model family as "${modelId}". ` +
                       `Remove the existing model first, or pass ?force=true to add both.`,
              existingModelId: conflict,
              candidateModelId: modelId,
            });
          }
        }
      }

      // #650 — LIVE PROVIDER DISCOVERY is the SoT for capabilities, limits,
      // defaults, and pricing. Body is admin-overrides only (displayName for
      // description). Without live discovery the Registry's RouterTuning math
      // (cost-per-token, ctx-fit gates, FCA floors) operates on stale defaults.
      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const providerInstanceForDiscovery = providerManager.getProvider(provider.name) as unknown as ProviderRuntime;
      if (!providerInstanceForDiscovery?.discoverModelDetails) {
        return reply.code(501).send({
          error: 'Provider does not support live model discovery',
          message: `Provider '${provider.provider_type}' has no discoverModelDetails implementation`,
        });
      }
      const discoveryRegion = (provider.provider_config as ProviderConfigBag)?.region
                           ?? (provider.provider_config as ProviderConfigBag)?.location;
      let discovered: ModelDiscoveryRecord;
      try {
        const result = await providerInstanceForDiscovery.discoverModelDetails(modelId, discoveryRegion);
        if (!result) {
          return reply.code(502).send({ error: 'Live discovery returned null', modelId });
        }
        discovered = result;
      } catch (err) {
        logger.error({ providerId, modelId, err: err?.message }, '[admin] Live model discovery failed');
        return reply.code(502).send({
          error: 'Live model discovery failed',
          message: err?.message || String(err),
          modelId,
        });
      }

      if (existingRegistryRow) {
        isUpdate = true;
      }
      // Registry write happens at the bottom of this handler (already there);
      // legacy provider_config.models[] mutation removed — Registry is SoT.

      // Always register chat-capable models in model_config so /chat/models
      // and the Registry tab can see them. This runs on BOTH add and upsert
      // to fix models stuck in provider_config but missing from model_config.
      // #650 — Slot decision uses discovered capabilities, not body fields.
      const effectiveCaps = discovered.capabilities;
      const modelConfig = (provider.model_config as ModelConfigBag) || {};
      const isChatCapable = (effectiveCaps?.chat !== false);
      const isEmbeddingOnly = effectiveCaps?.embeddings && !effectiveCaps?.chat;
      const updatedModelConfig = { ...modelConfig };

      if (isEmbeddingOnly) {
        // Embedding models go into embeddingModel slot
        if (!updatedModelConfig.embeddingModel) {
          updatedModelConfig.embeddingModel = modelId;
        }
      } else if (isChatCapable) {
        if (!updatedModelConfig.chatModel) {
          updatedModelConfig.chatModel = modelId;
        } else if (updatedModelConfig.chatModel !== modelId) {
          // Already has a chatModel — add to additionalModels so it shows in selector
          const additional: string[] = Array.isArray(updatedModelConfig.additionalModels) ? [...updatedModelConfig.additionalModels] : [];
          if (!additional.includes(modelId)) additional.push(modelId);
          updatedModelConfig.additionalModels = additional;
        }
      }

      // Update only model_config (routing-hint fields). The legacy
      // provider_config.models[] write is removed — Registry is SoT.
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: {
          model_config: updatedModelConfig,
          updated_by: request.user?.id
        } as unknown as Prisma.LLMProviderUpdateInput
      });

      // Registry upsert — the admin Models table reads from ModelRoleAssignment,
      // NOT from provider_config.models[]. Skipping this was the "Add Model → UI
      // shows nothing" bug: the POST wrote to provider_config + model_config but
      // the Registry view queries ModelRoleAssignment, so newly added models
      // never appeared.
      //
      // Derive ONE primary role per model. vision/tools/thinking/streaming are
      // capability flags preserved in the capabilities JSON on the row — they
      // are NOT separate roles. (Compare to gpt-oss:20b which has tools +
      // thinking + streaming but only a single role=chat row.)
      const caller = request.user?.id;
      if (caller) {
        // #650 — Registry write sources EVERY column from discovered. Body's
        // displayName wins as admin override for description; everything else
        // (max_tokens, temperature, capabilities, options jsonb, all 7 cost
        // columns, pricing_source, pricing_fetched_at) comes from the live
        // discovery record. body.config.* is NOT consulted here — it would be
        // a silent override of provider truth.
        const caps = discovered.capabilities;
        const primaryRole = caps.embeddings && !caps.chat
          ? 'embeddings'
          : caps.imageGeneration ? 'image-generation' : 'chat';
        const optionsBlob = {
          contextWindow: discovered.contextWindow,
          family: discovered.family,
          topP: discovered.topP,
          topK: discovered.topK,
          providerType: discovered.providerType,
          pricingRegion: discovered.pricing.region,
          nativeToolCalling: caps.nativeToolCalling,
        };
        const dataCommon: Record<string, unknown> = {
          enabled: true,
          capabilities: caps as unknown,
          options: optionsBlob as unknown,
          max_tokens: discovered.maxOutputTokens ?? undefined,
          temperature: discovered.temperature ?? 0.5,
          thinking_budget: discovered.thinkingBudget ?? undefined,
          // OSS schema only tracks a single cost_per_request column for now;
          // detailed per-token pricing is enterprise-tier.
          cost_per_request: discovered.pricing.perRequestUsd ?? null,
          pricing_source: discovered.pricing.source,
          pricing_fetched_at: new Date(discovered.pricing.fetchedAt),
          description: displayName || discovered.displayName,
        };
        const existing = await prisma.modelRoleAssignment.findFirst({
          where: { role: primaryRole, model: modelId, provider: provider.name },
        });
        if (existing) {
          await prisma.modelRoleAssignment.update({
            where: { id: existing.id },
            data: dataCommon as unknown as Prisma.ModelRoleAssignmentUpdateInput,
          });
        } else {
          await prisma.modelRoleAssignment.create({
            data: {
              ...dataCommon,
              role: primaryRole,
              model: modelId,
              provider: provider.name,
              priority: 10,
              created_by: caller,
            } as unknown as Prisma.ModelRoleAssignmentCreateInput,
          });
        }
        logger.info({
          providerId: provider.id,
          modelId,
          role: primaryRole,
          pricingSource: discovered.pricing.source,
          contextWindow: discovered.contextWindow,
        }, '[admin] ModelRoleAssignment upserted from live discovery (#650)');
      }

      logger.info({ providerId: provider.id, modelId, isUpdate }, isUpdate ? 'Model upserted (was stuck in provider_config, now in model_config too)' : 'Model added to provider');

      // Audit log
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: isUpdate ? 'UPSERT_PROVIDER_MODEL' : 'ADD_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId, providerName: provider.name, isUpdate },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Trigger hot-reload so the new model appears in
      // modelToProviderMap immediately and is routable for the next
      // turn — without it the model exists in DB but the running
      // ProviderManager's lookup is stale until pod restart. Live
      // 2026-05-06 incident: gemma4:latest registered successfully but
      // routed to the wrong ollama provider for ~3 min until manual
      // restart. reloadProviders() is atomic (#74) so traffic isn't
      // interrupted.
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        try {
          await providerManager.reloadProviders();
          logger.info(
            { providerId: provider.id, modelId },
            'Provider manager reloaded after model registration',
          );
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id, modelId },
            '[admin] post-model-add reloadProviders() failed — Registry row written but routing may be stale',
          );
        }
      }

      return reply.code(isUpdate ? 200 : 201).send({
        message: isUpdate ? 'Model updated and registered' : 'Model added successfully',
        model: models[existingIdx >= 0 ? existingIdx : models.length - 1],
        totalModels: models.length,
        isUpdate,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId }, 'Failed to add model to provider');
      return reply.code(500).send({
        error: 'Failed to add model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:providerId/models/:modelId/refresh
   *
   * #650 U7 — Re-runs live provider discovery for an existing Registry row
   * and atomically replaces capabilities, limits, defaults, and pricing.
   * The daily re-sync cron (U8) calls this exact code path per row.
   *
   * Returns 200 on success, 404 if provider/row missing, 501 if provider
   * has no discoverModelDetails (older provider class), 502 on upstream
   * discovery error, 503 if ProviderManager not initialized.
   */
  fastify.post<{
    Params: { providerId: string; modelId: string };
  }>('/llm-providers/:providerId/models/:modelId/refresh', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const modelId = decodeURIComponent(request.params.modelId);

      const { prisma } = await import('../../../utils/prisma.js');
      const provider = await resolveProvider(prisma, providerId);
      if (!provider) {
        return reply.code(404).send({ error: 'Provider not found' });
      }

      const existing = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: modelId },
      });
      if (!existing) {
        return reply.code(404).send({
          error: 'Registry row not found',
          message: `No ModelRoleAssignment for provider='${provider.name}' model='${modelId}'`,
        });
      }

      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const providerInstance = providerManager.getProvider(provider.name) as unknown as ProviderRuntime;
      if (!providerInstance?.discoverModelDetails) {
        return reply.code(501).send({
          error: 'Provider does not support live model discovery',
          message: `Provider '${provider.provider_type}' has no discoverModelDetails implementation`,
        });
      }

      const region = (provider.provider_config as ProviderConfigBag)?.region
                  ?? (provider.provider_config as ProviderConfigBag)?.location;
      let discovered: ModelDiscoveryRecord;
      try {
        const result = await providerInstance.discoverModelDetails(modelId, region);
        if (!result) {
          return reply.code(502).send({ error: 'Refresh discovery returned null', modelId });
        }
        discovered = result;
      } catch (err) {
        logger.error({ providerId, modelId, err: err?.message }, '[admin] Refresh discovery failed');
        return reply.code(502).send({
          error: 'Refresh from provider failed',
          message: err?.message || String(err),
          modelId,
        });
      }

      const caps = discovered.capabilities;
      await prisma.modelRoleAssignment.update({
        where: { id: existing.id },
        data: {
          max_tokens: discovered.maxOutputTokens ?? undefined,
          temperature: discovered.temperature ?? 0.5,
          thinking_budget: discovered.thinkingBudget ?? undefined,
          capabilities: caps as unknown,
          options: {
            contextWindow: discovered.contextWindow,
            family: discovered.family,
            topP: discovered.topP,
            topK: discovered.topK,
            providerType: discovered.providerType,
            pricingRegion: discovered.pricing.region,
            nativeToolCalling: caps.nativeToolCalling,
          } as unknown,
          // OSS schema only tracks a single cost_per_request column for now;
          // detailed per-token pricing is enterprise-tier.
          cost_per_request: discovered.pricing.perRequestUsd ?? null,
          pricing_source: discovered.pricing.source,
          pricing_fetched_at: new Date(discovered.pricing.fetchedAt),
        } as unknown as Prisma.ModelRoleAssignmentUpdateInput,
      });

      logger.info({
        providerId: provider.id,
        modelId,
        pricingSource: discovered.pricing.source,
        pricingFetchedAt: discovered.pricing.fetchedAt,
      }, '[admin] Registry row refreshed from provider (#650)');

      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'REFRESH_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId, providerName: provider.name, pricingSource: discovered.pricing.source },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      return reply.send({
        message: 'Refreshed from provider',
        modelId,
        provider: provider.name,
        pricing_source: discovered.pricing.source,
        pricing_fetched_at: discovered.pricing.fetchedAt,
        contextWindow: discovered.contextWindow,
        maxOutputTokens: discovered.maxOutputTokens,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId },
        'Failed to refresh model from provider');
      return reply.code(500).send({
        error: 'Failed to refresh model',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/refresh-all
   *
   * #650 U8 — Walks every Active Registry row and re-runs live discovery
   * via RefreshModelDetailsJob. Per-row failures are isolated. Logs price
   * deltas. The k8s CronJob hits this endpoint daily at 03:00 UTC; admin
   * UI may surface a manual "Refresh All" button later.
   *
   * Auth: inherits the admin middleware on this plugin's parent.
   */
  fastify.post('/llm-providers/refresh-all', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      if (!providerManager) {
        return reply.code(503).send({ error: 'ProviderManager not initialized' });
      }
      const { RefreshModelDetailsJob } = await import('../../../jobs/RefreshModelDetailsJob.js');
      const job = new RefreshModelDetailsJob(prisma, providerManager, logger);
      const result = await job.run();
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'REFRESH_ALL_MODELS',
        resource: 'LLMProvider',
        resourceId: 'all',
        details: result,
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});
      return reply.send({ message: 'Refresh sweep complete', ...result });
    } catch (error) {
      logger.error({ error }, 'Refresh-all sweep failed');
      return reply.code(500).send({
        error: 'Refresh-all sweep failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:providerId/models/:modelId/test
   * Low-token "is this model alive?" check from the Model Registry UI.
   * Sends a tiny prompt asking the model to reply with "ok" + its self-reported
   * id, returns pass/fail + latency + token usage + the model's own response.
   * Goal: one-click validation that the model is reachable, configured
   * correctly, and IS the model the admin thinks it is (catches provider-side
   * aliasing/fallbacks).
   */
  fastify.post<{
    Params: { providerId: string; modelId: string };
  }>('/llm-providers/:providerId/models/:modelId/test', async (request, reply) => {
    const { providerId, modelId: rawModelId } = request.params;
    const modelId = decodeURIComponent(rawModelId);
    const startedAt = Date.now();
    try {
      if (!providerManager) {
        return reply.code(503).send({ ok: false, error: 'ProviderManager not initialized' });
      }

      // Resolve provider name. providerId can be the DB id OR the provider name.
      let providerName = providerId;
      try {
        const { prisma: p } = await import('../../../utils/prisma.js');
        const row = await p.lLMProvider.findFirst({ where: { OR: [{ id: providerId }, { name: providerId }] } });
        if (row) providerName = row.name;
      } catch { /* fall through */ }

      // Verify the provider is enabled in the live map (#59 cascade rule)
      if (!providerManager.hasProvider(providerName)) {
        return reply.code(409).send({
          ok: false,
          error: `Provider "${providerName}" is not enabled. Enable it in admin LLM Providers first.`,
          latencyMs: Date.now() - startedAt,
        });
      }

      // Fire a minimal completion. Cap at ~80 output tokens — this is a
      // health probe, not a generation. We deliberately ask the model to
      // self-identify so the admin can compare against the configured id.
      const probe = `Reply with EXACTLY this format and nothing else:\nOK | <your model id and version>`;
      const completionRequest: Record<string, unknown> = {
        model: modelId,
        messages: [{ role: 'user', content: probe }],
        temperature: 0,
        max_tokens: 80,
        stream: false,
      };
      const result = await providerManager.createCompletion(completionRequest as unknown as Parameters<typeof providerManager.createCompletion>[0], providerName) as unknown as CompletionResultLike;

      // Drain async generator if needed (some providers return a stream even when stream:false)
      let content = '';
      let usage: Record<string, unknown> = null;
      if (result && typeof (result as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function') {
        for await (const chunk of result as unknown as AsyncIterable<CompletionResultLike>) {
          if (chunk?.choices?.[0]?.delta?.content) content += chunk.choices[0].delta.content;
          if (chunk?.usage) usage = chunk.usage;
        }
      } else if (result?.choices?.[0]?.message?.content) {
        content = result.choices[0].message.content;
        usage = result.usage;
      } else if (typeof result?.content === 'string') {
        content = result.content;
        usage = result.usage;
      }

      const latencyMs = Date.now() - startedAt;
      const success = content.trim().length > 0;
      const reportedModel = (() => {
        const m = content.match(/OK\s*\|\s*(.+)/i);
        return m ? m[1].trim().slice(0, 200) : null;
      })();

      logger.info({
        providerName,
        configuredModelId: modelId,
        latencyMs,
        success,
        reportedModel,
        usage,
      }, '[Model Test] Completed');

      return reply.send({
        ok: success,
        latencyMs,
        configuredModelId: modelId,
        reportedModel,
        responsePreview: content.slice(0, 200),
        usage: usage ? {
          prompt: usage.prompt_tokens ?? usage.promptTokens,
          completion: usage.completion_tokens ?? usage.completionTokens,
          total: usage.total_tokens ?? usage.totalTokens,
        } : null,
        provider: providerName,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      logger.warn({ providerId, modelId, error: err?.message, latencyMs }, '[Model Test] Failed');
      return reply.code(200).send({
        ok: false,
        latencyMs,
        configuredModelId: modelId,
        error: err?.message || 'Test failed',
      });
    }
  });


  /**
   * PUT /api/admin/llm-providers/:providerId/models/:modelId
   * Update a model's config. modelId is URL-encoded.
   */
  fastify.put<{
    Params: { providerId: string; modelId: string };
    Body: {
      displayName?: string;
      capabilities?: { chat?: boolean; vision?: boolean; tools?: boolean; streaming?: boolean; embeddings?: boolean };
      config?: {
        maxOutputTokens?: number;
        maxInputTokens?: number;
        rateLimitRequestsPerHour?: number;
        rateLimitTokensPerHour?: number;
        temperature?: number;
        topP?: number;
        enabled?: boolean;
        roles?: string[];
      };
    };
  }>('/llm-providers/:providerId/models/:modelId', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const decodedModelId = decodeURIComponent(request.params.modelId);

      const { prisma } = await import('../../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Registry SoT — look up the row in admin.model_role_assignments.
      // Legacy provider_config.models[] is no longer the source.
      const registryRow = await prisma.modelRoleAssignment.findFirst({
        where: { provider: provider.name, model: decodedModelId },
      });

      // Model might also be referenced via model_config (chatModel, embeddingModel, etc.)
      // model_config can be stored as JSON string in some providers — parse it
      let modelConfig = (provider.model_config as ModelConfigBag) || {};
      if (typeof modelConfig === 'string') {
        try { modelConfig = JSON.parse(modelConfig); } catch { modelConfig = {}; }
      }
      const modelConfigFields = ['chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel', 'defaultModel'];
      const isInModelConfig = modelConfigFields.some(f => modelConfig[f] === decodedModelId);
      const isInDisabled = (Array.isArray(modelConfig.disabledModels) && modelConfig.disabledModels.includes(decodedModelId)) ||
        (modelConfig._disabled && Object.values(modelConfig._disabled).includes(decodedModelId));

      if (!registryRow && !isInModelConfig && !isInDisabled) {
          return reply.code(404).send({ error: 'Model not found', message: `Model '${decodedModelId}' not found on this provider` });
      }

      const updateData: Record<string, unknown> = { updated_by: request.user?.id };

      if (registryRow) {
        // Update the Registry row directly.
        await prisma.modelRoleAssignment.update({
          where: { id: registryRow.id },
          data: {
            description: request.body.displayName ?? registryRow.description,
            capabilities: request.body.capabilities ? { ...(registryRow.capabilities as Record<string, unknown> || {}), ...request.body.capabilities } : (registryRow.capabilities as Record<string, unknown>),
            max_tokens: request.body.config?.maxOutputTokens ?? registryRow.max_tokens,
            temperature: request.body.config?.temperature ?? registryRow.temperature,
            enabled: request.body.config?.enabled !== undefined ? request.body.config.enabled : registryRow.enabled,
            options: { ...((registryRow.options as Record<string, unknown>) || {}), auto: false },
          } as unknown as Prisma.ModelRoleAssignmentUpdateInput,
        });
      }

      // Update disabledModels array for ANY model source (model_config fields OR provider_config.models)
      // The smart router uses disabledModels as the single source of truth for filtering
      if (request.body.config?.enabled !== undefined) {
        const updatedModelConfig = { ...((updateData.model_config as ModelConfigBag) || modelConfig) };
        const disabledModels: string[] = Array.isArray(updatedModelConfig.disabledModels) ? [...updatedModelConfig.disabledModels] : [];

        if (!request.body.config.enabled) {
          // Add to disabled list
          if (!disabledModels.includes(decodedModelId)) {
            disabledModels.push(decodedModelId);
          }
        } else {
          // Remove from disabled list
          const idx = disabledModels.indexOf(decodedModelId);
          if (idx >= 0) disabledModels.splice(idx, 1);
        }
        updatedModelConfig.disabledModels = disabledModels;

        // Clean up any legacy _disabled data
        delete updatedModelConfig._disabled;

        updateData.model_config = updatedModelConfig;
      }

      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: updateData as unknown as Prisma.LLMProviderUpdateInput,
      });

      logger.info({ providerId, modelId: decodedModelId }, 'Model updated on provider');

      // Trigger hot-reload
      if (providerManager) {
        await invalidateAllModelCaches(logger);
      }

      return reply.send({
        message: 'Model updated successfully',
        model: registryRow ? { id: registryRow.model, displayName: request.body.displayName ?? registryRow.description } : { id: decodedModelId },
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId }, 'Failed to update model');
      return reply.code(500).send({
        error: 'Failed to update model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * DELETE /api/admin/llm-providers/:providerId/models/:modelId
   * Remove a model from a provider's provider_config.models array.
   */
  fastify.delete<{
    Params: { providerId: string; modelId: string };
    Querystring: { force?: string };
  }>('/llm-providers/:providerId/models/:modelId', async (request, reply) => {
    try {
      const { providerId } = request.params;
      const decodedModelId = decodeURIComponent(request.params.modelId);
      const force = (request.query as Record<string, unknown>)?.force === 'true';

      const { prisma } = await import('../../../utils/prisma.js');

      const provider = await resolveProvider(prisma, providerId);

      if (!provider) {
          return reply.code(404).send({ error: 'Provider not found', message: `Provider '${providerId}' not found` });
      }

      // Use computeDeletePlan() to classify references:
      //   - Self-referencing fields on THIS provider → auto-clear (was a 409 pre-2026-04-21)
      //   - Cross-provider refs / role assignments → real 409 (unless force)
      //   - Chat session pins → cascade-null (never blocks)
      const { computeDeletePlan } = await import('../../../services/model-routing/deleteModelPlan.js');

      const [roleAssignmentCount, recentSessionCount, otherProvidersRaw] = await Promise.all([
        prisma.modelRoleAssignment.count({ where: { model: decodedModelId, enabled: true } }),
        prisma.chatSession.count({
          where: { model: decodedModelId, updated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
        prisma.lLMProvider.findMany({
          where: { deleted_at: null, enabled: true, id: { not: provider.id } },
          select: { id: true, name: true, model_config: true, provider_config: true },
        }),
      ]);

      const plan = computeDeletePlan({
        targetProviderId: provider.id,
        modelId: decodedModelId,
        targetProvider: {
          id: provider.id,
          name: provider.name,
          model_config: provider.model_config as ModelConfigBag,
          provider_config: provider.provider_config as ProviderConfigBag,
        },
        otherEnabledProviders: otherProvidersRaw.map((p) => ({
          id: p.id, name: p.name,
          model_config: p.model_config as ModelConfigBag,
          provider_config: p.provider_config as ProviderConfigBag,
        })),
        roleAssignmentCount,
        recentSessionCount,
        force,
      });

      if (!plan.canDelete) {
        return reply.code(409).send({
          error: 'MODEL_IN_USE',
          message: `Cannot delete "${decodedModelId}": ${plan.blockers.map(b => b.description).join('; ')}. Use ?force=true to override.`,
          blockers: plan.blockers,
          selfReferenceFields: plan.selfReferenceFields,
          recentSessionCount: plan.recentSessionCount,
        });
      }

      // Registry SoT — delete the row from admin.model_role_assignments
      // (the new SoT) instead of mutating provider_config.models[]. Model
      // existence is checked against Registry + model_config slots only.
      const registryRows = await prisma.modelRoleAssignment.findMany({
        where: { provider: provider.name, model: decodedModelId },
      });
      // model_config can be stored as JSON string — parse it
      let modelConfig = (provider.model_config as ModelConfigBag) || {};
      if (typeof modelConfig === 'string') {
        try { modelConfig = JSON.parse(modelConfig); } catch { modelConfig = {}; }
      }

      const wasInRegistry = registryRows.length > 0;

      // Check model_config fields
      const modelConfigFields = ['chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel', 'defaultModel'];
      const wasInModelConfig = modelConfigFields.some(f => modelConfig[f] === decodedModelId);
      const wasInDisabled = Array.isArray(modelConfig.disabledModels) && modelConfig.disabledModels.includes(decodedModelId);
      const wasInAdditional = Array.isArray(modelConfig.additionalModels) && modelConfig.additionalModels.includes(decodedModelId);

      if (!wasInRegistry && !wasInModelConfig && !wasInDisabled && !wasInAdditional) {
          return reply.code(404).send({ error: 'Model not found', message: `Model '${decodedModelId}' not found on this provider` });
      }

      // Clean up model_config fields that reference this model
      const updatedModelConfig = { ...modelConfig };
      for (const field of modelConfigFields) {
        if (updatedModelConfig[field] === decodedModelId) {
          delete updatedModelConfig[field];
        }
      }
      // Also remove from additionalModels
      if (Array.isArray(updatedModelConfig.additionalModels)) {
        updatedModelConfig.additionalModels = updatedModelConfig.additionalModels.filter((m: string) => m !== decodedModelId);
      }
      // Remove from disabledModels if present (prevents dead references)
      if (Array.isArray(updatedModelConfig.disabledModels)) {
        updatedModelConfig.disabledModels = updatedModelConfig.disabledModels.filter((m: string) => m !== decodedModelId);
      }

      // Delete Registry rows for this (provider, model) pair.
      if (wasInRegistry) {
        await prisma.modelRoleAssignment.deleteMany({
          where: { provider: provider.name, model: decodedModelId },
        });
      }
      // Update model_config only (no provider_config.models[] write — Registry is SoT).
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: {
          model_config: updatedModelConfig,
          updated_by: request.user?.id
        } as unknown as Prisma.LLMProviderUpdateInput
      });

      // Cascade: null chat_sessions.model for any session pinned to the deleted model
      // so the next send falls through to the tenant default (or the router's "unknown
      // model" error) instead of silently trying to route a dangling pin.
      let sessionsCleared = 0;
      try {
        const r = await prisma.chatSession.updateMany({
          where: { model: decodedModelId },
          data: { model: null },
        });
        sessionsCleared = r.count;
      } catch (cascadeErr) {
        logger.warn({ error: cascadeErr?.message, modelId: decodedModelId }, '[admin] chat session cascade failed — non-fatal');
      }

      logger.info({ providerId: provider.id, modelId: decodedModelId, sessionsCleared }, 'Model removed from provider');

      // Audit log
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_UPDATE,
        severity: AuditSeverity.WARNING,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'REMOVE_PROVIDER_MODEL',
        resource: 'LLMProvider',
        resourceId: providerId,
        details: { modelId: decodedModelId, providerName: provider.name },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Trigger hot-reload
      if (providerManager) {
        await invalidateAllModelCaches(logger);
      }

      const remainingRegistryRows = await prisma.modelRoleAssignment.count({
        where: { provider: provider.name },
      });
      return reply.send({
        message: 'Model removed successfully',
        modelId: decodedModelId,
        remainingModels: remainingRegistryRows,
        selfReferencesCleared: plan.selfReferenceFields,
        sessionsCleared,
      });
    } catch (error) {
      logger.error({ error, providerId: request.params.providerId, modelId: request.params.modelId }, 'Failed to remove model');
      return reply.code(500).send({
        error: 'Failed to remove model',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:name/models/add-from-catalog
   * Add a model from the catalog to the provider's configuration
   */
  fastify.post<{
    Params: { name: string };
    Body: { modelId: string };
  }>('/llm-providers/:name/models/add-from-catalog', async (request, reply) => {
    try {
      const { name: providerName } = request.params;
      const { modelId } = request.body;

      if (!modelId) {
        return reply.code(400).send({ error: 'modelId is required' });
      }

      // Get model info from catalog
      const catalogResponse = await fastify.inject({
        method: 'GET',
        url: '/admin/llm-providers/vertex-ai/catalog',
        headers: request.headers
      });

      const catalog = JSON.parse(catalogResponse.payload);
      let modelInfo: ModelLike = null;

      // Search in all categories
      for (const category of ['chat', 'imageGeneration', 'embeddings']) {
        const found = catalog.catalog?.[category]?.find((m) => m.id === modelId);
        if (found) {
          modelInfo = found;
          break;
        }
      }

      if (!modelInfo) {
        return reply.code(404).send({ error: `Model ${modelId} not found in catalog` });
      }

      // Add to provider configuration
      const addResponse = await fastify.inject({
        method: 'POST',
        url: `/admin/llm-providers/${providerName}/models`,
        headers: request.headers,
        payload: {
          id: modelInfo.id,
          name: modelInfo.name,
          capabilities: modelInfo.capabilities,
          maxTokens: modelInfo.maxTokens,
          contextWindow: modelInfo.contextWindow,
          description: modelInfo.description,
          pricing: modelInfo.pricing
        }
      });

      return reply.code(addResponse.statusCode).send(JSON.parse(addResponse.payload));
    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to add model from catalog');
      return reply.code(500).send({
        error: 'Failed to add model from catalog',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers/:name/deploy-model
   * Create an AIF deployment for a catalog model via ARM API.
   * This is the AIF equivalent of "adding a model" — it provisions a deployment
   * in the CognitiveServices account so the model becomes usable for inference.
   */
  fastify.post<{
    Params: { name: string };
    Body: { modelName: string; modelVersion?: string; modelFormat?: string; sku?: string; capacity?: number; deploymentName?: string };
  }>('/llm-providers/:name/deploy-model', async (request, reply) => {
    const { name: providerName } = request.params;
    const { modelName, modelVersion, modelFormat, sku = 'GlobalStandard', capacity = 1, deploymentName } = request.body;

    if (!modelName) return reply.code(400).send({ error: 'modelName is required' });

    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const dbRecord = await prisma.lLMProvider.findFirst({
        where: { name: providerName, deleted_at: null },
      });
      if (!dbRecord || dbRecord.provider_type !== 'azure-ai-foundry') {
        return reply.code(400).send({ error: 'Provider not found or not AIF type' });
      }

      const authConfig = decryptAuthConfig(dbRecord.auth_config) || {};
      const providerConfig = (dbRecord.provider_config as ProviderConfigBag) || {};
      const tenantId = authConfig.tenantId;
      const clientId = authConfig.clientId;
      const clientSecret = authConfig.clientSecret;
      const endpointUrl = authConfig.endpointUrl || providerConfig.endpointUrl || '';

      if (!tenantId || !clientId || !clientSecret || !endpointUrl) {
        return reply.code(400).send({ error: 'AIF provider missing Entra credentials or endpoint' });
      }

      // Get ARM token
      const tokenResp = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
          scope: 'https://management.azure.com/.default',
        }).toString(),
      });
      if (!tokenResp.ok) return reply.code(500).send({ error: 'Failed to get ARM token' });
      const { access_token: armToken } = await tokenResp.json() as { access_token?: string };

      // Find the CognitiveServices account
      const hostname = new URL(endpointUrl).hostname;
      const accountName = hostname.split('.')[0];
      const subsResp = await fetch('https://management.azure.com/subscriptions?api-version=2022-12-01', {
        headers: { Authorization: `Bearer ${armToken}` },
      });
      const subsData = await subsResp.json() as { value?: Array<{ subscriptionId?: string }> };

      let subId = '', rg = '';
      for (const sub of (subsData.value || [])) {
        const acctResp = await fetch(
          `https://management.azure.com/subscriptions/${sub.subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01`,
          { headers: { Authorization: `Bearer ${armToken}` } }
        );
        if (!acctResp.ok) continue;
        const acctData = await acctResp.json() as { value?: Array<{ name?: string; id?: string }> };
        const account = (acctData.value || []).find((a) => a.name === accountName);
        if (account) {
          subId = sub.subscriptionId;
          const rgMatch = account.id?.match(/resourceGroups\/([^/]+)/i);
          rg = rgMatch?.[1] || '';
          break;
        }
      }
      if (!subId || !rg) return reply.code(404).send({ error: `Could not find AIF account ${accountName}` });

      // Create the deployment via ARM PUT
      const deplName = deploymentName || modelName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const deplUrl = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.CognitiveServices/accounts/${accountName}/deployments/${deplName}?api-version=2024-10-01`;

      // Determine model format — if not provided, infer from model name
      let format = modelFormat || 'OpenAI';
      if (!modelFormat) {
        const ml = modelName.toLowerCase();
        if (ml.includes('claude')) format = 'Anthropic';
        else if (ml.includes('llama') || ml.includes('meta-llama')) format = 'Meta';
        else if (ml.includes('mistral') || ml.includes('codestral')) format = 'Mistral AI';
        else if (ml.includes('deepseek')) format = 'DeepSeek';
        else if (ml.includes('phi')) format = 'Microsoft';
        else if (ml.includes('cohere')) format = 'Cohere';
        else if (ml.includes('grok')) format = 'xAI';
        else if (ml.includes('jamba') || ml.includes('ai21')) format = 'AI21 Labs';
        else if (ml.includes('qwen')) format = 'Alibaba';
      }

      const deplBody = {
        sku: { name: sku, capacity },
        properties: {
          model: {
            format,
            name: modelName,
            version: modelVersion || '',
          },
        },
      };

      logger.info({ accountName, deplName, modelName, sku, capacity }, 'Creating AIF deployment via ARM');

      const createResp = await fetch(deplUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${armToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(deplBody),
      });

      if (!createResp.ok) {
        const errText = await createResp.text().catch(() => '');
        logger.error({ status: createResp.status, error: errText }, 'AIF deployment creation failed');
        return reply.code(createResp.status).send({ error: `Deployment failed: ${createResp.status}`, details: errText });
      }

      const result = await createResp.json() as { properties?: { provisioningState?: string } };

      // Also add to provider_config.models[] in DB
      const existingModels = Array.isArray(providerConfig.models) ? providerConfig.models : [];
      if (!existingModels.some((m) => m.id === deplName)) {
        existingModels.push({
          id: deplName,
          name: modelName,
          capabilities: { chat: true, tools: true, streaming: true },
          config: {},
        });
        const { prisma: prisma2 } = await import('../../../utils/prisma.js');
        await prisma2.lLMProvider.update({
          where: { id: dbRecord.id },
          data: { provider_config: { ...providerConfig, models: existingModels } } as unknown as Prisma.LLMProviderUpdateInput,
        });
      }

      return reply.send({
        success: true,
        deployment: deplName,
        model: modelName,
        status: result.properties?.provisioningState || 'Creating',
        message: `Deployment "${deplName}" created. It may take 1-2 minutes to become active.`,
      });
    } catch (error) {
      logger.error({ error: error.message }, 'deploy-model failed');
      return reply.code(500).send({ error: error.message });
    }
  });


  // ──────────────────────────────────────────────────────────────────────────────
  // Per-model disable/enable endpoints
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * PUT /api/admin/llm-providers/:id/models/:modelId/disable
   * Disable a specific model within a provider
   */
  fastify.put<{ Params: { id: string; modelId: string } }>(
    '/llm-providers/:id/models/:modelId/disable',
    async (request, reply) => {
      try {
        const { id, modelId } = request.params;
        const decodedModelId = decodeURIComponent(modelId);
        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const disabledModels = provider.disabled_models || [];
        if (!disabledModels.includes(decodedModelId)) {
          disabledModels.push(decodedModelId);
        }

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            disabled_models: disabledModels,
            updated_by: request.user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'model_disabled',
          userId: request.user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, modelId: decodedModelId },
          severity: AuditSeverity.WARNING,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, modelId: decodedModelId }, 'Model disabled');

        return reply.send({
          success: true,
          message: `Model ${decodedModelId} disabled on provider ${provider.display_name}`,
          providerId: id,
          modelId: decodedModelId,
          disabledModels
        });
      } catch (error) {
        logger.error({ error }, 'Failed to disable model');
        return reply.code(500).send({
          error: 'Failed to disable model',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );


  /**
   * PUT /api/admin/llm-providers/:id/models/:modelId/enable
   * Enable a previously disabled model within a provider
   */
  fastify.put<{ Params: { id: string; modelId: string } }>(
    '/llm-providers/:id/models/:modelId/enable',
    async (request, reply) => {
      try {
        const { id, modelId } = request.params;
        const decodedModelId = decodeURIComponent(modelId);
        const { prisma } = await import('../../../utils/prisma.js');

        const provider = await prisma.lLMProvider.findUnique({ where: { id } });
        if (!provider) {
              return reply.code(404).send({ error: 'Provider not found' });
        }

        const disabledModels = (provider.disabled_models || []).filter(
          (m: string) => m !== decodedModelId
        );

        await prisma.lLMProvider.update({
          where: { id },
          data: {
            disabled_models: disabledModels,
            updated_by: request.user?.id || null
          }
        });
  
        await auditTrail.log({
          eventType: AuditEventType.ADMIN_ACTION,
          action: 'model_enabled',
          userId: request.user?.id || 'admin',
          details: { providerId: id, providerName: provider.name, modelId: decodedModelId },
          severity: AuditSeverity.INFO,
          resource: 'admin-llm-providers',
          timestamp: new Date(),
          success: true
        });

        logger.info({ providerId: id, modelId: decodedModelId }, 'Model enabled');

        return reply.send({
          success: true,
          message: `Model ${decodedModelId} enabled on provider ${provider.display_name}`,
          providerId: id,
          modelId: decodedModelId,
          disabledModels
        });
      } catch (error) {
        logger.error({ error }, 'Failed to enable model');
        return reply.code(500).send({
          error: 'Failed to enable model',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        });
      }
    }
  );

};


export default modelsCrudRoutes;
