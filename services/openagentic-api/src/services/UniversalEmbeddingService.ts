/**
 * Universal Embedding Service
 *
 * Multi-provider embedding service that works with:
 * - Azure OpenAI
 * - AWS Bedrock (Amazon Titan, Cohere)
 * - Google Vertex AI (text-embedding models)
 * - Any OpenAI-compatible endpoint
 *
 * Automatically detects provider from environment variables.
 */

import { AzureOpenAI } from 'openai';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ClientSecretCredential, DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import type { Logger } from 'pino';
import { pino } from 'pino';
import { LLMMetricsService } from './LLMMetricsService.js';
import { capEmbeddingDimForHnsw, truncateVectorToColumnDim } from './halfvecHnswCap.js';
import {
  EMBEDDING_INPUT_MAX_CHARS,
  capEmbeddingInput,
  shrinkEmbeddingInput,
} from './embeddingInputCap.js';

export type EmbeddingProvider = 'azure-openai' | 'aws-bedrock' | 'vertex-ai' | 'openai-compatible' | 'ollama';

export interface UniversalEmbeddingConfig {
  // Provider selection
  provider?: EmbeddingProvider;

  // Azure OpenAI
  azureEndpoint?: string;
  azureEmbeddingEndpoint?: string;
  azureApiKey?: string;
  azureApiVersion?: string;
  azureDeployment?: string;

  // AWS Bedrock
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsModelId?: string; // e.g., 'amazon.titan-embed-text-v1'

  // Google Vertex AI
  gcpProjectId?: string;
  gcpLocation?: string;
  gcpModel?: string; // e.g., 'textembedding-gecko@003'

  // Generic OpenAI-compatible
  endpoint?: string;
  apiKey?: string;
  model?: string;

  // Ollama
  ollamaBaseUrl?: string;
  ollamaModel?: string;

  // Common settings
  dimensions?: number;
  maxRetries?: number;
  timeout?: number;
  batchSize?: number;
  
  // Chunking settings for models with small context windows
  maxContextChars?: number;     // Max chars per chunk (auto-detected if not set)
  chunkOverlap?: number;        // Overlap between chunks in chars (default: 100)
  enableChunking?: boolean;     // Enable/disable chunking (default: true for small context models)
}

// Model context limits in characters (conservative estimates, ~4 chars per token)
// These are CONSERVATIVE limits to ensure embeddings succeed
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Ollama models - typically have smaller embedding context
  'embeddinggemma': 1500,        // Very small context for gemma embedding model
  'gemma': 1500,                 // Gemma models have limited embedding context
  'nomic-embed-text': 8000,     // 2K tokens, nomic is better
  'mxbai-embed-large': 2000,    // ~512 tokens
  'all-minilm': 1000,           // ~256 tokens, very small
  'snowflake-arctic-embed': 2000, // ~512 tokens
  'bge': 2000,                  // BGE models ~512 tokens
  
  // Azure/OpenAI models (larger context)
  'text-embedding-ada-002': 32000,   // 8K tokens
  'text-embedding-3-small': 32000,   // 8K tokens
  'text-embedding-3-large': 32000,   // 8K tokens
  
  // AWS Bedrock models
  'amazon.titan-embed-text-v1': 32000,   // 8K tokens
  'amazon.titan-embed-text-v2:0': 32000, // 8K tokens
  'cohere.embed-english-v3': 2000,       // 512 tokens
  'cohere.embed-multilingual-v3': 2000,  // 512 tokens
  
  // Vertex AI models
  'textembedding-gecko@003': 12000,      // 3K tokens
  'text-embedding-004': 12000,           // 3K tokens
  
  // Default fallback - be conservative for unknown models
  'default': 2000  // ~500 tokens, safe for most models
};

export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  provider: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  dimensions: number;
  model: string;
  provider: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Global DB-loaded embedding config cache.
 * Set by server.ts after LLMProviderSeeder runs.
 * All UniversalEmbeddingService instances check this before env var detection.
 */
let _dbEmbeddingConfig: Partial<UniversalEmbeddingConfig> | null = null;
let _dbConfigLoadedAt = 0;

/** Set DB-backed embedding config (called from server.ts after DB seeding) */
export function setDbEmbeddingConfig(config: Partial<UniversalEmbeddingConfig> | null): void {
  _dbEmbeddingConfig = config;
  _dbConfigLoadedAt = Date.now();
}

/** Get the DB-backed config (for admin routes) */
export function getDbEmbeddingConfig(): Partial<UniversalEmbeddingConfig> | null {
  return _dbEmbeddingConfig;
}

/**
 * Universal Embedding Service supporting multiple providers
 */
export class UniversalEmbeddingService {
  private logger: Logger;
  private config: UniversalEmbeddingConfig;
  private provider: EmbeddingProvider;
  private dimensions: number;
  private credential?: DefaultAzureCredential;
  private azureCredential?: ClientSecretCredential;

  // Provider clients
  private azureClient?: AzureOpenAI;
  private bedrockClient?: BedrockRuntimeClient;

