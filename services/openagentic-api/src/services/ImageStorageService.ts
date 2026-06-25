/**
 * Image Storage Service - Hybrid Architecture
 *
 * Combines blob storage (MinIO/GCS/Azure/S3) for image binary data with Milvus
 * for metadata and semantic search capabilities.
 *
 * Architecture:
 * - Image binaries → Blob storage (MinIO in Docker, cloud storage in K8s)
 * - Metadata + embeddings → Milvus (semantic search, LLM context)
 *
 * Benefits:
 * - Fast image retrieval (blob storage optimized for binary data)
 * - Semantic search via embeddings (find similar images by prompt)
 * - Scalable (blob storage handles large files efficiently)
 * - Cost-effective (no vector DB storage costs for binary blobs)
 */

import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import type { ProviderManager } from './llm-providers/ProviderManager.js';
import { BlobStorageService } from './BlobStorageService.js';
import { escapeMilvusFilterValue } from '../utils/milvusFilter.js';

export interface StoredImage {
  id: string;
  imageData: string; // base64 encoded (loaded from blob storage)
  prompt: string;
  userId: string;
  timestamp: Date;
  metadata: {
    model: string;
    revisedPrompt?: string;
    dimensions?: string;
    generationTime?: number;
    format?: string;
    blobKey?: string;
  };
}

export interface ImageSearchResult {
  id: string;
  prompt: string;
  score: number;
  metadata: any;
}

export class ImageStorageService {
  private milvusClient: MilvusClient;
  private blobStorage: BlobStorageService;
  private connected = false;
  // 2026-06-24 — default OSS stack is pgvector-only (NO Milvus; see root
  // CLAUDE.md gotcha #7). Without a fallback, generate_image produced the
  // image bytes via Imagen but then failed at storeImage with "Not connected
  // to storage" (Milvus gRPC code 14 UNAVAILABLE), so no image ever surfaced.
  // When Milvus is unavailable but Redis is, run in redis-only mode: the full
  // record (base64 + metadata) is persisted in Redis under a durable key so
  // /api/images/:id can serve the PNG. Semantic image search is unavailable
  // in this mode (no vector index), which is acceptable for the default
  // install — the image renders inline in chat, the launch-critical path.
  private redisOnly = false;
  private readonly COLLECTION_NAME = 'image_metadata';
  private readonly EMBEDDING_DIM: number;
  private readonly CACHE_TTL = 3600; // 1 hour cache TTL
  // Durable TTL for redis-only persistence (not just cache). Matches the
  // /api/images/:id Cache-Control max-age (24h) — long enough for the chat
  // turn + the user revisiting the session shortly after.
  private readonly REDIS_ONLY_TTL = 86400; // 24h
  private readonly REDIS_ONLY_PREFIX = 'imgstore:';
  private readonly CACHE_PREFIX = 'img:';
  private logger: any;
  private redis: any;
  private embeddingService: UniversalEmbeddingService;

  constructor(logger: any, providerManager?: ProviderManager, redis?: any) {
    this.logger = logger;
    this.redis = redis;

    const address = `${process.env.MILVUS_HOST}:${process.env.MILVUS_PORT}`;
    const username = process.env.MILVUS_USERNAME;
    const password = process.env.MILVUS_PASSWORD;
    const ssl = process.env.MILVUS_SSL === 'true';

    this.milvusClient = new MilvusClient({
      address,
      username,
      password,
      ssl
    });

    // Initialize blob storage (auto-detects MinIO/GCS/Azure/S3/local)
    this.blobStorage = new BlobStorageService(logger);

    // Initialize embedding service
    this.embeddingService = new UniversalEmbeddingService(logger);
    this.EMBEDDING_DIM = this.embeddingService.getInfo().dimensions;

    this.logger.info({
      embeddingDim: this.EMBEDDING_DIM,
      blobStorageType: this.blobStorage.getConfig().type,
      hasProviderManager: !!providerManager
    }, '[IMAGE-STORAGE] Hybrid storage initialized (blob + Milvus)');
  }

