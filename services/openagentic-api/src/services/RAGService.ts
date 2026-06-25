/**
 * RAG (Retrieval Augmented Generation) Service
 * Implements semantic search for prompt templates using Milvus vector database
 * with Redis acceleration layer for high-performance caching
 *
 * Supports multiple embedding providers via UniversalEmbeddingService:
 * - Azure OpenAI
 * - AWS Bedrock
 * - Google Vertex AI
 * - OpenAI-compatible endpoints
 */

import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { MilvusClient, DataType, IndexType, MetricType } from '@zilliz/milvus2-sdk-node';
import { prisma } from '../utils/prisma.js';
import { getRedisClient, UnifiedRedisClient } from '../utils/redis-client.js';
import { createHash } from 'crypto';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

export interface VectorSearchResult {
  id: string;
  similarity: number;
  data: any;
}

export interface RAGConfig {
  collectionName?: string;
  embeddingDimension?: number;
  topK?: number;
  similarityThreshold?: number;
  indexType?: IndexType;
  metricType?: MetricType;
}

export class RAGService {
  private prisma: PrismaClient;
  private milvus: MilvusClient;
  private logger: any;
  private collectionName: string = 'prompt_templates';
  private embeddingDimension: number;
  private redisClient: UnifiedRedisClient | null;
  private enableRagCache: boolean;
  private ragCacheTTL: number;
  private embeddingService: UniversalEmbeddingService | null = null;
  private embeddingEnabled: boolean = false;