  constructor(logger?: Logger, config?: Partial<UniversalEmbeddingConfig>) {
    this.logger = logger || pino({ name: 'universal-embedding-service' });
    this.config = this.detectAndLoadConfig(config);
    this.provider = this.config.provider!;
    this.dimensions = this.config.dimensions || this.getDefaultDimensions();

    this.initializeClient();

    this.logger.info({
      provider: this.provider,
      dimensions: this.dimensions,
      model: this.getModelName()
    }, 'Universal Embedding Service initialized');
  }

  /**
   * Auto-detect provider and load configuration from environment
   */
  private detectAndLoadConfig(userConfig?: Partial<UniversalEmbeddingConfig>): UniversalEmbeddingConfig {
    // If provider explicitly set via userConfig, use that
    if (userConfig?.provider) {
      return this.loadProviderConfig(userConfig.provider, userConfig);
    }

    // Precedence (2026-04-23 — DB is SoT):
    //   1. userConfig.provider (already handled above)
    //   2. _dbEmbeddingConfig (admin-edited state in DB, set by server.ts
    //      after LLMProviderSeeder) — THE authoritative choice
    //   3. EMBEDDING_PROVIDER env var — bootstrap/fallback ONLY when DB is
    //      empty (first-boot, DB unreachable). Never overrides a live DB row.
    //   4. Auto-detection from other env vars — bootstrap only.
    //
    // Previous revision inverted this ("deploy-time config wins over DB")
    // to paper over a non-deterministic Prisma findFirst picker. The fix for
    // that bug lives in server.ts's loader (deterministic ordering), not
    // here. Env-over-DB breaks the promise that admin UI edits stick across
    // pod restarts. See CLAUDE.md "database is SoT" rule.

    const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';

    // FIRST: DB-backed config (set by server.ts after LLMProviderSeeder).
    if (_dbEmbeddingConfig?.provider) {
      this.logger.info({ provider: _dbEmbeddingConfig.provider }, 'Using DB-backed embedding config (SoT)');
      return this.loadProviderConfig(_dbEmbeddingConfig.provider, { ...userConfig, ..._dbEmbeddingConfig });
    }

    // SECOND: Explicit EMBEDDING_PROVIDER env (bootstrap fallback only — no DB row yet)
    const explicitProvider = process.env.EMBEDDING_PROVIDER?.toLowerCase();
    if (explicitProvider) {
      if (explicitProvider === 'ollama') {
        if (!ollamaEnabled) {
          this.logger.warn('EMBEDDING_PROVIDER is set to ollama but OLLAMA_ENABLED is not true - skipping Ollama');
        } else {
          this.logger.info('Using Ollama embedding provider (env fallback — no DB row)');
          return this.loadProviderConfig('ollama', userConfig);
        }
      }
      if (explicitProvider === 'azure-openai' || explicitProvider === 'azure' || explicitProvider === 'azureopenai') {
        this.logger.info('Using Azure OpenAI embedding provider (env fallback — no DB row)');
        return this.loadProviderConfig('azure-openai', userConfig);
      }
      if (explicitProvider === 'aws-bedrock' || explicitProvider === 'aws' || explicitProvider === 'bedrock') {
        this.logger.info('Using AWS Bedrock embedding provider (env fallback — no DB row)');
        return this.loadProviderConfig('aws-bedrock', userConfig);
      }
      if (explicitProvider === 'vertex-ai' || explicitProvider === 'vertex' || explicitProvider === 'gcp') {
        this.logger.info('Using Vertex AI embedding provider (env fallback — no DB row)');
        return this.loadProviderConfig('vertex-ai', userConfig);
      }
      if (explicitProvider === 'openai-compatible' || explicitProvider === 'openai') {
        this.logger.info('Using OpenAI-compatible embedding provider (env fallback — no DB row)');
        return this.loadProviderConfig('openai-compatible', userConfig);
      }
    }

    // THIRD: Auto-detect from environment variables
    // Priority: Ollama (if enabled) > Azure OpenAI > AWS Bedrock > Vertex AI > Generic

    // Check for Ollama (only if explicitly enabled)
    if (ollamaEnabled && (process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_OLLAMA_MODEL || process.env.OLLAMA_BASE_URL)) {
      this.logger.info('Auto-detected Ollama embedding configuration');
      return this.loadProviderConfig('ollama', userConfig);
    }

    // Check for Azure OpenAI - prioritize AZURE_OPENAI_EMBEDDING_ENDPOINT for direct embedding URLs
    if (process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT) {
      this.logger.info('Auto-detected Azure OpenAI embedding configuration');
      return this.loadProviderConfig('azure-openai', userConfig);
    }

    // Check for AWS Bedrock
    if (process.env.AWS_EMBEDDING_MODEL_ID) {
      this.logger.info('Auto-detected AWS Bedrock embedding configuration');
      return this.loadProviderConfig('aws-bedrock', userConfig);
    }

    // Check for Vertex AI
    if (process.env.GCP_EMBEDDING_MODEL || process.env.VERTEX_AI_EMBEDDING_MODEL) {
      this.logger.info('Auto-detected Google Vertex AI embedding configuration');
      return this.loadProviderConfig('vertex-ai', userConfig);
    }

    // Check for generic OpenAI-compatible
    if (process.env.EMBEDDING_ENDPOINT && process.env.EMBEDDING_API_KEY) {
      this.logger.info('Auto-detected OpenAI-compatible embedding configuration');
      return this.loadProviderConfig('openai-compatible', userConfig);
    }

    throw new Error('No embedding provider configuration found. Set EMBEDDING_PROVIDER or one of: OLLAMA_EMBEDDING_MODEL, AZURE_OPENAI_EMBEDDING_DEPLOYMENT, AWS_EMBEDDING_MODEL_ID, GCP_EMBEDDING_MODEL, or EMBEDDING_ENDPOINT');
  }

