import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.services;

const EMBEDDING_NAME_PATTERNS = [
  /embed/i,         // any name with 'embed'
  /^nomic-/i,
  /^mxbai-/i,
  /^bge[-:]/i,
  /^bge$/i,
  /^e5[-:]/i,
  /^gte[-:]/i,
  /arctic-embed/i,
];

export function isEmbeddingModelName(name: string): boolean {
  if (!name) return false;
  return EMBEDDING_NAME_PATTERNS.some(re => re.test(name));
}

/**
 * #591 — Pick a chat-capable fallback when the previous chatModel was
 * removed from the host. Returns the first non-embedding model in the
 * input list, or `null` if the host has no chat-capable models. The
 * caller MUST treat `null` as "clear chatModel + defaultModel" — do
 * NOT silently re-stamp the embedding model as chat (the bug that
 * surfaced as "hal" provider stuck on `nomic-embed-text:latest" after
 * sync). Uses `isEmbeddingModelName` (regex set), not the weaker
 * `.includes('embed')` substring — bge-m3 / e5-large-v2 / gte-large /
 * arctic-embed all need to be excluded.
 */
export function selectChatModelFallback(hostModelNames: string[]): string | null {
  for (const name of hostModelNames) {
    if (!isEmbeddingModelName(name)) return name;
  }
  return null;
}

interface OllamaTagModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface SyncResult {
  providerId: string;
  providerName: string;
  host: string;
  status: 'synced' | 'unreachable' | 'error';
  modelsOnHost: string[];
  modelsAdded: string[];
  modelsRemoved: string[];
  error?: string;
  lastSync: Date;
}

