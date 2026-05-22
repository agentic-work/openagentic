/**
 * ModelConfigurationService
 *
 * Centralized service for model configuration across all critical services.
 * Single source of truth for: chat, embedding, title generation, compaction, etc.
 *
 * Logic:
 * - Reads models from database LLMProvider table (priority)
 * - Falls back to environment variables
 * - If ONE model: it's the default for everything
 * - If multiple: order by provider priority (prio 1 = default, prio 2 = fallback, etc.)
 * - Derives economy/balanced/premium tier mapping from available models
 */

import { logger } from '../utils/logger.js';

export interface ModelAssignment {
  modelId: string;
  provider: string;
  providerType?: string;
  providerId?: string;
  priority: number;
  supportsThinking: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  maxTokens: number;
  contextWindow: number;
}

export interface CriticalServiceModels {
  // Primary chat model (default for all chat)
  chat: ModelAssignment;
  // Embedding model for RAG/vector search
  embedding: ModelAssignment | null;
  // Title generation (can use cheaper model)
  titleGeneration: ModelAssignment;
  // Compaction/summarization (can use cheaper model)
  compaction: ModelAssignment;
  // Vision model (for image understanding)
  vision: ModelAssignment | null;
  // Image generation model
  imageGeneration: ModelAssignment | null;
}

export interface ModelTierMap {
  economical: ModelAssignment | null;
  balanced: ModelAssignment | null;
  premium: ModelAssignment | null;
}

export interface ModelConfiguration {
  // All available models ordered by priority
  availableModels: ModelAssignment[];
  // The single default model (priority 1 or only model)
  defaultModel: ModelAssignment;
  // Assignments for critical services
  services: CriticalServiceModels;
  // Tier mapping (economical / balanced / premium) derived from available models
  tiers: ModelTierMap;
  // Auto-derived slider defaults (used by SliderService when a user hasn't
  // pinned a position). `autoConfigured` is true when only one model is
  // available so the slider snaps to that model's optimal position.
  sliderConfig: {
    autoConfigured: boolean;
    defaultPosition: number;
  };
  // Source of configuration
  source: 'database' | 'environment' | 'fallback';
  // Last refresh timestamp
  lastRefresh: Date;
}

// Models that support extended thinking
const THINKING_CAPABLE_MODELS = [
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-3-7-sonnet',
  'claude-3.7-sonnet',
  'sonnet-4-5',
  'opus-4-5',
  'sonnet-4.5',
  'opus-4.5',
];

// Models that do NOT support thinking (will be warned but work)
const NON_THINKING_MODELS = [
  'haiku',
  'nova-micro',
  'nova-lite',
  'gemini-flash',
  'gpt-4o-mini',
];

class ModelConfigurationServiceClass {
  private static instance: ModelConfigurationServiceClass;
  private config: ModelConfiguration | null = null;
  private refreshPromise: Promise<ModelConfiguration> | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  private constructor() {}

  static getInstance(): ModelConfigurationServiceClass {
    if (!ModelConfigurationServiceClass.instance) {
      ModelConfigurationServiceClass.instance = new ModelConfigurationServiceClass();
    }
    return ModelConfigurationServiceClass.instance;
  }

