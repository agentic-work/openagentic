/**
 * Bedrock Pricing Service
 *
 * Fetches live pricing data from AWS Pricing API and caches it.
 * Falls back to hardcoded values only when API doesn't have the model.
 *
 * Usage:
 *   const pricing = BedrockPricingService.getInstance();
 *   await pricing.initialize();
 *   const cost = pricing.getModelPricing('anthropic.claude-haiku-4-5-20251001-v1:0');
 */

import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { logger } from '../utils/logger.js';

export interface ModelPricing {
  modelId: string;
  modelName: string;
  provider: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  region: string;
  lastUpdated: Date;
  source: 'aws-api' | 'fallback';
}

// Fallback pricing for models not yet in AWS Pricing API
// These are updated manually from https://aws.amazon.com/bedrock/pricing/
const FALLBACK_PRICING: Record<string, { input: number; output: number }> = {
  // Claude 4.6 models
  'claude-opus-4.6': { input: 0.005, output: 0.025 },
  'claude-sonnet-4.6': { input: 0.003, output: 0.015 },

  // Claude 4.5 models (not in AWS Pricing API yet)
  'claude-haiku-4.5': { input: 0.0011, output: 0.0055 },
  'claude-sonnet-4.5': { input: 0.0033, output: 0.0165 },
  'claude-sonnet-4.5-long': { input: 0.0066, output: 0.02475 },
  'claude-opus-4.5': { input: 0.0055, output: 0.0275 },

  // Claude 4.x models
  'claude-opus-4.1': { input: 0.015, output: 0.075 },
  'claude-opus-4': { input: 0.015, output: 0.075 },
  'claude-sonnet-4': { input: 0.003, output: 0.015 },
  'claude-sonnet-4-long': { input: 0.006, output: 0.0225 },

  // Claude 3.x models
  'claude-3.7-sonnet': { input: 0.003, output: 0.015 },
  'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
  'claude-3.5-sonnet-v2': { input: 0.003, output: 0.015 },
  'claude-3.5-haiku': { input: 0.0008, output: 0.004 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },

  // Claude 2.x
  'claude-2.1': { input: 0.008, output: 0.024 },
  'claude-2.0': { input: 0.008, output: 0.024 },
  'claude-instant': { input: 0.0008, output: 0.0024 },

  // Titan embeddings
  'titan-embed-image': { input: 0.0008, output: 0 },
  'titan-embed-text': { input: 0.0001, output: 0 },

  // Amazon Nova models (ultra-cheap options)
  // Source: https://aws.amazon.com/bedrock/pricing/
  'nova-micro': { input: 0.000035, output: 0.00014 },  // $0.035/1M input, $0.14/1M output
  'nova-lite': { input: 0.00006, output: 0.00024 },    // $0.06/1M input, $0.24/1M output
  'nova-pro': { input: 0.0008, output: 0.0032 },       // $0.80/1M input, $3.20/1M output
  'nova-premier': { input: 0.0025, output: 0.0125 },   // $2.50/1M input, $12.50/1M output
};

export class BedrockPricingService {
  private static instance: BedrockPricingService;
  private pricingClient: PricingClient;
  private pricingCache: Map<string, ModelPricing> = new Map();
  private initialized = false;
  private lastRefresh: Date | null = null;
  private refreshIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  private constructor() {
    // Pricing API is only available in us-east-1 and ap-south-1
    this.pricingClient = new PricingClient({ region: 'us-east-1' });
  }

  static getInstance(): BedrockPricingService {
    if (!BedrockPricingService.instance) {
      BedrockPricingService.instance = new BedrockPricingService();
    }
    return BedrockPricingService.instance;
  }

  /**
   * Initialize the pricing service by fetching from AWS
   */
  async initialize(): Promise<void> {
    if (this.initialized && this.lastRefresh) {
      const age = Date.now() - this.lastRefresh.getTime();
      if (age < this.refreshIntervalMs) {
        return; // Cache is still fresh
      }
    }

    try {
      await this.fetchBedrockPricing();
      this.initialized = true;
      this.lastRefresh = new Date();
      logger.info({
        cachedModels: this.pricingCache.size,
        source: 'aws-pricing-api'
      }, 'BedrockPricingService initialized');
    } catch (error) {
      logger.warn({ error }, 'Failed to fetch AWS pricing, using fallback values');
      this.initialized = true;
    }
  }

  /**
   * Fetch pricing from AWS Pricing API
   */
  private async fetchBedrockPricing(): Promise<void> {
    const providers = ['Anthropic', 'Amazon', 'Stability AI', 'Meta', 'Cohere'];

    for (const provider of providers) {
      try {
        let nextToken: string | undefined;

        do {
          const command = new GetProductsCommand({
            ServiceCode: 'AmazonBedrock',
            Filters: [
              {
                Type: 'TERM_MATCH',
                Field: 'provider',
                Value: provider
              }
            ],
            NextToken: nextToken,
            MaxResults: 100
          });

          const response = await (this.pricingClient as any).send(command);
          nextToken = response.NextToken;

          if (response.PriceList) {
            for (const priceItem of response.PriceList) {
              const parsed = JSON.parse(priceItem);
              this.processPriceItem(parsed);
            }
          }
        } while (nextToken);

      } catch (error) {
        logger.debug({ error, provider }, 'Failed to fetch pricing for provider');
      }
    }
  }

