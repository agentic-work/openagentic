/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
 * - Auto-configures slider based on available models
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

export interface ModelConfiguration {
  // All available models ordered by priority
  availableModels: ModelAssignment[];
  // The single default model (priority 1 or only model)
  defaultModel: ModelAssignment;
  // Assignments for critical services
  services: CriticalServiceModels;
  // Slider configuration based on available models
  sliderConfig: {
    autoConfigured: boolean;
    defaultPosition: number; // 0-100
    tiers: {
      economical: ModelAssignment | null;  // 0-40%
      balanced: ModelAssignment | null;    // 41-60%
      premium: ModelAssignment | null;     // 61-100%
    };
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
   * Get the default chat model (quick access)
   */
  async getDefaultChatModel(): Promise<string> {
    const config = await this.getConfig();
    return config.defaultModel.modelId;
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
   * Scans cached config first, then does a fresh DB scan for models
   * in provider_config.models (added via Add Model dialog).
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

    // Not in cache — fresh DB scan (provider_config.models may have been added recently)
    try {
      const { prisma } = await import('../utils/prisma.js');
      const providers = await prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
      });
      for (const p of providers) {
        const mc = (p.model_config as any) || {};
        const pc = (p.provider_config as any) || {};
        const allModelIds = [
          mc.chatModel, mc.defaultModel, mc.embeddingModel, mc.visionModel,
          mc.thinkingModel, mc.imageModel, mc.compactionModel, pc.modelId,
          ...(Array.isArray(pc.models) ? pc.models.map((m: any) => m.id || m.name) : []),
        ].filter(Boolean);

        if (allModelIds.includes(modelId)) {
          return { providerName: p.name, providerType: p.provider_type, providerId: p.id };
        }
      }
    } catch { /* non-fatal */ }