  constructor(milvus: MilvusClient, logger: any) {
    this.prisma = prisma;
    this.milvus = milvus;
    this.logger = logger;

    // Initialize Redis cache for RAG acceleration
    this.redisClient = getRedisClient();
    this.enableRagCache = process.env.ENABLE_RAG_CACHE === 'true';
    this.ragCacheTTL = Number.parseInt(process.env.RAG_CACHE_TTL || '300'); // 5 minutes default

    // Initialize Universal Embedding Service
    try {
      this.embeddingService = new UniversalEmbeddingService(logger);
      this.embeddingEnabled = true;

      const info = this.embeddingService.getInfo();
      this.embeddingDimension = info.dimensions;

      this.logger.info({
        provider: info.provider,
        model: info.model,
        dimensions: info.dimensions
      }, 'RAGService initialized with embeddings enabled');

    } catch (error) {
      this.embeddingEnabled = false;
      this.embeddingDimension = 1536; // Default fallback

      this.logger.warn({
        err: error instanceof Error ? error.message : error
      }, 'RAGService initialized without embeddings - semantic search disabled');
      this.logger.info('To enable embeddings, configure one of: AZURE_OPENAI_EMBEDDING_DEPLOYMENT, AWS_EMBEDDING_MODEL_ID, GCP_EMBEDDING_MODEL, or EMBEDDING_ENDPOINT');
    }

    if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
      this.logger.info('RAG Redis cache enabled with TTL:', this.ragCacheTTL);
    }
  }

  /**
   * Test Milvus connection
   */
  private async testConnection(): Promise<void> {
    // Try a simple operation to test connection
    await this.milvus.listCollections();
  }

  /**
   * Generate cache key for RAG queries
   */
  private hashQuery(query: string, topK: number, filters?: any): string {
    const content = JSON.stringify({ query, topK, filters });
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Initialize Milvus collection for prompt templates
   */
  async initializeCollection(config: RAGConfig = {}): Promise<{ success: boolean; error?: string }> {
    // Embedding dimension is already set in constructor if embedding service is available
    if (!this.embeddingEnabled) {
      this.logger.warn('Embeddings not enabled - collection initialization skipped');
      return { success: false, error: 'Embeddings not enabled' };
    }

    const {
      collectionName = this.collectionName,
      embeddingDimension = this.embeddingDimension, // Now uses discovered dimension
      indexType = IndexType.IVF_FLAT,
      metricType = MetricType.COSINE
    } = config;

    try {
      // Test connection first
      try {
        await this.testConnection();
      } catch (connError) {
        this.logger.warn('Milvus connection failed during collection initialization:', connError);
        return { success: false, error: `Milvus connection failed: ${connError instanceof Error ? connError.message : String(connError)}` };
      }

      // Check if collection exists - wrap in try/catch for safety
      let hasCollection = false;
      try {
        const hasCollectionResult = await this.milvus.hasCollection({
          collection_name: collectionName
        });
        // Handle both boolean and object responses
        hasCollection = typeof hasCollectionResult === 'boolean' 
          ? hasCollectionResult 
          : hasCollectionResult?.value === true;
      } catch (checkError) {
        this.logger.warn(`Failed to check if collection ${collectionName} exists:`, checkError);
        // Assume collection doesn't exist if check fails
        hasCollection = false;
      }

      // Drop and recreate if dimension mismatch
      if (hasCollection) {
        try {
          // Check current collection info
          const collectionInfo = await this.milvus.describeCollection({
            collection_name: collectionName
          });
          
          // Find embedding field dimension
          let currentDim = 0;
          if (collectionInfo && collectionInfo.schema && collectionInfo.schema.fields) {
            const embeddingField = collectionInfo.schema.fields.find((f: any) => f.name === 'embedding');
            if (embeddingField && embeddingField.type_params) {
              const dimValue = embeddingField.type_params.find((p: any) => p.key === 'dim')?.value;
              currentDim = typeof dimValue === 'number' ? dimValue : Number.parseInt(String(dimValue || '0'));
            }
          }
          
          // If dimension mismatch, drop and recreate
          if (currentDim !== embeddingDimension) {
            this.logger.warn(`Collection dimension mismatch: current=${currentDim}, expected=${embeddingDimension}. Dropping and recreating...`);
            await this.milvus.dropCollection({ collection_name: collectionName });
            hasCollection = false;
          }
        } catch (descError) {
          this.logger.warn('Failed to check collection dimension, will recreate:', descError);
          try {
            await this.milvus.dropCollection({ collection_name: collectionName });
            hasCollection = false;
          } catch (dropError) {
            this.logger.error('Failed to drop collection:', dropError);
          }
        }
      }
      
      if (!hasCollection) {
        // Create collection schema
        const schema = [
          {
            name: 'id',
            data_type: DataType.VarChar,
            is_primary_key: true,
            max_length: 128
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: embeddingDimension
          },
          {
            name: 'template_id',
            data_type: DataType.VarChar,
            max_length: 128
          },
          {
            name: 'name',
            data_type: DataType.VarChar,
            max_length: 256
          },
          {
            name: 'category',
            data_type: DataType.VarChar,
            max_length: 64
          },
          {
            name: 'content',
            data_type: DataType.VarChar,
            max_length: 8192  // Increased from 4096 to support larger templates
          }
        ];

        // Create collection
        await this.milvus.createCollection({
          collection_name: collectionName,
          fields: schema,
          enable_dynamic_field: true
        });

        // Create index
        await this.milvus.createIndex({
          collection_name: collectionName,
          field_name: 'embedding',
          index_type: indexType,
          metric_type: metricType,
          params: { nlist: 1024 }
        });

        // Load collection
        await this.milvus.loadCollection({
          collection_name: collectionName
        });

        this.logger.info(`Created Milvus collection: ${collectionName}`);
      } else {
        this.logger.info(`Milvus collection ${collectionName} already exists`);
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error('Failed to initialize Milvus collection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create embedding for text using Azure OpenAI
   */
  async createEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingService || !this.embeddingEnabled) {
      this.logger.warn('Embeddings not enabled - returning zero vector');
      return new Array(this.embeddingDimension).fill(0);
    }

    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to create embedding');
      // Return zero vector as fallback
      return new Array(this.embeddingDimension).fill(0);
    }
  }

  /**
   * Discover available embedding model
   * Using EmbeddingService for Azure OpenAI embeddings
   */
  private async discoverEmbeddingModel(): Promise<void> {
    // Model discovery not needed - EmbeddingService handles Azure OpenAI configuration
    this.logger.info('Using Azure OpenAI embeddings via EmbeddingService');
  }

  /**
   * Store prompt template embeddings in Milvus
   */
  async storeTemplateEmbeddings(
    templates: Array<{
      id: string;
      name: string;
      category: string;
      content: string;
      embedding?: number[];
    }>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Test connection first
      try {
        await this.testConnection();
      } catch (connError) {
        this.logger.warn('Milvus connection failed during store operation:', connError);
        return { success: false, error: `Milvus connection failed: ${connError instanceof Error ? connError.message : String(connError)}` };
      }

      // Prepare data for insertion - must match Milvus schema exactly
      const data = await Promise.all(templates.map(async (template) => {
        // Ensure content is truncated before creating embedding
        const truncatedContent = (template.content || '').substring(0, 4090);
        const embedding = template.embedding || await this.createEmbedding(truncatedContent);
        
        // Log embedding dimensions for debugging
        this.logger.debug(`Template ${template.id} embedding dimensions: ${embedding.length}`);
        
        return {
          id: `template_${template.id}`,
          embedding,
          template_id: template.id,
          name: template.name,
          category: template.category,
          content: truncatedContent // Already truncated above
        };
      }));

      // Insert into Milvus
      const insertResult = await this.milvus.insert({
        collection_name: this.collectionName,
        data
      });

      if (insertResult.status.error_code !== 'Success') {
        throw new Error(insertResult.status.reason);
      }

      this.logger.info(`Stored ${data.length} template embeddings in Milvus`);
      return { success: true };
    } catch (error: any) {
      this.logger.error('Failed to store template embeddings:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Search for similar prompt templates with Redis caching acceleration
   */
  async searchSimilarTemplates(
    query: string,
    topK: number = 3,
    config: Partial<RAGConfig> = {}
  ): Promise<VectorSearchResult[]> {
    const { similarityThreshold = 0.5 } = config;

    // Check Redis cache first
    if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
      const cacheKey = `rag:search:${this.hashQuery(query, topK, config)}`;
      const cached = await this.redisClient.get<VectorSearchResult[]>(cacheKey);
      
      if (cached) {
        this.logger.info('RAG cache hit for similar templates search');
        return cached;
      }
    }

    try {
      // Test connection first
      try {
        await this.testConnection();
      } catch (connError) {
        this.logger.warn('Milvus connection failed during search, returning empty results:', connError);
        return [];
      }

      // Original Milvus logic unchanged
      const queryEmbedding = await this.createEmbedding(query);

      // Search in Milvus
      const searchResult = await this.milvus.search({
        collection_name: this.collectionName,
        data: [queryEmbedding],
        limit: topK,
        output_fields: ['template_id', 'name', 'category', 'content'],
        metric_type: MetricType.COSINE
      });

      if (searchResult.status.error_code !== 'Success') {
        throw new Error(searchResult.status.reason);
      }

      // Process results
      const results: VectorSearchResult[] = searchResult.results
        .filter(result => result.distance >= similarityThreshold)
        .map(result => ({
          id: result.id,
          similarity: result.distance, // Cosine similarity
          data: {
            template_id: result.template_id,
            name: result.name,
            category: result.category,
            content: result.content
          }
        }));

      // Cache for future queries (5 minute TTL for RAG results)
      if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
        const cacheKey = `rag:search:${this.hashQuery(query, topK, config)}`;
        await this.redisClient.set(cacheKey, results, this.ragCacheTTL);
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to search similar templates:', error);
      return [];
    }
  }

  /**
   * Hybrid search combining vector similarity and metadata filters with Redis caching
   */
  async hybridSearch(
    query: string,
    filters: {
      category?: string;
      userId?: string;
      isPublic?: boolean;
    },
    topK: number = 5
  ): Promise<VectorSearchResult[]> {
    // Check Redis cache first
    if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
      const cacheKey = `rag:hybrid:${this.hashQuery(query, topK, filters)}`;
      const cached = await this.redisClient.get<VectorSearchResult[]>(cacheKey);
      
      if (cached) {
        this.logger.info('RAG cache hit for hybrid search');
        return cached;
      }
    }

    try {
      // Build filter expression
      const filterConditions: string[] = [];
      if (filters.category) {
        filterConditions.push(`category == "${filters.category}"`);
      }

      const filterExpr = filterConditions.length > 0 
        ? filterConditions.join(' && ')
        : undefined;

      // Original Milvus search logic unchanged
      const queryEmbedding = await this.createEmbedding(query);

      // Search with filters
      const searchResult = await this.milvus.search({
        collection_name: this.collectionName,
        data: [queryEmbedding],
        limit: topK,
        expr: filterExpr,
        output_fields: ['template_id', 'name', 'category', 'content'],
        metric_type: MetricType.COSINE
      });

      if (searchResult.status.error_code !== 'Success') {
        throw new Error(searchResult.status.reason);
      }

      const results = searchResult.results.map(result => ({
        id: result.id,
        similarity: result.distance,
        data: {
          template_id: result.template_id,
          name: result.name,
          category: result.category,
          content: result.content
        }
      }));

      // Cache results
      if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
        const cacheKey = `rag:hybrid:${this.hashQuery(query, topK, filters)}`;
        await this.redisClient.set(cacheKey, results, this.ragCacheTTL);
      }

      return results;
    } catch (error) {
      this.logger.error('Failed to perform hybrid search:', error);
      return [];
    }
  }

  /**
   * Get collection statistics
   */
  async getCollectionStats(): Promise<{
    totalVectors: number;
    indexType: string;
    metricType: string;
  } | null> {
    try {
      // Test connection first
      try {
        await this.testConnection();
      } catch (connError) {
        this.logger.warn('Milvus connection failed during stats retrieval:', connError);
        return null;
      }

      const stats = await this.milvus.getCollectionStatistics({
        collection_name: this.collectionName
      });

      // Wrap describeCollection in try/catch - it might fail if collection doesn't exist
      let info = null;
      try {
        info = await this.milvus.describeCollection({
          collection_name: this.collectionName
        });
      } catch (describeError) {
        this.logger.warn('Failed to describe collection during stats retrieval:', describeError);
      }

      return {
        totalVectors: Number.parseInt((stats.stats as any).row_count || '0'),
        indexType: 'IVF_FLAT', // Default if we can't get from info
        metricType: 'COSINE'    // Default if we can't get from info
      };
    } catch (error) {
      this.logger.error('Failed to get collection stats:', error);
      return null;
    }
  }

  /**
   * Search for relevant context for RAG (main interface method)
   */
  async searchRelevantContext(
    query: string, 
    options: { 
      topK?: number; 
      similarityThreshold?: number; 
      userId?: string;
      contextTypes?: string[];
    } = {}
  ): Promise<VectorSearchResult[]> {
    try {
      const { topK = 5, similarityThreshold = 0.7 } = options;
      
      // Generate cache key for this query
      const cacheKey = this.hashQuery(query, topK, options);
      
      // Check Redis cache first if enabled
      if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          this.logger.info({ cacheKey }, 'RAG context retrieved from cache');
          return cached;
        }
      }
      
      // Search similar templates (main knowledge source)
      const results = await this.searchSimilarTemplates(query, topK, { similarityThreshold });
      
      // Format results for pipeline consumption
      const formattedResults: VectorSearchResult[] = results.map(result => ({
        id: result.id,
        similarity: result.similarity,
        data: {
          content: result.data?.content || '',
          title: result.data?.name || '',
          category: result.data?.category || '',
          type: 'template'
        }
      }));
      
      // Cache results if enabled
      if (this.enableRagCache && this.redisClient && this.redisClient.isConnected()) {
        await this.redisClient.set(cacheKey, formattedResults, this.ragCacheTTL);
      }
      
      this.logger.info({ 
        queryLength: query.length,
        resultCount: formattedResults.length,
        topSimilarity: formattedResults[0]?.similarity,
        cached: false
      }, 'RAG context retrieved from Milvus');
      
      return formattedResults;
      
    } catch (error) {
      this.logger.error({ error, query: query.substring(0, 100) }, 'Failed to search relevant context for RAG');
      return []; // Return empty array instead of throwing to not break chat flow
    }
  }

}