  /**
   * Process a single price item from AWS API
   */
  private processPriceItem(item: any): void {
    try {
      const attributes = item.product?.attributes;
      if (!attributes) return;

      const modelName = attributes.model;
      const inferenceType = attributes.inferenceType;
      const region = attributes.regionCode || 'us-east-1';
      const provider = attributes.provider;

      // Get the price
      const onDemand = item.terms?.OnDemand;
      if (!onDemand) return;

      const termKey = Object.keys(onDemand)[0];
      if (!termKey) return;

      const priceDimensions = onDemand[termKey]?.priceDimensions;
      if (!priceDimensions) return;

      const dimKey = Object.keys(priceDimensions)[0];
      if (!dimKey) return;

      const pricePerUnit = Number.parseFloat(priceDimensions[dimKey]?.pricePerUnit?.USD || '0');

      // Create cache key (model + region)
      const cacheKey = `${modelName.toLowerCase().replace(/\s+/g, '-')}-${region}`;

      // Get or create pricing entry
      let pricing = this.pricingCache.get(cacheKey);
      if (!pricing) {
        pricing = {
          modelId: cacheKey,
          modelName: modelName,
          provider: provider,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          region: region,
          lastUpdated: new Date(),
          source: 'aws-api'
        };
      }

      // Update input or output price
      if (inferenceType?.toLowerCase().includes('input')) {
        pricing.inputPricePer1k = pricePerUnit;
      } else if (inferenceType?.toLowerCase().includes('output')) {
        pricing.outputPricePer1k = pricePerUnit;
      }

      this.pricingCache.set(cacheKey, pricing);

    } catch (error) {
      logger.debug({ error, item }, 'Failed to process price item');
    }
  }

  /**
   * Get pricing for a model
   * First checks AWS API cache, then falls back to hardcoded values
   */
  getModelPricing(modelId: string, region: string = 'us-west-2'): ModelPricing {
    // Normalize the model ID
    const normalized = this.normalizeModelId(modelId);

    // Try exact match in cache
    const cacheKey = `${normalized}-${region}`;
    if (this.pricingCache.has(cacheKey)) {
      return this.pricingCache.get(cacheKey)!;
    }

    // Try without region
    for (const [key, pricing] of this.pricingCache) {
      if (key.startsWith(normalized)) {
        return pricing;
      }
    }

    // Try partial match on model name
    for (const [key, pricing] of this.pricingCache) {
      if (normalized.includes(pricing.modelName.toLowerCase().replace(/\s+/g, '-'))) {
        return pricing;
      }
    }

    // Fall back to hardcoded values
    return this.getFallbackPricing(modelId, region);
  }

  /**
   * Normalize model ID for lookup
   */
  private normalizeModelId(modelId: string): string {
    return modelId
      .toLowerCase()
      .replace(/anthropic\./g, '')
      .replace(/amazon\./g, '')
      .replace(/stability\./g, '')
      .replace(/-\d{8}-v\d+:\d+/g, '') // Remove version suffix like -20251001-v1:0
      .replace(/\s+/g, '-');
  }

  /**
   * Get fallback pricing for models not in AWS API
   */
  private getFallbackPricing(modelId: string, region: string): ModelPricing {
    const normalized = this.normalizeModelId(modelId);

    // Try to find a matching fallback
    for (const [key, prices] of Object.entries(FALLBACK_PRICING)) {
      if (normalized.includes(key.toLowerCase().replace(/\./g, '-'))) {
        return {
          modelId: modelId,
          modelName: key,
          provider: 'unknown',
          inputPricePer1k: prices.input,
          outputPricePer1k: prices.output,
          region: region,
          lastUpdated: new Date(),
          source: 'fallback'
        };
      }
    }

    // Default fallback - conservative estimate
    logger.warn({ modelId }, 'No pricing found for model, using conservative fallback');
    return {
      modelId: modelId,
      modelName: 'unknown',
      provider: 'unknown',
      inputPricePer1k: 0.003, // $3/1M - middle tier estimate
      outputPricePer1k: 0.015, // $15/1M
      region: region,
      lastUpdated: new Date(),
      source: 'fallback'
    };
  }

  /**
   * Calculate cost for a request
   */
  calculateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    region: string = 'us-west-2'
  ): { inputCost: number; outputCost: number; totalCost: number; source: string } {
    const pricing = this.getModelPricing(modelId, region);

    const inputCost = (inputTokens / 1000) * pricing.inputPricePer1k;
    const outputCost = (outputTokens / 1000) * pricing.outputPricePer1k;

    return {
      inputCost: Number.parseFloat(inputCost.toFixed(8)),
      outputCost: Number.parseFloat(outputCost.toFixed(8)),
      totalCost: Number.parseFloat((inputCost + outputCost).toFixed(8)),
      source: pricing.source
    };
  }

  /**
   * Get all cached pricing
   */
  getAllPricing(): ModelPricing[] {
    return Array.from(this.pricingCache.values());
  }

  /**
   * Force refresh pricing from AWS
   */
  async refresh(): Promise<void> {
    this.initialized = false;
    this.pricingCache.clear();
    await this.initialize();
  }
}

// Export singleton
export const bedrockPricingService = BedrockPricingService.getInstance();