export class OllamaModelSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private syncing = false;
  private lastSyncResults: Map<string, SyncResult> = new Map();

  // Default sync interval: 60 seconds
  private readonly SYNC_INTERVAL_MS = 60_000;

  constructor() {}

  /** Start background sync loop */
  start(): void {
    if (this.syncInterval) return;

    logger.info({ intervalMs: this.SYNC_INTERVAL_MS }, '[OllamaSync] Starting background sync');

    // Initial sync after 5s (let API finish startup)
    setTimeout(() => this.syncAll().catch(e => logger.error({ error: e }, '[OllamaSync] Initial sync failed')), 5000);

    this.syncInterval = setInterval(() => {
      this.syncAll().catch(e => logger.error({ error: e }, '[OllamaSync] Periodic sync failed'));
    }, this.SYNC_INTERVAL_MS);
  }

  /** Stop background sync */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('[OllamaSync] Background sync stopped');
    }
  }

  /** Get last sync results for all providers */
  getLastSyncResults(): SyncResult[] {
    return Array.from(this.lastSyncResults.values());
  }

  /** Sync a specific provider by ID (for on-demand sync from admin API) */
  async syncProvider(providerId: string): Promise<SyncResult> {
    const provider = await prisma.lLMProvider.findUnique({ where: { id: providerId } });
    if (!provider || provider.provider_type !== 'ollama') {
      throw new Error(`Provider ${providerId} not found or not an Ollama provider`);
    }
    return this.syncSingleProvider(provider);
  }

  /** Sync all Ollama providers */
  async syncAll(): Promise<SyncResult[]> {
    if (this.syncing) return Array.from(this.lastSyncResults.values());
    this.syncing = true;

    try {
      const ollamaProviders = await prisma.lLMProvider.findMany({
        where: {
          provider_type: 'ollama',
          enabled: true,
          deleted_at: null,
        },
      });

      if (ollamaProviders.length === 0) {
        return [];
      }

      const results: SyncResult[] = [];
      for (const provider of ollamaProviders) {
        const result = await this.syncSingleProvider(provider);
        results.push(result);
        this.lastSyncResults.set(provider.id, result);
      }

      return results;
    } finally {
      this.syncing = false;
    }
  }

  /** Sync a single provider against its Ollama host */
  private async syncSingleProvider(provider: any): Promise<SyncResult> {
    const providerConfig = provider.provider_config as any || {};
    const modelConfig = provider.model_config as any || {};
    const authConfig = provider.auth_config as any || {};
    const baseUrl = providerConfig.baseUrl || providerConfig.host || providerConfig.endpoint
                  || authConfig.baseUrl || authConfig.endpoint
                  || 'http://localhost:11434';

    const result: SyncResult = {
      providerId: provider.id,
      providerName: provider.name,
      host: baseUrl,
      status: 'synced',
      modelsOnHost: [],
      modelsAdded: [],
      modelsRemoved: [],
      lastSync: new Date(),
    };

    try {
      // Fetch models from Ollama host
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const hostModels: OllamaTagModel[] = data.models || [];
      const hostModelNames = hostModels.map(m => m.name);
      result.modelsOnHost = hostModelNames;

      // Current models in DB for this provider
      const dbModels: any[] = Array.isArray(providerConfig.models) ? providerConfig.models : [];
      const dbModelNames = new Set(dbModels.map(m => m.id || m.name));

      // Also include chatModel, defaultModel, modelId as "known" models
      const knownModelNames = new Set(dbModelNames);
      if (modelConfig.chatModel) knownModelNames.add(modelConfig.chatModel);
      if (modelConfig.defaultModel) knownModelNames.add(modelConfig.defaultModel);
      if (providerConfig.modelId) knownModelNames.add(providerConfig.modelId);

      // Detect new models on host not in DB
      const newModels: any[] = [];
      for (const hostModel of hostModels) {
        if (!knownModelNames.has(hostModel.name)) {
          // Skip embedding models — they shouldn't appear in chat selector
          if (isEmbeddingModelName(hostModel.name)) continue;

          newModels.push({
            id: hostModel.name,
            name: hostModel.name,
            size: hostModel.size,
            details: hostModel.details,
            addedBy: 'ollama-sync',
            addedAt: new Date().toISOString(),
          });
          result.modelsAdded.push(hostModel.name);
        }
      }

      // Detect models in DB that are no longer on host — HARD REMOVE
      const hostModelSet = new Set(hostModelNames);
      const modelsToKeep = dbModels.filter(m => {
        const modelName = m.id || m.name;
        if (!hostModelSet.has(modelName)) {
          result.modelsRemoved.push(modelName);
          return false;
        }
        return true;
      });

      // Check if chatModel/defaultModel/modelId were removed from host
      let chatModelRemoved = false;
      if (modelConfig.chatModel && !hostModelSet.has(modelConfig.chatModel)) {
        chatModelRemoved = true;
        result.modelsRemoved.push(modelConfig.chatModel);
      }

      // Sanitize chatModel if it's actually an embedding model.
      // (User may have hand-set an embedding tag as chatModel via the wizard
      // before sanitizer landed, or before isEmbeddingModelName was extended.)
      if (modelConfig.chatModel && isEmbeddingModelName(modelConfig.chatModel)) {
        chatModelRemoved = true;
        result.modelsRemoved.push(`${modelConfig.chatModel} (sanitized: was embedding model)`);
      }

      // Only update DB if there are changes
      if (newModels.length > 0 || result.modelsRemoved.length > 0) {
        // Legacy models[] write removed — Registry is SoT (admin.model_role_assignments).
        // The Registry upsert further down handles enable/disable semantics.
        const updatedProviderConfig = {
          ...providerConfig,
          lastSync: new Date().toISOString(),
          hostModels: hostModelNames, // Full host catalog for reference / debugging
        };

        const updatedModelConfig = { ...modelConfig };

        // If chatModel was removed, switch to first chat-capable model on
        // the host. #591 — `selectChatModelFallback` returns null on
        // embed-only hosts (e.g. nomic-only Ollama instances dedicated to
        // embedding). In that case we MUST clear chatModel + defaultModel
        // rather than re-stamp the embedding model as a chat default.
        if (chatModelRemoved) {
          const fallback = selectChatModelFallback(hostModelNames);
          if (fallback) {
            updatedModelConfig.chatModel = fallback;
            updatedModelConfig.defaultModel = fallback;
            logger.warn({
              provider: provider.name,
              removedModel: modelConfig.chatModel,
              newDefault: fallback,
            }, '[OllamaSync] Chat model removed from host, switched to fallback');
          } else {
            // Embed-only host: drop the chat slots entirely so downstream
            // routers/UIs don't see a stale (or worse, embedding-as-chat)
            // selection. Smart Router will skip this provider for chat.
            delete (updatedModelConfig as any).chatModel;
            delete (updatedModelConfig as any).defaultModel;
            logger.warn({
              provider: provider.name,
              removedModel: modelConfig.chatModel,
              hostModels: hostModelNames,
            }, '[OllamaSync] Embed-only host — cleared chatModel + defaultModel (#591)');
          }
        }

        // Scrub host-removed models from every model_config list so they
        // don't leak as phantom options in the UI model picker or Smart
        // Router. The DELETE admin endpoint already does this for single
        // admin-initiated removes; this path handles the case where a user
        // pulls a model directly from Ollama (`ollama rm X`) and the next
        // sync needs to clean up. Bug surfaced by gemma4 lingering in
        // additionalModels after the tag was removed from the host.
        const listFields = ['additionalModels', 'disabledModels'] as const;
        for (const f of listFields) {
          if (Array.isArray((updatedModelConfig as any)[f])) {
            (updatedModelConfig as any)[f] = (updatedModelConfig as any)[f].filter(
              (m: string) => hostModelSet.has(m),
            );
          }
        }
        // Same scrub for scalar role-slot fields that can pin a removed model.
        const roleFields = ['toolModel', 'visionModel', 'embeddingModel', 'imageModel', 'compactionModel'] as const;
        for (const f of roleFields) {
          const cur = (updatedModelConfig as any)[f];
          if (typeof cur === 'string' && cur && !hostModelSet.has(cur)) {
            delete (updatedModelConfig as any)[f];
          }
        }

        // Update the provider record
        await prisma.lLMProvider.update({
          where: { id: provider.id },
          data: {
            provider_config: updatedProviderConfig,
            model_config: updatedModelConfig,
            updated_at: new Date(),
          },
        });

        logger.info({
          provider: provider.name,
          host: baseUrl,
          added: result.modelsAdded,
          removed: result.modelsRemoved,
          total: hostModelNames.length,
        }, '[OllamaSync] Provider synced');

        // Invalidate all caches so new/removed models are instantly available for routing
        try {
          const { invalidateAllModelCaches } = await import('./llm-providers/ProviderManager.js');
          await invalidateAllModelCaches(logger);
        } catch { /* non-fatal */ }
      }

      // Registry SoT sync (Ollama): mirror the host's deployed model list
      // into admin.model_role_assignments so the Smart Router considers
      // them. Upsert covers both adds and updates idempotently. Removals
      // are handled by disabling rows whose `model` is no longer on the host.
      try {
        const { upsertDiscoveredModels } = await import('./model-routing/RegistryUpsertService.js');
        const discoveredForRegistry = hostModels
          .filter(m => !isEmbeddingModelName(m.name))
          .map(m => ({
            id: m.name,
            name: m.name,
            provider: 'ollama',
            description: `Deployed on ${baseUrl}`,
            family: m.details?.family,
            capabilities: { chat: true, tools: true, streaming: true },
          } as any));

        if (discoveredForRegistry.length > 0) {
          // Resolve a valid createdBy — provider.created_by may be null for
          // helm-bootstrapped providers. Fall back to ADMIN_USER_EMAIL → user.id.
          // If neither exists, skip the upsert (warn) instead of using a sentinel
          // UUID that violates the FK to `users`.
          let createdBy: string | null = provider.created_by ?? null;
          if (!createdBy) {
            const adminEmail = (process.env.ADMIN_USER_EMAIL ?? '').trim();
            if (adminEmail) {
              const adminRow = await (prisma as any).user?.findUnique?.({
                where: { email: adminEmail },
                select: { id: true },
              });
              if (adminRow?.id) createdBy = adminRow.id as string;
            }
          }
          if (createdBy) {
            await upsertDiscoveredModels(
              {
                providerName: provider.name,
                discovered: discoveredForRegistry,
                createdBy,
                providerType: 'ollama',
                region: null,
              },
              prisma as any,
            );
          } else {
            logger.warn(
              { provider: provider.name, count: discoveredForRegistry.length },
              '[OllamaSync] No valid createdBy (provider.created_by null + ADMIN_USER_EMAIL unresolvable) — skipping registry upsert',
            );
          }
        }

        // Disable Registry rows for this provider whose model is no longer on the host.
        const { prisma: pr } = await import('../utils/prisma.js');
        const stale = await (pr as any).modelRoleAssignment.findMany({
          where: { provider: provider.name, enabled: true },
          select: { id: true, model: true },
        });
        const toDisable = stale.filter((r: any) => !hostModelSet.has(r.model));
        if (toDisable.length > 0) {
          await Promise.all(toDisable.map((r: any) =>
            (pr as any).modelRoleAssignment.update({
              where: { id: r.id },
              data: { enabled: false, options: { auto: true, disabledReason: 'host_removed', disabledAt: new Date().toISOString() } },
            }),
          ));
          logger.info({ provider: provider.name, disabled: toDisable.map((r: any) => r.model) }, '[OllamaSync] Disabled Registry rows for host-removed models');
        }
      } catch (e: any) {
        logger.warn({ provider: provider.name, error: e.message }, '[OllamaSync] Registry upsert failed (non-fatal)');
      }
    } catch (error: any) {
      result.status = 'unreachable';
      result.error = error.message;
      logger.warn({ provider: provider.name, host: baseUrl, error: error.message }, '[OllamaSync] Host unreachable');
    }

    return result;
  }

  /** Cleanup */
  async destroy(): Promise<void> {
    this.stop();
  }
}

// Singleton
let instance: OllamaModelSyncService | null = null;

export function getOllamaModelSyncService(): OllamaModelSyncService {
  if (!instance) {
    instance = new OllamaModelSyncService();
  }
  return instance;
}
