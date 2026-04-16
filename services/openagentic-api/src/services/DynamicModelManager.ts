/**
 * Dynamic Model Manager
 *
 * @deprecated This service is deprecated. We now use direct Azure OpenAI with specific deployment names.
 * Model discovery is no longer needed - we use configured Azure OpenAI deployments.
 *
 * TODO: Remove this file after confirming no critical dependencies.
 * Date deprecated: 2025-11-12
 * Reason: Architectural change from MCP Proxy to direct Azure OpenAI
 */

import { pino } from 'pino';

const logger = pino({
  name: 'dynamic-model-manager',
  level: process.env.LOG_LEVEL || 'info'
});

export interface ModelCapabilities {
  chat: boolean;
  embeddings: boolean;
  tools: boolean;
  vision: boolean;
  dimensions?: number;
}

export interface DynamicModel {
  id: string;
  provider: string;
  capabilities: ModelCapabilities;
  maxTokens?: number;
  costPerToken?: {
    prompt: number;
    completion: number;
  };
}

class DynamicModelManager {
  private models: Map<string, DynamicModel> = new Map();
  private embeddingModel: string | null = null;
  private chatModel: string | null = null;
  private lastDiscovery: Date | null = null;
  private discoveryInterval = 5 * 60 * 1000; // 5 minutes

  /**
   * Get the best available embedding model
   * Dimensions are read from env (EMBEDDING_DIMENSIONS) - NO HARDCODING
   * If not set in env, caller should use EmbeddingService.getDimension() for auto-detection
   */
  async getEmbeddingModel(): Promise<{ model: string; dimensions: number } | null> {
    // Get model from env - NO HARDCODED FALLBACKS
    const embeddingModel = process.env.EMBEDDING_MODEL ||
                          process.env.EMBEDDING_OLLAMA_MODEL ||
                          process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
                          process.env.VERTEX_AI_EMBEDDING_MODEL ||
                          process.env.AWS_BEDROCK_EMBEDDING_MODEL;

    if (!embeddingModel) {
      logger.error('No embedding model configured! Set EMBEDDING_MODEL in environment.');
      return null;
    }

    const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'unknown';

    // Get dimensions from env - NO HARDCODED FALLBACKS
    // Supports both EMBEDDING_DIMENSIONS (plural) and EMBEDDING_DIMENSION (singular)
    const dimensionStr = process.env.EMBEDDING_DIMENSIONS || process.env.EMBEDDING_DIMENSION;

    if (!dimensionStr) {
      logger.warn({
        model: embeddingModel,
        provider: embeddingProvider
      }, 'EMBEDDING_DIMENSIONS not set in env - caller should use EmbeddingService.getDimension() for auto-detection');
      // Return 0 to indicate "needs auto-detection"
      return {
        model: embeddingModel,
        dimensions: 0
      };
    }

    const dimensions = parseInt(dimensionStr);

    logger.info({
      model: embeddingModel,
      dimensions,
      provider: embeddingProvider
    }, 'Using embedding model');

    return {
      model: embeddingModel,
      dimensions
    };
  }

  /**
   * Get the best available chat model
   * @deprecated Model discovery is disabled - use Azure OpenAI deployments directly
   */
  async getChatModel(): Promise<string | null> {
    logger.warn('DynamicModelManager.getChatModel() is deprecated - use Azure OpenAI deployments directly');
    return null;
  }

  /**
   * Discover all available models from LLM providers
   * @deprecated Model discovery is disabled - use Azure OpenAI deployments directly
   */
  async discoverAllModels(): Promise<Map<string, DynamicModel>> {
    logger.warn('DynamicModelManager.discoverAllModels() is deprecated - model discovery is disabled');
    this.models.clear();
    this.lastDiscovery = new Date();
    return this.models;
  }

  /**
   * Detect provider from model ID
   */
  private detectProvider(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.includes('gpt') || id.includes('text-embedding')) return 'openai';
    if (id.includes('claude')) return 'anthropic';
    if (id.includes('gemini')) return 'google';
    if (id.includes('llama') || id.includes('mistral') || id.includes('mixtral')) return 'meta';
    if (id.includes('command')) return 'cohere';
    if (id.includes('azure')) return 'azure';
    return 'unknown';
  }

  /**
   * Ensure models have been discovered recently
   */
  private async ensureModelsDiscovered(): Promise<void> {
    if (!this.lastDiscovery || 
        Date.now() - this.lastDiscovery.getTime() > this.discoveryInterval) {
      await this.discoverAllModels();
    }
  }

  /**
   * Get all available models
   */
  async getAllModels(): Promise<DynamicModel[]> {
    await this.ensureModelsDiscovered();
    return Array.from(this.models.values());
  }

  /**
   * Get a specific model by ID
   */
  async getModel(modelId: string): Promise<DynamicModel | null> {
    await this.ensureModelsDiscovered();
    return this.models.get(modelId) || null;
  }

  /**
   * Test if a model is available
   */
  async isModelAvailable(modelId: string): Promise<boolean> {
    await this.ensureModelsDiscovered();
    return this.models.has(modelId);
  }

  /**
   * Get models by capability
   */
  async getModelsByCapability(capability: keyof ModelCapabilities): Promise<DynamicModel[]> {
    await this.ensureModelsDiscovered();
    return Array.from(this.models.values()).filter(m => m.capabilities[capability]);
  }
}

// Export singleton instance
export const dynamicModelManager = new DynamicModelManager();

// Also export the class for testing
export { DynamicModelManager };