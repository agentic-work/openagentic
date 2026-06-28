/**
 * Admin LLM-provider CRUD + read routes.
 *
 *   GET    /llm-providers
 *   GET    /llm-providers/:name
 *   GET    /llm-providers/config
 *   GET    /llm-providers/database
 *   POST   /llm-providers
 *   PUT    /llm-providers/:id
 *   DELETE /llm-providers/:id
 *
 * Registered as a sub-plugin of llmProviderRoutes; the parent (admin.ts ->
 * adminMiddleware) applies admin auth, so this plugin must NOT re-add it.
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

/**
 * Strip model-list fields from inbound `modelConfig` before persisting.
 *
 * Why: the Add-Provider wizard's Test-Connection step runs `discoverModels()`
 * and (incorrectly) stuffs the catalog into modelConfig.{chatModel,
 * embeddingModel, additionalModels, codeModel, defaultModel}. Storing that
 * verbatim violates the "Registry == explicit add" rule (#459) — a
 * freshly-added provider then appears to "have" 88 phantom models the user
 * never selected.
 *
 * Provider-create persists creds + non-model config only. Models enter the
 * Registry via:
 *   - Admin "Add Model" wizard (POST /llm-providers/:id/models), OR
 *   - Curated-upstream auto-sync (AIF, Ollama) → `upsertDiscoveredModels`,
 *     which writes Registry rows directly (NOT model_config).
 *
 * Exported so the regression test can unit-check it without spinning up the
 * Fastify route module.
 */

export function sanitizeProviderModelConfig(input): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const {
    chatModel: _chatModel,
    embeddingModel: _embeddingModel,
    additionalModels: _additionalModels,
    codeModel: _codeModel,
    defaultModel: _defaultModel,
    ...rest
  } = input;
  return rest;
}


