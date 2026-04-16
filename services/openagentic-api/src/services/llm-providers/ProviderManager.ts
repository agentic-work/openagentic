/**
 * LLM Provider Manager
 *
 * Central service for managing multiple LLM providers (Azure OpenAI, AWS Bedrock, Google Vertex AI)
 * Handles provider registration, routing, failover, and load balancing
 */

import type { Logger } from 'pino';
import { ILLMProvider, CompletionRequest, CompletionResponse, ProviderHealth } from './ILLMProvider.js';
import { AzureOpenAIProvider } from './AzureOpenAIProvider.js';
import { AWSBedrockProvider } from './AWSBedrockProvider.js';
import { GoogleVertexProvider } from './GoogleVertexProvider.js';
import { classifyError, type FailoverClassification } from './FailoverError.js';
import { getModelCapabilityRegistry } from '../ModelCapabilityRegistry.js';

export interface ProviderConfig {
  name: string;
  type: 'azure-openai' | 'aws-bedrock' | 'google-vertex' | 'vertex-ai' | 'ollama' | 'azure-ai-foundry' | 'anthropic' | 'openai';
  enabled: boolean;
  priority: number; // Lower number = higher priority
  config: Record<string, any>;
}

export interface ProviderManagerConfig {
  providers: ProviderConfig[];
  defaultProvider?: string;
  enableFailover: boolean;
  failoverTimeout: number; // ms
  enableLoadBalancing: boolean;
  loadBalancingStrategy: 'round-robin' | 'least-latency' | 'priority';
}

export interface ProviderMetrics {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  totalCost: number;
  lastHealthCheck?: ProviderHealth;
  uptime: number; // percentage
  lastUsed?: Date;
  /** Image generation metrics (separate from completion metrics) */
  imageGenRequests?: number;
  imageGenSuccessful?: number;
  imageGenFailed?: number;
  imageGenAvgLatency?: number;
}

/**
 * Failover metadata returned when a provider fails and another takes over
 */
export interface FailoverMetadata {
  occurred: boolean;
  originalProvider: string;
  failedProvider?: string;
  failoverProvider?: string;
  failureReason?: string;
  failoverTime?: number; // ms
  attemptCount?: number;
}

export interface CostLimits {
  dailyMaxCostCents: number;
  warningThresholdCents?: number;
  enforced: boolean;
}

export class ProviderManager {
  private logger: Logger;
  private providers: Map<string, ILLMProvider> = new Map();
  private config: ProviderManagerConfig;
  private metrics: Map<string, ProviderMetrics> = new Map();
  private roundRobinIndex = 0;
  private initialized = false;
  private providerConfigs: Array<{ name: string; provider_type: string }> = [];

  // Cost cap enforcement: model ID → cost limits from admin config
  private costLimitsMap: Map<string, CostLimits> = new Map();
  // Redis-backed daily spend cache: "cost:daily:{model}:{YYYY-MM-DD}" → cents spent
  private dailySpendCache: Map<string, { cents: number; fetchedAt: number }> = new Map();
  private static readonly SPEND_CACHE_TTL_MS = 60000; // Cache daily spend for 60s

  // TTL-based cache refresh — database is the source of truth.
  // The TTL is a SAFETY NET only — cache is primarily invalidated via
  // Redis pub/sub from admin CRUD operations (see invalidateAllModelCaches +
  // subscribeProviderReload at the bottom of this file). 30s TTL fallback
  // runs in case Redis pub/sub is unavailable.
  private lastReloadTime = 0;
  private reloading = false;
  private static readonly PROVIDER_CACHE_TTL_MS = 30000;

  constructor(logger: Logger, config: ProviderManagerConfig) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Check if provider cache is stale and needs refresh
   */
  private isCacheStale(): boolean {
    return Date.now() - this.lastReloadTime > ProviderManager.PROVIDER_CACHE_TTL_MS;
  }

  /**
   * Ensure providers are fresh - called before operations
   * This makes the database the true source of truth for provider configs
   */
  private async ensureFreshProviders(): Promise<void> {
    if (!this.initialized) return;
    if (this.reloading) return;
    if (!this.isCacheStale()) return;

    this.logger.debug('Provider cache stale, reloading from database...');
    await this.reloadProviders().catch(err => {
      this.logger.warn({ error: err }, 'Failed to refresh providers from database');
    });
  }

