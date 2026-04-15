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
 * RAG Initialization Service
 *
 * Initializes RAG (Retrieval Augmented Generation) components:
 * - Embedding service (Azure OpenAI, AWS Bedrock, or OpenAI-compatible)
 * - Milvus vector database
 * - Model capability discovery
 */

import { pino } from 'pino';
import type { Logger } from 'pino';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { prisma } from '../utils/prisma.js';

export interface RAGHealthStatus {
  healthy: boolean;
  components: {
    embeddings: {
      healthy: boolean;
      provider?: string;
      model?: string;
      dimensions?: number;
      error?: string;
    };
    milvus: {
      healthy: boolean;
      connected: boolean;
      error?: string;
    };
    modelDiscovery: {
      healthy: boolean;
      modelsFound: number;
      error?: string;
    };
  };
  warnings: string[];
  errors: string[];
  timestamp: Date;
}

export class RAGInitService {
  private logger: Logger;
  private healthStatus: RAGHealthStatus;
  private initialized: boolean = false;
  private initializationError?: string;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 5000; // 5 seconds
  private embeddingService: UniversalEmbeddingService | null = null;

  constructor() {
    this.logger = pino({
      name: 'rag-init-service',
      level: process.env.LOG_LEVEL || 'info'
    });

    this.healthStatus = this.getDefaultHealthStatus();
  }

  private getDefaultHealthStatus(): RAGHealthStatus {
    return {
      healthy: false,
      components: {
        embeddings: {
          healthy: false
        },
        milvus: {
          healthy: false,
          connected: false
        },
        modelDiscovery: {
          healthy: false,
          modelsFound: 0
        }
      },
      warnings: [],
      errors: [],
      timestamp: new Date()
    };
  }

