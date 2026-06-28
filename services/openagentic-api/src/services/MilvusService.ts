/**
 * Milvus Vector Database Service
 * 
 * Provides comprehensive vector database operations using Milvus for storing and
 * retrieving user memories with semantic similarity search. Manages per-user
 * collections, automatic schema creation, and optimized vector indexing.
 * 
 * Features:
 * - Per-user isolated memory collections with automatic creation
 * - High-dimensional vector storage (1536-dimensional embeddings)
 * - Efficient similarity search using IVF_FLAT indexing
 * - Comprehensive memory lifecycle management (store, search, delete)
 * - Collection statistics and health monitoring
 * - Flexible metadata storage with JSON support
 * 
 * @see {@link https://docs.openagentic.io/api/services/milvus | Milvus Vector Database Documentation}
 */

import { MilvusClient, DataType, ConsistencyLevelEnum } from '@zilliz/milvus2-sdk-node';
import { assertUserIdOrThrow } from './MilvusAuditGuard.js';

export interface MilvusConfig {
  address?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
}

export interface MemoryEntry {
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
}

export interface MemorySearchResult {
  id: number;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

export interface MemoryStats {
  totalMemories: number;
  collectionName: string;
}

export class MilvusService {
  private client: MilvusClient;
  private connected = false;
  private readonly EMBEDDING_DIM = 1536; // OpenAI ada-002 embedding dimension

  constructor(config: MilvusConfig = {}) {
    const {
      address = `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`,
      username = process.env.MILVUS_USERNAME,
      password = process.env.MILVUS_PASSWORD,
      ssl = process.env.MILVUS_SSL === 'true'
    } = config;

    this.client = new MilvusClient({
      address,
      username,
      password,
      ssl
    });
  }

  async connect(): Promise<void> {
    try {
      // Test connection by checking if server is healthy
      const health = await this.client.checkHealth();
      if (health.isHealthy) {
        this.connected = true;
      } else {
        throw new Error('Milvus server is not healthy');
      }
    } catch (error) {
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        // SDK v2.6.0 doesn't have a disconnect method
        // Connection is managed internally
        this.connected = false;
      } catch (error) {
        console.error('Error disconnecting from Milvus:', error);
      }
    }
  }