    return null;
  }

  /**
   * Get slider tier model IDs (economy/balanced/premium) from DB.
   * Used by TieredFC, TaskAnalysis, AgentSpawnManager, SynthService.
   */
  async getSliderTiers(): Promise<{ economical: string; balanced: string; premium: string }> {
    const config = await this.getConfig();
    return {
      economical: config.sliderConfig.tiers.economical?.modelId || config.defaultModel.modelId,
      balanced: config.sliderConfig.tiers.balanced?.modelId || config.defaultModel.modelId,
      premium: config.sliderConfig.tiers.premium?.modelId || config.defaultModel.modelId,
    };
  }

  /**
   * Get all available chat models with provider info.
   * Used by delegate_to_agents tool description to give LLM visibility.
   */
  async getAvailableModelsForDisplay(): Promise<Array<{ modelId: string; provider: string; tier: string; contextWindow: number }>> {
    const config = await this.getConfig();
    const tiers = await this.getSliderTiers();
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

    // Determine default model (first by priority)
    const defaultModel = models[0];

    // Assign models to services
    const services = this.assignServicesToModels(models);

    // Configure slider based on available models
    const sliderConfig = this.configureSlider(models);

    const config: ModelConfiguration = {
      availableModels: models,
      defaultModel,
      services,
      sliderConfig,
      source,
      lastRefresh: new Date(),
    };

    logger.info({
      defaultModel: defaultModel.modelId,
      modelCount: models.length,
      source,
      sliderPosition: sliderConfig.defaultPosition,
      supportsThinking: defaultModel.supportsThinking,
    }, '[ModelConfig] Configuration loaded');

    return config;
  }

  /**
   * Load models from database LLMProvider table
   */
  private async loadFromDatabase(): Promise<ModelAssignment[]> {
    const { prisma } = await import('../utils/prisma.js');

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

      const models: ModelAssignment[] = [];

      for (const provider of providers) {
        const modelConfig = provider.model_config as any;
        const providerConfig = provider.provider_config as any;
        const disabledModels: string[] = Array.isArray(modelConfig?.disabledModels) ? modelConfig.disabledModels : [];

        // Get chat model from config
        const chatModelId = modelConfig?.chatModel || providerConfig?.modelId || modelConfig?.defaultModel || providerConfig?.chatModel;

        if (chatModelId && !disabledModels.includes(chatModelId)) {
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
        if (embeddingModelId && !disabledModels.includes(embeddingModelId) && !models.find(m => m.modelId === embeddingModelId)) {
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

        // Also load models from provider_config.models (added via Add Model dialog)
        if (Array.isArray(providerConfig?.models)) {
          for (const m of providerConfig.models) {
            const mId = m.id || m.name;
            // Check both disabledModels array AND per-model config.enabled flag
            const isModelDisabled = disabledModels.includes(mId) || m.config?.enabled === false;
            if (mId && !isModelDisabled && !models.find(x => x.modelId === mId)) {
              const isEmbed = mId.toLowerCase().includes('embed');
              models.push({
                modelId: mId,
                provider: provider.name,
                providerType: provider.provider_type,
                providerId: provider.id,
                priority: provider.priority + (isEmbed ? 100 : 10),
                supportsThinking: this.supportsThinking(mId),
                supportsTools: !isEmbed && this.supportsToolCalling(mId),
                supportsVision: mId.toLowerCase().includes('gemini') || mId.toLowerCase().includes('claude'),
                maxTokens: m.config?.maxOutputTokens || 8192,
                contextWindow: m.contextWindow || 128000,
              });
            }
          }
        }
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
   * Configure slider based on available models
   */
  private configureSlider(models: ModelAssignment[]): ModelConfiguration['sliderConfig'] {
    // Filter out non-chat models: embeddings AND image-only models
    const IMAGE_ONLY_PATTERNS = ['imagen', 'nova-canvas', 'dall-e', 'stable-diffusion'];
    const chatModels = models.filter(m => {
      const id = m.modelId.toLowerCase();
      if (id.includes('embed')) return false;
      if (IMAGE_ONLY_PATTERNS.some(p => id.includes(p))) return false;
      return true;
    });

    // If only one model, auto-configure slider to that model's tier
    if (chatModels.length === 1) {
      const model = chatModels[0];
      const defaultPosition = this.getModelSliderPosition(model.modelId);

      return {
        autoConfigured: true,
        defaultPosition,
        tiers: {
          economical: model,
          balanced: model,
          premium: model,
        },
      };
    }

    // Multiple models: assign to tiers by priority
    // Sort by "quality" (inverse of typical pricing)
    const sortedByQuality = [...chatModels].sort((a, b) => {
      const aScore = this.getModelQualityScore(a.modelId);
      const bScore = this.getModelQualityScore(b.modelId);
      return bScore - aScore; // Higher score = better quality
    });

    return {
      autoConfigured: true,
      defaultPosition: 50, // Default to balanced
      tiers: {
        economical: sortedByQuality[sortedByQuality.length - 1] || null, // Cheapest
        balanced: sortedByQuality[Math.floor(sortedByQuality.length / 2)] || sortedByQuality[0],
        premium: sortedByQuality[0] || null, // Best quality
      },
    };
  }

  /**
   * Get slider position (0-100) for a model
   */
  private getModelSliderPosition(modelId: string): number {
    const modelLower = modelId.toLowerCase();

    // Premium tier (61-100)
    if (modelLower.includes('opus') || modelLower.includes('gpt-4') && !modelLower.includes('mini')) {
      return 80;
    }

    // Balanced tier (41-60)
    if (modelLower.includes('sonnet') || modelLower.includes('gpt-4o') || modelLower.includes('gemini-pro')) {
      return 50;
    }

    // Economical tier (0-40)
    if (modelLower.includes('haiku') || modelLower.includes('mini') || modelLower.includes('flash') || modelLower.includes('nova')) {
      return 25;
    }

    // Default to balanced
    return 50;
  }

  /**
   * Get quality score for model sorting (higher = better)
   */
  private getModelQualityScore(modelId: string): number {
    const modelLower = modelId.toLowerCase();

    if (modelLower.includes('opus')) return 100;
    if (modelLower.includes('gpt-5')) return 95;
    if (modelLower.includes('o3') && !modelLower.includes('mini')) return 92;
    if (modelLower.includes('o1') && !modelLower.includes('mini')) return 90;
    if (modelLower.includes('sonnet') && (modelLower.includes('4.5') || modelLower.includes('4-5'))) return 85;
    if (modelLower.includes('o3-mini') || modelLower.includes('o1-mini')) return 82;
    if (modelLower.includes('sonnet')) return 80;
    if (modelLower.includes('gpt-4o') && !modelLower.includes('mini')) return 75;
    if (modelLower.includes('gemini-2.5-pro') || modelLower.includes('gemini-pro')) return 70;
    if (modelLower.includes('gemini-2.5-flash') || modelLower.includes('gemini-flash')) return 50;
    if (modelLower.includes('gpt-4o-mini')) return 45;
    if (modelLower.includes('gpt-4.1')) return 78;
    if (modelLower.includes('haiku')) return 40;
    if (modelLower.includes('nova-pro')) return 35;
    if (modelLower.includes('nova-lite')) return 25;
    if (modelLower.includes('nova-micro')) return 20;
    if (modelLower.includes('gpt-oss') || modelLower.includes('llama') || modelLower.includes('qwen')) return 15;

    return 50; // Default
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