  /**
   * Load configuration for specific provider
   */
  private loadProviderConfig(provider: EmbeddingProvider, userConfig?: Partial<UniversalEmbeddingConfig>): UniversalEmbeddingConfig {
    const config: UniversalEmbeddingConfig = {
      provider,
      maxRetries: userConfig?.maxRetries || 3,
      timeout: userConfig?.timeout || 30000,
      batchSize: userConfig?.batchSize || 100
    };

    switch (provider) {
      case 'azure-openai':
        // Support both base endpoints and full embedding URLs
        const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT;

        if (embeddingEndpoint && embeddingEndpoint.includes('/embeddings')) {
          // Full embedding URL provided - extract base endpoint
          const url = new URL(embeddingEndpoint);
          config.azureEndpoint = userConfig?.azureEndpoint || `${url.protocol}//${url.host}`;
        } else {
          config.azureEndpoint = userConfig?.azureEndpoint || process.env.AZURE_OPENAI_ENDPOINT;
        }

        config.azureApiKey = userConfig?.azureApiKey || process.env.AZURE_OPENAI_API_KEY;
        config.azureApiVersion = userConfig?.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || '2024-02-15-preview';
        config.azureDeployment = userConfig?.azureDeployment || process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.EMBEDDING_MODEL;
        if (!config.azureDeployment) {
          throw new Error('Azure OpenAI requires AZURE_OPENAI_EMBEDDING_DEPLOYMENT or EMBEDDING_MODEL');
        }
        config.dimensions = userConfig?.dimensions || this.getDimensionsFromEnvOrModel(config.azureDeployment);

        // Support both API key and Entra ID authentication
        if (!config.azureEndpoint) {
          throw new Error('Azure OpenAI requires AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_EMBEDDING_ENDPOINT');
        }

        // Check for Entra ID credentials (preferred)
        const tenantId = process.env.AZURE_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

        if (tenantId && clientId && clientSecret) {
          // Use Entra ID authentication
          this.logger.info('Using Entra ID authentication for Azure OpenAI embeddings');
        } else if (!config.azureApiKey) {
          throw new Error('Azure OpenAI requires either (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET) for Entra ID or AZURE_OPENAI_API_KEY for API key authentication');
        }
        break;

      case 'aws-bedrock':
        config.awsRegion = userConfig?.awsRegion || process.env.AWS_REGION || 'us-east-1';
        config.awsAccessKeyId = userConfig?.awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID;
        config.awsSecretAccessKey = userConfig?.awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
        config.awsModelId = userConfig?.awsModelId || process.env.AWS_EMBEDDING_MODEL_ID || process.env.AWS_BEDROCK_EMBEDDING_MODEL;
        if (!config.awsModelId) {
          throw new Error('AWS Bedrock requires AWS_EMBEDDING_MODEL_ID');
        }
        config.dimensions = userConfig?.dimensions || this.getDimensionsFromEnvOrModel(config.awsModelId);

        if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
          throw new Error('AWS Bedrock requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
        }
        break;

      case 'vertex-ai':
        config.gcpProjectId = userConfig?.gcpProjectId || process.env.GCP_PROJECT_ID;
        config.gcpLocation = userConfig?.gcpLocation || process.env.GCP_LOCATION || 'us-central1';
        config.gcpModel = userConfig?.gcpModel || process.env.GCP_EMBEDDING_MODEL || process.env.VERTEX_AI_EMBEDDING_MODEL;
        if (!config.gcpModel) {
          throw new Error('Vertex AI requires GCP_EMBEDDING_MODEL');
        }
        config.dimensions = userConfig?.dimensions || this.getDimensionsFromEnvOrModel(config.gcpModel);

        if (!config.gcpProjectId) {
          throw new Error('Vertex AI requires GCP_PROJECT_ID');
        }
        break;

      case 'openai-compatible':
        config.endpoint = userConfig?.endpoint || process.env.EMBEDDING_ENDPOINT;
        config.apiKey = userConfig?.apiKey || process.env.EMBEDDING_API_KEY;
        config.model = userConfig?.model || process.env.EMBEDDING_MODEL;
        if (!config.model) {
          throw new Error('OpenAI-compatible requires EMBEDDING_MODEL');
        }
        config.dimensions = userConfig?.dimensions || this.getDimensionsFromEnvOrModel(config.model);

        if (!config.endpoint || !config.apiKey) {
          throw new Error('OpenAI-compatible requires EMBEDDING_ENDPOINT and EMBEDDING_API_KEY');
        }
        break;

      case 'ollama':
        config.ollamaBaseUrl = userConfig?.ollamaBaseUrl || process.env.EMBEDDING_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
        config.ollamaModel = userConfig?.ollamaModel || process.env.EMBEDDING_OLLAMA_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
        if (!config.ollamaModel) {
          throw new Error('Ollama requires EMBEDDING_OLLAMA_MODEL or EMBEDDING_MODEL');
        }
        config.dimensions = userConfig?.dimensions || this.getDimensionsFromEnvOrModel(config.ollamaModel);
        break;
    }

    return config;
  }

