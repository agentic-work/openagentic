/**
 * CodeMode Milvus Service - Per-user vector collections for CodeMode
 *
 * Provides semantic code search and knowledge storage for each CodeMode user.
 * Each user gets their own isolated Milvus collection (`codemode_user_{userId}`)
 * for storing:
 * - Code embeddings (functions, classes, modules)
 * - Documentation embeddings
 * - Session context and conversation embeddings
 * - File content embeddings for semantic search
 *
 * Features:
 * - Automatic collection creation on first use
 * - Code-optimized schema with file metadata
 * - Multiple search modes (semantic, hybrid, filtered)
 * - Batch embedding ingestion for performance
 * - Collection health monitoring and optimization
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

// Collection schema for code embeddings
export interface CodeEmbedding {
  content: string;
  embedding: number[];
  metadata: CodeMetadata;
}

export interface CodeMetadata {
  sessionId?: string;
  filePath?: string;
  fileName?: string;
  language?: string;
  symbolType?: 'function' | 'class' | 'module' | 'snippet' | 'documentation' | 'context' | 'message';
  symbolName?: string;
  startLine?: number;
  endLine?: number;
  timestamp: number;
  tags?: string[];
}

export interface CodeSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: CodeMetadata;
}

export interface CollectionInfo {
  name: string;
  userId: string;
  vectorCount: number;
  createdAt?: Date;
  lastAccessed?: Date;
  sizeBytes?: number;
  status: 'active' | 'inactive' | 'error';
}

export interface CodeModeCollectionStats {
  totalCollections: number;
  totalVectors: number;
  activeUsers: number;
  collectionsHealth: {
    healthy: number;
    degraded: number;
    error: number;
  };
  storageUsageBytes: number;
}

export class CodeModeMilvusService {
  private client: MilvusClient;
  private connected = false;
  private readonly EMBEDDING_DIM = 1536; // OpenAI text-embedding-ada-002 / Anthropic compatible
  private readonly COLLECTION_PREFIX = 'codemode_user_';
  private readonly MAX_CONTENT_LENGTH = 65535;
  private collectionCache: Map<string, boolean> = new Map(); // userId -> collection exists

  constructor() {
    const address = `${process.env.MILVUS_HOST || 'milvus'}:${process.env.MILVUS_PORT || '19530'}`;

    this.client = new MilvusClient({
      address,
      username: process.env.MILVUS_USERNAME,
      password: process.env.MILVUS_PASSWORD,
    });

    logger.info({ address }, '[CodeModeMilvus] Service initialized');
  }

  /**
   * Connect to Milvus
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const health = await this.client.checkHealth();
      if (health.isHealthy) {
        this.connected = true;
        logger.info('[CodeModeMilvus] Connected successfully');
      } else {
        throw new Error('Milvus server is not healthy');
      }
    } catch (error) {
      this.connected = false;
      logger.error({ error }, '[CodeModeMilvus] Connection failed');
      throw error;
    }
  }

  /**
   * Get collection name for a user
   */
  getCollectionName(userId: string): string {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50);
    return `${this.COLLECTION_PREFIX}${sanitizedUserId}`;
  }

  /**
   * Ensure user's collection exists
   */
  async ensureUserCollection(userId: string): Promise<string> {
    if (!this.connected) {
      await this.connect();
    }

    const collectionName = this.getCollectionName(userId);

    // Check cache first
    if (this.collectionCache.get(userId)) {
      return collectionName;
    }

    try {
      const exists = await this.client.hasCollection({ collection_name: collectionName });

      if (exists.value) {
        this.collectionCache.set(userId, true);
        return collectionName;
      }

      // Create collection with code-optimized schema
      await this.createUserCollection(userId);
      this.collectionCache.set(userId, true);

      return collectionName;
    } catch (error) {
      logger.error({ error, userId }, '[CodeModeMilvus] Failed to ensure collection');
      throw error;
    }
  }

  /**
   * Create a new user collection with code-optimized schema
   */
  private async createUserCollection(userId: string): Promise<void> {
    const collectionName = this.getCollectionName(userId);

    logger.info({ collectionName, userId }, '[CodeModeMilvus] Creating user collection');

    const fields = [
      {
        name: 'id',
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 64,
        description: 'Primary key (UUID)'
      },
      {
        name: 'content',
        data_type: DataType.VarChar,
        max_length: this.MAX_CONTENT_LENGTH,
        description: 'Code content or text'
      },
      {
        name: 'embedding',
        data_type: DataType.FloatVector,
        dim: this.EMBEDDING_DIM,
        description: 'Content embedding vector'
      },
      // Metadata fields for efficient filtering
      {
        name: 'session_id',
        data_type: DataType.VarChar,
        max_length: 64,
        description: 'Session ID for context filtering'
      },
      {
        name: 'file_path',
        data_type: DataType.VarChar,
        max_length: 512,
        description: 'File path in workspace'
      },
      {
        name: 'language',
        data_type: DataType.VarChar,
        max_length: 32,
        description: 'Programming language'
      },
      {
        name: 'symbol_type',
        data_type: DataType.VarChar,
        max_length: 32,
        description: 'Type: function, class, module, snippet, documentation, context, message'
      },
      {
        name: 'symbol_name',
        data_type: DataType.VarChar,
        max_length: 256,
        description: 'Name of the symbol'
      },
      {
        name: 'timestamp',
        data_type: DataType.Int64,
        description: 'Creation timestamp'
      },
      {
        name: 'metadata_json',
        data_type: DataType.JSON,
        description: 'Additional metadata (tags, line numbers, etc.)'
      }
    ];

    // Create collection
    await this.client.createCollection({
      collection_name: collectionName,
      fields,
      enable_dynamic_field: true,
      consistency_level: 'Strong' as any
    });

    // Create vector index (HNSW for better recall on code search)
    await this.client.createIndex({
      collection_name: collectionName,
      field_name: 'embedding',
      index_type: 'HNSW',
      metric_type: 'COSINE', // Cosine similarity works well for code
      params: { M: 16, efConstruction: 256 }
    });

    // Create scalar indexes for efficient filtering
    await this.client.createIndex({
      collection_name: collectionName,
      field_name: 'session_id',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: collectionName,
      field_name: 'symbol_type',
      index_type: 'INVERTED'
    });

    await this.client.createIndex({
      collection_name: collectionName,
      field_name: 'language',
      index_type: 'INVERTED'
    });

    // Load collection into memory
    await this.client.loadCollection({ collection_name: collectionName });

    logger.info({ collectionName }, '[CodeModeMilvus] Collection created and loaded');
  }

  /**
   * Store code embedding
   */
  async storeEmbedding(userId: string, entry: CodeEmbedding): Promise<string> {
    const collectionName = await this.ensureUserCollection(userId);

    if (entry.embedding.length !== this.EMBEDDING_DIM) {
      throw new Error(`Invalid embedding dimension: expected ${this.EMBEDDING_DIM}, got ${entry.embedding.length}`);
    }

    const id = this.generateId();
    const content = entry.content.substring(0, this.MAX_CONTENT_LENGTH);

    const data = [{
      id,
      content,
      embedding: entry.embedding,
      session_id: entry.metadata.sessionId || '',
      file_path: entry.metadata.filePath || '',
      language: entry.metadata.language || '',
      symbol_type: entry.metadata.symbolType || 'snippet',
      symbol_name: entry.metadata.symbolName || '',
      timestamp: entry.metadata.timestamp || Date.now(),
      metadata_json: JSON.stringify({
        startLine: entry.metadata.startLine,
        endLine: entry.metadata.endLine,
        fileName: entry.metadata.fileName,
        tags: entry.metadata.tags || []
      })
    }];

    const result = await this.client.insert({
      collection_name: collectionName,
      data
    });

    if (result.status.error_code !== 'Success') {
      throw new Error(`Failed to store embedding: ${result.status.reason}`);
    }

    logger.debug({ collectionName, id }, '[CodeModeMilvus] Stored embedding');
    return id;
  }

  /**
   * Batch store embeddings for performance
   */
  async batchStoreEmbeddings(userId: string, entries: CodeEmbedding[]): Promise<string[]> {
    if (entries.length === 0) return [];

    const collectionName = await this.ensureUserCollection(userId);
    const ids: string[] = [];

    const data = entries.map(entry => {
      if (entry.embedding.length !== this.EMBEDDING_DIM) {
        throw new Error(`Invalid embedding dimension: expected ${this.EMBEDDING_DIM}, got ${entry.embedding.length}`);
      }

      const id = this.generateId();
      ids.push(id);

      return {
        id,
        content: entry.content.substring(0, this.MAX_CONTENT_LENGTH),
        embedding: entry.embedding,
        session_id: entry.metadata.sessionId || '',
        file_path: entry.metadata.filePath || '',
        language: entry.metadata.language || '',
        symbol_type: entry.metadata.symbolType || 'snippet',
        symbol_name: entry.metadata.symbolName || '',
        timestamp: entry.metadata.timestamp || Date.now(),
        metadata_json: JSON.stringify({
          startLine: entry.metadata.startLine,
          endLine: entry.metadata.endLine,
          fileName: entry.metadata.fileName,
          tags: entry.metadata.tags || []
        })
      };
    });

    // Insert in batches of 1000
    const BATCH_SIZE = 1000;
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const batch = data.slice(i, i + BATCH_SIZE);
      const result = await this.client.insert({
        collection_name: collectionName,
        data: batch
      });

      if (result.status.error_code !== 'Success') {
        throw new Error(`Batch insert failed at offset ${i}: ${result.status.reason}`);
      }
    }

    logger.info({ collectionName, count: entries.length }, '[CodeModeMilvus] Batch stored embeddings');
    return ids;
  }

  /**
   * Semantic search in user's collection
   */
  async search(
    userId: string,
    queryEmbedding: number[],
    options: {
      topK?: number;
      sessionId?: string;
      language?: string;
      symbolType?: string;
      filePath?: string;
      minScore?: number;
    } = {}
  ): Promise<CodeSearchResult[]> {
    const { topK = 10, sessionId, language, symbolType, filePath, minScore = 0.0 } = options;
    const collectionName = await this.ensureUserCollection(userId);

    if (queryEmbedding.length !== this.EMBEDDING_DIM) {
      throw new Error(`Invalid query embedding dimension: expected ${this.EMBEDDING_DIM}, got ${queryEmbedding.length}`);
    }

    // Build filter expression
    const filters: string[] = [];
    if (sessionId) filters.push(`session_id == "${sessionId}"`);
    if (language) filters.push(`language == "${language}"`);
    if (symbolType) filters.push(`symbol_type == "${symbolType}"`);
    if (filePath) filters.push(`file_path like "${filePath}%"`);

    const filterExpr = filters.length > 0 ? filters.join(' && ') : undefined;

    const searchResult = await this.client.search({
      collection_name: collectionName,
      data: [queryEmbedding],
      limit: topK,
      filter: filterExpr,
      output_fields: ['id', 'content', 'session_id', 'file_path', 'language', 'symbol_type', 'symbol_name', 'timestamp', 'metadata_json'],
      params: { ef: 64 } // HNSW search parameter
    });

    if (searchResult.status.error_code !== 'Success') {
      throw new Error(`Search failed: ${searchResult.status.reason}`);
    }

    // Transform and filter results
    return searchResult.results
      .filter((result: any) => result.score >= minScore)
      .map((result: any) => {
        let additionalMeta = {};
        try {
          additionalMeta = JSON.parse(result.metadata_json || '{}');
        } catch {
          // Ignore parse errors
        }

        return {
          id: result.id,
          content: result.content,
          score: result.score,
          metadata: {
            sessionId: result.session_id || undefined,
            filePath: result.file_path || undefined,
            fileName: (additionalMeta as any).fileName,
            language: result.language || undefined,
            symbolType: result.symbol_type as CodeMetadata['symbolType'],
            symbolName: result.symbol_name || undefined,
            startLine: (additionalMeta as any).startLine,
            endLine: (additionalMeta as any).endLine,
            timestamp: result.timestamp,
            tags: (additionalMeta as any).tags
          }
        };
      });
  }

  /**
   * Search within a specific session's context
   */
  async searchSessionContext(
    userId: string,
    sessionId: string,
    queryEmbedding: number[],
    topK: number = 5
  ): Promise<CodeSearchResult[]> {
    return this.search(userId, queryEmbedding, { topK, sessionId });
  }

  /**
   * Delete embeddings by IDs
   */
  async deleteEmbeddings(userId: string, ids: string[]): Promise<void> {
    const collectionName = await this.ensureUserCollection(userId);

    const idFilter = ids.map(id => `"${id}"`).join(', ');
    await this.client.delete({
      collection_name: collectionName,
      filter: `id in [${idFilter}]`
    });

    logger.debug({ collectionName, count: ids.length }, '[CodeModeMilvus] Deleted embeddings');
  }

  /**
   * Delete all embeddings for a session
   */
  async deleteSessionEmbeddings(userId: string, sessionId: string): Promise<number> {
    const collectionName = await this.ensureUserCollection(userId);

    // First count how many will be deleted
    const countResult = await this.client.query({
      collection_name: collectionName,
      filter: `session_id == "${sessionId}"`,
      output_fields: ['id']
    });

    const count = countResult.data.length;

    if (count > 0) {
      await this.client.delete({
        collection_name: collectionName,
        filter: `session_id == "${sessionId}"`
      });
    }

    logger.info({ collectionName, sessionId, count }, '[CodeModeMilvus] Deleted session embeddings');
    return count;
  }

  /**
   * Get collection info for a user
   */
  async getCollectionInfo(userId: string): Promise<CollectionInfo | null> {
    try {
      const collectionName = this.getCollectionName(userId);

      const exists = await this.client.hasCollection({ collection_name: collectionName });
      if (!exists.value) {
        return null;
      }

      const stats = await this.client.getCollectionStatistics({ collection_name: collectionName });
      const rowCount = parseInt(stats.data?.row_count || '0');

      return {
        name: collectionName,
        userId,
        vectorCount: rowCount,
        status: 'active'
      };
    } catch (error) {
      logger.error({ error, userId }, '[CodeModeMilvus] Failed to get collection info');
      return {
        name: this.getCollectionName(userId),
        userId,
        vectorCount: 0,
        status: 'error'
      };
    }
  }

  /**
   * List all CodeMode collections
   */
  async listAllCollections(): Promise<CollectionInfo[]> {
    if (!this.connected) {
      await this.connect();
    }

    const collections: CollectionInfo[] = [];
    const result = await this.client.listCollections();

    for (const col of result.data) {
      if (col.name.startsWith(this.COLLECTION_PREFIX)) {
        const userId = col.name.substring(this.COLLECTION_PREFIX.length);

        try {
          const stats = await this.client.getCollectionStatistics({ collection_name: col.name });
          const rowCount = parseInt(stats.data?.row_count || '0');

          collections.push({
            name: col.name,
            userId,
            vectorCount: rowCount,
            status: 'active'
          });
        } catch {
          collections.push({
            name: col.name,
            userId,
            vectorCount: 0,
            status: 'error'
          });
        }
      }
    }

    return collections;
  }

  /**
   * Get global CodeMode collection statistics
   */
  async getGlobalStats(): Promise<CodeModeCollectionStats> {
    const collections = await this.listAllCollections();

    let totalVectors = 0;
    let healthyCount = 0;
    let errorCount = 0;

    for (const col of collections) {
      totalVectors += col.vectorCount;
      if (col.status === 'active') {
        healthyCount++;
      } else if (col.status === 'error') {
        errorCount++;
      }
    }

    // Estimate storage (very rough: 1536 floats * 4 bytes + metadata overhead)
    const bytesPerVector = 1536 * 4 + 500; // Vector + estimated metadata
    const storageUsageBytes = totalVectors * bytesPerVector;

    return {
      totalCollections: collections.length,
      totalVectors,
      activeUsers: collections.filter(c => c.vectorCount > 0).length,
      collectionsHealth: {
        healthy: healthyCount,
        degraded: collections.length - healthyCount - errorCount,
        error: errorCount
      },
      storageUsageBytes
    };
  }

  /**
   * Delete a user's entire collection
   */
  async deleteUserCollection(userId: string): Promise<void> {
    const collectionName = this.getCollectionName(userId);

    try {
      const exists = await this.client.hasCollection({ collection_name: collectionName });
      if (exists.value) {
        await this.client.dropCollection({ collection_name: collectionName });
        this.collectionCache.delete(userId);
        logger.info({ collectionName, userId }, '[CodeModeMilvus] Deleted user collection');
      }
    } catch (error) {
      logger.error({ error, userId }, '[CodeModeMilvus] Failed to delete collection');
      throw error;
    }
  }

  /**
   * Compact user collection to optimize storage
   */
  async compactUserCollection(userId: string): Promise<void> {
    const collectionName = await this.ensureUserCollection(userId);

    try {
      // Release collection first
      await this.client.releaseCollection({ collection_name: collectionName });

      // Compact
      const result = await this.client.compact({ collection_name: collectionName });
      logger.info({ collectionName, compactionId: result.compactionID }, '[CodeModeMilvus] Compaction started');

      // Reload
      await this.client.loadCollection({ collection_name: collectionName });

      logger.info({ collectionName }, '[CodeModeMilvus] Collection compacted');
    } catch (error) {
      // Ensure collection is reloaded even on error
      try {
        await this.client.loadCollection({ collection_name: collectionName });
      } catch {
        // Ignore reload errors
      }
      logger.error({ error, userId }, '[CodeModeMilvus] Failed to compact collection');
      throw error;
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from Milvus
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.collectionCache.clear();
    logger.info('[CodeModeMilvus] Disconnected');
  }
}

// Singleton instance
export const codeModeMilvusService = new CodeModeMilvusService();