  /**
   * Get the current model configuration
   * Refreshes from database/env if cache is stale
   */
  async getConfig(): Promise<ModelConfiguration> {
    // Check cache
    if (this.config && (Date.now() - this.config.lastRefresh.getTime()) < this.CACHE_TTL_MS) {
      return this.config;
    }

    // Prevent concurrent refreshes
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.loadConfiguration();
    try {
      this.config = await this.refreshPromise;
      return this.config;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Get the default code model for Code Mode sessions.
   * Reads from default_models.code (admin-configurable via PUT /api/admin/default-models).
   * Falls through to the chat default if code is unset.
   */
  async getDefaultCodeModel(): Promise<string> {
    const { prisma } = await import('../utils/prisma.js');
    const row = await prisma.systemConfiguration.findUnique({ where: { key: 'default_models' } });
    const v = row?.value as any;
    if (v && typeof v.code === 'string' && v.code.trim() !== '') {
      return v.code.trim();
    }
    if (v && typeof v.chat === 'string' && v.chat.trim() !== '') {
      return v.chat.trim();
    }
    return this.getDefaultChatModel();
  }

  /**
   * Get the default chat model (quick access).
   *
   * Registry SoT: admin.model_role_assignments row with role='chat' &
   * enabled=true, ordered by priority ASC.
   *
   * #508 Phase 2 (FedRAMP overhaul §5.3) — NO self-heal, NO write-inside-read.
   * The Phase 1 cascade trigger guarantees the registry can never go empty
   * while a provider exists, and the #509 tombstone gate blocks discovery
   * from re-resurrecting admin-deleted rows. The only way to hit "registry
   * empty" is admin deleting every row by hand — that IS the actionable
   * state. Throw with the existing actionable message; caller surfaces it.
   *
   * Predecessor: the #504 self-heal that auto-INSERTed registry rows from
   * llm_providers.model_config was ripped here (commit landing this method
   * change). It was the diffuse-writer anti-pattern that caused 9+
   * sequential bugs (admin deletes silently undone, capability metadata
   * stomped, etc.). All registry mutations now go through RegistryWriter.
   */
  async getDefaultChatModel(): Promise<string> {
    const { prisma } = await import('../utils/prisma.js');
    // #653: cross-check the assignment's provider name against the live
    // enabled+non-deleted provider set. The Registry's enabled flag and
    // the Provider's enabled flag are independent; without this filter we
    // return models whose backing provider was disabled by an admin —
    // ProviderManager subsequently rejects with "no enabled provider serves
    // it" and every chat turn that hits the default-model path fails.
    //
    // Two-step query (string-match on provider name) works for both legacy
    // rows (provider_id NULL) and new rows. Cheap: ~5 rows per role × 5
    // providers, served from Postgres in a single round-trip each.
    const [rows, enabledProviders] = await Promise.all([
      prisma.modelRoleAssignment.findMany({
        where: { role: 'chat', enabled: true },
        orderBy: { priority: 'asc' },
        select: { model: true, provider: true },
      }),
      prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
        select: { name: true },
      }),
    ]);
    const enabledNames = new Set(enabledProviders.map(p => p.name));
    const row = rows.find(r => enabledNames.has(r.provider));
    if (row?.model) {
      return row.model;
    }

    throw new Error(
      'No chat model configured. Enable at least one row with role="chat" in admin.model_role_assignments whose provider is also enabled.',
    );
  }

  /**
   * Get model for a specific service
   */
  async getServiceModel(service: keyof CriticalServiceModels): Promise<ModelAssignment | null> {
    const config = await this.getConfig();
    return config.services[service];
  }

  /**
   * Check if a model supports thinking
   */
  supportsThinking(modelId: string): boolean {
    const modelLower = modelId.toLowerCase();

    // Check explicit non-thinking models
    for (const pattern of NON_THINKING_MODELS) {
      if (modelLower.includes(pattern)) {
        return false;
      }
    }

    // Check thinking-capable models
    for (const pattern of THINKING_CAPABLE_MODELS) {
      if (modelLower.includes(pattern)) {
        return true;
      }
    }

    // Default: assume no thinking support for safety
    return false;
  }

  /**
   * Check if a model supports tool/function calling.
   * Uses ModelCapabilityRegistry if available, falls back to pattern matching.
   * Models like gpt-oss, gemma3 DON'T support tools reliably.
   */
  supportsToolCalling(modelId: string): boolean {
    // Try registry first (most accurate)
    try {
      const { getModelCapabilityRegistry } = require('./ModelCapabilityRegistry.js');
      const registry = getModelCapabilityRegistry();
      if (registry) {
        return registry.supportsFunctionCalling(modelId);
      }
    } catch { /* registry not initialized yet */ }

    // Fallback: pattern-based
    const lower = modelId.toLowerCase();
    // Models known to NOT support tool calling
    if (lower.includes('gemma') || lower.includes('phi') || lower.includes('llama-2') || lower.includes('llama2')) {
      return false;
    }
    // Most cloud models and newer local models support tools
    return true;
  }