  /**
   * Get dimensions from environment variable first, then fall back to known model defaults
   */
  private getDimensionsFromEnvOrModel(modelName?: string): number {
    // FIRST: Check explicit EMBEDDING_DIMENSIONS from environment
    const envDimensions = process.env.EMBEDDING_DIMENSIONS || process.env.AZURE_OPENAI_EMBEDDING_DIMENSION;
    if (envDimensions) {
      const parsed = parseInt(envDimensions, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.logger.info({ dimensions: parsed, source: 'EMBEDDING_DIMENSIONS' }, 'Using dimensions from environment');
        return parsed;
      }
    }

    if (!modelName) {
      this.logger.warn('No model name and no EMBEDDING_DIMENSIONS set - defaulting to 768');
      return 768;
    }

    // Known model dimension lookup (as fallback only)
    const knownDimensions: Record<string, number> = {
      // Azure OpenAI / OpenAI
      'text-embedding-ada-002': 1536,
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,

      // AWS Bedrock
      'amazon.titan-embed-text-v1': 1536,
      'amazon.titan-embed-text-v2': 1024,
      'cohere.embed-english-v3': 1024,
      'cohere.embed-multilingual-v3': 1024,

      // Google Vertex AI
      'textembedding-gecko@001': 768,
      'textembedding-gecko@003': 768,

      // Ollama common models
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
      'embeddinggemma': 768
    };

    // Try exact match
    if (knownDimensions[modelName]) {
      return knownDimensions[modelName];
    }

    // Try partial match
    for (const [key, value] of Object.entries(knownDimensions)) {
      if (modelName.toLowerCase().includes(key.toLowerCase())) {
        return value;
      }
    }

    // Default
    this.logger.warn({ model: modelName }, 'Unknown embedding model, defaulting to 1536 dimensions');
    return 1536;
  }

  /**
   * Get default dimensions based on provider
   */
  private getDefaultDimensions(): number {
    switch (this.provider) {
      case 'azure-openai':
      case 'openai-compatible':
        return 1536;
      case 'aws-bedrock':
        return 1536; // Titan default
      case 'vertex-ai':
        return 768; // Gecko default
      case 'ollama':
        return 768; // Most Ollama models use 768
      default:
        return 1536;
    }
  }

  /**
   * Get model name for logging
   */
  private getModelName(): string {
    switch (this.provider) {
      case 'azure-openai':
        return this.config.azureDeployment || 'unknown';
      case 'aws-bedrock':
        return this.config.awsModelId || 'unknown';
      case 'vertex-ai':
        return this.config.gcpModel || 'unknown';
      case 'openai-compatible':
        return this.config.model || 'unknown';
      case 'ollama':
        return this.config.ollamaModel || 'unknown';
      default:
        return 'unknown';
    }
  }