  async connect(): Promise<void> {
    // Initialize blob storage first (auto-detects local FS when no MinIO/S3).
    // Best-effort: a blob-init failure must not block the redis-only path,
    // which persists base64 in Redis directly.
    try {
      await this.blobStorage.init();
    } catch (blobErr) {
      this.logger.warn({ error: blobErr }, '[IMAGE-STORAGE] Blob storage init failed (redis-only mode still works)');
    }

    // Try Milvus. On the default pgvector-only stack Milvus is absent and the
    // gRPC health check fails (code 14 UNAVAILABLE) — fall back to redis-only
    // persistence instead of throwing so generate_image still delivers the
    // image. Only throw if NEITHER Milvus NOR Redis is available.
    try {
      const health = await this.milvusClient.checkHealth();
      if (health.isHealthy) {
        this.connected = true;
        this.redisOnly = false;
        await this.ensureMetadataCollection();
        this.logger.info('[IMAGE-STORAGE] Connected - blob storage and Milvus ready');
        return;
      }
      throw new Error('Milvus server is not healthy');
    } catch (error) {
      if (this.redis) {
        this.connected = true;
        this.redisOnly = true;
        this.logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          '[IMAGE-STORAGE] Milvus unavailable — falling back to redis-only image persistence (no semantic image search)',
        );
        return;
      }
      this.connected = false;
      this.logger.error({ error }, '[IMAGE-STORAGE] Failed to connect (no Milvus and no Redis fallback)');
      throw error;
    }
  }

  private async ensureMetadataCollection(): Promise<void> {
    const exists = await this.milvusClient.hasCollection({
      collection_name: this.COLLECTION_NAME
    });

    if (exists.value) {
      this.logger.info('[IMAGE-STORAGE] Metadata collection exists');
      try {
        await this.milvusClient.loadCollection({ collection_name: this.COLLECTION_NAME });
      } catch (e) { /* ignore if already loaded */ }
      return;
    }

    this.logger.info('[IMAGE-STORAGE] Creating image_metadata collection');

    const fields = [
      {
        name: 'id',
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 100,
        description: 'Image ID'
      },
      {
        name: 'blobKey',
        data_type: DataType.VarChar,
        max_length: 500,
        description: 'Key/path in blob storage'
      },
      {
        name: 'prompt',
        data_type: DataType.VarChar,
        max_length: 2000,
        description: 'Image generation prompt'
      },
      {
        name: 'promptEmbedding',
        data_type: DataType.FloatVector,
        dim: this.EMBEDDING_DIM,
        description: 'Prompt embedding for semantic search'
      },
      {
        name: 'userId',
        data_type: DataType.VarChar,
        max_length: 200,
        description: 'User who generated the image'
      },
      {
        name: 'createdAt',
        data_type: DataType.Int64,
        description: 'Creation timestamp (Unix ms)'
      },
      {
        name: 'metadata',
        data_type: DataType.JSON,
        description: 'Additional metadata'
      }
    ];

    await this.milvusClient.createCollection({
      collection_name: this.COLLECTION_NAME,
      fields,
      consistency_level: 'Strong' as const
    });

    await this.milvusClient.createIndex({
      collection_name: this.COLLECTION_NAME,
      field_name: 'promptEmbedding',
      index_type: 'IVF_FLAT',
      metric_type: 'L2',
      params: { nlist: 128 }
    });

    await this.milvusClient.loadCollection({ collection_name: this.COLLECTION_NAME });

    this.logger.info('[IMAGE-STORAGE] Metadata collection created');
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.generateEmbedding(text);
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, '[IMAGE-STORAGE] Embedding failed - using zero vector');
      return new Array(this.EMBEDDING_DIM).fill(0);
    }
  }

  /**
   * Store an image: saves to blob storage and metadata to Milvus
   */
  async storeImage(
    imageBase64: string,
    prompt: string,
    userId: string,
    metadata: StoredImage['metadata']
  ): Promise<string> {
    if (!this.connected) {
      throw new Error('Not connected to storage');
    }

    // Redis-only fallback (default pgvector-only stack — no Milvus). Persist
    // the full record (base64 + metadata) under a durable Redis key so
    // /api/images/:id can serve it. No blob storage, no embedding, no vector
    // index — semantic search is unavailable in this mode by design.
    if (this.redisOnly) {
      const format = metadata.format || 'png';
      // Mint an id consistent with the blob path: img_ prefix + random, no
      // extension (nginx intercepts .png URLs before they reach Fastify).
      const imageId = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const stored: StoredImage = {
        id: imageId,
        imageData: imageBase64,
        prompt: prompt.substring(0, 2000),
        userId,
        timestamp: new Date(),
        metadata: {
          model: metadata.model,
          revisedPrompt: metadata.revisedPrompt,
          dimensions: metadata.dimensions,
          generationTime: metadata.generationTime,
          format,
        },
      };
      const ok = await this.redis.set(
        `${this.REDIS_ONLY_PREFIX}${imageId}`,
        stored,
        this.REDIS_ONLY_TTL,
      );
      if (!ok) {
        throw new Error('Redis-only image persistence failed (SET returned false)');
      }
      this.logger.info(
        { imageId, userId, sizeBytes: Math.ceil((imageBase64.length * 3) / 4), storageType: 'redis-only' },
        '[IMAGE-STORAGE] Image stored successfully (redis-only)',
      );
      return imageId;
    }

    try {
      // 1. Generate unique key and store in blob storage
      const blobKey = this.blobStorage.generateKey(userId, 'img');
      const format = metadata.format || 'png';
      const fullKey = `${blobKey}.${format}`;

      const blobMeta = await this.blobStorage.store(
        imageBase64, // Will be decoded from base64
        fullKey,
        `image/${format}`
      );

      // Strip file extension from ID - IDs must not contain extensions because
      // nginx intercepts URLs ending in .png/.jpg as static file requests,
      // preventing /api/images/:id from reaching Fastify
      const imageId = (blobMeta.id || '').replace(/\.[^.]+$/, '');

      // 2. Generate embedding for semantic search
      const promptEmbedding = await this.generateEmbedding(prompt);

      // 3. Store metadata in Milvus
      const result = await this.milvusClient.insert({
        collection_name: this.COLLECTION_NAME,
        data: [{
          id: imageId,
          blobKey: fullKey,
          prompt: prompt.substring(0, 2000),
          promptEmbedding,
          userId,
          createdAt: Date.now(),
          metadata: JSON.stringify({
            model: metadata.model,
            revisedPrompt: metadata.revisedPrompt,
            dimensions: metadata.dimensions,
            generationTime: metadata.generationTime,
            format,
            sizeBytes: blobMeta.sizeBytes
          })
        }]
      });

      if (result.status.error_code !== 'Success') {
        // Cleanup blob on Milvus failure
        await this.blobStorage.delete(fullKey);
        throw new Error(`Milvus insert failed: ${result.status.reason}`);
      }

      await this.milvusClient.flushSync({ collection_names: [this.COLLECTION_NAME] });

      this.logger.info({
        imageId,
        userId,
        blobKey: fullKey,
        sizeBytes: blobMeta.sizeBytes,
        storageType: this.blobStorage.getConfig().type
      }, '[IMAGE-STORAGE] Image stored successfully');

      return imageId;

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        userId
      }, '[IMAGE-STORAGE] Failed to store image');
      throw error;
    }
  }

  /**
   * Retrieve an image by ID (with Redis caching)
   */
  async getImage(imageId: string): Promise<StoredImage | null> {
    if (!this.connected) {
      throw new Error('Not connected to storage');
    }

    // Redis-only fallback retrieval (default pgvector-only stack — no Milvus).
    if (this.redisOnly) {
      try {
        const rec = await this.redis.get(`${this.REDIS_ONLY_PREFIX}${imageId}`);
        if (!rec) {
          this.logger.warn({ imageId }, '[IMAGE-STORAGE] Image not found (redis-only)');
          return null;
        }
        // UnifiedRedisClient.get already JSON-parses; tolerate a raw string too.
        const parsed = typeof rec === 'string' ? JSON.parse(rec) : rec;
        return {
          ...parsed,
          timestamp: new Date(parsed.timestamp),
        } as StoredImage;
      } catch (error) {
        this.logger.error({ error, imageId }, '[IMAGE-STORAGE] Failed to retrieve image (redis-only)');
        return null;
      }
    }

    try {
      // Check Redis cache first
      if (this.redis) {
        const cacheKey = `${this.CACHE_PREFIX}${imageId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug({ imageId }, '[IMAGE-STORAGE] Cache HIT');
          return JSON.parse(cached);
        }
      }

      // Query Milvus for metadata
      const queryResult = await this.milvusClient.query({
        collection_name: this.COLLECTION_NAME,
        filter: `id == "${imageId}"`,
        output_fields: ['id', 'blobKey', 'prompt', 'userId', 'createdAt', 'metadata'],
        limit: 1
      });

      if (queryResult.status.error_code !== 'Success') {
        throw new Error(`Query failed: ${queryResult.status.reason}`);
      }

      if (!queryResult.data || queryResult.data.length === 0) {
        // Backward compat: old images were stored with .png extension in ID.
        // Try again with .png suffix if the original ID has no extension.
        if (!imageId.includes('.')) {
          const retryResult = await this.milvusClient.query({
            collection_name: this.COLLECTION_NAME,
            filter: `id == "${imageId}.png"`,
            output_fields: ['id', 'blobKey', 'prompt', 'userId', 'createdAt', 'metadata'],
            limit: 1
          });
          if (retryResult.status.error_code === 'Success' && retryResult.data?.length > 0) {
            this.logger.info({ imageId, resolvedId: `${imageId}.png` }, '[IMAGE-STORAGE] Resolved legacy .png ID');
            queryResult.data = retryResult.data;
          } else {
            this.logger.warn({ imageId }, '[IMAGE-STORAGE] Image not found in Milvus');
            return null;
          }
        } else {
          this.logger.warn({ imageId }, '[IMAGE-STORAGE] Image not found in Milvus');
          return null;
        }
      }

      const record = queryResult.data[0];
      const meta = JSON.parse(record.metadata || '{}');

      // Get image from blob storage
      const imageBase64 = await this.blobStorage.getBase64(record.blobKey);

      if (!imageBase64) {
        this.logger.warn({ imageId, blobKey: record.blobKey }, '[IMAGE-STORAGE] Image not found in blob storage');
        return null;
      }

      const storedImage: StoredImage = {
        id: record.id,
        imageData: imageBase64,
        prompt: record.prompt,
        userId: record.userId,
        timestamp: new Date(Number(record.createdAt)),
        metadata: {
          model: meta.model,
          revisedPrompt: meta.revisedPrompt,
          dimensions: meta.dimensions,
          generationTime: meta.generationTime,
          format: meta.format,
          blobKey: record.blobKey
        }
      };

      // Cache in Redis
      if (this.redis) {
        const cacheKey = `${this.CACHE_PREFIX}${imageId}`;
        await this.redis.set(cacheKey, JSON.stringify(storedImage), this.CACHE_TTL);
      }

      return storedImage;

    } catch (error) {
      this.logger.error({ error, imageId }, '[IMAGE-STORAGE] Failed to retrieve image');
      return null;
    }
  }

  /**
   * Search for images by semantic similarity
   */
  async searchImages(queryPrompt: string, userId?: string, topK: number = 5): Promise<ImageSearchResult[]> {
    if (!this.connected) {
      throw new Error('Not connected to storage');
    }

    try {
      const queryEmbedding = await this.generateEmbedding(queryPrompt);
      const filter = userId ? `userId == "${escapeMilvusFilterValue(userId)}"` : undefined;

      const searchResult = await this.milvusClient.search({
        collection_name: this.COLLECTION_NAME,
        data: [queryEmbedding],
        limit: topK,
        output_fields: ['id', 'prompt', 'userId', 'metadata'],
        filter
      });

      if (searchResult.status.error_code !== 'Success') {
        throw new Error(`Search failed: ${searchResult.status.reason}`);
      }

      return searchResult.results.map((result: any) => ({
        id: result.id,
        prompt: result.prompt,
        score: result.score,
        metadata: JSON.parse(result.metadata || '{}')
      }));

    } catch (error) {
      this.logger.error({ error, queryPrompt }, '[IMAGE-STORAGE] Search failed');
      return [];
    }
  }

  /**
   * Delete an image from both blob storage and Milvus
   */
  async deleteImage(imageId: string): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to storage');
    }

    try {
      // Get blob key from Milvus
      const queryResult = await this.milvusClient.query({
        collection_name: this.COLLECTION_NAME,
        filter: `id == "${imageId}"`,
        output_fields: ['blobKey'],
        limit: 1
      });

      if (queryResult.data && queryResult.data.length > 0) {
        await this.blobStorage.delete(queryResult.data[0].blobKey);
      }

      // Delete from Milvus
      await this.milvusClient.delete({
        collection_name: this.COLLECTION_NAME,
        filter: `id == "${imageId}"`
      });

      // Invalidate cache
      if (this.redis) {
        await this.redis.del(`${this.CACHE_PREFIX}${imageId}`);
      }

      this.logger.info({ imageId }, '[IMAGE-STORAGE] Image deleted');

    } catch (error) {
      this.logger.error({ error, imageId }, '[IMAGE-STORAGE] Delete failed');
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStatistics(): Promise<{
    totalImages: number;
    totalSize: number;
    oldestImage: Date | null;
    newestImage: Date | null;
  }> {
    if (!this.connected) {
      throw new Error('Not connected to storage');
    }

    try {
      const stats = await this.milvusClient.getCollectionStatistics({
        collection_name: this.COLLECTION_NAME
      });

      const rowCountStat = stats.stats.find((stat: any) => stat.key === 'row_count');
      const totalImages = rowCountStat ? Number.parseInt(String(rowCountStat.value), 10) : 0;

      return {
        totalImages,
        totalSize: 0, // Would need to query blob storage for this
        oldestImage: null,
        newestImage: null
      };

    } catch (error) {
      this.logger.error({ error }, '[IMAGE-STORAGE] Stats failed');
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