  /**
   * Live check: is a model currently enabled and routable?
   * Used by smart router and chat pipeline to bail out fast on disabled
   * models. Reads from in-memory state which is always fresh thanks to
   * Redis pub/sub invalidation (subscribeToInvalidations).
   *
   * Returns true if:
   *   - The model exists in our discovered capabilities
   *   - Its provider is enabled
   *   - The model itself is not flagged disabled in DB
   *
   * Returns false otherwise (caller should fall back to next-best model).
   */
  isModelEnabled(modelId: string): boolean {
    if (!modelId) return false;
    const normalized = modelId.toLowerCase();

    // Check if any provider claims this model and is enabled
    const providerName = this.modelToProviderMap.get(normalized);
    if (!providerName) return false;

    const provider = this.providers.get(providerName);
    if (!provider) return false; // Provider disabled = not in this.providers (init skips disabled ones)

    return true;
  }

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('ProviderManager already initialized');
      return;
    }

    this.logger.info({
      providerCount: this.config.providers.length,
      enableFailover: this.config.enableFailover,
      loadBalancingStrategy: this.config.loadBalancingStrategy
    }, 'Initializing ProviderManager');

    // Sort providers by priority
    const sortedProviders = [...this.config.providers].sort((a, b) => a.priority - b.priority);

    for (const providerConfig of sortedProviders) {
      if (!providerConfig.enabled) {
        this.logger.info({ provider: providerConfig.name }, 'Provider disabled, skipping');
        continue;
      }

      try {
        const provider = await this.createProvider(providerConfig);
        await provider.initialize(providerConfig.config);

        this.providers.set(providerConfig.name, provider);

        // Initialize metrics
        this.metrics.set(providerConfig.name, {
          provider: providerConfig.name,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          averageLatency: 0,
          totalTokens: 0,
          totalCost: 0,
          uptime: 100
        });

        this.logger.info({
          provider: providerConfig.name,
          type: providerConfig.type
        }, 'Provider initialized successfully');

      } catch (error) {
        this.logger.error({
          provider: providerConfig.name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to initialize provider');
      }
    }

    // Allow initialization even if no providers are available
    // The admin UI can show warnings instead of completely failing
    if (this.providers.size === 0) {
      this.logger.warn('No providers initialized successfully - admin UI will show warnings');
    }

    // Log per-provider model discovery results for observability
    for (const [name, provider] of this.providers.entries()) {
      if (typeof (provider as any).discoverModels === 'function') {
        try {
          const discovered = await (provider as any).discoverModels();
          this.logger.info({ provider: name, modelsDiscovered: discovered.length }, 'Discovered models from provider');
        } catch (err: any) {
          this.logger.warn({ provider: name, error: err.message }, 'Model discovery failed');
        }
      }
    }

    // Build model-to-provider mapping from configurations
    this.buildModelToProviderMap();

    // Discover live model capabilities from all providers — MUST complete before init returns
    // so admin CRUD → reloadProviders() → discoveredCapabilities is fresh immediately
    try {
      await this.discoverAllModelCapabilities();
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[ProviderManager] Model discovery failed (non-fatal, routing will use fallbacks)');
    }

    // Live cache invalidation is wired up at the module level via
    // subscribeProviderReload() — see server.ts boot. Admin CRUD endpoints
    // call invalidateAllModelCaches() which publishes to PROVIDER_RELOAD_CHANNEL
    // and all replicas reload immediately. The 30s ensureFreshProviders TTL
    // remains as a safety-net fallback if Redis pub/sub is unavailable.

    // Register known pricing for models not covered by Bedrock pricing API
    this.registerKnownModelPricing();

    this.initialized = true;
    this.lastReloadTime = Date.now();
    this.logger.info({
      initializedProviders: Array.from(this.providers.keys()),
      cacheTtlMs: ProviderManager.PROVIDER_CACHE_TTL_MS
    }, 'ProviderManager initialized (database is source of truth, auto-refreshes every 30s)');
  }

  /**
   * Create a provider instance based on type
   */
  private async createProvider(config: ProviderConfig): Promise<ILLMProvider> {
    switch (config.type) {
      case 'azure-openai':
        return new AzureOpenAIProvider(this.logger);

      case 'aws-bedrock':
        return new AWSBedrockProvider(this.logger);

      case 'google-vertex':
      case 'vertex-ai':
        return new GoogleVertexProvider(this.logger);

      case 'ollama': {
        const { OllamaProvider } = await import('./OllamaProvider.js');
        return new OllamaProvider(this.logger);
      }

      case 'azure-ai-foundry': {
        const { AzureAIFoundryProvider } = await import('./AzureAIFoundryProvider.js');
        // Merge provider_config (pc) + auth_config (ac) — credentials live in auth_config
        const ac = (config as any).authConfig || {};
        const pc = config.config || {};
        return new AzureAIFoundryProvider(this.logger, {
          endpointUrl: pc.endpointUrl || pc.endpoint || ac.endpointUrl || pc.baseUrl,
          apiKey: pc.apiKey || ac.apiKey,
          apiVersion: pc.apiVersion || ac.apiVersion,
          model: pc.chatModel || pc.model || pc.deploymentName || ac.model,
          tenantId: pc.tenantId || ac.tenantId,
          clientId: pc.clientId || ac.clientId,
          clientSecret: pc.clientSecret || ac.clientSecret,
          // (#71) Unified endpoint mode — set via admin form Provider Settings.
          // When true, calls /models/chat/completions and lets admin use any
          // partner-catalog model (Claude, Mistral) without per-model deployments.
          useUnifiedEndpoint: pc.useUnifiedEndpoint === true,
        });
      }

      case 'anthropic': {
        const { AnthropicProvider } = await import('./AnthropicProvider.js');
        return new AnthropicProvider(this.logger);
      }

      case 'openai': {
        const { OpenAIProvider } = await import('./OpenAIProvider.js');
        return new OpenAIProvider(this.logger);
      }

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  // Track last failover metadata for retrieval
  private lastFailoverMetadata: FailoverMetadata | null = null;

  /**
   * Get the last failover metadata (for the completion stage to emit to client)
   */
  getLastFailoverMetadata(): FailoverMetadata | null {
    return this.lastFailoverMetadata;
  }

  /**
   * Clear the last failover metadata
   */
  clearFailoverMetadata(): void {
    this.lastFailoverMetadata = null;
  }

  /**
   * Check if a model has exceeded its daily cost cap.
   * Queries TokenUsage table for today's total spend, with in-memory caching.
   * Throws if cap exceeded and enforcement is enabled.
   */
  private async enforceCostCap(model: string): Promise<void> {
    const normalizedModel = model.toLowerCase();
    const limits = this.costLimitsMap.get(normalizedModel);
    if (!limits || !limits.enforced) return;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const cacheKey = `${normalizedModel}:${today}`;

    // Check in-memory cache first
    const cached = this.dailySpendCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < ProviderManager.SPEND_CACHE_TTL_MS) {
      if (cached.cents >= limits.dailyMaxCostCents) {
        throw new Error(
          `Cost cap exceeded for model "${model}": $${(cached.cents / 100).toFixed(2)} spent today, ` +
          `limit is $${(limits.dailyMaxCostCents / 100).toFixed(2)}/day. ` +
          `Try again tomorrow or use a different model.`
        );
      }
      return;
    }

    // Query DB for today's spend on this model
    try {
      const { prisma } = await import('../../utils/prisma.js');

      const startOfDay = new Date(today + 'T00:00:00.000Z');
      const endOfDay = new Date(today + 'T23:59:59.999Z');

      // Sum total_cost for this model today (total_cost is in dollars, we need cents)
      const result = await prisma.tokenUsage.aggregate({
        where: {
          model: { in: [model, normalizedModel] },
          timestamp: { gte: startOfDay, lte: endOfDay },
        },
        _sum: { total_cost: true },
      });

      const totalDollars = Number(result._sum.total_cost || 0);
      const totalCents = Math.round(totalDollars * 100);

      // Cache the result
      this.dailySpendCache.set(cacheKey, { cents: totalCents, fetchedAt: Date.now() });

      // Log warning threshold
      if (limits.warningThresholdCents && totalCents >= limits.warningThresholdCents && totalCents < limits.dailyMaxCostCents) {
        this.logger.warn({
          model, totalCents, warningThreshold: limits.warningThresholdCents, dailyMax: limits.dailyMaxCostCents,
        }, '[CostCap] WARNING: approaching daily cost limit');
      }

      if (totalCents >= limits.dailyMaxCostCents) {
        this.logger.error({
          model, totalCents, dailyMax: limits.dailyMaxCostCents,
        }, '[CostCap] BLOCKED: daily cost limit exceeded');
        throw new Error(
          `Cost cap exceeded for model "${model}": $${(totalCents / 100).toFixed(2)} spent today, ` +
          `limit is $${(limits.dailyMaxCostCents / 100).toFixed(2)}/day. ` +
          `Try again tomorrow or use a different model.`
        );
      }
    } catch (error: any) {
      // If the error is our own cost cap error, re-throw it
      if (error.message?.includes('Cost cap exceeded')) throw error;
      // Otherwise log and allow the request (fail-open for DB errors)
      this.logger.warn({ error: error.message, model }, '[CostCap] Failed to check cost cap, allowing request');
    }
  }

  /**
   * Increment the daily spend cache after a completion (called post-completion)
   */
  incrementDailySpend(model: string, costDollars: number): void {
    const normalizedModel = model.toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `${normalizedModel}:${today}`;
    const cached = this.dailySpendCache.get(cacheKey);
    if (cached) {
      cached.cents += Math.round(costDollars * 100);
    }
  }

  /**
   * Create a completion using the appropriate provider
   */
  async createCompletion(request: CompletionRequest, targetProvider?: string): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized) {
      throw new Error('ProviderManager not initialized');
    }

    // Ensure providers are fresh from database (TTL-based refresh)
    await this.ensureFreshProviders();

    // Enforce cost cap before making any LLM call
    if (request.model) {
      await this.enforceCostCap(request.model);
    }

    // Clear previous failover metadata
    this.lastFailoverMetadata = null;

    // If target provider specified, use it directly — but verify it's still
    // enabled. After ensureFreshProviders() above, this.providers only
    // contains providers whose admin row has enabled=true. A request that
    // came in just before an admin disable (and finished its preflight
    // before the cache reload) will be rejected here cleanly.
    if (targetProvider) {
      const provider = this.providers.get(targetProvider);
      if (!provider) {
        throw new Error(
          `Provider "${targetProvider}" is not available — it may have been disabled by an admin. ` +
          `Enabled providers: ${Array.from(this.providers.keys()).join(', ') || 'none'}`
        );
      }
      return this.executeCompletion(provider, targetProvider, request);
    }

    // Pre-flight model→provider gate: if the request specifies a model but no
    // enabled provider serves it, fail fast with a clear error instead of
    // letting selectProvider try to guess.
    if (request.model) {
      const resolvedProviderName = this.detectProviderForModel(request.model);
      if (!resolvedProviderName) {
        throw new Error(
          `Model "${request.model}" is not available — no enabled provider serves it. ` +
          `Either re-enable the source provider in admin, or pick one of the available models from /api/chat/models.`
        );
      }
      // Verify the resolved provider is still in the live map (defense in depth
      // against a stale modelToProviderMap entry pointing at a now-disabled provider)
      if (!this.providers.has(resolvedProviderName)) {
        throw new Error(
          `Model "${request.model}" maps to provider "${resolvedProviderName}" which is currently disabled. ` +
          `Enabled providers: ${Array.from(this.providers.keys()).join(', ') || 'none'}`
        );
      }
    }

    // Select provider based on strategy
    const provider = this.selectProvider(request);
    if (!provider) {
      throw new Error('No available providers');
    }

    const [providerInstance, providerName] = provider;

    // Execute with failover if enabled
    if (this.config.enableFailover) {
      return this.executeWithFailover(providerInstance, providerName, request);
    }

    return this.executeCompletion(providerInstance, providerName, request);
  }

  /**
   * Model-to-provider mapping cache (built from provider configurations)
   * This is populated during initialization from each provider's configured models
   */
  private modelToProviderMap: Map<string, string> = new Map();

  /**
   * Live-discovered model capabilities from providers.
   * Populated by discoverAllModelCapabilities() during init/reload.
   * This is the AUTHORITATIVE source — NOT the hardcoded ModelCapabilityRegistry.
   */
  private discoveredCapabilities: Map<string, import('./ILLMProvider.js').DiscoveredModel> = new Map();

  /**
   * Get live-discovered capabilities for a model.
   * Returns null if the model hasn't been discovered yet.
   */
  getDiscoveredCapabilities(modelId: string): import('./ILLMProvider.js').DiscoveredModel | null {
    const normalized = modelId.toLowerCase();
    return this.discoveredCapabilities.get(normalized) || null;
  }

  /**
   * Returns ALL discovered models. Used by ModelCapabilityGate Rule 6 to find a
   * model that meets a requiredContextWindow floor. De-duplicated by model id.
   */
  getAllDiscoveredCapabilities(): import('./ILLMProvider.js').DiscoveredModel[] {
    const seen = new Set<string>();
    const result: import('./ILLMProvider.js').DiscoveredModel[] = [];
    for (const m of this.discoveredCapabilities.values()) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      result.push(m);
    }
    return result;
  }

  /**
   * Discover capabilities from all providers and cache them.
   * Called during init/reload. Non-blocking — failures on individual providers don't prevent startup.
   */
  private async discoverAllModelCapabilities(): Promise<void> {
    this.discoveredCapabilities.clear();
    const startTime = Date.now();

    for (const [name, provider] of this.providers) {
      try {
        // Only use discoverModels() — listModels() lacks capability data
        if (!provider.discoverModels) continue;
        const models = await provider.discoverModels();
        for (const model of models) {
          if (!model.capabilities) continue;
          const normalized = model.id.toLowerCase();
          if (!this.discoveredCapabilities.has(normalized)) {
            this.discoveredCapabilities.set(normalized, model);
          }
          // Also store with :latest suffix for Ollama models
          if (!normalized.includes(':') && !this.discoveredCapabilities.has(`${normalized}:latest`)) {
            this.discoveredCapabilities.set(`${normalized}:latest`, model);
          }
        }
        this.logger.info({
          provider: name,
          modelsDiscovered: models.length,
          modelIds: models.slice(0, 10).map(m => m.id),
        }, '[ProviderManager] Discovered model capabilities from provider');
      } catch (err: any) {
        this.logger.warn({
          provider: name,
          error: err.message,
        }, '[ProviderManager] Failed to discover models from provider (non-fatal)');
      }
    }

    this.logger.info({
      totalModels: this.discoveredCapabilities.size,
      durationMs: Date.now() - startTime,
    }, '[ProviderManager] Model capability discovery complete');
  }

  /**
   * Build the model-to-provider mapping from provider configurations
   * Called during initialization to create a lookup table
   */
  private buildModelToProviderMap(): void {
    this.modelToProviderMap.clear();
    this.costLimitsMap.clear();
    // Store provider configs for type-to-name resolution
    this.providerConfigs = this.config.providers.map(p => ({ name: p.name, provider_type: p.type }));

    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) continue;

      const providerName = providerConfig.name;
      const config = providerConfig.config || {};

      // Collect all model IDs configured for this provider
      const modelIds: string[] = [];

      // Standard model configurations (check all possible model config keys)
      const modelConfigKeys = [
        'modelId', 'model', 'deployment',
        'chatModel', 'embeddingModel', 'visionModel', 'imageModel', 'compactionModel',
        'functionCallingModel', 'healthCheckModel',
        'defaultModel', 'premiumModel', 'economicalModel', 'ultraPremiumModel', 'thinkingModel'
      ];

      for (const key of modelConfigKeys) {
        if (config[key] && typeof config[key] === 'string') {
          modelIds.push(config[key]);
        }
      }

      // Also include models from provider_config.models[] array (admin-added models)
      if (Array.isArray(config.models)) {
        for (const m of config.models) {
          const mId = m.id || m.name;
          if (mId && typeof mId === 'string' && !modelIds.includes(mId)) {
            modelIds.push(mId);
          }
        }
      }

      // Extract cost limits from model_config (set via admin console)
      // costLimits: { dailyMaxCostCents, warningThresholdCents, enforced }
      const rawCostLimits = config.costLimits;
      if (rawCostLimits && rawCostLimits.enforced && rawCostLimits.dailyMaxCostCents > 0) {
        for (const modelId of modelIds) {
          this.costLimitsMap.set(modelId.toLowerCase(), {
            dailyMaxCostCents: rawCostLimits.dailyMaxCostCents,
            warningThresholdCents: rawCostLimits.warningThresholdCents,
            enforced: true,
          });
        }
        this.logger.info({
          provider: providerName,
          costLimits: rawCostLimits,
          models: modelIds,
        }, '[ProviderManager] Cost cap configured for provider models');
      }

      // Register each model ID to this provider
      for (const modelId of modelIds) {
        const normalizedModelId = modelId.toLowerCase();

        // Cross-provider validation: don't map a model to the wrong provider
        // e.g., gpt-oss in vertex-ai's thinkingModel should still route to ollama
        const correctProviderType = this.inferProviderFromModelName(normalizedModelId);
        // Resolve provider TYPE to actual provider NAME (instance name in providers map)
        // e.g., 'aws-bedrock' → 'bedrock-east1', 'vertex-ai' → 'gcp-vertex'
        let correctProvider = correctProviderType;
        if (correctProviderType && !this.providers.has(correctProviderType)) {
          // Type doesn't match any provider name — find by provider_type or SDK type
          // Check both the SDK type property AND the DB provider_type
          for (const [pName, pInstance] of this.providers) {
            const sdkType = (pInstance as any).type;
            const dbType = this.providerConfigs?.find((c: any) => c.name === pName)?.provider_type;
            if (sdkType === correctProviderType || dbType === correctProviderType) {
              correctProvider = pName;
              break;
            }
          }
        }
        const effectiveProvider = correctProvider || providerName;

        if (correctProvider && correctProvider !== providerName) {
          this.logger.warn({
            model: modelId,
            configuredIn: providerName,
            correctedTo: correctProvider
          }, '[ProviderManager] Cross-provider model reference detected, routing to correct provider');
        }

        // Don't overwrite if already registered (first provider wins based on priority)
        if (!this.modelToProviderMap.has(normalizedModelId)) {
          this.modelToProviderMap.set(normalizedModelId, effectiveProvider);
          this.logger.debug({
            model: modelId,
            provider: effectiveProvider
          }, '[ProviderManager] Registered model-to-provider mapping');
        }
      }
    }

    this.logger.info({
      mappingCount: this.modelToProviderMap.size,
      mappings: Object.fromEntries(this.modelToProviderMap)
    }, '[ProviderManager] Built model-to-provider mapping from configuration');
  }

  /**
   * Infer the correct provider for a model based on well-known naming patterns.
   * Returns null if the model name is ambiguous.
   */
  private inferProviderFromModelName(model: string): string | null {
    const m = model.toLowerCase();

    // IMPORTANT: Check cloud provider models BEFORE the Ollama ':' check
    // because Bedrock model IDs have `:0` suffix (e.g., anthropic.claude-sonnet-4-5-20250929-v1:0)
    // and Amazon models have `:0` suffix (e.g., amazon.nova-canvas-v1:0)

    // Bedrock-specific model IDs (have vendor prefix like us.anthropic.* or amazon.*)
    // Plain 'claude-*' names are NOT Bedrock-specific — they could be AIF deployments.
    // Only route to Bedrock when the model ID has the Bedrock ARN-style prefix.
    if (m.startsWith('us.anthropic') || m.startsWith('anthropic.') ||
        m.startsWith('us.amazon.') || m.startsWith('amazon.')) {
      return 'aws-bedrock';
    }
    // Vertex AI / Google models
    if (m.startsWith('gemini') || m.startsWith('palm') || m.startsWith('imagen') ||
        m.startsWith('text-embedding-004') || m.startsWith('text-multilingual')) {
      return 'vertex-ai';
    }
    // Azure AI Foundry-specific GPT models (only available via AIF deployments)
    if (m.startsWith('gpt-4.1') || m.startsWith('gpt-5-mini') || m.startsWith('gpt-5.')) {
      return 'azure-ai-foundry';
    }
    // OpenAI models (exclude gpt-oss and AIF-specific models handled above)
    if (m.startsWith('gpt-') && !m.startsWith('gpt-oss')) {
      return null; // Could be openai or azure-openai
    }
    // Ollama models: have :tag suffix, or well-known OSS model prefixes
    // MUST be after cloud provider checks since Bedrock/Amazon IDs also have ':'
    if (m.includes(':') || m.startsWith('gpt-oss') || m.startsWith('llama') ||
        m.startsWith('qwen') || m.startsWith('deepseek') || m.startsWith('phi-') ||
        m.startsWith('mistral') || m.startsWith('codellama') || m.startsWith('nomic') ||
        m.startsWith('gemma') || m.startsWith('wizardlm') || m.startsWith('vicuna') ||
        m.startsWith('starcoder') || m.startsWith('devstral')) {
      return 'ollama';
    }
    return null;
  }

  /**
   * Register known pricing for models not covered by BedrockPricingService.
   * Only updates the registry cache — does not overwrite DB entries.
   */
  private registerKnownModelPricing(): void {
    const registry = getModelCapabilityRegistry();
    if (!registry) return;

    // Published pricing for Google Vertex/Gemini models (per 1K tokens)
    const knownPricing: Array<{ pattern: string; inputPer1k: number; outputPer1k: number; provider: string }> = [
      // Google Gemini 3.1
      { pattern: 'gemini-3.1-pro', inputPer1k: 0.00125, outputPer1k: 0.01, provider: 'google-vertex' },
      { pattern: 'gemini-3.1-flash', inputPer1k: 0.00015, outputPer1k: 0.0006, provider: 'google-vertex' },
      // Google Gemini 3.0
      { pattern: 'gemini-3-pro', inputPer1k: 0.00125, outputPer1k: 0.01, provider: 'google-vertex' },
      { pattern: 'gemini-3-flash', inputPer1k: 0.00015, outputPer1k: 0.0006, provider: 'google-vertex' },
      // Google Gemini 2.0
      { pattern: 'gemini-2.0-flash', inputPer1k: 0.0001, outputPer1k: 0.0004, provider: 'google-vertex' },
      { pattern: 'gemini-2.0-pro', inputPer1k: 0.00125, outputPer1k: 0.005, provider: 'google-vertex' },
      // Google Gemini 1.5
      { pattern: 'gemini-1.5-pro', inputPer1k: 0.00125, outputPer1k: 0.005, provider: 'google-vertex' },
      { pattern: 'gemini-1.5-flash', inputPer1k: 0.000075, outputPer1k: 0.0003, provider: 'google-vertex' },
      // Embeddings
      { pattern: 'text-embedding-005', inputPer1k: 0.000025, outputPer1k: 0, provider: 'google-vertex' },
      { pattern: 'text-embedding-004', inputPer1k: 0.000025, outputPer1k: 0, provider: 'google-vertex' },
      { pattern: 'text-embedding-3-large', inputPer1k: 0.00013, outputPer1k: 0, provider: 'azure-openai' },
      { pattern: 'text-embedding-3-small', inputPer1k: 0.00002, outputPer1k: 0, provider: 'azure-openai' },
      // GPT-5.x models (Azure AI Foundry / Vertex AI Model Garden)
      { pattern: 'gpt-5.4', inputPer1k: 0.005, outputPer1k: 0.015, provider: 'azure-ai-foundry' },
      { pattern: 'gpt-5', inputPer1k: 0.003, outputPer1k: 0.012, provider: 'azure-ai-foundry' },
      // Azure OpenAI models
      { pattern: 'gpt-4o', inputPer1k: 0.0025, outputPer1k: 0.01, provider: 'azure-openai' },
      { pattern: 'gpt-4o-mini', inputPer1k: 0.00015, outputPer1k: 0.0006, provider: 'azure-openai' },
      { pattern: 'o1', inputPer1k: 0.015, outputPer1k: 0.06, provider: 'azure-openai' },
      { pattern: 'o1-mini', inputPer1k: 0.003, outputPer1k: 0.012, provider: 'azure-openai' },
      // Ollama (local inference - free)
      { pattern: 'llama', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
      { pattern: 'qwen', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
      { pattern: 'deepseek', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
      { pattern: 'mistral', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
      { pattern: 'phi', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
      { pattern: 'codestral', inputPer1k: 0, outputPer1k: 0, provider: 'ollama' },
    ];

    let registered = 0;
    for (const entry of knownPricing) {
      // Only register if not already in cache (don't overwrite DB/pattern matches)
      const existing = registry.getCapabilities(entry.pattern);
      if (!existing || existing.inputCostPer1k === undefined) {
        registry.registerModel({
          modelId: entry.pattern,
          provider: entry.provider,
          providerType: entry.provider as any,
          inputCostPer1k: entry.inputPer1k,
          outputCostPer1k: entry.outputPer1k,
          isAvailable: true,
          lastUpdated: new Date(),
        } as any);
        registered++;
      }
    }

    if (registered > 0) {
      this.logger.info({ registered }, '[ProviderManager] Registered known model pricing for non-Bedrock models');
    }
  }

  /**
   * Detect which provider should handle a given model
   * Uses ONLY the configured model mappings - NO hardcoded patterns
   */
  private detectProviderForModel(model: string): string | null {
    if (!model) return null;

    const modelLower = model.toLowerCase();

    // ── 1. Direct match from explicit config ────────────────────────────────
    // modelToProviderMap is rebuilt on every reloadProviders() and only
    // contains models from ENABLED providers (line 504 skips disabled).
    // If a provider is toggled off in admin, its models vanish from this map
    // within one reload cycle (≤30s TTL or immediate via invalidateAllModelCaches).
    if (this.modelToProviderMap.has(modelLower)) {
      return this.modelToProviderMap.get(modelLower)!;
    }

    // Strip version suffix (e.g., "gpt-oss:latest" -> "gpt-oss")
    const modelWithoutVersion = modelLower.split(':')[0];
    if (modelWithoutVersion !== modelLower && this.modelToProviderMap.has(modelWithoutVersion)) {
      this.logger.debug({
        originalModel: model,
        strippedModel: modelWithoutVersion
      }, '[ProviderManager] Matched model after stripping version suffix');
      return this.modelToProviderMap.get(modelWithoutVersion)!;
    }

    // Alias resolution — bare canonical names like "claude-sonnet-4-6"
    // map to Bedrock-registered "anthropic.claude-sonnet-4-6". Without this,
    // a request silently routes to the platform default (gpt-oss) instead.
    // Also handle version suffixes (-v1, -v1:0) that Bedrock appends to some
    // Anthropic deployments.
    for (const prefix of ['anthropic.', 'us.anthropic.']) {
      if (modelLower.startsWith(prefix)) continue;
      for (const suffix of ['', '-v1', '-v1:0']) {
        const aliased = prefix + modelLower + suffix;
        if (this.modelToProviderMap.has(aliased)) {
          this.logger.info({
            originalModel: model,
            aliasedModel: aliased,
          }, '[ProviderManager] Matched model via alias prefix');
          return this.modelToProviderMap.get(aliased)!;
        }
      }
    }
    // Last-resort fuzzy: a registered entry whose stripped form matches.
    for (const [key, provider] of this.modelToProviderMap.entries()) {
      const stripped = key.replace(/^(us\.)?anthropic\./, '');
      if (stripped === modelLower || stripped.startsWith(modelLower + '-v')) {
        this.logger.info({ originalModel: model, fuzzyMatch: key }, '[ProviderManager] Matched model via fuzzy lookup');
        return provider;
      }
    }

    // ── 2. Live-discovered capability lookup ────────────────────────────────
    // Each enabled provider runs discoverModels() during init/reload and
    // populates discoveredCapabilities. This catches models that are
    // available via auto-discovery (e.g., Ollama local models, AIF deployments)
    // but weren't explicitly added to provider_config.models[].
    // CRITICAL: this only iterates ENABLED providers (this.providers map).
    if (this.discoveredCapabilities.has(modelLower)) {
      // Find which currently-enabled provider serves this model
      for (const [providerName, providerInstance] of this.providers) {
        try {
          const sdkType = (providerInstance as any).type;
          // Check if this provider's discovered model list contains our model
          // (we already populated discoveredCapabilities from each provider)
          const meta = this.discoveredCapabilities.get(modelLower);
          if (meta && (meta.provider === providerName || meta.provider === sdkType)) {
            return providerName;
          }
        } catch {
          /* ignore introspection failures */
        }
      }
    }

    // ── 3. Pattern fallback — VERIFIED against enabled providers only ───────
    // Removed in 2026-04-08 hardening: the previous code returned hardcoded
    // literal provider names (e.g., 'aws-bedrock') without verifying that the
    // provider actually had the requested model. This bypassed admin disable:
    // a request for `anthropic.claude-sonnet-4-5-...` would route to a Bedrock
    // provider that no longer had any Sonnet model in its config, OR to a
    // disabled provider whose name happened to match the literal string.
    //
    // New behavior: if the model id isn't in modelToProviderMap or
    // discoveredCapabilities, no enabled provider serves it. Return null and
    // let the caller error out cleanly with "model unavailable".
    //
    // For models that need pattern-based routing (e.g., a sub-agent picks an
    // unfamiliar id), the admin must add the model explicitly via
    // POST /admin/llm-providers/:providerName/models or rely on the provider's
    // own discoverModels() to surface it.

    this.logger.debug({
      model,
      enabledProviders: Array.from(this.providers.keys()),
      hint: 'Model not found in any enabled provider config or discovered list'
    }, '[ProviderManager] No enabled provider serves this model');

    return null;
  }

  /**
   * PUBLIC method to get the provider for a model
   * Can be called by completion stage to determine routing
   */
  public getProviderForModel(model: string): string | null {
    return this.detectProviderForModel(model);
  }

  /**
   * Return the canonical (registered) model id for an input that may be a
   * bare alias. E.g. "claude-sonnet-4-6" → "anthropic.claude-sonnet-4-6".
   * Returns the input unchanged when no alias is needed (or when no provider
   * matches — caller is expected to error out separately).
   *
   * Without this, downstream provider SDKs receive the bare alias and fail
   * (e.g. Bedrock: "The provided model identifier is invalid"). Routing alone
   * isn't enough — the request body must carry the canonical id too.
   */
  public resolveModelAlias(model: string): string {
    if (!model) return model;
    const modelLower = model.toLowerCase();
    if (this.modelToProviderMap.has(modelLower)) return model;

    // Try common prefix aliases first (exact match after prefix).
    for (const prefix of ['anthropic.', 'us.anthropic.']) {
      if (modelLower.startsWith(prefix)) continue;
      const aliased = prefix + modelLower;
      if (this.modelToProviderMap.has(aliased)) return aliased;
    }

    // Try prefix + model + common Bedrock version suffixes. Different Anthropic
    // models carry different suffix conventions in Bedrock:
    //   anthropic.claude-sonnet-4-6            (no suffix)
    //   anthropic.claude-opus-4-6-v1           (-v1)
    //   anthropic.claude-haiku-4-5-20251001-v1:0  (-v1:0)
    // CLI/SDK consumers send the bare canonical name and expect the API to
    // resolve it. Walk the modelToProviderMap keys for anything that ENDS WITH
    // the requested name under a known prefix; if unambiguous, return it.
    const suffixes = ['', '-v1', '-v1:0'];
    for (const prefix of ['anthropic.', 'us.anthropic.']) {
      for (const suffix of suffixes) {
        if (!suffix) continue; // already tried above
        const aliased = prefix + modelLower + suffix;
        if (this.modelToProviderMap.has(aliased)) return aliased;
      }
    }

    // Fuzzy: find any registered model that ends with the requested name
    // (after dropping a leading provider prefix). Pick the first match.
    for (const key of this.modelToProviderMap.keys()) {
      const stripped = key.replace(/^(us\.)?anthropic\./, '');
      if (stripped === modelLower) return key;
      // Handle version-suffixed registered ids: anthropic.<model>-v1[:0]
      if (stripped.startsWith(modelLower + '-v')) return key;
    }

    return model;
  }

  /**
   * Get the stream format for a given model
   * Used by the pipeline to know how to parse streaming responses
   */
  public getStreamFormatForModel(model: string): 'anthropic' | 'openai' | 'gemini' {
    const providerName = this.detectProviderForModel(model);
    if (providerName) {
      const provider = this.providers.get(providerName);
      if (provider && 'streamFormat' in provider) {
        return (provider as any).streamFormat || 'openai';
      }
    }
    // Default to openai format for unknown providers
    return 'openai';
  }

  /**
   * Select a provider based on load balancing strategy
   * CRITICAL: First checks if the request.model requires a specific provider
   */
  private selectProvider(request: CompletionRequest): [ILLMProvider, string] | null {
    const availableProviders = Array.from(this.providers.entries());

    if (availableProviders.length === 0) {
      return null;
    }

    // Check for resolved provider hint from completion stage (ModelConfigurationService registry)
    const hintProvider = (request as any)?._resolvedProvider;
    if (hintProvider && this.providers.has(hintProvider)) {
      const provider = this.providers.get(hintProvider)!;
      this.logger.info({ provider: hintProvider, model: request.model }, '[ProviderManager] Using resolved provider from registry');
      return [provider, hintProvider];
    }

    // CRITICAL: First, check if the model requires a specific provider
    // This ensures gpt-oss goes to Ollama, gemini goes to Vertex, etc.
    if (request.model) {
      const requiredProvider = this.detectProviderForModel(request.model);

      if (requiredProvider) {
        // First try exact name match
        let matchedProvider = availableProviders.find(([name]) => name === requiredProvider);

        // If not found by name, try by provider TYPE (handles custom provider names)
        // e.g., requiredProvider='aws-bedrock' should match provider named 'bedrock-east1' with type='aws-bedrock'
        if (!matchedProvider) {
          matchedProvider = availableProviders.find(([, prov]) => (prov as any).type === requiredProvider);
        }
        // Also try DB provider_type (handles AIF where SDK type='azure-openai' but DB type='azure-ai-foundry')
        if (!matchedProvider) {
          const dbMatch = this.providerConfigs.find(c => c.provider_type === requiredProvider);
          if (dbMatch) {
            matchedProvider = availableProviders.find(([name]) => name === dbMatch.name);
          }
        }

        if (matchedProvider) {
          this.logger.info({
            model: request.model,
            detectedProvider: requiredProvider,
            resolvedName: matchedProvider[0],
            available: true
          }, '[ProviderManager] Model-based provider routing');

          return [matchedProvider[1], matchedProvider[0]];
        } else {
          this.logger.warn({
            model: request.model,
            detectedProvider: requiredProvider,
            availableProviders: availableProviders.map(([name]) => name)
          }, '[ProviderManager] Required provider not available, falling back to default routing');
        }
      }
    }

    // Fall back to standard load balancing if no model-specific routing
    switch (this.config.loadBalancingStrategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableProviders);

      case 'least-latency':
        return this.selectLeastLatency(availableProviders);

      case 'priority':
      default:
        // Return [provider, name] tuple - already sorted by priority
        const [name, provider] = availableProviders[0];
        return [provider, name];
    }
  }

  /**
   * Round-robin selection
   */
  private selectRoundRobin(providers: [string, ILLMProvider][]): [ILLMProvider, string] {
    const [name, provider] = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % providers.length;
    return [provider, name];
  }

  /**
   * Select provider with lowest average latency
   */
  private selectLeastLatency(providers: [string, ILLMProvider][]): [ILLMProvider, string] {
    let bestProvider = providers[0];
    let lowestLatency = this.metrics.get(providers[0][0])?.averageLatency ?? Infinity;

    for (const [name, provider] of providers) {
      const metrics = this.metrics.get(name);
      if (metrics && metrics.averageLatency < lowestLatency) {
        lowestLatency = metrics.averageLatency;
        bestProvider = [name, provider];
      }
    }

    return [bestProvider[1], bestProvider[0]];
  }

  /**
   * Execute completion with a specific provider
   */
  private async executeCompletion(
    provider: ILLMProvider,
    providerName: string,
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();
    const metrics = this.metrics.get(providerName)!;

    // Merge provider's model config defaults with the request
    // Request values take precedence over provider defaults
    const providerConfig = this.config.providers.find(p => p.name === providerName);
    const modelConfig = providerConfig?.config || {};

    const mergedRequest: CompletionRequest = {
      ...request,
      // Use request values if defined, otherwise fall back to provider model config
      temperature: request.temperature ?? modelConfig.temperature,
      max_tokens: request.max_tokens ?? modelConfig.maxTokens,
      top_p: request.top_p ?? modelConfig.topP,
      top_k: request.top_k ?? modelConfig.topK,
      frequency_penalty: request.frequency_penalty ?? modelConfig.frequencyPenalty,
      presence_penalty: request.presence_penalty ?? modelConfig.presencePenalty,
    };

    this.logger.debug({
      provider: providerName,
      temperature: mergedRequest.temperature,
      maxTokens: mergedRequest.max_tokens,
      topP: mergedRequest.top_p,
      topK: mergedRequest.top_k,
      frequencyPenalty: mergedRequest.frequency_penalty,
      presencePenalty: mergedRequest.presence_penalty,
      source: 'merged_provider_defaults'
    }, 'Request parameters merged with provider model config');

    try {
      metrics.totalRequests++;
      const response = await provider.createCompletion(mergedRequest);

      const latency = Date.now() - startTime;
      metrics.successfulRequests++;
      metrics.averageLatency = (metrics.averageLatency * (metrics.successfulRequests - 1) + latency) / metrics.successfulRequests;

      // Update uptime
      metrics.uptime = (metrics.successfulRequests / metrics.totalRequests) * 100;

      this.logger.debug({
        provider: providerName,
        latency,
        uptime: metrics.uptime.toFixed(2)
      }, 'Completion successful');

      return response;

    } catch (error) {
      metrics.failedRequests++;
      metrics.uptime = (metrics.successfulRequests / metrics.totalRequests) * 100;

      this.logger.error({
        provider: providerName,
        error: error instanceof Error ? error.message : error,
        uptime: metrics.uptime.toFixed(2)
      }, 'Completion failed');

      throw error;
    }
  }

  /**
   * Execute completion with automatic failover
   * Populates lastFailoverMetadata if failover occurs
   */
  private async executeWithFailover(
    provider: ILLMProvider,
    providerName: string,
    request: CompletionRequest
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();
    const originalProvider = providerName;

    try {
      // Try primary provider with timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), this.config.failoverTimeout);
      });

      const completionPromise = this.executeCompletion(provider, providerName, request);

      const result = await Promise.race([completionPromise, timeoutPromise]);

      // Success - no failover occurred
      this.lastFailoverMetadata = {
        occurred: false,
        originalProvider: providerName
      };

      return result;

    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Structured error classification (v0.5.0 hardening)
      const classification: FailoverClassification = classifyError(error, providerName);
      this.logger.warn({
        provider: providerName,
        error: errorMessage,
        elapsed,
        failoverReason: classification.reason,
        retryable: classification.retryable,
        shouldFailover: classification.shouldFailover,
        httpStatus: classification.httpStatus,
      }, `Provider failed [${classification.reason}], attempting failover`);

      // If error is not retryable and not failover-worthy, throw immediately
      if (!classification.retryable && !classification.shouldFailover) {
        this.lastFailoverMetadata = {
          occurred: false,
          originalProvider: providerName,
          failedProvider: providerName,
          failureReason: `${classification.reason}: ${errorMessage}`,
        };
        throw error;
      }

      // Try next available provider
      const providers = Array.from(this.providers.entries());
      const currentIndex = providers.findIndex(([name]) => name === providerName);
      let attemptCount = 1;

      for (let i = 1; i < providers.length; i++) {
        attemptCount++;
        const nextIndex = (currentIndex + i) % providers.length;
        const [nextName, nextProvider] = providers[nextIndex];

        try {
          // Remap model to one supported by the target provider.
          // The original model (e.g. gpt-oss) belongs to the failed provider.
          // Find a configured model that maps to this target provider.
          let failoverModel = request.model;
          const targetProviderModels: string[] = [];
          for (const [model, prov] of this.modelToProviderMap.entries()) {
            if (prov === nextName) targetProviderModels.push(model);
          }
          if (targetProviderModels.length > 0 && !targetProviderModels.includes(request.model?.toLowerCase() || '')) {
            failoverModel = targetProviderModels[0];
          }
          const failoverRequest = failoverModel !== request.model
            ? { ...request, model: failoverModel }
            : request;

          this.logger.info({
            from: providerName,
            to: nextName,
            originalModel: request.model,
            failoverModel,
            attemptCount
          }, 'Failing over to alternate provider');

          const failoverStartTime = Date.now();
          const result = await this.executeCompletion(nextProvider, nextName, failoverRequest);
          const failoverTime = Date.now() - failoverStartTime;

          // Failover succeeded - populate metadata
          this.lastFailoverMetadata = {
            occurred: true,
            originalProvider: originalProvider,
            failedProvider: providerName,
            failoverProvider: nextName,
            failureReason: errorMessage,
            failoverTime: failoverTime,
            attemptCount: attemptCount
          };

          this.logger.info({
            from: providerName,
            to: nextName,
            failoverTime,
            attemptCount
          }, '✅ Failover succeeded');

          return result;

        } catch (failoverError) {
          const failoverErrorMessage = failoverError instanceof Error ? failoverError.message : String(failoverError);
          this.logger.error({
            provider: nextName,
            error: failoverErrorMessage,
            attemptCount
          }, 'Failover provider also failed');

          // Update providerName for next iteration's error tracking
          providerName = nextName;
          continue;
        }
      }

      // All providers failed - populate metadata with final state
      this.lastFailoverMetadata = {
        occurred: true,
        originalProvider: originalProvider,
        failedProvider: providerName,
        failoverProvider: undefined,
        failureReason: 'All providers failed',
        attemptCount: attemptCount
      };

      throw new Error(`All providers failed. Original error: ${errorMessage}`);
    }
  }

  /**
   * Get list of available models from all providers
   */
  async listModels(): Promise<Array<{ id: string; name: string; provider: string; type: string; description?: string }>> {
    const models: Array<{ id: string; name: string; provider: string; type: string; description?: string }> = [];

    for (const [name, provider] of this.providers.entries()) {
      try {
        const providerModels = await provider.listModels();
        // Add type field to each model for UI filtering
        const modelsWithType = providerModels.map(m => ({
          ...m,
          type: 'chat', // All models from providers are chat models
          description: (m as any).description || `${m.provider} model`
        }));
        models.push(...modelsWithType);
      } catch (error) {
        this.logger.error({
          provider: name,
          error: error instanceof Error ? error.message : error
        }, 'Failed to list models');
      }
    }

    return models;
  }

  /**
   * Get health status for all providers
   */
  async getHealthStatus(): Promise<Map<string, ProviderHealth>> {
    const healthStatus = new Map<string, ProviderHealth>();

    for (const [name, provider] of this.providers.entries()) {
      try {
        const health = await provider.getHealth();
        healthStatus.set(name, health);

        // Update metrics with health check result
        const metrics = this.metrics.get(name);
        if (metrics) {
          metrics.lastHealthCheck = health;
        }

      } catch (error) {
        healthStatus.set(name, {
          status: 'unhealthy',
          provider: name,
          error: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date()
        });
      }
    }

    return healthStatus;
  }

  /**
   * Get metrics for all providers
   */
  getMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Get metrics for a specific provider
   */
  getProviderMetrics(providerName: string): ProviderMetrics | undefined {
    return this.metrics.get(providerName);
  }

  /**
   * Get list of registered provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all registered providers with their instances
   */
  getProviders(): Map<string, ILLMProvider> {
    return new Map(this.providers);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(providerName: string): boolean {
    return this.providers.has(providerName);
  }

  /**
   * Get provider instance
   */
  getProvider(providerName: string): ILLMProvider | undefined {
    return this.providers.get(providerName);
  }

  /**
   * Reload providers from database configuration
   * This allows hot-reloading without service restart
   * Called automatically when cache TTL expires (database is the source of truth)
   */
  async reloadProviders(): Promise<void> {
    if (this.reloading) {
      this.logger.debug('Already reloading providers, skipping duplicate request');
      return;
    }

    this.reloading = true;
    this.logger.info('Reloading providers from database (source of truth)...');

    try {
      // Load fresh configuration from database + environment
      const { ProviderConfigService } = await import('./ProviderConfigService.js');
      const configService = new ProviderConfigService(this.logger);
      const newConfig = await configService.loadProviderConfig();

      // (#74) ATOMIC SWAP: previously this method called this.providers.clear()
      // immediately and then awaited a slow re-init. During the gap (~250ms)
      // any chat request that called getProvider() would return null and the
      // completion stage would throw "ProviderManager not initialized". This
      // race was triggered by every admin CRUD that pub/sub-invalidated.
      //
      // Fix: build the new providers map in a temporary, fully initialize it,
      // then swap atomically. The old map keeps serving traffic until the new
      // one is ready. No "empty" window.
      const newProviders = new Map<string, ILLMProvider>();
      const newMetrics = new Map<string, ProviderMetrics>();
      const sortedProviders = [...newConfig.providers].sort((a, b) => a.priority - b.priority);

      for (const providerConfig of sortedProviders) {
        if (!providerConfig.enabled) {
          this.logger.info({ provider: providerConfig.name }, 'Provider disabled, skipping');
          continue;
        }
        try {
          const provider = await this.createProvider(providerConfig);
          await provider.initialize(providerConfig.config);
          newProviders.set(providerConfig.name, provider);
          newMetrics.set(providerConfig.name, {
            provider: providerConfig.name,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            totalTokens: 0,
            totalCost: 0,
            uptime: 100
          });
          this.logger.info({ provider: providerConfig.name, type: providerConfig.type }, 'Provider re-initialized successfully');
        } catch (error) {
          this.logger.error({
            provider: providerConfig.name,
            error: error instanceof Error ? error.message : error
          }, 'Failed to re-initialize provider during reload');
        }
      }

      // Store old map for cleanup
      const oldProviders = this.providers;

      // ATOMIC SWAP — single assignment, no window
      this.providers = newProviders;
      this.metrics = newMetrics;
      this.config = newConfig;
      this.lastReloadTime = Date.now();

      // Rebuild the model→provider lookup map
      this.buildModelToProviderMap();

      // Re-discover capabilities for the new provider set (best-effort, non-blocking)
      this.discoverAllModelCapabilities().catch((err: any) => {
        this.logger.warn({ error: err.message }, '[ProviderManager] Capability re-discovery after reload failed');
      });

      // Cleanup old providers that are no longer configured (after swap, so
      // they're guaranteed not to be in use by any new requests)
      for (const [name, provider] of oldProviders.entries()) {
        if (!this.providers.has(name)) {
          this.logger.info({ provider: name }, 'Provider removed from configuration, cleaning up');
          try {
            if (typeof (provider as any).cleanup === 'function') {
              await (provider as any).cleanup();
            }
          } catch (cleanupError) {
            this.logger.warn({ provider: name, error: cleanupError }, 'Failed to cleanup old provider');
          }
        }
      }

      this.logger.info({
        providersLoaded: this.providers.size,
        providers: Array.from(this.providers.keys())
      }, 'Providers reloaded successfully from database (atomic swap)');

    } catch (error) {
      this.logger.error({ error }, 'Failed to reload providers');
      throw error;
    } finally {
      this.reloading = false;
    }
  }

  // ===========================================================================
  // Image Generation (routed through provider system with failover)
  // ===========================================================================

  /**
   * Generate an image through the unified provider system.
   * Routes to providers with imageGeneration capability, with failover.
   */
  async generateImage(
    request: import('./ILLMProvider.js').ImageGenerationRequest,
    targetProvider?: string
  ): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized) {
      throw new Error('ProviderManager not initialized');
    }

    await this.ensureFreshProviders();

    // Enforce image gen daily cost cap (uses same costLimitsMap as LLM)
    // Image models like imagen-4.0 cost ~$0.04/image — track under model name
    if (request.model) {
      await this.enforceCostCap(request.model);
    }

    // Find providers that support image generation
    // Check provider config models for imageGeneration capability flag
    const imageProviders: Array<[string, ILLMProvider]> = [];
    for (const [name, provider] of this.providers.entries()) {
      if (typeof provider.generateImage !== 'function') continue;
      const providerConfig = this.config.providers.find(pc => pc.name === name);
      const models = providerConfig?.config?.models || [];
      const hasImageModel = models.some((m: any) => m.capabilities?.imageGeneration);
      if (hasImageModel) {
        imageProviders.push([name, provider]);
      }
      this.logger.debug({ provider: name, modelsCount: models.length, hasImageModel }, '[ProviderManager] Image gen provider check');
    }

    if (imageProviders.length === 0) {
      throw new Error('No providers with image generation capability are configured');
    }

    // If target provider specified, use it directly
    if (targetProvider) {
      const entry = imageProviders.find(([name]) => name === targetProvider);
      if (!entry) {
        throw new Error(`Provider "${targetProvider}" not found or does not support image generation`);
      }
      const [name, provider] = entry;
      return this.executeImageGen(provider, name, request);
    }

    // Try providers in priority order with failover
    let lastError: Error | null = null;
    for (const [providerName, provider] of imageProviders) {
      try {
        const startTime = Date.now();

        // Timeout race
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Image generation timeout')), this.config.failoverTimeout);
        });

        const result = await Promise.race([
          this.executeImageGen(provider, providerName, request),
          timeoutPromise,
        ]);

        this.logger.info({
          provider: providerName,
          model: result.model,
          generationTimeMs: result.generationTimeMs,
        }, '[ProviderManager] Image generated successfully');

        // Record image gen cost for daily cap tracking (~$0.04 per Imagen image)
        const imgCostDollars = 0.04;
        if (result.model) {
          this.incrementDailySpend(result.model, imgCostDollars);
          // Also persist to TokenUsage table for accurate tracking
          try {
            const { prisma } = await import('../../utils/prisma.js');
            await prisma.tokenUsage.create({
              data: {
                user_id: 'system',
                session_id: 'image-gen',
                model: result.model,
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                total_cost: imgCostDollars,
                provider: providerName,
                timestamp: new Date(),
              }
            });
          } catch (costErr: any) {
            this.logger.debug({ error: costErr.message }, '[ProviderManager] Failed to record image gen cost (non-fatal)');
          }
        }

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn({
          provider: providerName,
          error: lastError.message,
        }, '[ProviderManager] Image gen provider failed, trying next');
      }
    }

    throw lastError || new Error('All image generation providers failed');
  }

  /**
   * Execute image generation on a specific provider and track metrics.
   */
  private async executeImageGen(
    provider: ILLMProvider,
    providerName: string,
    request: import('./ILLMProvider.js').ImageGenerationRequest
  ): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    const startTime = Date.now();

    // Inject image model from provider config if request doesn't specify one
    if (!request.model) {
      const providerConfig = this.config.providers.find(pc => pc.name === providerName);
      const models = providerConfig?.config?.models || [];
      const imageModel = models.find((m: any) => m.capabilities?.imageGeneration);
      if (imageModel) {
        request = { ...request, model: imageModel.id || imageModel.name };
      }
    }

    try {
      const result = await provider.generateImage!(request);

      // Track image gen metrics
      const metrics = this.metrics.get(providerName);
      if (metrics) {
        metrics.totalRequests++;
        metrics.successfulRequests++;
        metrics.imageGenRequests = (metrics.imageGenRequests || 0) + 1;
        metrics.imageGenSuccessful = (metrics.imageGenSuccessful || 0) + 1;
        const elapsed = Date.now() - startTime;
        metrics.imageGenAvgLatency = metrics.imageGenAvgLatency
          ? (metrics.imageGenAvgLatency + elapsed) / 2
          : elapsed;
        metrics.lastUsed = new Date();
      }

      return result;

    } catch (error) {
      const metrics = this.metrics.get(providerName);
      if (metrics) {
        metrics.totalRequests++;
        metrics.failedRequests++;
        metrics.imageGenRequests = (metrics.imageGenRequests || 0) + 1;
        metrics.imageGenFailed = (metrics.imageGenFailed || 0) + 1;
      }
      throw error;
    }
  }
}