  /**
   * Initialize provider-specific client
   */
  private initializeClient(): void {
    switch (this.provider) {
      case 'azure-openai':
        const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT;
        const normalizedEndpoint = this.config.azureEndpoint!.endsWith('/') ? this.config.azureEndpoint : `${this.config.azureEndpoint}/`;

        // Check for Entra ID credentials (preferred over API key)
        const tenantId = process.env.AZURE_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

        if (tenantId && clientId && clientSecret) {
          // Use Entra ID authentication (2025 best practice)
          this.azureCredential = new ClientSecretCredential(tenantId, clientId, clientSecret);

          const azureADTokenProvider = getBearerTokenProvider(
            this.azureCredential,
            'https://cognitiveservices.azure.com/.default'
          );

          // Temporarily remove API key from env to prevent SDK conflicts
          const savedApiKey = process.env.AZURE_OPENAI_API_KEY;
          delete process.env.AZURE_OPENAI_API_KEY;

          try {
            if (embeddingEndpoint && embeddingEndpoint.includes('/embeddings')) {
              // Use full embedding URL directly
              this.azureClient = new AzureOpenAI({
                azureADTokenProvider,
                apiVersion: this.config.azureApiVersion!,
                endpoint: normalizedEndpoint,
                baseURL: embeddingEndpoint.split('?')[0], // Remove query params
                maxRetries: this.config.maxRetries,
                timeout: this.config.timeout
              });

              this.logger.info({
                authType: 'entra-id',
                endpoint: normalizedEndpoint,
                baseURL: embeddingEndpoint.split('?')[0],
                deployment: this.config.azureDeployment,
                apiVersion: this.config.azureApiVersion,
                usingDirectClient: true
              }, 'Azure OpenAI embedding client initialized with Entra ID (direct endpoint)');
            } else {
              // Standard endpoint configuration
              this.azureClient = new AzureOpenAI({
                azureADTokenProvider,
                deployment: this.config.azureDeployment!,
                apiVersion: this.config.azureApiVersion!,
                endpoint: normalizedEndpoint,
                maxRetries: this.config.maxRetries,
                timeout: this.config.timeout
              });

              this.logger.info({
                authType: 'entra-id',
                endpoint: normalizedEndpoint,
                deployment: this.config.azureDeployment,
                apiVersion: this.config.azureApiVersion,
                baseURL: `${normalizedEndpoint}openai/v1/`
              }, 'Azure OpenAI embedding client initialized with Entra ID (standard endpoint)');
            }
          } finally {
            // Restore API key for other services
            if (savedApiKey) {
              process.env.AZURE_OPENAI_API_KEY = savedApiKey;
            }
          }
        } else if (this.config.azureApiKey) {
          // Fall back to API key authentication
          if (embeddingEndpoint && embeddingEndpoint.includes('/embeddings')) {
            this.azureClient = new AzureOpenAI({
              apiKey: this.config.azureApiKey,
              apiVersion: this.config.azureApiVersion!,
              endpoint: normalizedEndpoint,
              baseURL: embeddingEndpoint.split('?')[0],
              maxRetries: this.config.maxRetries,
              timeout: this.config.timeout
            });

            this.logger.info({
              authType: 'api-key',
              endpoint: normalizedEndpoint,
              baseURL: embeddingEndpoint.split('?')[0],
              deployment: this.config.azureDeployment,
              usingDirectClient: true
            }, 'Azure OpenAI embedding client initialized with API key (direct endpoint)');
          } else {
            this.azureClient = new AzureOpenAI({
              endpoint: normalizedEndpoint,
              apiKey: this.config.azureApiKey,
              apiVersion: this.config.azureApiVersion!,
              deployment: this.config.azureDeployment!,
              maxRetries: this.config.maxRetries,
              timeout: this.config.timeout
            });

            this.logger.info({
              authType: 'api-key',
              endpoint: normalizedEndpoint,
              deployment: this.config.azureDeployment,
              apiVersion: this.config.azureApiVersion
            }, 'Azure OpenAI embedding client initialized with API key (standard endpoint)');
          }
        } else {
          throw new Error('Azure OpenAI authentication configuration missing');
        }
        break;

      case 'aws-bedrock':
        this.bedrockClient = new BedrockRuntimeClient({
          region: this.config.awsRegion!,
          credentials: {
            accessKeyId: this.config.awsAccessKeyId!,
            secretAccessKey: this.config.awsSecretAccessKey!
          }
        });
        break;

      case 'vertex-ai':
        // Vertex AI client will be initialized on-demand using google-auth-library
        break;

      case 'openai-compatible':
        // Use standard OpenAI client with custom endpoint
        this.azureClient = new AzureOpenAI({
          endpoint: this.config.endpoint!,
          apiKey: this.config.apiKey!,
          maxRetries: this.config.maxRetries,
          timeout: this.config.timeout
        } as any);
        break;

      case 'ollama':
        // Ollama uses HTTP API, no special client needed
        this.logger.info({
          baseUrl: this.config.ollamaBaseUrl,
          model: this.config.ollamaModel
        }, 'Ollama embedding provider configured');
        break;
    }
  }

  /**
   * Get the maximum context length for the current model
   */
  private getMaxContextLength(): number {
    // Check config override first
    if (this.config.maxContextChars) {
      return this.config.maxContextChars;
    }
    
    // Get model name and look up in limits table
    const modelName = this.getModelName().toLowerCase();
    
    // Try exact match first
    if (MODEL_CONTEXT_LIMITS[modelName]) {
      return MODEL_CONTEXT_LIMITS[modelName];
    }
    
    // Try partial match for model families
    for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
      if (modelName.includes(key) || key.includes(modelName)) {
        return limit;
      }
    }
    
