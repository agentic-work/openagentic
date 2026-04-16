/**
 * Model Capability Discovery Service
 *
 * Discovers and tests available models from configured providers.
 * Stores capabilities in Milvus for semantic search and caches for performance.
 *
 * Features:
 * - LAZY discovery mode (default) - only discovers when explicitly requested
 * - Rate limiting to prevent over-hitting provider endpoints
 * - Uses ModelCapabilityRegistry defaults when discovery is disabled/lazy
 * - Milvus storage with embeddings for semantic search
 * - In-memory caching with TTL
 * - Performance metrics tracking
 *
 * Environment Variables:
 * - CAPABILITY_DISCOVERY_MODE: 'lazy' | 'eager' | 'disabled' (default: 'lazy')
 * - CAPABILITY_DISCOVERY_COOLDOWN_MS: Minimum time between discoveries per provider (default: 60000)
 * - MODEL_DISCOVERY_CACHE_TTL_MS: Cache TTL in ms (default: 86400000 = 24h)
 */

import { Logger } from 'pino';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import OpenAI from 'openai';
import { ExtendedCapabilitiesService } from './ModelCapabilitiesService.js';
import { prisma } from '../utils/prisma.js';

// Discovery mode types
export type DiscoveryMode = 'lazy' | 'eager' | 'disabled';

/**
 * Rate limiter for discovery operations per provider
 * Prevents over-hitting provider endpoints which can burn API limits
 */
class DiscoveryRateLimiter {
  private lastDiscoveryPerProvider: Map<string, number> = new Map();
  private cooldownMs: number;

  constructor(cooldownMs: number = 60000) {
    this.cooldownMs = cooldownMs;
  }

  canDiscover(provider: string): boolean {
    const last = this.lastDiscoveryPerProvider.get(provider) || 0;
    return Date.now() - last >= this.cooldownMs;
  }

  recordDiscovery(provider: string): void {
    this.lastDiscoveryPerProvider.set(provider, Date.now());
  }

  getTimeUntilNextDiscovery(provider: string): number {
    const last = this.lastDiscoveryPerProvider.get(provider) || 0;
    const timeSince = Date.now() - last;
    return Math.max(0, this.cooldownMs - timeSince);
  }

  setCooldown(cooldownMs: number): void {
    this.cooldownMs = cooldownMs;
  }
}

export interface ModelCapability {
  modelId: string;
  provider: string;
  deployment?: string; // Azure deployment name
  capabilities: {
    text: boolean;
    vision: boolean;
    imageGeneration: boolean;
    audioGeneration: boolean;
    audioTranscription: boolean;
    functionCalling: boolean;
    streaming: boolean;
    embeddings: boolean;
    fineTuning: boolean;
    jsonMode: boolean;
    structuredOutput: boolean;
  };
  performance: {
    avgLatencyMs: number;
    throughputTokensPerSec: number;
    maxContextLength: number;
    maxOutputTokens: number;
    concurrentRequests: number;
  };
  cost: {
    inputPer1kTokens: number;
    outputPer1kTokens: number;
    imagePer1k?: number;
    currency: string;
  };
  metadata: {
    family: string; // gpt, claude, llama, etc.
    version: string;
    size?: string; // 7b, 13b, 70b, etc.
    lastTested: Date;
    testResults: any;
    specializations: string[]; // coding, math, creative, etc.
    languages: string[]; // supported languages
  };
  embedding?: number[]; // Vector embedding of capabilities for semantic search
}

export interface DiscoveryConfig {
  providers: {
    azure?: {
      endpoint: string;
      apiKey: string;
      deployments?: string[]; // Specific deployments to test
    };
    openai?: {
      apiKey: string;
      organization?: string;
    };
    custom?: Array<{
      name: string;
      endpoint: string;
      apiKey?: string;
      testEndpoint?: string;
    }>;
  };
  milvus: {
    address: string;
    token?: string;
    collectionName: string;
  };
  cache: {
    ttlMs: number; // Cache TTL in milliseconds
    maxSize: number; // Max number of models to cache
  };
  testing: {
    enabled: boolean;
    parallel: boolean;
    maxConcurrent: number;
    timeout: number;
    testPrompts: {
      text: string;
      vision: string;
      code: string;
      math: string;
      creative: string;
    };
  };
}

