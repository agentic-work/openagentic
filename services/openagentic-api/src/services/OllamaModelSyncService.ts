/**
 * OllamaModelSyncService — Background sync between Ollama hosts and LLMProvider DB records.
 *
 * For each Ollama provider in the DB:
 * 1. Polls the host's GET /api/tags to discover actual models
 * 2. Adds newly-found models to provider_config.models[]
 * 3. Removes models no longer on the host (hard-remove from chat selector)
 * 4. Updates model_config.chatModel if the current chatModel was removed
 *
 * Supports multiple Ollama hosts — each LLMProvider with provider_type='ollama' is synced independently.
 *
 * @copyright 2026 Openagentic LLC
 */

import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.services;

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
    const baseUrl = providerConfig.baseUrl || providerConfig.host || providerConfig.endpoint || 'http://localhost:11434';

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
          const lower = hostModel.name.toLowerCase();
          if (lower.includes('embed') || lower.includes('nomic')) continue;

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

      // Only update DB if there are changes
      if (newModels.length > 0 || result.modelsRemoved.length > 0) {
        const updatedModels = [...modelsToKeep, ...newModels];

        // Build updated configs
        const updatedProviderConfig = {
          ...providerConfig,
          models: updatedModels,
          lastSync: new Date().toISOString(),
          hostModels: hostModelNames, // Full list for reference
        };

        const updatedModelConfig = { ...modelConfig };

        // If chatModel was removed, switch to first available model on host
        if (chatModelRemoved && hostModelNames.length > 0) {
          const fallback = hostModelNames.find(m => !m.toLowerCase().includes('embed')) || hostModelNames[0];
          updatedModelConfig.chatModel = fallback;
          updatedModelConfig.defaultModel = fallback;
          logger.warn({
            provider: provider.name,
            removedModel: modelConfig.chatModel,
            newDefault: fallback,
          }, '[OllamaSync] Chat model removed from host, switched to fallback');
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
          total: updatedModels.length,
        }, '[OllamaSync] Provider synced');

        // Invalidate all caches so new/removed models are instantly available for routing
        try {
          const { invalidateAllModelCaches } = await import('./llm-providers/ProviderManager.js');
          await invalidateAllModelCaches(logger);
        } catch { /* non-fatal */ }
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