  /**
   * Resolve which provider owns a given model ID.
   * Scans cached config first, then queries the Registry SoT
   * (admin.model_role_assignments) for the model's provider name.
   */
  async resolveModelProvider(modelId: string): Promise<{ providerName: string; providerType: string; providerId: string } | null> {
    const config = await this.getConfig();

    // Check cached models first
    for (const model of config.availableModels) {
      if (model.modelId === modelId) {
        return {
          providerName: model.provider,
          providerType: model.providerType || 'unknown',
          providerId: model.providerId || '',
        };
      }
    }

    // Not in cache — query the Registry directly. The Registry is the
    // single source of truth for which provider owns which model.
    try {
      const { prisma } = await import('../utils/prisma.js');
      const registryHit = await prisma.modelRoleAssignment.findFirst({
        where: { model: modelId, enabled: true },
        select: { provider: true },
      });
      if (registryHit) {
        const p = await prisma.lLMProvider.findFirst({
          where: { name: registryHit.provider, deleted_at: null },
          select: { id: true, name: true, provider_type: true },
        });
        if (p) return { providerName: p.name, providerType: p.provider_type, providerId: p.id };
      }

      // Fallback: scan model_config routing-hint fields. These are admin-
      // pinned default-slot assignments, NOT registry rows — but if a
      // freshly-added pin hasn't propagated to the Registry yet we can
      // still resolve the provider for routing.
      const providers = await prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
      });
      for (const p of providers) {
        const mc = (p.model_config as any) || {};
        const pc = (p.provider_config as any) || {};
        const allModelIds = [
          mc.chatModel, mc.defaultModel, mc.embeddingModel, mc.visionModel,
          mc.thinkingModel, mc.imageModel, mc.compactionModel, pc.modelId,
        ].filter(Boolean);

        if (allModelIds.includes(modelId)) {
          return { providerName: p.name, providerType: p.provider_type, providerId: p.id };
        }
      }
    } catch { /* non-fatal */ }

    return null;
  }

  /**
   * Get tier model IDs (economy/balanced/premium) from DB.
   * Used by TieredFC, TaskAnalysis, the legacy in-api orchestrator, SynthService.
   */
  async getTierModels(): Promise<{ economical: string; balanced: string; premium: string }> {
    const config = await this.getConfig();
    return {
      economical: config.tiers.economical?.modelId || config.defaultModel.modelId,
      balanced: config.tiers.balanced?.modelId || config.defaultModel.modelId,
      premium: config.tiers.premium?.modelId || config.defaultModel.modelId,
    };
  }

  /**
   * Get all available chat models with provider info.
   * Used by delegate_to_agents tool description to give LLM visibility.
   */
  async getAvailableModelsForDisplay(): Promise<Array<{ modelId: string; provider: string; tier: string; contextWindow: number }>> {
    const config = await this.getConfig();
    const tiers = await this.getTierModels();
    const IMAGE_ONLY = ['imagen', 'nova-canvas', 'dall-e', 'stable-diffusion'];
    return config.availableModels
      .filter(m => !m.modelId.includes('embed') && !IMAGE_ONLY.some(p => m.modelId.toLowerCase().includes(p)))
      .map(m => ({
        modelId: m.modelId,
        provider: m.provider,
        tier: m.modelId === tiers.premium ? 'premium' :
              m.modelId === tiers.economical ? 'economy' : 'balanced',
        contextWindow: m.contextWindow || 128000,
      }));
  }

  /**
   * Load configuration from database, then env vars, then fallback
   */
  private async loadConfiguration(): Promise<ModelConfiguration> {
    const models: ModelAssignment[] = [];
    let source: 'database' | 'environment' | 'fallback' = 'fallback';

    // Step 1: Try to load from database
    try {
      const dbModels = await this.loadFromDatabase();
      if (dbModels.length > 0) {
        models.push(...dbModels);
        source = 'database';
        logger.info({ modelCount: dbModels.length }, '[ModelConfig] Loaded models from database');
      }
    } catch (error) {
      logger.warn({ error }, '[ModelConfig] Failed to load from database, trying env vars');
    }

    // Step 2: If no DB models, load from env vars
    if (models.length === 0) {
      const envModels = this.loadFromEnvironment();
      if (envModels.length > 0) {
        models.push(...envModels);
        source = 'environment';
        logger.info({ modelCount: envModels.length }, '[ModelConfig] Loaded models from environment');
      }
    }

    // Step 3: Fallback if nothing configured
    if (models.length === 0) {
      logger.error('[ModelConfig] No models configured! Using emergency fallback.');
      models.push(this.getEmergencyFallback());
      source = 'fallback';
    }

    // Sort by priority (lower = higher priority)
    models.sort((a, b) => a.priority - b.priority);

    // Default model: Registry SoT wins. Query admin.model_role_assignments
    // for the highest-priority enabled role='chat' row and pin that as the
    // platform default. Fall through to models[0] only if the Registry has
    // no enabled chat rows (pre-provider-registration or misconfigured env).
    // This is the same query getDefaultChatModel() issues; keeping them in
    // agreement is deliberate — UI's /api/chat/models.defaultModel must
    // match the stage-2 summarizer's pick so admins don't see one model in
    // the picker while a different model answers.
    let defaultModel = models[0];
    try {
      const { prisma } = await import('../utils/prisma.js');
      const chatRow = await prisma.modelRoleAssignment.findFirst({
        where: { role: 'chat', enabled: true },
        orderBy: { priority: 'asc' },
        select: { model: true, provider: true },
      });
      if (chatRow?.model) {
        const preferred = models.find(m => m.modelId === chatRow.model);
        if (preferred) {
          defaultModel = preferred;
        } else {
          logger.warn({
            registryChatModel: chatRow.model,
            candidateModels: models.map(m => m.modelId),
          }, '[ModelConfig] Registry role="chat" row references a model not present in availableModels — falling back to priority sort');
        }
      }
    } catch (err) {
      logger.warn({ err }, '[ModelConfig] Registry lookup for chat default failed — using priority-sorted models[0]');
    }

    // Assign models to services
    const services = this.assignServicesToModels(models);

    // Derive tier mapping from available models
    const tiers = this.computeTiers(models);

    // Auto-configure the slider when only one model is available — snap
    // to position 50 (balanced) since there's nothing else to pick from.
    const sliderConfig = {
      autoConfigured: models.length <= 1,
      defaultPosition: 50,
    };

    const config: ModelConfiguration = {
      availableModels: models,
      defaultModel,
      services,
      tiers,
      sliderConfig,
      source,
      lastRefresh: new Date(),
    };

    logger.info({
      defaultModel: defaultModel.modelId,
      modelCount: models.length,
      source,
      economical: tiers.economical?.modelId,
      balanced: tiers.balanced?.modelId,
      premium: tiers.premium?.modelId,
      supportsThinking: defaultModel.supportsThinking,
    }, '[ModelConfig] Configuration loaded');

    return config;
  }

  /**
   * Load models from database LLMProvider table
   */
  private async loadFromDatabase(): Promise<ModelAssignment[]> {
    const { prisma } = await import('../utils/prisma.js');
    const { listRegistryCandidatePool } = await import('./model-routing/RegistryCandidatePool.js');

    {
      const providers = await prisma.lLMProvider.findMany({
        where: {
          enabled: true,
          deleted_at: null,
        },
        orderBy: {
          priority: 'asc',
        },
      });

      // Registry (admin.model_role_assignments) is the SoT for which
      // (provider, model) pairs the platform will actually dispatch to.
      // Auto-discovered provider_config.models[] advertises everything
      // the CSP serves (hundreds of rows, including EOL ids like
      // us.anthropic.claude-3-opus-20240229-v1:0 that AWS still catalogues
      // but Converse rejects at inference). Any model not in the Registry
      // must not leak into availableModels / tiers / capability-gate.
      const registryPool = await listRegistryCandidatePool(prisma as any);
      const registryAllowlist = new Set(registryPool.map(r => r.model));

      const models: ModelAssignment[] = [];

      for (const provider of providers) {
        const modelConfig = provider.model_config as any;
        const providerConfig = provider.provider_config as any;
        const disabledModels: string[] = Array.isArray(modelConfig?.disabledModels) ? modelConfig.disabledModels : [];

        // Get chat model from config
        const chatModelId = modelConfig?.chatModel || providerConfig?.modelId || modelConfig?.defaultModel || providerConfig?.chatModel;

        if (chatModelId && !disabledModels.includes(chatModelId) && registryAllowlist.has(chatModelId)) {
          models.push({
            modelId: chatModelId,
            provider: provider.name,
            providerType: provider.provider_type,
            providerId: provider.id,
            priority: provider.priority,
            supportsThinking: this.supportsThinking(chatModelId),
            supportsTools: this.supportsToolCalling(chatModelId),
            supportsVision: chatModelId.toLowerCase().includes('vision') ||
                           chatModelId.toLowerCase().includes('gemini') ||
                           chatModelId.toLowerCase().includes('claude'),
            maxTokens: providerConfig?.maxTokens || modelConfig?.maxTokens || 8192,
            contextWindow: modelConfig?.contextWindow || 200000,
          });
        }

        // Get embedding model
        const embeddingModelId = modelConfig?.embeddingModel || providerConfig?.embeddingModel;
        if (embeddingModelId && !disabledModels.includes(embeddingModelId) && registryAllowlist.has(embeddingModelId) && !models.find(m => m.modelId === embeddingModelId)) {
          models.push({
            modelId: embeddingModelId,
            provider: provider.name,
            providerType: provider.provider_type,
            providerId: provider.id,
            priority: provider.priority + 100,
            supportsThinking: false,
            supportsTools: false,
            supportsVision: false,
            maxTokens: 8192,
            contextWindow: 8192,
          });
        }

        // Also load each Registry row whose `provider` matches this provider.
        // Replaces the legacy provider_config.models[] iteration — Registry
        // is the SoT and already filtered by enabled=true via registryPool.
        for (const r of registryPool.filter(rp => rp.provider === provider.name)) {
          const mId = r.model;
          if (!mId || disabledModels.includes(mId)) continue;
          if (models.find(x => x.modelId === mId)) continue;
          const isEmbed = mId.toLowerCase().includes('embed') || r.role === 'embeddings';
          models.push({
            modelId: mId,
            provider: provider.name,
            providerType: provider.provider_type,
            providerId: provider.id,
            priority: provider.priority + (isEmbed ? 100 : 10),
            supportsThinking: this.supportsThinking(mId),
            supportsTools: !isEmbed && this.supportsToolCalling(mId),
            supportsVision: mId.toLowerCase().includes('gemini') || mId.toLowerCase().includes('claude'),
            maxTokens: 8192,
            contextWindow: 128000,
          });
        }
      }

      if (models.length === 0 && registryAllowlist.size === 0) {
        logger.warn({}, '[ModelConfig] Registry (admin.model_role_assignments) is empty — no models available. Admin must enable at least one role→model pair.');
      } else if (models.length === 0) {
        logger.warn({ registryModels: [...registryAllowlist] }, '[ModelConfig] No models matched Registry — provider configs advertise none of the enabled Registry rows.');
      }

      return models;
    }
  }

  /**
   * Load models from environment variables
   */
  private loadFromEnvironment(): ModelAssignment[] {
    const models: ModelAssignment[] = [];

    // AWS Bedrock
    const bedrockModel = process.env.AWS_BEDROCK_CHAT_MODEL || process.env.AWS_BEDROCK_MODEL_ID;
    if (bedrockModel && process.env.AWS_BEDROCK_ENABLED === 'true') {
      models.push({
        modelId: bedrockModel,
        provider: 'aws-bedrock',
        priority: parseInt(process.env.AWS_BEDROCK_PRIORITY || '1'),
        supportsThinking: this.supportsThinking(bedrockModel),
        supportsTools: true,
        supportsVision: false,
        maxTokens: parseInt(process.env.AWS_BEDROCK_MAX_TOKENS || '16000'),
        contextWindow: 200000,
      });
    }

    // Vertex AI
    const vertexModel = process.env.VERTEX_AI_CHAT_MODEL || process.env.VERTEX_DEFAULT_MODEL;
    if (vertexModel && process.env.VERTEX_AI_ENABLED === 'true') {
      models.push({
        modelId: vertexModel,
        provider: 'vertex-ai',
        priority: parseInt(process.env.VERTEX_AI_PRIORITY || '2'),
        supportsThinking: this.supportsThinking(vertexModel),
        supportsTools: true,
        supportsVision: true,
        maxTokens: parseInt(process.env.VERTEX_AI_MAX_TOKENS || '8192'),
        contextWindow: 200000,
      });
    }

    // Azure OpenAI
    const azureModel = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_CHAT_MODEL;
    if (azureModel && process.env.AZURE_OPENAI_ENABLED === 'true') {
      models.push({
        modelId: azureModel,
        provider: 'azure-openai',
        priority: parseInt(process.env.AZURE_OPENAI_PRIORITY || '3'),
        supportsThinking: false, // OpenAI models don't have Claude-style thinking
        supportsTools: true,
        supportsVision: azureModel.includes('gpt-4'),
        maxTokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS || '16000'),
        contextWindow: 128000,
      });
    }

    // Ollama
    const ollamaModel = process.env.OLLAMA_CHAT_MODEL;
    if (ollamaModel && process.env.OLLAMA_ENABLED === 'true') {
      models.push({
        modelId: ollamaModel,
        provider: 'ollama',
        priority: parseInt(process.env.OLLAMA_PRIORITY || '10'),
        supportsThinking: false,
        supportsTools: false,
        supportsVision: false,
        maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS || '4096'),
        contextWindow: 32000,
      });
    }

    // Fallback: DEFAULT_MODEL env var
    const defaultModel = process.env.DEFAULT_CHAT_MODEL || process.env.DEFAULT_MODEL;
    if (defaultModel && models.length === 0) {
      models.push({
        modelId: defaultModel,
        provider: 'unknown',
        priority: 1,
        supportsThinking: this.supportsThinking(defaultModel),
        supportsTools: true,
        supportsVision: false,
        maxTokens: 8192,
        contextWindow: 200000,
      });
    }

    return models;
  }

  /**
   * Emergency fallback when nothing is configured
   */
  private getEmergencyFallback(): ModelAssignment {
    logger.error('[ModelConfig] EMERGENCY: No models configured! System may not function correctly.');
    return {
      modelId: 'default',
      provider: 'unknown',
      priority: 1,
      supportsThinking: false,
      supportsTools: false,
      supportsVision: false,
      maxTokens: 4096,
      contextWindow: 4096,
    };
  }

  /**
   * Assign models to critical services
   */
  private assignServicesToModels(models: ModelAssignment[]): CriticalServiceModels {
    const IMAGE_ONLY_PATTERNS = ['imagen', 'nova-canvas', 'dall-e', 'stable-diffusion'];
    const chatModels = models.filter(m => {
      const id = m.modelId.toLowerCase();
      if (id.includes('embed')) return false;
      if (IMAGE_ONLY_PATTERNS.some(p => id.includes(p))) return false;
      return true;
    });
    const embeddingModels = models.filter(m => m.modelId.includes('embed') || m.modelId.includes('titan'));

    // Find cheapest model for title/compaction (Haiku, Nova Micro, etc.)
    const cheapModel = chatModels.find(m =>
      m.modelId.toLowerCase().includes('haiku') ||
      m.modelId.toLowerCase().includes('nova-micro') ||
      m.modelId.toLowerCase().includes('flash') ||
      m.modelId.toLowerCase().includes('mini')
    ) || chatModels[0];

    // Find vision-capable model
    const visionModel = chatModels.find(m => m.supportsVision) || null;

    return {
      chat: chatModels[0], // Primary chat = highest priority
      embedding: embeddingModels[0] || null,
      titleGeneration: cheapModel, // Use cheap model for titles
      compaction: cheapModel, // Use cheap model for compaction
      vision: visionModel,
      imageGeneration: null, // Handled separately by ImageGenerationService
    };
  }

  /**
   * Compute economy/balanced/premium tier mapping from available models,
   * sorted by quality score. With a single model, all tiers collapse to it.
   */
  private computeTiers(models: ModelAssignment[]): ModelTierMap {
    // Filter out non-chat models: embeddings AND image-only models
    const IMAGE_ONLY_PATTERNS = ['imagen', 'nova-canvas', 'dall-e', 'stable-diffusion'];
    const chatModels = models.filter(m => {
      const id = m.modelId.toLowerCase();
      if (id.includes('embed')) return false;
      if (IMAGE_ONLY_PATTERNS.some(p => id.includes(p))) return false;
      return true;
    });

    // If only one model, it serves all tiers
    if (chatModels.length === 1) {
      const model = chatModels[0];
      return {
        economical: model,
        balanced: model,
        premium: model,
      };
    }

    // H3: tier sort by registry priority — operator's explicit ranking
    // (admin.model_role_assignments.priority). Higher priority = premium tier.
    // Replaces a 17-pattern substring quality-score guess. Per
    // docs/rules/no-hardcoded-models.md.
    const sortedByPriority = [...chatModels].sort((a, b) => b.priority - a.priority);

    return {
      economical: sortedByPriority[sortedByPriority.length - 1] || null, // Lowest priority
      balanced: sortedByPriority[Math.floor(sortedByPriority.length / 2)] || sortedByPriority[0],
      premium: sortedByPriority[0] || null, // Highest priority
    };
  }

  /**
   * Force refresh configuration
   */
  async refresh(): Promise<ModelConfiguration> {
    this.config = null;
    return this.getConfig();
  }
}

// Export singleton
export const ModelConfigurationService = ModelConfigurationServiceClass.getInstance();

// Export for direct import
export default ModelConfigurationService;