// Singleton accessor for ProviderManager — set by server.ts on init
let _providerManagerInstance: ProviderManager | null = null;

export function setProviderManager(pm: ProviderManager): void {
  _providerManagerInstance = pm;
}

export function getProviderManager(): ProviderManager | null {
  return _providerManagerInstance;
}

const PROVIDER_RELOAD_CHANNEL = 'provider:reload';
let _reloadSubscribed = false;

/**
 * FULL cache invalidation — call after ANY provider/model CRUD.
 * Reloads providers, rediscovers model capabilities, refreshes model config.
 * This ensures admin changes take effect INSTANTLY across the entire platform.
 * Also broadcasts via Redis pub/sub so other replicas reload immediately.
 */
export async function invalidateAllModelCaches(logger?: any, broadcast = true): Promise<void> {
  const pm = getProviderManager();
  if (pm) {
    await pm.reloadProviders(); // This now awaits discoverAllModelCapabilities()
    logger?.info?.('[CacheInvalidation] ProviderManager reloaded + model capabilities rediscovered');
  }
  try {
    const { ModelConfigurationService } = await import('../ModelConfigurationService.js');
    await ModelConfigurationService.refresh();
    logger?.info?.('[CacheInvalidation] ModelConfigurationService cache refreshed');
  } catch (err: any) {
    logger?.warn?.({ error: err.message }, '[CacheInvalidation] ModelConfigurationService refresh failed');
  }

  // Broadcast to other replicas via Redis pub/sub
  if (broadcast) {
    try {
      const { getRedisClient } = await import('../../utils/redis-client.js');
      const redis = getRedisClient();
      await redis.publish(PROVIDER_RELOAD_CHANNEL, JSON.stringify({ ts: Date.now(), source: process.env.HOSTNAME || 'unknown' }));
      logger?.info?.('[CacheInvalidation] Broadcast provider:reload to other replicas');
    } catch {
      // Redis not available — single-replica mode is fine
    }
  }
}

/**
 * Subscribe to provider:reload Redis channel.
 * When another replica broadcasts a change, this replica reloads immediately.
 */
export async function subscribeProviderReload(logger?: any): Promise<void> {
  if (_reloadSubscribed) return;
  _reloadSubscribed = true;
  try {
    const { getRedisClient } = await import('../../utils/redis-client.js');
    const redis = getRedisClient();
    const hostname = process.env.HOSTNAME || 'unknown';
    await redis.subscribe(PROVIDER_RELOAD_CHANNEL, async (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.source === hostname) return; // Ignore own broadcasts
        logger?.info?.({ from: data.source }, '[CacheInvalidation] Received provider:reload from peer, reloading...');
        await invalidateAllModelCaches(logger, false); // Don't re-broadcast
      } catch {
        // Ignore malformed messages
      }
    });
    logger?.info?.('[CacheInvalidation] Subscribed to provider:reload channel');
  } catch (err: any) {
    logger?.warn?.({ error: err.message }, '[CacheInvalidation] Failed to subscribe to provider:reload — single-replica mode');
  }
}