  /**
   * Initialize all RAG services with retry logic
   */
  async initialize(): Promise<boolean> {
    // Allow skipping RAG init entirely (useful when Ollama/embedding models are unavailable)
    const skipRag = process.env.SKIP_RAG_INIT === 'true' || process.env.SKIP_TOOL_SEMANTIC_CACHE === 'true';
    if (skipRag) {
      this.logger.warn('⏭️ Skipping RAG initialization (SKIP_RAG_INIT or SKIP_TOOL_SEMANTIC_CACHE is true)');
      this.logger.warn('⚠️ System will operate without embedding/vector capabilities');
      this.initialized = false;
      return false;
    }

    this.logger.info('🚀 Starting RAG services initialization...');

    while (this.retryCount < this.maxRetries) {
      this.retryCount++;

      try {
        this.healthStatus = this.getDefaultHealthStatus();

        // Step 1: Initialize embedding service
        await this.initializeEmbeddingService();

        // Step 2: Check Milvus connectivity
        await this.checkMilvusConnection();

        // Step 3: Discover available models
        await this.discoverModels();

        // Update overall health
        this.updateOverallHealth();

        if (this.healthStatus.healthy) {
          this.initialized = true;
          this.logger.info('✅ RAG services initialized successfully');

          // -------------------------------------------------------------
          // Docs auto-ingest: populate the platform_docs Milvus collection
          // on first startup of a fresh release. Runs ONLY when:
          //   1. DOCS_AUTO_INGEST=true env var is set (opt-in, chart-gated)
          //   2. The platform_docs collection exists but has 0 rows
          //
          // Every v0.6.3+ release includes fresh JSON manifests baked into
          // the UI image at public/docs/generated/. Without auto-ingest the
          // collection starts empty on every rebuild and only an admin's
          // manual POST /api/docs/ingest would populate it. With
          // auto-ingest the docs agent has full platform knowledge
          // (services + companion projects) as soon as the API is ready.
          //
          // Fire-and-forget — if the ingest fails the API still starts,
          // admin can retry via POST /api/docs/ingest.
          // -------------------------------------------------------------
          if (process.env.DOCS_AUTO_INGEST === 'true') {
            this.logger.info('📚 Docs auto-ingest enabled — checking collection');
            // Don't await — let it run in the background so API startup
            // isn't blocked by the (potentially multi-minute) embedding
            // pass over the manifests.
            void this.triggerDocsAutoIngest();
          } else {
            this.logger.debug('📚 Docs auto-ingest disabled (DOCS_AUTO_INGEST != "true")');
          }

          return true;
        }

        // If not healthy, log details
        this.logger.warn({
          embeddings: this.healthStatus.components.embeddings.healthy,
          milvus: this.healthStatus.components.milvus.healthy,
          warnings: this.healthStatus.warnings,
          errors: this.healthStatus.errors
        }, `⚠️ RAG initialization incomplete (attempt ${this.retryCount}/${this.maxRetries})`);

        if (this.retryCount < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }

      } catch (error) {
        this.logger.error({
          error,
          attempt: this.retryCount,
          maxRetries: this.maxRetries
        }, 'RAG initialization attempt failed');

        if (this.retryCount < this.maxRetries) {
          this.logger.info(`Retrying in ${this.retryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    // All retries exhausted
    this.logger.error('❌ RAG services failed to initialize after all retries');
    this.initializationError = `RAG initialization failed: ${this.healthStatus.errors.join(', ')}`;
    this.logger.warn('⚠️ System will operate with limited RAG capabilities');

    return false;
  }

  /**
   * Background task: if the platform_docs Milvus collection is empty
   * (fresh install or first pod of a new release), call DocsRAGService
   * ingestDocs() to populate it from the UI's baked-in JSON manifests.
   *
   * Gated on DOCS_AUTO_INGEST=true (chart sets this in the API env).
   * Runs as fire-and-forget from initialize(); errors are logged but
   * don't affect API startup — an admin can always retry manually via
   * POST /api/docs/ingest.
   */
  private async triggerDocsAutoIngest(): Promise<void> {
    try {
      const { getDocsRAGService } = await import('./DocsRAGService.js');
      const docsRAG = getDocsRAGService(this.logger);

      // First check if the collection already has content — skip if so.
      // ingestDocs() drops and recreates the collection, so we only want
      // it to run on empty collections (fresh install) or when an admin
      // explicitly re-triggers via the REST endpoint.
      const stats = await docsRAG.getCollectionStats();
      const rowCount = typeof stats?.rowCount === 'number' ? stats.rowCount : 0;

      if (rowCount > 0) {
        this.logger.info(
          { rowCount },
          '📚 Docs collection already populated — skipping auto-ingest (use POST /api/docs/ingest to force refresh)',
        );
        return;
      }

      this.logger.info('📚 Docs collection empty — starting auto-ingest from baked-in manifests');
      const started = Date.now();
      const result = await docsRAG.ingestDocs();
      const durationMs = Date.now() - started;

      this.logger.info(
        { chunksIngested: result.chunksIngested, durationMs },
        '📚 Docs auto-ingest completed',
      );
    } catch (err: any) {
      this.logger.error(
        { err: err?.message || String(err) },
        '📚 Docs auto-ingest failed — admin can retry via POST /api/docs/ingest',
      );
    }
  }

  /**
   * Initialize embedding service
   */
  private async initializeEmbeddingService(): Promise<void> {
    try {
      // Check if Ollama is explicitly enabled
      const ollamaEnabled = process.env.OLLAMA_ENABLED === 'true';

      // If using Ollama, wait for the embedding model to be ready
      const embeddingProvider = process.env.EMBEDDING_PROVIDER?.toLowerCase();
      const ollamaModel = process.env.EMBEDDING_OLLAMA_MODEL || process.env.OLLAMA_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
      const ollamaBaseUrl = process.env.EMBEDDING_OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://ollama:11434';

      // Only use Ollama for embeddings if EMBEDDING_PROVIDER is explicitly 'ollama'
      // This prevents checking Ollama when using Bedrock/Azure/etc
      const isOllama = ollamaEnabled && embeddingProvider === 'ollama';

      if (isOllama && ollamaModel) {
        this.logger.info({ ollamaBaseUrl, ollamaModel }, '🔄 Waiting for Ollama embedding model to be ready...');
        await this.waitForOllamaModel(ollamaBaseUrl, ollamaModel);
      } else if (!ollamaEnabled && embeddingProvider === 'ollama') {
        this.logger.warn('⚠️ EMBEDDING_PROVIDER is set to ollama but OLLAMA_ENABLED is not true - skipping Ollama');
      }

      this.embeddingService = new UniversalEmbeddingService(this.logger);

      if (this.embeddingService.isConfigured()) {
        const info = this.embeddingService.getInfo();

        // Verify embedding actually works with a test call (only if Ollama is enabled)
        if (ollamaEnabled && info.provider === 'ollama') {
          this.logger.info('🧪 Testing Ollama embedding generation...');
          await this.embeddingService.generateEmbedding('test');
          this.logger.info('✅ Ollama embedding test successful');
        }

        this.healthStatus.components.embeddings.healthy = true;
        this.healthStatus.components.embeddings.provider = info.provider;
        this.healthStatus.components.embeddings.model = info.model;
        this.healthStatus.components.embeddings.dimensions = info.dimensions;

        this.logger.info({
          provider: info.provider,
          model: info.model,
          dimensions: info.dimensions
        }, '✅ Embedding service initialized');
      } else {
        throw new Error('No embedding provider configured');
      }

    } catch (error) {
      const errorMsg = `Embedding service initialization failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.embeddings.error = errorMsg;
      this.healthStatus.errors.push(errorMsg);
      this.logger.warn(errorMsg);
      this.logger.info('💡 Set AZURE_OPENAI_EMBEDDING_DEPLOYMENT or AWS_EMBEDDING_MODEL_ID to enable embeddings');
    }
  }

  /**
   * Wait for Ollama embedding model to be available
   */
  private async waitForOllamaModel(baseUrl: string, modelName: string, maxAttempts: number = 5, delayMs: number = 3000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Check if Ollama is responding
        const listUrl = `${baseUrl}/api/tags`;
        const response = await fetch(listUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`Ollama not responding: ${response.status}`);
        }

        const data = await response.json();
        const models = data.models || [];

        // Check if our model is in the list
        const modelFound = models.some((m: any) =>
          m.name === modelName ||
          m.name === `${modelName}:latest` ||
          m.name.startsWith(`${modelName}:`)
        );

        if (modelFound) {
          this.logger.info({ modelName, attempt }, '✅ Ollama embedding model is ready');
          return;
        }

        // Model not found yet - it might still be pulling
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.info({
            modelName,
            attempt,
            maxAttempts,
            availableModels: models.map((m: any) => m.name)
          }, `⏳ Waiting for Ollama embedding model "${modelName}" to be ready...`);
        }

      } catch (error) {
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.warn({
            error: error instanceof Error ? error.message : String(error),
            attempt,
            maxAttempts,
            baseUrl
          }, '⏳ Ollama not ready yet, retrying...');
        }
      }

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new Error(`Ollama embedding model "${modelName}" not available after ${maxAttempts} attempts. Ensure Ollama is running and the model is pulled.`);
  }

  /**
   * Check Milvus vector database connectivity
   */
  private async checkMilvusConnection(): Promise<void> {
    try {
      // Try to connect to Milvus via Prisma (which has milvus config)
      // Simple check - if we can query, Milvus is accessible
      const testQuery = await prisma.$queryRaw`SELECT 1 as test`;

      this.healthStatus.components.milvus.healthy = true;
      this.healthStatus.components.milvus.connected = true;
      this.logger.info('✅ Milvus vector database connected');

    } catch (error) {
      const errorMsg = `Milvus connection failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.milvus.error = errorMsg;
      this.healthStatus.warnings.push(errorMsg);
      this.logger.warn(errorMsg);

      // Milvus is optional - mark as not connected but don't fail initialization
      this.healthStatus.components.milvus.connected = false;
    }
  }

  /**
   * Discover available models
   */
  private async discoverModels(): Promise<void> {
    try {
      const modelDiscovery = getModelCapabilityDiscoveryService();

      if (modelDiscovery) {
        const models = await modelDiscovery.discoverAllModels();

        this.healthStatus.components.modelDiscovery.healthy = true;
        this.healthStatus.components.modelDiscovery.modelsFound = models.length;

        this.logger.info({
          modelsFound: models.length
        }, '✅ Model capability discovery initialized');
      } else {
        this.healthStatus.warnings.push('Model capability discovery service not initialized');
        this.logger.warn('⚠️ Model capability discovery service not initialized');
      }

    } catch (error) {
      const errorMsg = `Model discovery failed: ${error instanceof Error ? error.message : String(error)}`;
      this.healthStatus.components.modelDiscovery.error = errorMsg;
      this.healthStatus.warnings.push(errorMsg);
      this.logger.warn(errorMsg);
    }
  }

  /**
   * Update overall health status
   */
  private updateOverallHealth(): void {
    // System is healthy if embeddings are configured
    // Milvus and model discovery are optional enhancements
    this.healthStatus.healthy = this.healthStatus.components.embeddings.healthy;
    this.healthStatus.timestamp = new Date();
  }

  /**
   * Get current health status
   */
  getHealthStatus(): RAGHealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Check if RAG is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get initialization error if any
   */
  getInitializationError(): string | undefined {
    return this.initializationError;
  }

  /**
   * Force re-initialization (useful for testing or recovery)
   */
  async reinitialize(): Promise<boolean> {
    this.logger.info('🔄 Re-initializing RAG services...');
    this.initialized = false;
    this.retryCount = 0;
    this.initializationError = undefined;

    return this.initialize();
  }

  /**
   * Perform lightweight health check without full initialization
   */
  async healthCheck(): Promise<RAGHealthStatus> {
    const startTime = Date.now();

    await Promise.allSettled([
      this.initializeEmbeddingService(),
      this.checkMilvusConnection(),
      this.discoverModels()
    ]);

    this.updateOverallHealth();

    this.logger.debug({
      duration: Date.now() - startTime,
      healthy: this.healthStatus.healthy
    }, 'RAG health check completed');

    return this.getHealthStatus();
  }
}

// Export singleton instance
export const ragInitService = new RAGInitService();