  getUserCollectionName(userId: string): string {
    // Sanitize user ID to create valid collection name
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_]/g, '_');
    return `user_memory_${sanitizedUserId}`;
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    try {
      const result = await this.client.hasCollection({
        collection_name: collectionName
      });
      return result.value === true;
    } catch (error) {
      console.error(`Error checking collection existence: ${error}`);
      return false;
    }
  }

  async createUserMemoryCollection(userId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    const collectionName = this.getUserCollectionName(userId);
    
    if (await this.collectionExists(collectionName)) {
      return; // Collection already exists
    }

    // Define schema for memory collection
    const fields = [
      {
        name: 'id',
        data_type: DataType.Int64,
        is_primary_key: true,
        autoID: true,
        description: 'Primary key'
      },
      {
        name: 'content',
        data_type: DataType.VarChar,
        max_length: 65535,
        description: 'Memory content text'
      },
      {
        name: 'embedding',
        data_type: DataType.FloatVector,
        dim: this.EMBEDDING_DIM,
        description: 'Content embedding vector'
      },
      {
        name: 'metadata',
        data_type: DataType.JSON,
        description: 'Additional metadata'
      }
    ];

    // Create collection with string consistency level
    await this.client.createCollection({
      collection_name: collectionName,
      fields,
      consistency_level: 'Strong' as const
    });

    // Create index on embedding field for vector search
    await this.client.createIndex({
      collection_name: collectionName,
      field_name: 'embedding',
      index_type: 'IVF_FLAT',
      metric_type: 'L2',
      params: { nlist: 1024 }
    });

    // Load collection into memory
    await this.client.loadCollection({
      collection_name: collectionName
    });
  }

  async storeMemory(userId: string, memory: MemoryEntry): Promise<number> {
    // 0.6.6 P5: reject empty / sentinel / wildcard userIds before they
    // map to a shared collection. Per-user collection naming is the
    // structural guarantee; this invariant is the defence-in-depth.
    assertUserIdOrThrow(userId);

    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    if (memory.embedding.length !== this.EMBEDDING_DIM) {
      throw new Error(`Invalid embedding dimension: expected ${this.EMBEDDING_DIM}, got ${memory.embedding.length}`);
    }

    const collectionName = this.getUserCollectionName(userId);

    // Ensure collection exists
    if (!(await this.collectionExists(collectionName))) {
      await this.createUserMemoryCollection(userId);
    }

    // Insert memory
    const result = await this.client.insert({
      collection_name: collectionName,
      data: [{
        content: memory.content,
        embedding: memory.embedding,
        metadata: JSON.stringify(memory.metadata)
      }]
    });

    // Return the generated ID
    if (result.status.error_code !== 'Success') {
      throw new Error(`Failed to store memory: ${result.status.reason}`);
    }

    // Extract the ID from the response
    const ids = result.IDs;
    let insertedId: number;
    
    if (ids && 'int_id' in ids && ids.int_id?.data && ids.int_id.data.length > 0) {
      insertedId = Number(ids.int_id.data[0]);
    } else if (ids && 'str_id' in ids && ids.str_id?.data && ids.str_id.data.length > 0) {
      insertedId = Number.parseInt(String(ids.str_id.data[0]), 10);
    } else {
      throw new Error('Unable to extract inserted ID from response');
    }
    
    return insertedId;
  }

  async searchMemories(userId: string, queryEmbedding: number[], topK: number = 5): Promise<MemorySearchResult[]> {
    assertUserIdOrThrow(userId);

    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    if (queryEmbedding.length !== this.EMBEDDING_DIM) {
      throw new Error(`Invalid query embedding dimension: expected ${this.EMBEDDING_DIM}, got ${queryEmbedding.length}`);
    }

    const collectionName = this.getUserCollectionName(userId);

    // Check if collection exists
    if (!(await this.collectionExists(collectionName))) {
      return []; // No memories for this user yet
    }

    // Perform vector similarity search
    const searchResult = await this.client.search({
      collection_name: collectionName,
      data: [queryEmbedding],
      limit: topK,
      output_fields: ['id', 'content', 'metadata']
    });

    if (searchResult.status.error_code !== 'Success') {
      throw new Error(`Search failed: ${searchResult.status.reason}`);
    }

    // Transform results
    return searchResult.results.map((result: any) => ({
      id: result.id,
      content: result.content,
      score: result.score,
      metadata: JSON.parse(result.metadata || '{}')
    }));
  }

  async queryMemories(userId: string, filter: string): Promise<MemorySearchResult[]> {
    assertUserIdOrThrow(userId);

    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    const collectionName = this.getUserCollectionName(userId);

    // Check if collection exists
    if (!(await this.collectionExists(collectionName))) {
      return []; // No memories for this user yet
    }

    // Query with filter expression
    const queryResult = await this.client.query({
      collection_name: collectionName,
      expr: filter,
      output_fields: ['id', 'content', 'metadata']
    });

    if (queryResult.status.error_code !== 'Success') {
      throw new Error(`Query failed: ${queryResult.status.reason}`);
    }

    // Transform results (no score for filtered queries)
    return queryResult.data.map((result: any) => ({
      id: result.id,
      content: result.content,
      score: 1.0, // Default score for query results
      metadata: JSON.parse(result.metadata || '{}')
    }));
  }

  async deleteMemory(userId: string, memoryId: number): Promise<void> {
    assertUserIdOrThrow(userId);

    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    const collectionName = this.getUserCollectionName(userId);

    // Check if collection exists
    if (!(await this.collectionExists(collectionName))) {
      return; // Nothing to delete
    }

    // Delete by ID - use filter instead of expr
    await this.client.delete({
      collection_name: collectionName,
      filter: `id == ${memoryId}`
    });
  }

  async getMemoryStats(userId: string): Promise<MemoryStats> {
    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    const collectionName = this.getUserCollectionName(userId);
    
    if (!(await this.collectionExists(collectionName))) {
      return {
        totalMemories: 0,
        collectionName
      };
    }

    // Get collection statistics
    const stats = await this.client.getCollectionStatistics({
      collection_name: collectionName
    });

    if (stats.status.error_code !== 'Success') {
      throw new Error(`Failed to get statistics: ${stats.status.reason}`);
    }

    // Extract row count from stats
    const rowCountStat = stats.stats.find((stat: any) => stat.key === 'row_count');
    const totalMemories = rowCountStat ? Number.parseInt(String(rowCountStat.value), 10) : 0;

    return {
      totalMemories,
      collectionName
    };
  }

  async deleteUserCollection(userId: string): Promise<void> {
    // Guard explicitly — a sentinel / empty userId here would drop a
    // wildcard-named collection, e.g. "memories_" or "memories_*".
    assertUserIdOrThrow(userId);

    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    const collectionName = this.getUserCollectionName(userId);

    // Check if collection exists
    if (!(await this.collectionExists(collectionName))) {
      return; // Nothing to delete
    }

    // Drop the entire collection
    await this.client.dropCollection({
      collection_name: collectionName
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listCollections(): Promise<string[]> {
    if (!this.connected) {
      throw new Error('Not connected to Milvus');
    }

    try {
      const result = await this.client.listCollections();
      if (result.status.error_code !== 'Success') {
        throw new Error(`Failed to list collections: ${result.status.reason}`);
      }
      return result.data.map(item => item.name);
    } catch (error) {
      console.error('Error listing collections:', error);
      return [];
    }
  }

  async getCollectionStats(userId: string): Promise<MemoryStats> {
    return this.getMemoryStats(userId);
  }
}