export class ModelCapabilityDiscoveryService {
  private logger: Logger;
  private milvusClient: MilvusClient;
  private cache: Map<string, ModelCapability> = new Map();
  private lastDiscovery?: Date;
  private isDiscovering = false;
  private embeddingModel?: OpenAI;
  private rateLimiter: DiscoveryRateLimiter;
  private discoveryMode: DiscoveryMode;

  constructor(
    private config: DiscoveryConfig,
    logger: Logger,
    private capabilitiesService?: ExtendedCapabilitiesService
  ) {
    this.logger = logger.child({ service: 'ModelCapabilityDiscovery' });

    // Get discovery mode from environment (default: 'lazy' to prevent over-hitting providers)
    const modeEnv = process.env.CAPABILITY_DISCOVERY_MODE?.toLowerCase() as DiscoveryMode | undefined;
    this.discoveryMode = modeEnv && ['lazy', 'eager', 'disabled'].includes(modeEnv) ? modeEnv : 'lazy';

    // Initialize rate limiter with configurable cooldown
    const cooldownMs = parseInt(process.env.CAPABILITY_DISCOVERY_COOLDOWN_MS || '60000');
    this.rateLimiter = new DiscoveryRateLimiter(cooldownMs);

    // Initialize Milvus client
    this.milvusClient = new MilvusClient({
      address: this.config.milvus.address,
      token: this.config.milvus.token
    });

    // Initialize embedding model for semantic search
    if (config.providers.openai?.apiKey) {
      this.embeddingModel = new OpenAI({
        apiKey: config.providers.openai.apiKey,
        organization: config.providers.openai.organization
      });
    }

    this.logger.info({
      discoveryMode: this.discoveryMode,
      cooldownMs,
      cacheTtlMs: this.config.cache.ttlMs
    }, 'ModelCapabilityDiscoveryService configured');
  }

  /**
   * Initialize service and create Milvus collection if needed
   * In lazy mode (default), this only loads from DB/cache and does NOT hit provider endpoints
   */
  async initialize(): Promise<void> {
    try {
      // Create or verify Milvus collection
      await this.ensureMilvusCollection();

      // Load cached capabilities from database first (no API calls)
      await this.loadFromDatabase();

      // Only run discovery on startup in 'eager' mode
      if (this.discoveryMode === 'eager') {
        this.logger.info('Running eager model discovery (CAPABILITY_DISCOVERY_MODE=eager)');
        await this.discoverAllModels();
      } else if (this.discoveryMode === 'lazy') {
        this.logger.info('Lazy mode: Skipping startup discovery. Use /api/admin/llm-providers/discover to trigger manually');
      } else {
        this.logger.info('Discovery disabled (CAPABILITY_DISCOVERY_MODE=disabled). Using pre-configured models only');
      }

      // Schedule periodic refresh only in eager mode
      if (this.discoveryMode === 'eager' && this.config.cache.ttlMs > 0) {
        setInterval(() => {
          this.refreshIfNeeded();
        }, this.config.cache.ttlMs);
      }

      this.logger.info({
        mode: this.discoveryMode,
        cachedModels: this.cache.size
      }, 'Model capability discovery service initialized');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize model discovery service');
      throw error;
    }
  }

