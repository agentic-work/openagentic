/**
 * Milvus Memory Service
 * 
 * Integrates Memory MCP data from Milvus with the MemoryContextService to provide
 * vector-based memory retrieval for context window management. Handles semantic
 * search, memory ranking, and efficient vector operations for user memories.
 * 
 * Features:
 * - Vector-based semantic memory search with similarity scoring
 * - Integration with MCP memory data structures and types
 * - Efficient memory ranking and relevance scoring algorithms
 * - Support for entity, topic, and text-based memory queries
 * - Configurable search thresholds and result limiting
 * - Memory deduplication and context optimization
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { Logger } from 'pino';
import { RankedMemory, Memory } from '../memory/types/Memory.js';
import { createHash } from 'crypto';
import { getModelCapabilityDiscoveryService } from './ModelCapabilityDiscoveryService.js';
import { dynamicModelManager } from './DynamicModelManager.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';

interface MemorySearchQuery {
  text?: string;
  entities?: string[];
  topics?: string[];
  limit?: number;
  threshold?: number;
}

export class MilvusMemoryService {
  private milvusClient: MilvusClient;
  private logger: any;
  private universalEmbedder?: UniversalEmbeddingService;

  constructor(logger: any) {
    // Defensive: some call sites pass a minimal logger without `.child()`
    // (e.g. chat dispatchTool ctx.logger). Same regression class as #753/#756.
    this.logger = typeof logger?.child === 'function'
      ? (logger.child({ service: 'MilvusMemory' }) as Logger)
      : (logger as Logger);
    
    if (!process.env.MILVUS_HOST || !process.env.MILVUS_PORT) {
      throw new Error('MILVUS_HOST and MILVUS_PORT must be configured');
    }
    
    this.milvusClient = new MilvusClient({
      address: `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username: process.env.MILVUS_USER,
      password: process.env.MILVUS_PASSWORD
    });
  }

  /**
   * Search user's memories in Milvus based on query
   * This is called by MemoryContextService.searchMemoriesByEmbedding
   */
  async searchUserMemories(
    userId: string, 
    query: MemorySearchQuery
  ): Promise<RankedMemory[]> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        this.logger.debug(`No memory collection for user ${userId}`);
        return [];
      }
      
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query.text || '');
      
      // Search in Milvus
      const searchResult = await this.milvusClient.search({
        collection_name: collectionName,
        data: [queryEmbedding],
        output_fields: ['entity_id', 'entity_name', 'entity_type', 'observations', 'created_at'],
        limit: query.limit || 20,
        metric_type: 'COSINE',
        params: { nprobe: 10 }
      });
      
      // Convert Milvus results to RankedMemory format
      const memories: RankedMemory[] = [];
      
      if (searchResult.results && searchResult.results.length > 0) {
        for (const result of searchResult.results) {
          const memory: RankedMemory = {
            id: result.entity_id,
            userId,
            type: 'entity_fact',
            content: `${result.entity_name} (${result.entity_type}): ${result.observations}`,
            summary: result.observations,
            entities: [result.entity_name],
            embedding: [],
            importance: 0.8,
            createdAt: new Date(result.created_at).getTime(),
            lastAccessed: Date.now(),
            tokenCount: Math.ceil(result.observations.length / 4), // Rough estimate
            metadata: {
              entityType: result.entity_type,
              entityName: result.entity_name,
              score: result.score || 0
            },
            rank: 0, // Will be set after sorting
            relevanceScore: result.score || 0,
            reasons: [`Similarity score: ${result.score?.toFixed(3)}`]
          };
          
          memories.push(memory);
        }
      }
      
      // Sort by relevance score (descending) and set ranks
      memories.sort((a, b) => b.relevanceScore - a.relevanceScore);
      memories.forEach((memory, index) => {
        memory.rank = index + 1;
      });
      
      this.logger.info(`Found ${memories.length} memories for user ${userId}`);
      return memories;
      
    } catch (error) {
      this.logger.error(`Failed to search memories for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get all memories for a user (for context assembly)
   */
  async getUserMemories(userId: string, limit: number = 100): Promise<RankedMemory[]> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      // Check if collection exists
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        return [];
      }
      
      // Query all entities (no vector search, just retrieve)
      const queryResult = await this.milvusClient.query({
        collection_name: collectionName,
        expr: 'entity_id != ""', // Get all
        output_fields: ['entity_id', 'entity_name', 'entity_type', 'observations', 'created_at'],
        limit
      });
      
      // Convert to RankedMemory format
      const memories: RankedMemory[] = [];
      
      if (queryResult && Array.isArray(queryResult)) {
        for (const entity of queryResult) {
          const memory: RankedMemory = {
            id: entity.entity_id,
            userId,
            type: 'entity_fact',
            content: `${entity.entity_name} (${entity.entity_type}): ${entity.observations}`,
            summary: entity.observations,
            entities: [entity.entity_name],
            embedding: [],
            importance: 0.8,
            createdAt: new Date(entity.created_at).getTime(),
            lastAccessed: Date.now(),
            tokenCount: Math.ceil(entity.observations.length / 4),
            metadata: {
              entityType: entity.entity_type,
              entityName: entity.entity_name
            },
            rank: 0,
            relevanceScore: 1.0, // Default score for non-search queries
            reasons: ['Direct retrieval']
          };
          
          memories.push(memory);
        }
      }
      
      // Sort by creation time (most recent first) and set ranks
      memories.sort((a, b) => b.createdAt - a.createdAt);
      memories.forEach((memory, index) => {
        memory.rank = index + 1;
      });
      
      return memories;
      
    } catch (error) {
      this.logger.error(`Failed to get memories for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Get embedding model from discovery service
   */
  private async getEmbeddingModel(): Promise<string> {
    // Try ModelCapabilityDiscoveryService first (SOT)
    const discoveryService = getModelCapabilityDiscoveryService();
    if (discoveryService) {
      const models = await discoveryService.searchModelsByCapability('embedding');
      if (models && models.length > 0) {
        return models[0].modelId;
      }
    }
    
    // Fallback to DynamicModelManager
    const embeddingInfo = await dynamicModelManager.getEmbeddingModel();
    if (embeddingInfo) {
      return embeddingInfo.model;
    }
    
    throw new Error('No embedding models available');
  }

  /**
   * Lazy-initialize the in-process UniversalEmbeddingService.
   *
   * Previously this service did an HTTP fetch to `${MCP_PROXY_URL}/v1/embeddings`
   * which mcp-proxy proxied BACK to api's own `/api/embeddings` — a circular
   * hop that surfaced as `"API embeddings error: 400 - input is required"` in
   * mcp-proxy logs, breaking ALL semantic memory recall (memory_search
   * returned [] for every query). Calling UniversalEmbeddingService directly
   * in-process eliminates the network hop and the auth-header trip wire.
   */
  private getUniversalEmbedder(): UniversalEmbeddingService {
    if (!this.universalEmbedder) {
      this.universalEmbedder = new UniversalEmbeddingService(this.logger);
    }
    return this.universalEmbedder;
  }

  /**
   * Generate embedding for text in-process via UniversalEmbeddingService.
   * Same pod, same service, no network, no auth round-trip.
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.getUniversalEmbedder().generateEmbedding(text);
      if (!result?.embedding || !Array.isArray(result.embedding)) {
        throw new Error('UniversalEmbeddingService returned invalid result');
      }
      return result.embedding;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error({ error: msg, textLen: text?.length ?? 0 }, '[MilvusMemory] in-process embedding failed');
      throw new Error(`Embedding failed: ${msg}`);
    }
  }

  /**
   * Write side of the per-user RAG memory contract (#1085).
   *
   * Sidecar emits from ConversationCompactionWorker (session_summary),
   * GenerateImageTool (generated_image), and LargeResultStorageService
   * (large_tool_result) all funnel through here. The collection is created
   * lazily — first write for a user provisions the collection so the existing
   * `searchUserMemories` read path finds it. `kind` rides on `entity_type`,
   * `title` on `entity_name`, and `artifactUrl` is prefixed onto `observations`
   * so downstream search results carry the URL without a schema migration.
   *
   * User-scope is enforced at the collection-name boundary: every write
   * targets `user_${sanitized}_memory`, NEVER a shared collection.
   */
  async upsertUserMemory(
    userId: string,
    entry: {
      kind: 'session_summary' | 'generated_image' | 'large_tool_result' | 'entity_fact';
      title: string;
      content: string;
      artifactUrl?: string;
    },
  ): Promise<void> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('userId is required for upsertUserMemory (cross-user write guard)');
    }
    const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;

    // Lazy create the collection on first write. Schema mirrors what
    // searchUserMemories reads from (entity_id, entity_name, entity_type,
    // observations, created_at) plus the embedding vector.
    const hasCollection = await this.milvusClient.hasCollection({ collection_name: collectionName });
    if (!hasCollection.value) {
      // Import DataType lazily so the prod codepath still tree-shakes if Milvus
      // is unreachable. The Milvus mock in tests provides numeric stubs.
      const { DataType } = await import('@zilliz/milvus2-sdk-node');
      await this.milvusClient.createCollection({
        collection_name: collectionName,
        fields: [
          { name: 'entity_id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
          { name: 'entity_name', data_type: DataType.VarChar, max_length: 512 },
          { name: 'entity_type', data_type: DataType.VarChar, max_length: 64 },
          { name: 'observations', data_type: DataType.VarChar, max_length: 8192 },
          { name: 'created_at', data_type: DataType.Int64 },
          { name: 'observations_embedding', data_type: DataType.FloatVector, dim: 768 },
        ],
      });
      await this.milvusClient.createIndex({
        collection_name: collectionName,
        field_name: 'observations_embedding',
        index_type: 'HNSW',
        metric_type: 'COSINE',
        params: { M: 16, efConstruction: 200 },
      });
      await this.milvusClient.loadCollection({ collection_name: collectionName });
    }

    // Encode artifactUrl into observations so it survives through searchUserMemories
    // without a schema extension. The model can parse `[url: /api/images/...]`
    // out of the returned observations text.
    const observations = entry.artifactUrl
      ? `[url: ${entry.artifactUrl}] ${entry.content}`
      : entry.content;
    const embedding = await this.generateEmbedding(observations);

    const result = await this.milvusClient.insert({
      collection_name: collectionName,
      data: [{
        entity_id: createHash('sha256').update(`${userId}:${entry.kind}:${entry.title}:${Date.now()}`).digest('hex').slice(0, 32),
        entity_name: entry.title.slice(0, 512),
        entity_type: entry.kind,
        observations: observations.slice(0, 8192),
        created_at: Date.now(),
        observations_embedding: embedding,
      }],
    });

    if (result.status && result.status.error_code !== 'Success') {
      throw new Error(`Milvus insert failed: ${result.status.reason || result.status.error_code}`);
    }
    await this.milvusClient.flushSync({ collection_names: [collectionName] });

    this.logger.info(
      { userId, kind: entry.kind, collection: collectionName },
      '[MilvusMemory] upserted user memory',
    );
  }

  /**
   * Update access statistics for a memory
   */
  async updateMemoryAccess(userId: string, memoryId: string): Promise<void> {
    // This could update access counts in Milvus or a separate tracking table
    // For now, just log it
    this.logger.debug(`Memory ${memoryId} accessed by user ${userId}`);
  }

  /**
   * Get memory statistics for monitoring
   */
  async getMemoryStats(userId: string): Promise<{
    totalMemories: number;
    collections: string[];
    lastSync?: Date;
  }> {
    try {
      const collectionName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}_memory`;
      
      const hasCollection = await this.milvusClient.hasCollection({
        collection_name: collectionName
      });
      
      if (!hasCollection.value) {
        return {
          totalMemories: 0,
          collections: []
        };
      }
      
      const stats = await this.milvusClient.getCollectionStatistics({
        collection_name: collectionName
      });
      
      return {
        totalMemories: parseInt(stats.data?.row_count || '0'),
        collections: [collectionName]
      };
      
    } catch (error) {
      this.logger.error(`Failed to get memory stats for user ${userId}:`, error);
      return {
        totalMemories: 0,
        collections: []
      };
    }
  }
}

// Singleton instance
let milvusMemoryInstance: MilvusMemoryService | null = null;

export function getMilvusMemoryService(logger: any): MilvusMemoryService {
  if (!milvusMemoryInstance) {
    milvusMemoryInstance = new MilvusMemoryService(logger);
  }
  return milvusMemoryInstance;
}