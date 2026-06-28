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
import { getProviderManager } from '../../services/llm-providers/ProviderManager.js';

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
    const providerManager = getProviderManager();
    let providerStatus = 'not_configured';

    // =========================================================================
    // PRIORITY 1: Load models from DATABASE (llm_providers table)
    // This is the source of truth for admin-configured providers
    // ALSO calls provider.listModels() to get ALL configured models (e.g., AWS_BEDROCK_AVAILABLE_MODELS)
    // =========================================================================
    try {
      const { prisma } = await import('../../utils/prisma.js');

      // Skip providers with status='error' so the UI model picker doesn't
      // list models that will 404 at dispatch. Admin sees the error in
      // Provider Management; chat users only see models that can actually run.
      const dbProviders = await prisma.lLMProvider.findMany({
        where: {
          enabled: true,
          deleted_at: null,
          NOT: { status: 'error' },
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
          // SINGLE SOURCE OF TRUTH: admin.model_role_assignments (Registry)
          //
          // The Smart Router and chat selector now both source from the
          // Registry table. Auto-discovery (AIF ARM / Ollama /api/tags)
          // upserts deployed models into the Registry via
          // upsertDiscoveredModels(). Admin enables/disables via the
          // Models page (PATCH /admin/llm-providers/registry/:id).
          // The legacy provider_config.models[] field is going away — do
          // not read it here.
          //
          // We deliberately IGNORE the routing-hint fields:
          //   - model_config.{chatModel,defaultModel,premiumModel,...}
          //   - model_config.additionalModels[]
          //   - provider_config.modelId
          // These are routing decisions, NOT registry entries.
          // =====================================================================
          const registryRows = await prisma.modelRoleAssignment.findMany({
            where: { provider: dbProvider.name, enabled: true },
            select: { model: true },
          });
          const registryModelIds: string[] = registryRows.map(r => r.model);

          // Deduplicate and apply admin-chosen disable list + filetype filter
          let uniqueRegistryModels = [...new Set(registryModelIds)].filter(id => {
            if (!id) return false;
            if (disabledModels.includes(id)) return false;
            const lower = id.toLowerCase();
            if (lower.includes('embed') || lower.includes('embedding')) return false;
            if (lower.startsWith('imagen') || lower.includes('image-generation')) return false;
            return true;
          });

          // Curated mode (?curated=true): further restrict to models that
          // are explicitly named in the provider's model_config routing
          // hints — chatModel, defaultModel, premiumModel, economicalModel,
          // ultraPremiumModel, thinkingModel, or additionalModels[]. This
          // matches the admin Model Registry view exactly and is used by
          // codemode's /model picker so users don't see every
          // auto-discovered upstream catalog entry.
          const curated = (request.query as any)?.curated === 'true' || (request.query as any)?.curated === '1';
          if (curated) {
            const mcHints = new Set<string>([
              modelConfig.chatModel,
              modelConfig.defaultModel,
              modelConfig.premiumModel,
              modelConfig.economicalModel,
              modelConfig.ultraPremiumModel,
              modelConfig.thinkingModel,
              modelConfig.toolModel,
              modelConfig.visionModel,
              ...(Array.isArray(modelConfig.additionalModels) ? modelConfig.additionalModels : []),
            ].filter((x: any): x is string => typeof x === 'string' && x.length > 0));
            if (mcHints.size > 0) {
              uniqueRegistryModels = uniqueRegistryModels.filter(id => mcHints.has(id));
            }
          }

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

        }
      }
    } catch (dbError) {
      request.log.warn({ error: dbError }, '[CHAT-MODELS] Failed to load from admin DB');
    }

    // No legacy unions: env-var seeds and runtime auto-discovery write into
    // admin DB (provider_config.models[]) on startup. The admin console
    // (LLM Providers + Model Garden) is the single edit/read point.
    // If DB is empty, the response is empty — admin needs to add a provider.

    // Default model resolution, in priority order:
    //   1. Tenant-level SystemConfiguration key `default_model` — explicit
    //      operator choice, overrides provider heuristics.
    //   2. Top-priority HEALTHY enabled provider's model_config.defaultModel
    //      or chatModel. `status='error'` providers are skipped so we never
    //      hand users a default that will 404 on dispatch (root-cause of the
    //      "resource not found" after Bedrock IAM test failed while still
    //      enabled).
    //   3. First model in the registry list.
    let defaultModelId: string | null = null;
    try {
      const { prisma } = await import('../../utils/prisma.js');
      // 1. Tenant default (one explicit point)
      try {
        const row = await prisma.systemConfiguration.findUnique({ where: { key: 'default_model' } });
        if (row?.value) {
          const v = row.value as any;
          const m = typeof v === 'string' ? v : (v?.model ?? null);
          if (typeof m === 'string' && m) defaultModelId = m;
        }
      } catch { /* ignore — fall through to provider heuristic */ }

      // 2. Provider heuristic (skip status=error)
      if (!defaultModelId) {
        const topProvider = await prisma.lLMProvider.findFirst({
          where: {
            enabled: true,
            deleted_at: null,
            NOT: { status: 'error' },
          },
          orderBy: { priority: 'asc' },
        });
        const mc = (topProvider?.model_config as any) || {};
        defaultModelId = (typeof mc.defaultModel === 'string' && mc.defaultModel)
          || (typeof mc.chatModel === 'string' && mc.chatModel)
          || models[0]?.id
          || null;
      }
    } catch {
      defaultModelId = models[0]?.id || null;
    }

    // Codemode default. Reads from default_models.code (SOT) → default_models.chat fallback.
    // Managed via GET/PUT /api/admin/default-models.
    // Falls back to first available Ollama model or chat default if unset.
    let codemodeDefault: string | null = null;
    try {
      const { ModelConfigurationService } = await import('../../services/ModelConfigurationService.js');
      codemodeDefault = await ModelConfigurationService.getDefaultCodeModel();
    } catch { /* ignore — fall through */ }
    if (!codemodeDefault) {
      const firstOllama = models.find(m => m.provider === 'ollama' && m.isAvailable);
      codemodeDefault = firstOllama?.id || defaultModelId;
    }

    request.log.info({
      totalModels: models.length,
      defaultModel: defaultModelId,
      codemodeDefault,
      providers: [...new Set(models.map(m => m.provider))],
      providerStatus
    }, '[CHAT-MODELS] Returning available models');

    reply.send({
      models,
      defaultModel: defaultModelId,
      codemodeDefault,
      count: models.length,
      availableCount: models.filter(m => m.isAvailable).length,
      capabilities: [...new Set(models.flatMap(m => m.capabilities))].sort((a, b) => a.localeCompare(b)),
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