  /**
   * Load cached capabilities from database (no API calls)
   */
  private async loadFromDatabase(): Promise<void> {
    try {
      const cached = await prisma.systemConfiguration.findFirst({
        where: { key: 'model_capabilities_cache' }
      });

      if (cached?.value) {
        const capabilities = JSON.parse(cached.value as string) as ModelCapability[];
        for (const cap of capabilities) {
          this.cache.set(cap.modelId, cap);
        }
        this.lastDiscovery = cached.updated_at;
        this.logger.info({ count: capabilities.length }, 'Loaded model capabilities from database cache');
      } else {
        this.logger.info('No cached capabilities found in database');
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to load capabilities from database - will use defaults');
    }
  }

  /**
   * Save capabilities to database for persistence across restarts
   */
  private async saveToDatabase(): Promise<void> {
    try {
      const capabilities = Array.from(this.cache.values());
      await prisma.systemConfiguration.upsert({
        where: { key: 'model_capabilities_cache' },
        update: {
          value: JSON.stringify(capabilities),
        },
        create: {
          key: 'model_capabilities_cache',
          value: JSON.stringify(capabilities),
          description: 'Cached model capabilities from discovery'
        }
      });
      this.logger.info({ count: capabilities.length }, 'Saved model capabilities to database');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to save capabilities to database');
    }
  }

  /**
   * Ensure Milvus collection exists with proper schema
   */
  private async ensureMilvusCollection(): Promise<void> {
    const collectionName = this.config.milvus.collectionName || 'model_capabilities';
    
    try {
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });

      if (!hasCollection.value) {
        // Create collection with schema
        await this.milvusClient.createCollection({
          collection_name: collectionName,
          fields: [
            {
              name: 'id',
              data_type: 'Int64',
              is_primary_key: true,
              autoID: true
            },
            {
              name: 'model_id',
              data_type: 'VarChar',
              max_length: 256
            },
            {
              name: 'provider',
              data_type: 'VarChar',
              max_length: 64
            },
            {
              name: 'capability_embedding',
              data_type: 'FloatVector',
              dim: 1536 // OpenAI embedding dimension
            },
            {
              name: 'capabilities_json',
              data_type: 'VarChar',
              max_length: 65535
            },
            {
              name: 'cost_input',
              data_type: 'Float'
            },
            {
              name: 'max_context',
              data_type: 'Int32'
            },
            {
              name: 'last_tested',
              data_type: 'Int64'
            }
          ]
        });

        // Create index for vector search
        await this.milvusClient.createIndex({
          collection_name: collectionName,
          field_name: 'capability_embedding',
          index_type: 'IVF_FLAT',
          metric_type: 'L2',
          params: { nlist: 128 }
        });

        await this.milvusClient.loadCollection({
          collection_name: collectionName
        });

        this.logger.info({ collectionName }, 'Created Milvus collection for model capabilities');
      }
    } catch (error) {
      this.logger.error({ error, collectionName }, 'Failed to ensure Milvus collection');
      throw error;
    }
  }

  /**
   * Discover all available models from all configured providers
   * Uses rate limiting to prevent over-hitting provider endpoints
   * @param force - If true, bypasses rate limiting (use with caution)
   */
  async discoverAllModels(force: boolean = false): Promise<ModelCapability[]> {
    if (this.discoveryMode === 'disabled' && !force) {
      this.logger.info('Discovery is disabled. Returning cached models');
      return Array.from(this.cache.values());
    }

    if (this.isDiscovering) {
      this.logger.warn('Discovery already in progress, skipping');
      return Array.from(this.cache.values());
    }

    this.isDiscovering = true;
    const startTime = Date.now();
    const discoveredModels: ModelCapability[] = [];
    const skippedProviders: string[] = [];

    try {
      this.logger.info({ force }, 'Starting model discovery');

      // Discover from each provider with rate limiting
      const discoveryPromises: Promise<ModelCapability[]>[] = [];

      if (this.config.providers.azure) {
        if (force || this.rateLimiter.canDiscover('azure')) {
          discoveryPromises.push(
            this.discoverAzureModels().then(models => {
              this.rateLimiter.recordDiscovery('azure');
              return models;
            })
          );
        } else {
          const waitTime = this.rateLimiter.getTimeUntilNextDiscovery('azure');
          this.logger.info({ provider: 'azure', waitTimeMs: waitTime }, 'Rate limited - skipping provider discovery');
          skippedProviders.push('azure');
        }
      }

      if (this.config.providers.openai) {
        if (force || this.rateLimiter.canDiscover('openai')) {
          discoveryPromises.push(
            this.discoverOpenAIModels().then(models => {
              this.rateLimiter.recordDiscovery('openai');
              return models;
            })
          );
        } else {
          const waitTime = this.rateLimiter.getTimeUntilNextDiscovery('openai');
          this.logger.info({ provider: 'openai', waitTimeMs: waitTime }, 'Rate limited - skipping provider discovery');
          skippedProviders.push('openai');
        }
      }

      if (this.config.providers.custom) {
        for (const custom of this.config.providers.custom) {
          if (force || this.rateLimiter.canDiscover(custom.name)) {
            discoveryPromises.push(
              this.discoverCustomModels(custom).then(models => {
                this.rateLimiter.recordDiscovery(custom.name);
                return models;
              })
            );
          } else {
            skippedProviders.push(custom.name);
          }
        }
      }

      if (discoveryPromises.length === 0) {
        this.logger.info({ skippedProviders }, 'All providers rate limited. Returning cached models');
        return Array.from(this.cache.values());
      }

      // Wait for all discoveries to complete
      const results = await Promise.allSettled(discoveryPromises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          discoveredModels.push(...result.value);
        } else {
          this.logger.error({ error: result.reason }, 'Provider discovery failed');
        }
      }

      // Test capabilities if enabled (skip in lazy mode to reduce API calls)
      if (this.config.testing.enabled && this.discoveryMode === 'eager') {
        await this.testModelCapabilities(discoveredModels);
      }

      // Generate embeddings for semantic search (only if we have an embedding model)
      if (this.embeddingModel) {
        await this.generateCapabilityEmbeddings(discoveredModels);
      }

      // Merge with existing cache (don't lose cached models for skipped providers)
      for (const model of discoveredModels) {
        this.cache.set(model.modelId, model);
      }

      // Store in Milvus
      if (discoveredModels.length > 0) {
        await this.storeInMilvus(discoveredModels);
      }

      // Persist to database for faster startup next time
      await this.saveToDatabase();

      this.lastDiscovery = new Date();
      const duration = Date.now() - startTime;

      this.logger.info({
        modelsDiscovered: discoveredModels.length,
        totalCached: this.cache.size,
        providers: [...new Set(discoveredModels.map(m => m.provider))],
        skippedProviders,
        durationMs: duration
      }, 'Model discovery completed');

      return discoveredModels;
    } catch (error) {
      this.logger.error({ error }, 'Model discovery failed');
      throw error;
    } finally {
      this.isDiscovering = false;
    }
  }

  /**
   * Get discovery status for admin API
   */
  getDiscoveryStatus(): {
    mode: DiscoveryMode;
    isDiscovering: boolean;
    lastDiscovery: Date | null;
    cachedModels: number;
    providers: { name: string; canDiscover: boolean; waitTimeMs: number }[];
  } {
    const providers = [];

    if (this.config.providers.azure) {
      providers.push({
        name: 'azure',
        canDiscover: this.rateLimiter.canDiscover('azure'),
        waitTimeMs: this.rateLimiter.getTimeUntilNextDiscovery('azure')
      });
    }

    if (this.config.providers.openai) {
      providers.push({
        name: 'openai',
        canDiscover: this.rateLimiter.canDiscover('openai'),
        waitTimeMs: this.rateLimiter.getTimeUntilNextDiscovery('openai')
      });
    }

    if (this.config.providers.custom) {
      for (const custom of this.config.providers.custom) {
        providers.push({
          name: custom.name,
          canDiscover: this.rateLimiter.canDiscover(custom.name),
          waitTimeMs: this.rateLimiter.getTimeUntilNextDiscovery(custom.name)
        });
      }
    }

    return {
      mode: this.discoveryMode,
      isDiscovering: this.isDiscovering,
      lastDiscovery: this.lastDiscovery || null,
      cachedModels: this.cache.size,
      providers
    };
  }

  /**
   * Discover Azure OpenAI models
   */
  private async discoverAzureModels(): Promise<ModelCapability[]> {
    if (!this.config.providers.azure) return [];

    const models: ModelCapability[] = [];
    
    try {
      const client = new OpenAI({
        apiKey: this.config.providers.azure.apiKey,
        baseURL: `${this.config.providers.azure.endpoint}/openai`,
        defaultHeaders: {
          'api-key': this.config.providers.azure.apiKey
        },
        defaultQuery: {
          'api-version': '2024-02-15-preview'
        }
      });

      // Get deployments list (Azure-specific)
      const deployments = this.config.providers.azure.deployments || [];
      
      for (const deployment of deployments) {
        const capability = await this.testAzureDeployment(client, deployment);
        if (capability) {
          models.push(capability);
        }
      }

      this.logger.info({ count: models.length }, 'Discovered Azure OpenAI models');
    } catch (error) {
      this.logger.error({ error }, 'Failed to discover Azure models');
    }

    return models;
  }

  /**
   * Test specific Azure deployment
   */
  private async testAzureDeployment(client: OpenAI, deployment: string): Promise<ModelCapability | null> {
    try {
      // Test basic completion
      const response = await client.chat.completions.create({
        model: deployment,
        messages: [{ role: 'user', content: 'Say "test"' }],
        max_tokens: 5,
        temperature: 0
      });

      // Determine capabilities based on model name and response
      const capabilities = this.inferCapabilitiesFromModelName(deployment);
      
      return {
        modelId: `azure/${deployment}`,
        provider: 'azure',
        deployment,
        capabilities,
        performance: {
          avgLatencyMs: 500, // Will be updated with actual metrics
          throughputTokensPerSec: 100,
          maxContextLength: this.getContextLength(deployment),
          maxOutputTokens: 4096,
          concurrentRequests: 10
        },
        cost: this.getModelCost(deployment),
        metadata: {
          family: this.getModelFamily(deployment),
          version: this.getModelVersion(deployment),
          lastTested: new Date(),
          testResults: { basic: 'success' },
          specializations: this.getModelSpecializations(deployment),
          languages: ['en'] // Will be expanded with actual testing
        }
      };
    } catch (error) {
      this.logger.warn({ deployment, error }, 'Failed to test Azure deployment');
      return null;
    }
  }

  /**
   * Discover OpenAI models
   */
  private async discoverOpenAIModels(): Promise<ModelCapability[]> {
    if (!this.config.providers.openai) return [];

    const models: ModelCapability[] = [];
    
    try {
      const client = new OpenAI({
        apiKey: this.config.providers.openai.apiKey,
        organization: this.config.providers.openai.organization
      });

      const response = await client.models.list();
      
      for (const model of response.data) {
        if (model.id.includes('gpt') || model.id.includes('dall-e')) {
          const capability = await this.testOpenAIModel(client, model.id);
          if (capability) {
            models.push(capability);
          }
        }
      }

      this.logger.info({ count: models.length }, 'Discovered OpenAI models');
    } catch (error) {
      this.logger.error({ error }, 'Failed to discover OpenAI models');
    }

    return models;
  }

  /**
   * Test OpenAI model capabilities
   */
  private async testOpenAIModel(client: OpenAI, modelId: string): Promise<ModelCapability | null> {
    // Implementation similar to testAzureDeployment
    return null; // Placeholder
  }

  /**
   * Discover custom provider models
   */
  private async discoverCustomModels(provider: any): Promise<ModelCapability[]> {
    // Implementation for custom providers
    return [];
  }

  /**
   * Test model capabilities dynamically
   */
  private async testModelCapabilities(models: ModelCapability[]): Promise<void> {
    const testPromises = models.map(model => this.testSingleModel(model));
    
    if (this.config.testing.parallel) {
      // Parallel testing with concurrency limit
      const chunks = this.chunkArray(testPromises, this.config.testing.maxConcurrent);
      for (const chunk of chunks) {
        await Promise.allSettled(chunk);
      }
    } else {
      // Sequential testing
      for (const promise of testPromises) {
        await promise.catch(err => 
          this.logger.error({ error: err }, 'Model test failed')
        );
      }
    }
  }

  /**
   * Test a single model's capabilities
   */
  private async testSingleModel(model: ModelCapability): Promise<void> {
    const tests = [];
    
    // Test text generation
    if (model.capabilities.text) {
      tests.push(this.testTextGeneration(model));
    }
    
    // Test vision
    if (model.capabilities.vision) {
      tests.push(this.testVisionCapability(model));
    }
    
    // Test function calling
    if (model.capabilities.functionCalling) {
      tests.push(this.testFunctionCalling(model));
    }
    
    // Add more capability tests...
    
    const results = await Promise.allSettled(tests);
    model.metadata.testResults = results;
  }

  /**
   * Generate embeddings for semantic search
   */
  private async generateCapabilityEmbeddings(models: ModelCapability[]): Promise<void> {
    if (!this.embeddingModel) {
      this.logger.warn('No embedding model configured, skipping embeddings');
      return;
    }

    for (const model of models) {
      try {
        // Create text description of capabilities
        const capabilityText = this.createCapabilityDescription(model);

        // Generate embedding
        const embeddingModelName = process.env.EMBEDDING_MODEL;
        if (!embeddingModelName) {
          throw new Error('EMBEDDING_MODEL must be set');
        }

        const response = await this.embeddingModel.embeddings.create({
          model: embeddingModelName,
          input: capabilityText
        });
        
        model.embedding = response.data[0].embedding;
      } catch (error) {
        this.logger.error({ modelId: model.modelId, error }, 'Failed to generate embedding');
      }
    }
  }

  /**
   * Store model capabilities in Milvus
   */
  private async storeInMilvus(models: ModelCapability[]): Promise<void> {
    const collectionName = this.config.milvus.collectionName || 'model_capabilities';
    
    try {
      const data = models.map(model => ({
        model_id: model.modelId,
        provider: model.provider,
        capability_embedding: model.embedding || new Array(1536).fill(0),
        capabilities_json: JSON.stringify(model.capabilities),
        cost_input: model.cost.inputPer1kTokens,
        max_context: model.performance.maxContextLength,
        last_tested: model.metadata.lastTested.getTime()
      }));

      await this.milvusClient.insert({
        collection_name: collectionName,
        data
      });

      this.logger.info({ count: models.length }, 'Stored model capabilities in Milvus');
    } catch (error) {
      this.logger.error({ error }, 'Failed to store in Milvus');
    }
  }

  /**
   * Search for models by capability requirements
   */
  async searchModelsByCapability(requirements: string): Promise<ModelCapability[]> {
    if (!this.embeddingModel) {
      // Fallback to cache search
      return this.searchCacheByRequirements(requirements);
    }

    try {
      // Generate embedding for requirements
      const embeddingModelName = process.env.EMBEDDING_MODEL;
      if (!embeddingModelName) {
        throw new Error('EMBEDDING_MODEL must be set');
      }

      const response = await this.embeddingModel.embeddings.create({
        model: embeddingModelName,
        input: requirements
      });
      
      const queryEmbedding = response.data[0].embedding;
      
      // Search in Milvus
      const searchResult = await this.milvusClient.search({
        collection_name: this.config.milvus.collectionName || 'model_capabilities',
        data: [queryEmbedding],
        output_fields: ['model_id', 'provider', 'capabilities_json', 'cost_input'],
        limit: 10
      });
      
      // Map results to ModelCapability objects
      const models: ModelCapability[] = [];
      for (const result of searchResult.results) {
        const cached = this.cache.get(result.model_id as string);
        if (cached) {
          models.push(cached);
        }
      }
      
      return models;
    } catch (error) {
      this.logger.error({ error }, 'Semantic search failed, falling back to cache');
      return this.searchCacheByRequirements(requirements);
    }
  }

  /**
   * Fallback search in cache
   */
  private searchCacheByRequirements(requirements: string): ModelCapability[] {
    const results: ModelCapability[] = [];
    const reqLower = requirements.toLowerCase();
    
    for (const model of this.cache.values()) {
      let score = 0;
      
      // Check for specific capability mentions
      if (reqLower.includes('image') && reqLower.includes('generat') && model.capabilities.imageGeneration) {
        score += 10;
      }
      if (reqLower.includes('vision') && model.capabilities.vision) {
        score += 10;
      }
      if (reqLower.includes('function') && model.capabilities.functionCalling) {
        score += 10;
      }
      if (reqLower.includes('code') && model.metadata.specializations.includes('coding')) {
        score += 5;
      }
      
      if (score > 0) {
        results.push(model);
      }
    }
    
    // Sort by relevance and cost
    return results.sort((a, b) => {
      // Prefer cheaper models if capabilities are similar
      return a.cost.inputPer1kTokens - b.cost.inputPer1kTokens;
    });
  }

  /**
   * Get optimal model for task
   */
  async getOptimalModel(requirements: string, context?: any): Promise<ModelCapability | null> {
    const candidates = await this.searchModelsByCapability(requirements);
    
    if (candidates.length === 0) {
      this.logger.warn({ requirements }, 'No models found matching requirements');
      return null;
    }
    
    // Apply additional filters based on context
    let filtered = candidates;
    
    if (context?.maxCost) {
      filtered = filtered.filter(m => m.cost.inputPer1kTokens <= context.maxCost);
    }
    
    if (context?.minPerformance) {
      filtered = filtered.filter(m => m.performance.avgLatencyMs <= context.minPerformance);
    }
    
    // Return best match
    return filtered[0] || candidates[0];
  }

  /**
   * Get capabilities for a specific model
   */
  async getModelCapabilities(modelId: string): Promise<ModelCapability | null> {
    // Check in-memory cache first
    const cached = this.cache.get(modelId);
    if (cached) {
      return cached;
    }
    
    // Search in Milvus by exact model ID
    try {
      const results = await this.milvusClient.query({
        collection_name: this.config.milvus.collectionName || 'model_capabilities',
        filter: `model_id == "${modelId}"`,
        output_fields: ['model_id', 'provider', 'capabilities', 'performance', 'cost', 'metadata'],
        limit: 1
      });
      
      if (results.data && results.data.length > 0) {
        const modelData = results.data[0];
        const capability: ModelCapability = {
          modelId: modelData.model_id,
          provider: modelData.provider,
          capabilities: JSON.parse(modelData.capabilities),
          performance: JSON.parse(modelData.performance),
          cost: JSON.parse(modelData.cost),
          metadata: JSON.parse(modelData.metadata)
        };
        
        // Cache result
        this.cache.set(modelId, capability);
        return capability;
      }
    } catch (error) {
      this.logger.warn({ error: error.message, modelId }, 'Failed to query model capabilities from Milvus');
    }
    
    return null;
  }

  /**
   * Refresh capabilities if cache is expired
   */
  private async refreshIfNeeded(): Promise<void> {
    if (!this.lastDiscovery) {
      await this.discoverAllModels();
      return;
    }
    
    const age = Date.now() - this.lastDiscovery.getTime();
    if (age > this.config.cache.ttlMs) {
      this.logger.info('Cache expired, refreshing model capabilities');
      await this.discoverAllModels();
    }
  }

  // Helper methods

  private inferCapabilitiesFromModelName(modelName: string): ModelCapability['capabilities'] {
    const lower = modelName.toLowerCase();
    
    return {
      text: true, // All models support text
      vision: lower.includes('vision') || lower.includes('4o') || lower.includes('gpt-4-turbo'),
      imageGeneration: lower.includes('dall-e') || lower.includes('imagen') || lower.includes('stable'),
      audioGeneration: lower.includes('tts') || lower.includes('speech'),
      audioTranscription: lower.includes('whisper') || lower.includes('transcribe'),
      functionCalling: lower.includes('gpt-4') || lower.includes('gpt-3.5-turbo'),
      streaming: !lower.includes('embedding'),
      embeddings: lower.includes('embedding'),
      fineTuning: lower.includes('base') || lower.includes('davinci'),
      jsonMode: lower.includes('gpt-4') || lower.includes('turbo'),
      structuredOutput: lower.includes('gpt-4o')
    };
  }

  private getContextLength(modelName: string): number {
    const lower = modelName.toLowerCase();
    if (lower.includes('32k')) return 32768;
    if (lower.includes('16k')) return 16384;
    if (lower.includes('128k')) return 128000;
    if (lower.includes('turbo')) return 16384;
    if (lower.includes('gpt-4')) return 8192;
    return 4096; // Default
  }

  private getModelCost(modelName: string): ModelCapability['cost'] {
    const lower = modelName.toLowerCase();
    
    // These are approximate costs - should be updated with actual pricing
    if (lower.includes('gpt-4o')) {
      return { inputPer1kTokens: 0.005, outputPer1kTokens: 0.015, currency: 'USD' };
    }
    if (lower.includes('gpt-4')) {
      return { inputPer1kTokens: 0.03, outputPer1kTokens: 0.06, currency: 'USD' };
    }
    if (lower.includes('gpt-3.5')) {
      return { inputPer1kTokens: 0.0005, outputPer1kTokens: 0.0015, currency: 'USD' };
    }
    
    return { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002, currency: 'USD' };
  }

  private getModelFamily(modelName: string): string {
    const lower = modelName.toLowerCase();
    if (lower.includes('gpt')) return 'gpt';
    if (lower.includes('claude')) return 'claude';
    if (lower.includes('llama')) return 'llama';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('gemini')) return 'gemini';
    return 'unknown';
  }

  private getModelVersion(modelName: string): string {
    const match = modelName.match(/(\d+\.?\d*)/);
    return match ? match[1] : '1.0';
  }

  private getModelSpecializations(modelName: string): string[] {
    const specializations: string[] = [];
    const lower = modelName.toLowerCase();
    
    if (lower.includes('code') || lower.includes('codex')) {
      specializations.push('coding');
    }
    if (lower.includes('chat') || lower.includes('turbo')) {
      specializations.push('conversation');
    }
    if (lower.includes('instruct')) {
      specializations.push('instruction-following');
    }
    if (lower.includes('vision')) {
      specializations.push('visual-analysis');
    }
    
    return specializations.length > 0 ? specializations : ['general'];
  }

  private createCapabilityDescription(model: ModelCapability): string {
    const caps = [];
    
    if (model.capabilities.vision) caps.push('vision understanding');
    if (model.capabilities.imageGeneration) caps.push('image generation');
    if (model.capabilities.audioGeneration) caps.push('audio generation');
    if (model.capabilities.functionCalling) caps.push('function calling tool use');
    if (model.capabilities.embeddings) caps.push('text embeddings');
    
    return `${model.modelId} from ${model.provider} with capabilities: ${caps.join(', ')}. ` +
           `Specializations: ${model.metadata.specializations.join(', ')}. ` +
           `Max context: ${model.performance.maxContextLength} tokens. ` +
           `Cost: $${model.cost.inputPer1kTokens} per 1k input tokens.`;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Test methods (placeholders for actual implementation)
  
  private async testTextGeneration(model: ModelCapability): Promise<any> {
    // Test basic text generation
    return { success: true };
  }
  
  private async testVisionCapability(model: ModelCapability): Promise<any> {
    // Test vision understanding
    return { success: true };
  }
  
  private async testFunctionCalling(model: ModelCapability): Promise<any> {
    // Test function calling
    return { success: true };
  }
}

// Singleton instance
let discoveryServiceInstance: ModelCapabilityDiscoveryService | null = null;

export function getModelCapabilityDiscoveryService(): ModelCapabilityDiscoveryService | null {
  return discoveryServiceInstance;
}

export function setModelCapabilityDiscoveryService(service: ModelCapabilityDiscoveryService): void {
  discoveryServiceInstance = service;
}