    // Default fallback
    return MODEL_CONTEXT_LIMITS['default'];
  }

  /**
   * Check if chunking is needed for the given text
   */
  private needsChunking(text: string): boolean {
    // Explicit disable
    if (this.config.enableChunking === false) {
      return false;
    }
    
    const maxLength = this.getMaxContextLength();
    return text.length > maxLength;
  }

  /**
   * Split text into chunks with overlap for better context preservation
   */
  private chunkText(text: string): string[] {
    const maxLength = this.getMaxContextLength();
    const overlap = this.config.chunkOverlap ?? 100;
    
    if (text.length <= maxLength) {
      return [text];
    }
    
    const chunks: string[] = [];
    let start = 0;
    
    while (start < text.length) {
      let end = start + maxLength;
      
      // Try to break at sentence boundary if possible
      if (end < text.length) {
        // Look for sentence-ending punctuation in the last 20% of the chunk
        const searchStart = Math.floor(end - maxLength * 0.2);
        const searchRegion = text.substring(searchStart, end);
        
        // Find last sentence boundary
        const sentenceBreaks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
        let bestBreak = -1;
        
        for (const breakChar of sentenceBreaks) {
          const idx = searchRegion.lastIndexOf(breakChar);
          if (idx > bestBreak) {
            bestBreak = idx;
          }
        }
        
        if (bestBreak > 0) {
          end = searchStart + bestBreak + 2; // Include the punctuation and space
        } else {
          // Fall back to word boundary
          const lastSpace = text.lastIndexOf(' ', end);
          if (lastSpace > start) {
            end = lastSpace + 1;
          }
        }
      }
      
      chunks.push(text.substring(start, end).trim());
      
      // Move start with overlap (but not for the first chunk)
      start = end - overlap;
      if (start < 0) start = 0;
      
      // Prevent infinite loop
      if (start >= text.length || end >= text.length) {
        break;
      }
    }
    
    // Handle any remaining text
    if (start < text.length && chunks.length > 0) {
      const lastChunk = text.substring(start).trim();
      if (lastChunk.length > 0 && lastChunk !== chunks[chunks.length - 1]) {
        chunks.push(lastChunk);
      }
    }
    
    this.logger.debug({
      originalLength: text.length,
      maxContextLength: maxLength,
      chunkCount: chunks.length,
      chunkLengths: chunks.map(c => c.length)
    }, 'Text chunked for embedding');
    
    return chunks;
  }

  /**
   * Average multiple embeddings into one (mean pooling)
   * Weighted by chunk length for better representation
   */
  private averageEmbeddings(embeddings: number[][], weights?: number[]): number[] {
    if (embeddings.length === 0) {
      throw new Error('Cannot average zero embeddings');
    }
    
    if (embeddings.length === 1) {
      return embeddings[0];
    }
    
    const dimensions = embeddings[0].length;
    const result = new Array(dimensions).fill(0);
    
    // Use weights if provided, otherwise equal weights
    const effectiveWeights = weights || embeddings.map(() => 1 / embeddings.length);
    const totalWeight = effectiveWeights.reduce((a, b) => a + b, 0);
    
    for (let i = 0; i < embeddings.length; i++) {
      const weight = effectiveWeights[i] / totalWeight;
      for (let j = 0; j < dimensions; j++) {
        result[j] += embeddings[i][j] * weight;
      }
    }
    
    // Normalize the result vector (L2 normalization)
    const magnitude = Math.sqrt(result.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < result.length; i++) {
        result[i] /= magnitude;
      }
    }
    
    return result;
  }

  /**
   * Generate embedding for a single chunk (internal method)
   */
  private async generateSingleEmbedding(text: string): Promise<{ embedding: number[]; usage?: any }> {
    let embedding: number[];
    let usage: any = undefined;

    // Hard cap the INPUT before it ever reaches a provider. A single very long
    // input (e.g. aws_knowledge read_documentation) otherwise 500s with
    // "the input length exceeds the context length" and — in the batch indexer
    // — zeroes out the entire tool catalog. Truncation is safe for semantic
    // search: leading text is the most discriminative. See embeddingInputCap.ts.
    const safeText = capEmbeddingInput(text);

    switch (this.provider) {
      case 'azure-openai':
      case 'openai-compatible':
        const response = await this.azureClient!.embeddings.create({
          input: safeText,
          model: this.config.azureDeployment || this.config.model!
        });
        embedding = response.data[0].embedding;
        usage = response.usage;
        break;

      case 'aws-bedrock':
        embedding = await this.generateBedrockEmbedding(safeText);
        break;

      case 'vertex-ai':
        embedding = await this.generateVertexEmbedding(safeText);
        break;

      case 'ollama':
        embedding = await this.generateOllamaEmbeddingSafe(safeText);
        break;

      default:
        throw new Error(`Unsupported provider: ${this.provider}`);
    }

    // qwen3-embedding:8b returns 4096-d but halfvec HNSW caps at 4000 — Matryoshka prefix preserves semantics.
    const columnDim = capEmbeddingDimForHnsw(this.dimensions ?? embedding.length);
    const truncated = truncateVectorToColumnDim(embedding, columnDim);

    return { embedding: truncated, usage };
  }

  /**
   * Generate embedding for a single text with automatic chunking for long texts
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();

    try {
      let embedding: number[];
      let usage: any = undefined;
      let chunked = false;
      let chunkCount = 1;

      // Check if we need to chunk the text
      if (this.needsChunking(text)) {
        chunked = true;
        const chunks = this.chunkText(text);
        chunkCount = chunks.length;
        
        this.logger.info({
          provider: this.provider,
          originalLength: text.length,
          maxContextLength: this.getMaxContextLength(),
          chunkCount: chunks.length,
          model: this.getModelName()
        }, 'Chunking text for embedding due to context length');

        // Generate embeddings for all chunks
        const chunkEmbeddings: number[][] = [];
        const chunkWeights: number[] = [];
        let totalUsage = { prompt_tokens: 0, total_tokens: 0 };

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          this.logger.debug({
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            chunkLength: chunk.length
          }, 'Processing chunk');

          const result = await this.generateSingleEmbedding(chunk);
          chunkEmbeddings.push(result.embedding);
          chunkWeights.push(chunk.length); // Weight by chunk length
          
          if (result.usage) {
            totalUsage.prompt_tokens += result.usage.prompt_tokens || 0;
            totalUsage.total_tokens += result.usage.total_tokens || 0;
          }
        }

        // Average the chunk embeddings with length-based weighting
        embedding = this.averageEmbeddings(chunkEmbeddings, chunkWeights);
        usage = totalUsage;

      } else {
        // Text fits within context, generate directly
        const result = await this.generateSingleEmbedding(text);
        embedding = result.embedding;
        usage = result.usage;
      }

      const duration = Date.now() - startTime;

      this.logger.info({
        provider: this.provider,
        textLength: text.length,
        dimensions: embedding.length,
        duration,
        chunked,
        chunkCount,
        maxContextLength: this.getMaxContextLength(),
        model: this.getModelName(),
        usingDirectClient: this.provider === 'azure-openai' && process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT?.includes('/embeddings')
      }, 'Generated embedding successfully with UniversalEmbeddingService');

      // Log embedding request to metrics (async, don't block response)
      this.logEmbeddingMetrics({
        provider: this.provider,
        model: this.getModelName(),
        promptTokens: usage?.prompt_tokens || usage?.total_tokens || Math.ceil(text.length / 4),
        totalTokens: usage?.total_tokens || Math.ceil(text.length / 4),
        latencyMs: duration,
        status: 'success'
      }).catch(err => {
        this.logger.warn({ err }, 'Failed to log embedding metrics');
      });

      return {
        embedding,
        dimensions: embedding.length,
        model: this.getModelName(),
        provider: this.provider,
        usage
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.logger.error({
        err: error,
        provider: this.provider,
        textLength: text.length,
        maxContextLength: this.getMaxContextLength()
      }, 'Failed to generate embedding');

      // Log failed embedding request
      this.logEmbeddingMetrics({
        provider: this.provider,
        model: this.getModelName(),
        promptTokens: Math.ceil(text.length / 4),
        totalTokens: Math.ceil(text.length / 4),
        latencyMs: duration,
        status: 'error',
        errorMessage: error?.message || 'Unknown error'
      }).catch(() => {});

      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async generateBatchEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    const startTime = Date.now();

    try {
      // Process in batches to avoid rate limits
      const batchSize = this.config.batchSize || 100;
      const allEmbeddings: number[][] = [];
      let totalUsage: any = { prompt_tokens: 0, total_tokens: 0 };

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);

        switch (this.provider) {
          case 'azure-openai':
          case 'openai-compatible':
            const response = await this.azureClient!.embeddings.create({
              input: batch,
              model: this.config.azureDeployment || this.config.model!
            });
            allEmbeddings.push(...response.data.map(d => d.embedding));
            if (response.usage) {
              totalUsage.prompt_tokens += response.usage.prompt_tokens || 0;
              totalUsage.total_tokens += response.usage.total_tokens || 0;
            }
            break;

          case 'aws-bedrock':
            // Bedrock doesn't support batch, process one by one
            for (const text of batch) {
              const embedding = await this.generateBedrockEmbedding(text);
              allEmbeddings.push(embedding);
            }
            break;

          case 'vertex-ai':
            // Vertex AI supports batch
            for (const text of batch) {
              const embedding = await this.generateVertexEmbedding(text);
              allEmbeddings.push(embedding);
            }
            break;

          case 'ollama':
            // Ollama doesn't support batch, process one by one.
            // Each input is INPUT-capped + retried-on-overflow so ONE
            // pathological description (read_documentation) can't 500 the
            // whole batch and zero out the tool catalog. A still-failing
            // input gets a zero-vector placeholder rather than aborting —
            // the batch length MUST stay aligned with the tool array so the
            // caller's index→tool mapping in MCPToolIndexingService holds.
            for (const text of batch) {
              const embedding = await this.generateOllamaEmbeddingSafe(text);
              allEmbeddings.push(embedding);
            }
            break;
        }
      }

      const duration = Date.now() - startTime;

      this.logger.info({
        provider: this.provider,
        count: texts.length,
        dimensions: allEmbeddings[0]?.length || 0,
        duration,
        avgPerText: Math.round(duration / texts.length),
        usingDirectClient: this.provider === 'azure-openai' && process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT?.includes('/embeddings')
      }, 'Generated batch embeddings successfully with UniversalEmbeddingService');

      return {
        embeddings: allEmbeddings,
        dimensions: allEmbeddings[0]?.length || this.dimensions,
        model: this.getModelName(),
        provider: this.provider,
        usage: totalUsage
      };

    } catch (error) {
      this.logger.error({
        err: error,
        provider: this.provider,
        count: texts.length
      }, 'Failed to generate batch embeddings');
      throw error;
    }
  }

  /**
   * Generate embedding using AWS Bedrock
   */
  private async generateBedrockEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.config.awsModelId!,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text
      })
    });

    const response = await this.bedrockClient!.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Handle different Bedrock model response formats
    if (responseBody.embedding) {
      return responseBody.embedding;
    } else if (responseBody.embeddings && Array.isArray(responseBody.embeddings)) {
      return responseBody.embeddings[0];
    } else {
      throw new Error('Unexpected Bedrock response format');
    }
  }

  /**
   * Generate embedding using Google Vertex AI
   * Uses the REST API with Application Default Credentials (ADC)
   */
  private async generateVertexEmbedding(text: string): Promise<number[]> {
    const projectId = this.config.gcpProjectId;
    const location = this.config.gcpLocation || 'us-central1';
    const model = this.config.gcpModel || 'text-embedding-004';

    if (!projectId) {
      throw new Error('GCP_PROJECT_ID is required for Vertex AI embeddings');
    }

    // Vertex AI embedding endpoint
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;

    this.logger.debug({
      endpoint,
      model,
      textLength: text.length,
      projectId,
      location
    }, 'Generating Vertex AI embedding');

    // Get access token using Application Default Credentials
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    if (!accessToken.token) {
      throw new Error('Failed to get access token for Vertex AI. Ensure GCP credentials are configured.');
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instances: [{ content: text }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error({
        status: response.status,
        error: errorText
      }, 'Vertex AI embedding request failed');
      throw new Error(`Vertex AI embedding request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as {
      predictions?: Array<{ embeddings?: { values?: number[] } }>;
    };

    const embedding = result.predictions?.[0]?.embeddings?.values;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response from Vertex AI');
    }

    this.logger.debug({
      model,
      dimensions: embedding.length
    }, 'Generated Vertex AI embedding');

    return embedding;
  }

  /**
   * Generate embedding using Ollama
   */
  private async generateOllamaEmbedding(text: string): Promise<number[]> {
    const baseUrl = this.config.ollamaBaseUrl || 'http://ollama:11434';
    const model = this.config.ollamaModel;

    if (!model) {
      throw new Error('Ollama model not configured. Set EMBEDDING_OLLAMA_MODEL or EMBEDDING_MODEL');
    }

    const url = `${baseUrl}/api/embeddings`;

    this.logger.debug({
      url,
      model,
      textLength: text.length
    }, 'Generating Ollama embedding');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: text
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error(`Invalid Ollama response: missing embedding array. Got: ${JSON.stringify(data).substring(0, 200)}`);
    }

    return data.embedding;
  }

  /**
   * Robust Ollama embedding: input-cap, then shrink-and-retry on a context
   * overflow, then a zero-vector last resort. A single oversized/pathological
   * input must NEVER fail the whole batch (which would leave the MCP tool
   * catalog empty — the live failure on open-dev 2026-06-01).
   *
   * Retry trigger is narrow: only the provider's context-overflow signal
   * ("input length exceeds the context length" / HTTP 500 from the embed
   * endpoint). Other errors (network, model-not-found) propagate so they're
   * not silently swallowed.
   */
  private async generateOllamaEmbeddingSafe(text: string): Promise<number[]> {
    let budget: number = EMBEDDING_INPUT_MAX_CHARS;
    let attemptText = capEmbeddingInput(text, budget);

    // First attempt at the normal cap, then up to a few shrink-halving retries.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.generateOllamaEmbedding(attemptText);
      } catch (err: any) {
        const msg = String(err?.message || '');
        const isContextOverflow =
          /exceeds the context length/i.test(msg) ||
          /input length/i.test(msg) ||
          /\b500\b/.test(msg);

        if (!isContextOverflow) {
          // Not a length problem — don't mask real errors.
          throw err;
        }

        const prevLen = attemptText.length;
        budget = Math.floor(budget / 2);
        attemptText = shrinkEmbeddingInput(attemptText, prevLen);

        this.logger.warn({
          attempt: attempt + 1,
          prevLen,
          newLen: attemptText.length,
          model: this.getModelName(),
        }, '[EMBED] Ollama context overflow — shrinking input and retrying (single input will not fail the batch)');

        // If we can't shrink any further, stop retrying.
        if (attemptText.length >= prevLen) break;
      }
    }

    // Last resort: a single bad input must not zero the whole catalog. Return a
    // zero vector at the configured dimension so the batch index→tool mapping
    // stays aligned. The tool still lands in the store via lexical/exact-name
    // lookup; only its semantic vector is degraded (rare, single tool).
    const dim = capEmbeddingDimForHnsw(this.dimensions || 768);
    this.logger.error({
      textPreview: text.substring(0, 120),
      model: this.getModelName(),
      dim,
    }, '[EMBED] Ollama embedding still failing after shrink retries — emitting zero-vector placeholder so the rest of the batch indexes');
    return new Array(dim).fill(0);
  }

  /**
   * Log embedding metrics to LLMRequestLog for analytics
   */
  private async logEmbeddingMetrics(params: {
    provider: EmbeddingProvider;
    model: string;
    promptTokens: number;
    totalTokens: number;
    latencyMs: number;
    status: 'success' | 'error';
    errorMessage?: string;
  }): Promise<void> {
    try {
      const metricsService = LLMMetricsService.getInstance();
      await metricsService.logRequest({
        providerType: params.provider,
        model: params.model,
        requestType: 'embedding',
        promptTokens: params.promptTokens,
        totalTokens: params.totalTokens,
        latencyMs: params.latencyMs,
        status: params.status,
        errorMessage: params.errorMessage,
        streaming: false
      });
    } catch (error) {
      // Don't throw - metrics logging should never break embedding generation
      this.logger.debug({ error }, 'Failed to log embedding metrics (non-critical)');
    }
  }

  /**
   * Check if service is properly configured
   */
  isConfigured(): boolean {
    return !!this.provider;
  }

  /**
   * Get service info
   */
  getInfo() {
    return {
      provider: this.provider,
      model: this.getModelName(),
      dimensions: this.dimensions,
      configured: this.isConfigured()
    };
  }
}