export const providersCrudRoutes: FastifyPluginAsync<ProviderRoutesOptions> = async (fastify, opts) => {
  const logger = fastify.log as Logger;
  const providerManager = opts.providerManager;
  const auditTrail = new AuditTrail();


  /**
   * GET /api/admin/llm-providers
   * List all configured providers from database (single source of truth)
   *
   * ARCHITECTURE: Database is the ONLY source of provider configuration.
   * Environment variables are seeded to DB at startup by LLMProviderSeeder.
   */
  fastify.get('/llm-providers', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');

      // Get providers from database ONLY - database is the single source of truth
      // Deduplicate by provider_type — if same type appears multiple times,
      // each gets a contextual display name (hostname, deployment, region)
      const dbProviders = await prisma.lLMProvider.findMany({
        where: { deleted_at: null },
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ]
      });

      // Count providers per type to detect duplicates
      const typeCounts = new Map<string, number>();
      dbProviders.forEach(p => typeCounts.set(p.provider_type, (typeCounts.get(p.provider_type) || 0) + 1));

      // For duplicate types, enrich display_name with context
      for (const p of dbProviders) {
        if ((typeCounts.get(p.provider_type) || 0) > 1) {
          const pc = p.provider_config as ProviderConfigBag || {};
          const ac = p.auth_config as AuthConfigBag || {};
          let ctx = '';
          if (p.provider_type === 'ollama') ctx = pc.host || pc.endpoint || 'localhost';
          else if (p.provider_type.includes('azure')) ctx = pc.deployment || pc.endpoint?.split('.')?.[0] || ac.tenantId || '';
          else if (p.provider_type === 'aws-bedrock') ctx = ac.region || pc.region || 'us-east-1';
          else if (p.provider_type === 'vertex-ai') ctx = pc.projectId || pc.location || '';
          if (ctx) {
            // Bug-fix 2026-05-06: keep `:` in the slug so `host:port`
            // doesn't collapse to `host port` (became `10.0.0.13611434`
            // for the new ollama-dev-win11 provider — confusing). Strip
            // protocol prefix first, then strip everything except a-z,
            // 0-9, and the punctuation that has structural meaning in a
            // URL host (`. - :`).
            const slug = ctx.replace(/https?:\/\//, '').replace(/[^a-z0-9.\-:]/gi, '').slice(0, 40);
            p.display_name = `${p.display_name} (${slug})`;
          }
        }
      }

      // Pull every Registry row in one query so each provider can be
      // enriched with its currently-enabled model list. This replaces
      // the legacy provider_config.models[] iteration (the field is
      // being deleted in favor of admin.model_role_assignments).
      const allRegistryRows = await prisma.modelRoleAssignment.findMany({
        where: { enabled: true },
        select: { provider: true, model: true, capabilities: true, max_tokens: true, description: true },
      });
      const rowsByProvider = new Map<string, typeof allRegistryRows>();
      for (const r of allRegistryRows) {
        const arr = rowsByProvider.get(r.provider) ?? [];
        arr.push(r);
        rowsByProvider.set(r.provider, arr);
      }

      // Convert database providers to consistent format
      const providers = dbProviders.map(p => {
        const providerConfig = p.provider_config as ProviderConfigBag || {};
        const modelConfig = p.model_config as ModelConfigBag || {};
        const authConfig = p.auth_config as AuthConfigBag || {};

        // Build models array from model_config
        const models = [];

        // Primary model from modelId or chatModel
        const primaryModel = providerConfig.modelId || modelConfig.chatModel || modelConfig.defaultModel;
        if (primaryModel) {
          models.push({
            id: primaryModel,
            name: primaryModel,
            provider: p.name,
            capabilities: p.capabilities || { chat: true, tools: true, vision: false, embeddings: false },
            maxTokens: modelConfig.maxTokens || modelConfig.contextWindow || modelConfig.maxOutputTokens || 8192
          });
        }

        // Add Registry-enabled rows for this provider (Registry SoT replaces
        // legacy provider_config.models[]).
        const registryRows = rowsByProvider.get(p.name) ?? [];
        for (const r of registryRows) {
          if (!models.find(existing => existing.id === r.model)) {
            models.push({
              id: r.model,
              name: r.description || r.model,
              provider: p.name,
              capabilities: (r.capabilities as Record<string, unknown>) || {},
              maxTokens: r.max_tokens ?? 8192,
            });
          }
        }

        return {
          id: p.id,
          name: p.name,
          displayName: p.display_name,
          type: p.provider_type,
          enabled: p.enabled,
          priority: p.priority,
          // §11.5 — clients POST this back on edit so we can detect
          // concurrent saves and 409 instead of clobbering.
          version: typeof (p as { version?: number | bigint }).version === 'bigint' ? Number((p as { version?: number | bigint }).version) : Number((p as { version?: number | bigint }).version ?? 1),
          updated_by: p.updated_by ?? null,
          updated_at: p.updated_at,
          config: {
            ...providerConfig,
            ...modelConfig,
            region: authConfig.region
          },
          authConfig: {
            type: authConfig.type || 'none',
            // Don't expose sensitive credentials
            hasApiKey: !!authConfig.apiKey,
            hasCredentials: !!(authConfig.accessKeyId || authConfig.clientId || authConfig.credentials || authConfig.clientSecret || authConfig.serviceAccountKey)
          },
          capabilities: p.capabilities || { chat: true, tools: true, vision: false, streaming: true },
          models
        };
      });

      const totalModels = providers.reduce((sum, p) => sum + (p.models?.length || 0), 0);

      return reply.send({
        providers: providers.map(p => ({
          ...p,
          models: (p.models || []).map((model) => ({
            ...model,
            capabilities: model.capabilities || { chat: true, embeddings: false, tools: true, vision: false },
            maxTokens: model.maxTokens || model.contextWindow || model.maxOutputTokens || 8192
          }))
        })),
        totalProviders: providers.length,
        totalModels
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list LLM providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/:name
   * Get details for a specific provider
   */
  fastify.get<{ Params: { name: string } }>('/llm-providers/:name', async (request, reply) => {
    try {
      const { name } = request.params;

      if (!providerManager) {
        return reply.code(503).send({
          error: 'ProviderManager not initialized',
          message: 'LLM provider details are not available'
        });
      }

      if (!providerManager.hasProvider(name)) {
        return reply.code(404).send({
          error: 'Provider not found',
          message: `Provider '${name}' is not configured`
        });
      }

      const provider = providerManager.getProvider(name);
      const metrics = providerManager.getProviderMetrics(name);
      const health = await provider?.getHealth();
      const models = await provider?.listModels();

      return reply.send({
        provider: name,
        health,
        metrics,
        models,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error, provider: request.params.name }, 'Failed to get provider details');
      return reply.code(500).send({
        error: 'Failed to get provider details',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/config
   * Get current provider configuration
   */
  fastify.get('/llm-providers/config', async (request, reply) => {
    try {
      const configService = new ProviderConfigService(logger);
      const config = await configService.loadProviderConfig();
      const validation = configService.validateConfig(config);
      const summary = configService.getConfigSummary(config);

      return reply.send({
        config: {
          defaultProvider: config.defaultProvider,
          enableFailover: config.enableFailover,
          failoverTimeout: config.failoverTimeout,
          enableLoadBalancing: config.enableLoadBalancing,
          loadBalancingStrategy: config.loadBalancingStrategy,
          providers: config.providers.map(p => ({
            name: p.name,
            type: p.type,
            enabled: p.enabled,
            priority: p.priority,
            maxTokens: p.config.maxTokens,
            temperature: p.config.temperature
          }))
        },
        validation,
        summary,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get provider configuration');
      return reply.code(500).send({
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * POST /api/admin/llm-providers
   * Create a new LLM provider configuration
   *
   * #459 follow-up (2026-04-30): inbound `modelConfig` MUST have its
   * model-list fields stripped via `sanitizeProviderModelConfig` before
   * persistence. The Add-Provider wizard's Test-Connection step runs
   * `discoverModels()` and (incorrectly) stuffs the catalog into
   * `modelConfig.{chatModel, embeddingModel, additionalModels}`. Storing
   * that verbatim violates the "Registry == explicit add" rule —
   * the user sees phantom models on a provider they never added.
   *
   * Provider creation = creds + non-model config only.
   * Models enter the Registry via:
   *   - Admin "Add Model" wizard (POST /llm-providers/:id/models), OR
   *   - Curated-upstream auto-sync (AIF, Ollama) handled below by
   *     `discoverModels()` → `upsertDiscoveredModels()`, which writes
   *     Registry rows directly (NOT model_config).
   */
  fastify.post<{
    Body: {
      name: string;
      displayName: string;
      providerType: 'azure-openai' | 'vertex-ai' | 'aws-bedrock' | 'ollama' | 'openai' | 'anthropic';
      enabled?: boolean;
      priority?: number;
      authConfig: Record<string, unknown>;
      providerConfig: Record<string, unknown>;
      modelConfig?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      description?: string;
      tags?: string[];
    };
  }>('/llm-providers', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');

      const {
        name,
        displayName,
        providerType,
        enabled = true,
        priority = 1,
        authConfig,
        providerConfig,
        modelConfig = {},
        capabilities = {},
        description,
        tags = []
      } = request.body;

      // Validate required fields
      if (!name || !displayName || !providerType || !authConfig || !providerConfig) {
        return reply.code(400).send({
          error: 'Missing required fields',
          required: ['name', 'displayName', 'providerType', 'authConfig', 'providerConfig']
        });
      }

      // Discriminator enforcement (discriminator origin metadata): reject generic
      // names + require per-type origin fields (env + per-type identifiers).
      // Existing rows are grandfathered; only new POSTs are validated here.
      // Tunable via PROVIDER_DISCRIMINATOR_ENFORCED=false (admin escape hatch
      // during the rolling migration window).
      if (process.env.PROVIDER_DISCRIMINATOR_ENFORCED !== 'false') {
        if (isGenericName(displayName) || isGenericName(name)) {
          return reply.code(400).send({
            success: false,
            error: 'Provider name is too generic. Add an environment + identifier (e.g. "bedrock-prod-1234-us-east-1").',
            code: 'GENERIC_NAME_REJECTED',
          });
        }
        const origin = (providerConfig?.origin as Record<string, string | undefined> | undefined) || {};
        const validation = validateDiscriminator(providerType, origin);
        if (validation.ok === false) {
          const missing = validation.missing;
          return reply.code(400).send({
            success: false,
            error: `Missing required origin fields: ${missing.join(', ')}`,
            code: 'DISCRIMINATOR_MISSING',
            missing,
            suggestedDisplayName: buildAutoDisplayName(providerType, origin),
          });
        }
      }

      // SECURITY: Encrypt sensitive credential fields before storage
      const encryptedAuthConfig = encryptAuthConfig(authConfig);

      // #289: clear any soft-deleted row that holds this name. The unique
      // constraint is on the raw `name` column (not `(name, deleted_at IS
      // NULL)`), so a previously-soft-deleted provider blocks re-add with
      // the same name. Treating "delete then re-add" as a clean restart is
      // the simplest UX — hard-delete the soft-deleted ghost first.
      try {
        const soft = await prisma.lLMProvider.deleteMany({
          where: { name, deleted_at: { not: null } },
        });
        if (soft.count > 0) {
          logger.info({ name, removed: soft.count }, 'Cleared soft-deleted provider rows before re-add (#289)');
        }
      } catch (cleanupErr) {
        logger.warn({ name, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) }, 'Soft-delete cleanup failed; proceeding to create — duplicate-name error may follow');
      }

      // Create provider
      // #459 follow-up: `sanitizeProviderModelConfig` strips the wizard's
      // discovery-result pollution (chatModel/embeddingModel/additionalModels)
      // from inbound modelConfig. Provider creation = creds + non-model
      // config only.
      const provider = await prisma.lLMProvider.create({
        data: {
          name,
          display_name: displayName,
          provider_type: providerType,
          enabled,
          priority,
          auth_config: encryptedAuthConfig,
          provider_config: providerConfig,
          model_config: sanitizeProviderModelConfig(modelConfig),
          capabilities,
          description,
          tags,
          created_by: request.user?.id
        } as unknown as Prisma.LLMProviderCreateInput
      });

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider created');

      // Audit: credential creation (generic admin audit)
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_CREATE,
        severity: AuditSeverity.INFO,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'CREATE_LLM_PROVIDER',
        resource: 'LLMProvider',
        resourceId: provider.id,
        details: { providerName: name, providerType },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Credential-specific audit trail (dedicated table)
      credentialAuditService.log({
        userId: request.user?.id || 'unknown',
        userEmail: request.user?.email,
        action: 'create',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: name,
        changes: {
          providerType: { new: providerType },
          enabled: { new: enabled },
          priority: { new: priority },
        },
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists. After reload the new
      // provider is in the live map and discoverModels() has populated
      // discoveredCapabilities — we then auto-persist those discovered models
      // into provider_config.models[] so admins don't have to manually add
      // each one. This is the AIF auto-discovery flow (#49) but works for
      // every provider type that implements discoverModels().
      let autoDiscoveredCount = 0;
      let registryUpserted = 0;
      let autoSyncSkipped = false;
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded with new provider');

        try {
          const liveProvider = (providerManager as unknown as { providers?: Map<string, ProviderRuntime> }).providers?.get(name);
          if (liveProvider && typeof liveProvider.discoverModels === 'function') {
            const discovered = await liveProvider.discoverModels();
            if (Array.isArray(discovered) && discovered.length > 0) {
              // Pull provider defaults so each auto-added model row has sensible
              // temperature/topP/maxTokens/capabilities populated from the
              // provider's own getModelDefaults() (so admins see real values
              // in the registry instead of zeros).
              const getDefaults = typeof liveProvider.getModelDefaults === 'function'
                ? (id: string) => liveProvider.getModelDefaults(id).catch(() => null)
                : async () => null;

              const models = await Promise.all(discovered.map(async (m: ModelLike) => {
                const defaults = await getDefaults(m.id);
                return {
                  id: m.id,
                  displayName: m.name || m.id,
                  config: {
                    enabled: true,
                    roles: m.capabilities?.embeddings ? ['embeddings'] : ['chat'],
                    temperature: defaults?.temperature ?? 0.7,
                    topP: defaults?.topP ?? 1.0,
                    maxInputTokens: m.contextWindow ?? 128000,
                    maxOutputTokens: m.maxOutputTokens ?? defaults?.maxTokens ?? 4096,
                    rateLimitRequestsPerHour: 0,
                    rateLimitTokensPerHour: 0,
                  },
                  capabilities: m.capabilities ?? { chat: true, streaming: true },
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  autoDiscovered: true,
                };
              }));

              // Legacy provider_config.models[] merge removed — Registry SoT
              // owns the model list now. The Registry upsert immediately
              // below populates admin.model_role_assignments with the
              // discovered set; that's where every reader looks.
              autoDiscoveredCount = models.length;
              logger.info({
                providerName: name,
                autoDiscoveredCount,
              }, '[ProviderCreate] Discovered models — handing off to Registry upsert');

              // Registry SoT (task #2): populate admin.model_role_assignments
              // for each discovered model so chat toolbar + Smart Router +
              // admin Models page have a single source of truth instead of
              // reading discoveredCapabilities.
              //
              // #311 GATE: only auto-upsert for curated-upstream providers
              // (AIF deployments, Ollama host pulls). Bulk-catalog providers
              // (Bedrock/Vertex/OpenAI/Anthropic/AzureOpenAI) must go through
              // the admin "Add Model" UI so Registry stays curated.
              // See feedback_registry_explicit_add.md for the full rationale.
              if (shouldAutoSyncRegistry(providerType)) {
                try {
                  // Task #342: instantiate PricingService per-request.
                  // Cheap (just a Map); avoids holding a long-lived PrismaClient
                  // handle at module scope. Fetcher caching is per-instance so
                  // the @aws-sdk/client-pricing SDK load only happens when the
                  // first Bedrock row is priced inside fetchAndStorePricing().
                  const pricingService = new PricingService(prisma);
                  // region comes from auth_config.region first (Bedrock stores
                  // it there post-encryption-decrypt); fallback to
                  // provider_config.region for providers that keep it outside
                  // the credential blob.
                  const region =
                    (authConfig?.region as string | undefined) ??
                    (providerConfig?.region as string | undefined) ??
                    null;

                  const registryResult = await upsertDiscoveredModels(
                    {
                      providerName: name,
                      discovered: discovered as unknown as Parameters<typeof upsertDiscoveredModels>[0]['discovered'],
                      createdBy: request.user?.id ?? 'seeder',
                      providerType,
                      region,
                      pricingService,
                    },
                    prisma as unknown as RegistryUpsertPrismaLike,
                  );
                  registryUpserted = (registryResult.inserted || 0) + (registryResult.updated || 0);
                  logger.info({
                    providerName: name,
                    providerType,
                    region,
                    registryInserted: registryResult.inserted,
                    registryUpdated: registryResult.updated,
                  }, '[ProviderCreate] Registry rows upserted (auto-sync allowed); pricing fetch dispatched in background');
                } catch (registryErr) {
                  logger.warn({
                    error: registryErr?.message,
                    providerName: name,
                  }, '[ProviderCreate] Registry upsert failed (non-fatal)');
                }
              } else {
                autoSyncSkipped = true;
                logger.info({
                  providerName: name,
                  providerType,
                  discoveredCount: discovered.length,
                }, '[ProviderCreate] Registry auto-sync skipped — explicit Add Model required for this provider type');
              }

              // Bust caches again so the freshly persisted model list is
              // reflected in /chat/models and the chat dropdown signal.
              await invalidateAllModelCaches(logger);
            }
          }
        } catch (discoveryErr) {
          logger.warn({
            error: discoveryErr.message,
            providerName: name
          }, '[ProviderCreate] Auto-discovery failed (non-fatal — admin can add models manually)');
        }
      }

      // Disconnect the prisma client now that all writes are done.

      // #459: be explicit about what landed in the Registry vs what was just
      // discovered in the catalog. Bedrock/Vertex/OpenAI/Anthropic/AzureOpenAI
      // skip auto-sync (#311 policy) so `autoDiscoveredCount` says "we saw 32
      // models" but `registryUpserted: 0` says "nothing was added to the
      // Registry — admin must use Models → Add Model to register specific
      // ones". The Provider Management page banner says the same thing.
      let message: string;
      if (registryUpserted > 0) {
        message = `Provider created. ${registryUpserted} model(s) added to the Registry from auto-sync.`;
      } else if (autoSyncSkipped && autoDiscoveredCount > 0) {
        message = `Provider created. Discovered ${autoDiscoveredCount} catalog model(s) — use Models → Add Model to register specific ones (auto-sync intentionally disabled for this provider type).`;
      } else if (autoDiscoveredCount > 0) {
        message = `Provider created. Discovered ${autoDiscoveredCount} model(s) from the provider; 0 added to the Registry.`;
      } else {
        message = 'Provider created successfully';
      }

      // §11.5 — normalize the BigInt `version` column before send. Fastify's
      // JSON serializer can't handle BigInt natively. Same pattern as GET
      // and the 409 conflict path.
      const providerOut = {
        ...provider,
        version: typeof (provider as { version?: number | bigint }).version === 'bigint'
          ? Number((provider as { version?: number | bigint }).version)
          : Number((provider as { version?: number | bigint }).version ?? 1),
      };

      // Hot-reload providerManager so the new provider is routable in this
      // pod immediately — without it the modelToProviderMap is stale until
      // the next pod restart, and any model registered against the new
      // provider gets routed to the wrong provider (or none). Live repro
      // 2026-05-06 (gemma4:latest mis-routed to `hal`). reloadProviders()
      // is atomic — old map keeps serving while the new one builds, then
      // swaps in (#74). Best-effort: if reload throws we still return 201
      // because the DB write succeeded; the next reload (next CRUD or pod
      // restart) will pick it up.
      if (providerManager) {
        try {
          await providerManager.reloadProviders();
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id },
            '[admin] post-create reloadProviders() failed — provider in DB but routing not yet refreshed',
          );
        }
      }

      return reply.code(201).send({
        provider: providerOut,
        autoDiscoveredCount,
        registryUpserted,
        autoSyncSkipped,
        message,
      });

    } catch (error) {
      // Prisma P2002 = unique-constraint violation. The `name` column is
      // the only unique constraint we expose to admins, so surface a clean
      // 409 message instead of leaking the raw Prisma stacktrace into the
      // toast (#100 — user reported "Save failed: Invalid prisma.lLMProvider
      // .create() invocation: Unique constraint failed on the fields:
      // (`name`)" appearing verbatim in the UI).
      if (error?.code === 'P2002') {
        const target = Array.isArray(error?.meta?.target)
          ? error.meta.target.join(', ')
          : String(error?.meta?.target ?? 'name');
        logger.warn({ target, providerName: (request.body as Record<string, unknown>)?.name }, 'P2002 on LLM provider create');
        return reply.code(409).send({
          error: 'A provider with this name already exists',
          message: `Field "${target}" must be unique. Pick a different name (e.g. add an env / region suffix).`,
          field: target,
        });
      }
      logger.error({ error }, 'Failed to create LLM provider');
      return reply.code(500).send({
        error: 'Failed to create provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * PUT /api/admin/llm-providers/:id
   * Update an existing LLM provider
   */
  fastify.put<{
    Params: { id: string };
    Body: {
      displayName?: string;
      enabled?: boolean;
      priority?: number;
      authConfig?: Record<string, unknown>;
      providerConfig?: Record<string, unknown>;
      modelConfig?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      description?: string;
      tags?: string[];
      /** §11.5 optimistic-concurrency token. The version the client just GET'd. */
      version?: number;
    };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { id } = request.params;

      // §11.5 — version is required on every write so concurrent admins
      // can't silently clobber each other.
      const clientVersion = request.body?.version;
      if (typeof clientVersion !== 'number' || !Number.isInteger(clientVersion) || clientVersion < 0) {
        return reply.code(400).send({
          error: 'version must be a non-negative integer (POST the version you GET\'d back to confirm no other admin has saved since).',
        });
      }

      // Fetch existing provider for change diffing
      const existingProvider = await prisma.lLMProvider.findUnique({ where: { id } });
      if (!existingProvider) {
          return reply.code(404).send({ error: 'Provider not found' });
      }

      const currentVersion = typeof (existingProvider as { version?: number | bigint }).version === 'bigint'
        ? Number((existingProvider as { version?: number | bigint }).version)
        : Number((existingProvider as { version?: number | bigint }).version ?? 0);
      if (clientVersion !== currentVersion) {
        const conflictingFields: string[] = [];
        const b = request.body;
        if (b.displayName !== undefined && b.displayName !== existingProvider.display_name) conflictingFields.push('displayName');
        if (b.enabled !== undefined && b.enabled !== existingProvider.enabled) conflictingFields.push('enabled');
        if (b.priority !== undefined && b.priority !== existingProvider.priority) conflictingFields.push('priority');
        if (b.description !== undefined && b.description !== existingProvider.description) conflictingFields.push('description');
        return reply.code(409).send({
          error: 'Conflict: another admin saved this provider before your save landed.',
          currentRow: { ...existingProvider, version: currentVersion },
          conflictingFields,
        });
      }

      // Discriminator enforcement on UPDATE: only validate fields the caller is
      // actually changing — pre-existing rows are grandfathered. Same env flag
      // and same error codes as POST.
      if (process.env.PROVIDER_DISCRIMINATOR_ENFORCED !== 'false') {
        if (request.body.displayName !== undefined && isGenericName(request.body.displayName)) {
          return reply.code(400).send({
            success: false,
            error: 'Provider name is too generic. Add an environment + identifier (e.g. "bedrock-prod-1234-us-east-1").',
            code: 'GENERIC_NAME_REJECTED',
          });
        }
        const incomingOrigin = (request.body.providerConfig as Record<string, unknown> | undefined)?.origin;
        if (incomingOrigin !== undefined) {
          const validation = validateDiscriminator(
            existingProvider.provider_type,
            incomingOrigin as Record<string, string | undefined>,
          );
          if (validation.ok === false) {
            const missing = validation.missing;
            return reply.code(400).send({
              success: false,
              error: `Missing required origin fields: ${missing.join(', ')}`,
              code: 'DISCRIMINATOR_MISSING',
              missing,
              suggestedDisplayName: buildAutoDisplayName(
                existingProvider.provider_type,
                incomingOrigin as Record<string, string>,
              ),
            });
          }
        }
      }

      const updateData: { provider_config?: Record<string, unknown>; [key: string]: unknown } = {};

      if (request.body.displayName !== undefined) updateData.display_name = request.body.displayName;
      if (request.body.enabled !== undefined) updateData.enabled = request.body.enabled;
      if (request.body.priority !== undefined) updateData.priority = request.body.priority;

      // MERGE auth_config: don't wipe existing credentials when UI sends partial update
      // (the GET /database endpoint strips credential values, so edit form starts empty)
      if (request.body.authConfig !== undefined) {
        const existingAuth = decryptAuthConfig(existingProvider.auth_config) || {};
        const newAuth = request.body.authConfig || {};
        // Keep existing credential values for any field that is empty/missing in the update
        const merged: Record<string, unknown> = { ...existingAuth };
        for (const [key, value] of Object.entries(newAuth)) {
          if (value !== undefined && value !== null && value !== '') {
            merged[key] = value;
          }
        }
        updateData.auth_config = encryptAuthConfig(merged);
      }

      // MERGE provider_config: preserve existing models array and other fields not in the update
      if (request.body.providerConfig !== undefined) {
        const existingPC = existingProvider.provider_config as ProviderConfigBag || {};
        const newPC = request.body.providerConfig || {};
        // Merge: new fields overwrite existing, but preserve models array if not in update
        const mergedPC: Record<string, unknown> = { ...existingPC, ...newPC };
        if (!newPC.models && existingPC.models) {
          mergedPC.models = existingPC.models; // Preserve manually-added models
        }
        updateData.provider_config = mergedPC;
      }

      // Mark as admin-owned so seeder won't overwrite admin's manual changes
      if (!updateData.provider_config) {
        const existingPC = existingProvider.provider_config as ProviderConfigBag || {};
        updateData.provider_config = { ...existingPC, seeder_managed: false };
      } else {
        updateData.provider_config.seeder_managed = false;
      }

      // MERGE model_config: preserve disabledModels and other fields, but
      // strip wizard-side model-list pollution (chatModel / embeddingModel /
      // additionalModels / codeModel / defaultModel) from the inbound side
      // so PUT can never reintroduce phantom model state. The Registry is
      // the single SoT for which models a provider exposes.
      if (request.body.modelConfig !== undefined) {
        const existingMC = existingProvider.model_config as ModelConfigBag || {};
        const sanitizedNewMC = sanitizeProviderModelConfig(request.body.modelConfig);
        updateData.model_config = { ...existingMC, ...sanitizedNewMC };
      }
      if (request.body.capabilities !== undefined) updateData.capabilities = request.body.capabilities;
      if (request.body.description !== undefined) updateData.description = request.body.description;
      if (request.body.tags !== undefined) updateData.tags = request.body.tags;

      updateData.updated_by = request.user?.id;

      // Version-gated update. updateMany permits a non-unique WHERE
      // (id + version), and tells us count=0 if the version is stale —
      // which we treat as a 409 race condition rather than a 500.
      const updateResult = await prisma.lLMProvider.updateMany({
        where: { id, version: clientVersion } as unknown as Prisma.LLMProviderWhereInput,
        data: { ...updateData, version: { increment: 1 } } as unknown as Prisma.LLMProviderUpdateInput,
      });
      if (updateResult.count === 0) {
        // Race: someone else saved between our findUnique and updateMany.
        const fresh = await prisma.lLMProvider.findUnique({ where: { id } });
        const freshVersion = fresh && typeof (fresh as { version?: number | bigint }).version === 'bigint'
          ? Number((fresh as { version?: number | bigint }).version)
          : Number((fresh as { version?: number | bigint })?.version ?? 0);
        return reply.code(409).send({
          error: 'Conflict: provider was updated between read and write.',
          currentRow: fresh ? { ...fresh, version: freshVersion } : null,
          conflictingFields: [],
        });
      }
      const refetched = await prisma.lLMProvider.findUnique({ where: { id } });
      const provider = refetched
        ? { ...refetched, version: typeof (refetched as { version?: number | bigint }).version === 'bigint' ? Number((refetched as { version?: number | bigint }).version) : Number((refetched as { version?: number | bigint }).version ?? 0) }
        : null;
      if (!provider) {
        return reply.code(500).send({ error: 'Provider update succeeded but row vanished on refetch' });
      }

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider updated');

      // Audit: credential update (generic admin audit)
      if (request.body.authConfig !== undefined) {
        auditTrail.log({
          timestamp: new Date(),
          eventType: AuditEventType.CREDENTIAL_UPDATE,
          severity: AuditSeverity.INFO,
          userId: request.user?.id,
          userEmail: request.user?.email,
          action: 'UPDATE_LLM_PROVIDER_CREDENTIALS',
          resource: 'LLMProvider',
          resourceId: provider.id,
          details: { providerName: provider.name },
          success: true,
          ipAddress: request.ip,
        }).catch(() => {});
      }

      // Credential-specific audit trail (dedicated table) -- log ALL updates, not just auth changes
      const changes: Record<string, { old?: unknown; new?: unknown }> = {};
      if (request.body.displayName !== undefined) {
        changes.displayName = { old: existingProvider.display_name, new: request.body.displayName };
      }
      if (request.body.enabled !== undefined) {
        changes.enabled = { old: existingProvider.enabled, new: request.body.enabled };
      }
      if (request.body.priority !== undefined) {
        changes.priority = { old: existingProvider.priority, new: request.body.priority };
      }
      if (request.body.authConfig !== undefined) {
        // Do NOT log raw credential values -- just note that auth config changed
        changes.authConfig = { old: '[redacted]', new: '[redacted]' };
      }
      if (request.body.providerConfig !== undefined) {
        changes.providerConfig = { old: '[previous]', new: '[updated]' };
      }
      if (request.body.description !== undefined) {
        changes.description = { old: existingProvider.description, new: request.body.description };
      }

      credentialAuditService.log({
        userId: request.user?.id || 'unknown',
        userEmail: request.user?.email,
        action: 'update',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: provider.name,
        changes,
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists. The cache-invalidate
      // alone (pre-2026-05-06) didn't rebuild the providerManager.providers
      // map or modelToProviderMap → routing stayed pinned to the OLD
      // provider config (e.g. baseUrl change didn't take effect until pod
      // restart). reloadProviders() is atomic per #74 — old map serves
      // traffic until the new one is fully built and swapped.
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        try {
          await providerManager.reloadProviders();
          logger.info({ providerId: provider.id }, 'Provider manager reloaded with updated configuration');
        } catch (reloadErr) {
          logger.warn(
            { err: (reloadErr as Error).message, providerId: provider.id },
            '[admin] post-update reloadProviders() failed — provider DB row updated but routing not yet refreshed',
          );
        }
      }

      return reply.send({
        provider,
        message: 'Provider updated successfully'
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to update LLM provider');
      return reply.code(500).send({
        error: 'Failed to update provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * DELETE /api/admin/llm-providers/:id
   * Soft delete an LLM provider
   */
  fastify.delete<{
    Params: { id: string };
    Querystring: { force?: string };
  }>('/llm-providers/:id', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');
      const { id } = request.params;
      const force = (request.query as { force?: string })?.force === 'true';

      // Check if provider exists
      const existing = await prisma.lLMProvider.findUnique({ where: { id } });
      if (!existing) {
          return reply.code(404).send({ error: 'Provider not found' });
      }

      // Guard: check if provider's models are currently in use
      if (!force) {
        const usages: string[] = [];
        const provName = existing.name;

        // Check model role assignments referencing this provider
        const roleAssignments = await prisma.modelRoleAssignment.count({
          where: { provider: provName, enabled: true }
        });
        if (roleAssignments > 0) {
          usages.push(`${roleAssignments} active model role assignment(s)`);
        }

        // Check active chat sessions using models from this provider (last 24h)
        const mc = existing.model_config as ModelConfigBag || {};
        const pc = existing.provider_config as ProviderConfigBag || {};
        const providerModelIds = new Set<string>();
        for (const f of ['chatModel', 'defaultModel', 'embeddingModel', 'visionModel', 'imageModel']) {
          if (mc[f]) providerModelIds.add(mc[f] as string);
        }
        if (pc.modelId) providerModelIds.add(pc.modelId);
        if (Array.isArray(pc.models)) {
          for (const m of pc.models) { if (m.id) providerModelIds.add(m.id); }
        }

        if (providerModelIds.size > 0) {
          const recentSessions = await prisma.chatSession.count({
            where: {
              model: { in: Array.from(providerModelIds) },
              updated_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }
          });
          if (recentSessions > 0) {
            usages.push(`${recentSessions} active chat session(s) in the last 24h`);
          }
        }

        if (usages.length > 0) {
              return reply.code(409).send({
            error: 'Provider is currently in use',
            message: `Cannot delete "${existing.display_name || existing.name}": ${usages.join(', ')}. Use ?force=true to override.`,
            usages,
          });
        }
      }

      // Soft delete by setting deleted_at timestamp + cascade-disable any
      // ModelRoleAssignment rows that reference this provider by name
      // (Phase G of the design notes).
      //
      // Why cascade in a transaction:
      //   ModelRoleAssignment.provider is a string column with no FK to
      //   LLMProvider.name, so Prisma's relational cascade can't help.
      //   Without this updateMany, deleted-provider rows linger as orphan
      //   "enabled" Registry entries → SmartModelRouter picks them →
      //   dispatch fails with "no enabled provider serves it" UNKNOWN_ERROR.
      //   Wrapping both writes in $transaction means a failure on EITHER
      //   step rolls back BOTH, so we never leave the registry in a
      //   half-deleted state.
      const [provider] = await prisma.$transaction(async (tx) => {
        const updatedProvider = await tx.lLMProvider.update({
          where: { id },
          data: {
            deleted_at: new Date(),
            enabled: false, // Also disable it
            updated_by: request.user?.id
          }
        });
        const cascade = await tx.modelRoleAssignment.updateMany({
          where: { provider: updatedProvider.name, enabled: true },
          data: { enabled: false },
        });
        return [updatedProvider, cascade] as const;
      });

      logger.info({ providerId: provider.id, name: provider.name }, 'LLM provider soft deleted');

      // Audit: credential deletion (generic admin audit)
      auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.CREDENTIAL_DELETE,
        severity: AuditSeverity.WARNING,
        userId: request.user?.id,
        userEmail: request.user?.email,
        action: 'DELETE_LLM_PROVIDER',
        resource: 'LLMProvider',
        resourceId: provider.id,
        details: { providerName: provider.name },
        success: true,
        ipAddress: request.ip,
      }).catch(() => {});

      // Credential-specific audit trail (dedicated table)
      credentialAuditService.log({
        userId: request.user?.id || 'unknown',
        userEmail: request.user?.email,
        action: 'delete',
        entityType: 'llm_provider',
        entityId: provider.id,
        entityName: provider.name,
        request,
      }).catch(() => {});

      // Trigger hot-reload if providerManager exists
      if (providerManager) {
        await invalidateAllModelCaches(logger);
        logger.info('Provider manager reloaded after provider deletion');
      }

      return reply.send({
        message: 'Provider deleted successfully',
        providerId: id
      });

    } catch (error) {
      logger.error({ error, providerId: request.params.id }, 'Failed to delete LLM provider');
      return reply.code(500).send({
        error: 'Failed to delete provider',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });


  /**
   * GET /api/admin/llm-providers/database
   * List all providers from database (including disabled/deleted)
   * Also includes environment-based providers as read-only system providers
   */
  fastify.get('/llm-providers/database', async (request, reply) => {
    try {
      const { prisma } = await import('../../../utils/prisma.js');

      const dbProviders = await prisma.lLMProvider.findMany({
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ],
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          updater: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });

      // Get environment-based providers from ProviderConfigService
      let envProviders: Record<string, unknown>[] = [];
      try {
        const { ProviderConfigService } = await import('../../../services/llm-providers/ProviderConfigService.js');
        const configService = new ProviderConfigService(logger);
        const config = await configService.loadProviderConfig();

        // Convert environment providers to database format
        envProviders = config.providers.map((p) => ({
          id: `env-${p.name}`,
          name: p.name,
          display_name: p.name === 'azure-openai' ? 'Azure OpenAI' :
                        p.name === 'aws-bedrock' ? 'AWS Bedrock' :
                        p.name === 'google-vertex' ? 'Google Vertex AI' : p.name,
          provider_type: p.type,
          enabled: p.enabled,
          priority: p.priority,
          description: `Environment-configured ${p.type} provider (read-only)`,
          tags: ['system', 'environment'],
          auth_config: { type: 'environment' },
          provider_config: (() => {
            // SECURITY: Strip credential fields from provider_config before sending to client
            const cfg = { ...(p.config || {}) };
            const credFields = ['apiKey', 'key', 'clientSecret', 'secretAccessKey', 'credentials', 'accessKeyId', 'password', 'token'];
            for (const f of credFields) {
              if (f in cfg) delete cfg[f];
            }
            return cfg;
          })(),
          model_config: {
            maxTokens: p.config?.maxTokens,
            temperature: p.config?.temperature
          },
          capabilities: {
            chat: true,
            embeddings: false,
            tools: true,
            vision: false,
            streaming: true
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          created_by: 'system',
          updated_by: 'system',
          isEnvironmentProvider: true // Flag to indicate it's from env
        }));
      } catch (envError) {
        logger.warn({ error: envError }, 'Failed to load environment providers');
      }

      // Merge database and environment providers
      // SECURITY: Redact credential values but keep non-sensitive config fields
      // so the edit form can display them (endpoint URLs, regions, project IDs)
      const credentialFields = new Set([
        'apiKey', 'key', 'clientSecret', 'secretAccessKey', 'awsSecretAccessKey',
        'accessKeyId', 'awsAccessKeyId', 'credentials', 'serviceAccountCredentials',
        'password', 'token', 'serviceAccountKey'
      ]);
      const sanitizedDbProviders = dbProviders.map((p) => {
        const rawAuth = decryptAuthConfig(p.auth_config) || {};
        const sanitized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawAuth)) {
          if (credentialFields.has(k)) {
            // Replace credential values with boolean flag
            sanitized[`has_${k}`] = !!v;
          } else {
            // Pass through non-sensitive fields (type, region, endpoint, projectId, etc.)
            sanitized[k] = v;
          }
        }
        // Normalize BigInt → Number so the response JSON-serializes cleanly,
        // and the UI's §11.5 useOptimisticVersion gets an integer it can POST back.
        const version = typeof p.version === 'bigint' ? Number(p.version) : Number(p.version ?? 1);
        return { ...p, auth_config: sanitized, version };
      });
      // SINGLE SOURCE OF TRUTH: Database is authoritative.
      // Env providers only shown if NOT already in DB (to avoid duplicates).
      // DB providers that originated from env get an 'isEnvironmentProvider' flag.
      const dbNames = new Set(sanitizedDbProviders.map((p) => p.name));
      const uniqueEnvProviders = envProviders.filter((p) => !dbNames.has(p.name as string));

      // Mark DB providers that have a matching env provider
      for (const dbp of sanitizedDbProviders) {
        if (envProviders.some((ep) => ep.name === dbp.name)) {
          (dbp as Record<string, unknown>).isEnvironmentProvider = true;
        }
      }

      // Filter out deleted and test providers
      const allProviders = ([...sanitizedDbProviders, ...uniqueEnvProviders] as Array<Record<string, unknown>>)
        .filter((p) => !p.deleted_at && !(p.name as string)?.startsWith('e2e-test'));

      // Enrich display_name with provider context (host, deployment, region, project)
      for (const p of allProviders) {
        const pc = (p.provider_config as ProviderConfigBag) || {};
        const ac = (p.auth_config as AuthConfigBag) || {};
        let ctx = '';
        const type = p.provider_type as string;
        if (type === 'ollama') ctx = pc.host || pc.endpoint || pc.ollamaHost || '';
        else if (type?.includes('azure')) ctx = pc.deployment || pc.endpoint?.split?.('.')?.[0]?.replace?.('https://', '') || ac.tenantId || '';
        else if (type === 'aws-bedrock') ctx = ac.region || pc.region || '';
        else if (type === 'vertex-ai') ctx = pc.projectId || pc.location || '';
        if (ctx && !(p.display_name as string)?.includes(ctx.slice(0, 10))) {
          // Keep `:` so host:port stays readable (see same pattern at line ~149)
          const slug = ctx.replace(/https?:\/\//, '').replace(/[^a-z0-9.\-:]/gi, '').slice(0, 30);
          if (slug) p.display_name = `${p.display_name as string} (${slug})`;
        }
      }

      return reply.send({
        providers: allProviders,
        total: allProviders.length,
        enabled: allProviders.filter((p) => p.enabled && !p.deleted_at).length,
        disabled: allProviders.filter((p) => !p.enabled || p.deleted_at).length,
        environmentProviders: allProviders.filter((p) => p.isEnvironmentProvider).length,
        databaseProviders: sanitizedDbProviders.length
      });

    } catch (error) {
      logger.error({ error }, 'Failed to list database providers');
      return reply.code(500).send({
        error: 'Failed to list providers',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

};


export default providersCrudRoutes;
