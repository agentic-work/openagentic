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
 * Google Vertex Context Cache Manager
 *
 * Manages Google's explicit context caching for Gemini models.
 * Unlike Bedrock/Anthropic ephemeral caching (provider-managed),
 * Google requires explicit cache creation and management.
 *
 * Architecture:
 * - Redis: Fast cache lookups (content_hash → cache_name + metadata)
 * - PostgreSQL: Persistent records for analytics and debugging
 * - Google CachedContent API: Creates/manages actual cached content on Google's servers
 *
 * Cost Savings:
 * - Gemini 2.5: 90% discount on cached tokens
 * - Gemini 2.0: 75% discount on cached tokens
 * - Gemini 1.5: 75% discount on cached tokens
 *
 * Requirements:
 * - Minimum 2,048 tokens for content to be cacheable
 * - Maximum 10MB content size
 * - Default TTL: 60 minutes (configurable)
 *
 * @see https://ai.google.dev/gemini-api/docs/caching
 */

import { GoogleGenAI } from '@google/genai';
import type { Logger } from 'pino';
import { pino } from 'pino';
import { getRedisClient, UnifiedRedisClient } from '../../utils/redis-client.js';
import { prisma } from '../../utils/prisma.js';
import crypto from 'crypto';

// =============================================================================
// Configuration
// =============================================================================

// Minimum tokens required for Google to accept content caching
const MIN_CACHEABLE_TOKENS = 2048;
// Approximate chars per token for estimation
const CHARS_PER_TOKEN = 4;
// Minimum chars (estimated) for caching consideration
const MIN_CACHEABLE_CHARS = MIN_CACHEABLE_TOKENS * CHARS_PER_TOKEN;
// Default cache TTL in seconds (60 minutes)
const DEFAULT_CACHE_TTL_SECONDS = 3600;
// Redis key prefix for cache lookups
const REDIS_KEY_PREFIX = 'vertex:cache:';
// Redis key TTL (slightly longer than cache TTL to handle race conditions)
const REDIS_KEY_TTL_BUFFER_SECONDS = 300;

// =============================================================================
// Types
// =============================================================================

export interface CachedContentMetadata {
  cacheName: string;           // Google's cache name (e.g., "cachedContents/abc123")
  contentHash: string;         // SHA256 hash of cached content
  model: string;               // Model the cache was created for
  createdAt: Date;
  expiresAt: Date;
  tokenCount?: number;         // Estimated token count
  usageCount: number;          // Times this cache has been used
  lastUsedAt: Date;
  userId?: string;             // User who created the cache
  sessionId?: string;          // Session context
}

export interface CacheLookupResult {
  found: boolean;
  cacheName?: string;
  metadata?: CachedContentMetadata;
  source?: 'redis' | 'database';
}

export interface CacheCreateResult {
  success: boolean;
  cacheName?: string;
  error?: string;
  tokenCount?: number;
  expiresAt?: Date;
}

export interface CacheStats {
  totalCaches: number;
  activeCaches: number;
  totalUsageCount: number;
  estimatedSavings: number;     // Estimated cost savings from caching
  hitRate: number;
  avgCacheLifeMinutes: number;
}

// =============================================================================
// Cache Manager Service
// =============================================================================

export class GoogleVertexCacheManager {
  private logger: Logger;
  private redis: UnifiedRedisClient;
  private genAI: GoogleGenAI | null = null;
  private initialized: boolean = false;
  private defaultTtlSeconds: number;

  // In-memory stats tracking
  private stats = {
    hits: 0,
    misses: 0,
    creates: 0,
    errors: 0,
  };

  constructor(
    logger?: Logger,
    config?: {
      defaultTtlSeconds?: number;
      genAIClient?: GoogleGenAI;
    }
  ) {
    this.logger = logger || pino({ name: 'GoogleVertexCacheManager' });
    this.redis = getRedisClient();
    this.defaultTtlSeconds = config?.defaultTtlSeconds || DEFAULT_CACHE_TTL_SECONDS;

    if (config?.genAIClient) {
      this.genAI = config.genAIClient;
      this.initialized = true;
    }
  }

  /**
   * Initialize the cache manager with a GoogleGenAI client
   */
  async initialize(genAIClient: GoogleGenAI): Promise<void> {
    this.genAI = genAIClient;
    this.initialized = true;
    this.logger.info('[VERTEX-CACHE] Cache manager initialized');
  }

  /**
   * Check if content is cacheable (meets minimum token requirement)
   */
  isContentCacheable(content: string | any[]): boolean {
    let totalChars = 0;

    if (typeof content === 'string') {
      totalChars = content.length;
    } else if (Array.isArray(content)) {
      // Handle array of content blocks (messages)
      for (const item of content) {
        if (typeof item === 'string') {
          totalChars += item.length;
        } else if (item.text) {
          totalChars += item.text.length;
        } else if (item.content) {
          totalChars += typeof item.content === 'string'
            ? item.content.length
            : JSON.stringify(item.content).length;
        }
      }
    }

    return totalChars >= MIN_CACHEABLE_CHARS;
  }

  /**
   * Generate a content hash for cache lookup
   */
  private generateContentHash(content: string | any[], model: string): string {
    let contentStr: string;

    if (typeof content === 'string') {
      contentStr = content;
    } else {
      // Normalize array content for consistent hashing
      contentStr = JSON.stringify(content);
    }

    // Include model in hash since caches are model-specific
    const hashInput = `${model}:${contentStr}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Look up an existing cache by content hash
   * First checks Redis, then falls back to database
   */
  async lookupCache(
    content: string | any[],
    model: string
  ): Promise<CacheLookupResult> {
    if (!this.initialized) {
      return { found: false };
    }

    const contentHash = this.generateContentHash(content, model);
    const redisKey = `${REDIS_KEY_PREFIX}${contentHash}`;

    try {
      // Try Redis first (fast path)
      const cachedData = await this.redis.get<CachedContentMetadata>(redisKey);

      if (cachedData) {
        // Verify cache hasn't expired
        if (new Date(cachedData.expiresAt) > new Date()) {
          this.stats.hits++;
          this.logger.info({
            contentHash: contentHash.substring(0, 16),
            cacheName: cachedData.cacheName,
            source: 'redis'
          }, '[VERTEX-CACHE] 🎯 Cache HIT (Redis)');

          // Update usage count asynchronously
          this.updateUsageCount(cachedData.cacheName, contentHash).catch(() => {});

          return {
            found: true,
            cacheName: cachedData.cacheName,
            metadata: cachedData,
            source: 'redis',
          };
        } else {
          // Cache expired, remove from Redis
          await this.redis.del(redisKey);
        }
      }

      // Try database (slower path, but persistent)
      const dbCache = await this.lookupFromDatabase(contentHash, model);

      if (dbCache) {
        this.stats.hits++;
        this.logger.info({
          contentHash: contentHash.substring(0, 16),
          cacheName: dbCache.cacheName,
          source: 'database'
        }, '[VERTEX-CACHE] 🎯 Cache HIT (Database)');

        // Populate Redis for next lookup
        await this.cacheToRedis(contentHash, dbCache);

        // Update usage count
        this.updateUsageCount(dbCache.cacheName, contentHash).catch(() => {});

        return {
          found: true,
          cacheName: dbCache.cacheName,
          metadata: dbCache,
          source: 'database',
        };
      }

      this.stats.misses++;
      this.logger.debug({
        contentHash: contentHash.substring(0, 16),
        model
      }, '[VERTEX-CACHE] Cache MISS');

      return { found: false };

    } catch (error) {
      this.stats.errors++;
      this.logger.warn({ error, contentHash: contentHash.substring(0, 16) },
        '[VERTEX-CACHE] Cache lookup error');
      return { found: false };
    }
  }

  /**
   * Create a new cache on Google's servers and store metadata
   */
  async createCache(
    content: string | any[],
    model: string,
    options?: {
      displayName?: string;
      ttlSeconds?: number;
      userId?: string;
      sessionId?: string;
      systemInstruction?: string;
      tools?: any[];
    }
  ): Promise<CacheCreateResult> {
    if (!this.initialized || !this.genAI) {
      return { success: false, error: 'Cache manager not initialized' };
    }

    // Check if content is cacheable
    if (!this.isContentCacheable(content)) {
      this.logger.debug({
        contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length,
        minRequired: MIN_CACHEABLE_CHARS
      }, '[VERTEX-CACHE] Content too small for caching');
      return { success: false, error: 'Content below minimum token threshold' };
    }

    const contentHash = this.generateContentHash(content, model);
    const ttlSeconds = options?.ttlSeconds || this.defaultTtlSeconds;

    try {
      // Check if cache already exists
      const existing = await this.lookupCache(content, model);
      if (existing.found && existing.cacheName) {
        this.logger.info({
          cacheName: existing.cacheName,
          contentHash: contentHash.substring(0, 16)
        }, '[VERTEX-CACHE] Using existing cache');
        return {
          success: true,
          cacheName: existing.cacheName,
          expiresAt: existing.metadata?.expiresAt,
        };
      }

      // Build cache content config
      const cacheContents: any[] = [];

      if (typeof content === 'string') {
        // System instruction or simple text
        cacheContents.push({
          role: 'user',
          parts: [{ text: content }]
        });
      } else if (Array.isArray(content)) {
        // Array of messages/content blocks
        for (const item of content) {
          if (item.role && item.parts) {
            // Already in Vertex format
            cacheContents.push(item);
          } else if (item.role && item.content) {
            // OpenAI format - convert
            cacheContents.push({
              role: item.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: typeof item.content === 'string' ? item.content : JSON.stringify(item.content) }]
            });
          }
        }
      }

      // Create cache config
      const cacheConfig: any = {
        model,
        displayName: options?.displayName || `cache-${contentHash.substring(0, 16)}`,
        contents: cacheContents,
        ttl: `${ttlSeconds}s`,
      };

      // Add system instruction if provided
      if (options?.systemInstruction) {
        cacheConfig.systemInstruction = {
          parts: [{ text: options.systemInstruction }]
        };
      }

      // Add tools if provided
      if (options?.tools && options.tools.length > 0) {
        cacheConfig.tools = options.tools;
      }

      this.logger.info({
        model,
        contentHash: contentHash.substring(0, 16),
        ttlSeconds,
        hasSystemInstruction: !!options?.systemInstruction,
        toolCount: options?.tools?.length || 0
      }, '[VERTEX-CACHE] Creating cache on Google servers');

      // Create cache via Google API
      const cache = await (this.genAI as any).caches.create(cacheConfig);

      if (!cache || !cache.name) {
        throw new Error('Cache creation returned no name');
      }

      const cacheName = cache.name;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      // Store metadata in Redis and database
      const metadata: CachedContentMetadata = {
        cacheName,
        contentHash,
        model,
        createdAt: new Date(),
        expiresAt,
        tokenCount: cache.usageMetadata?.totalTokenCount,
        usageCount: 1,
        lastUsedAt: new Date(),
        userId: options?.userId,
        sessionId: options?.sessionId,
      };

      await Promise.all([
        this.cacheToRedis(contentHash, metadata),
        this.saveToDatabase(metadata),
      ]);

      this.stats.creates++;

      this.logger.info({
        cacheName,
        contentHash: contentHash.substring(0, 16),
        tokenCount: metadata.tokenCount,
        expiresAt: expiresAt.toISOString(),
        ttlMinutes: Math.round(ttlSeconds / 60)
      }, '[VERTEX-CACHE] ✅ Cache created successfully');

      return {
        success: true,
        cacheName,
        tokenCount: metadata.tokenCount,
        expiresAt,
      };

    } catch (error: any) {
      this.stats.errors++;
      this.logger.error({
        error: error.message,
        contentHash: contentHash.substring(0, 16),
        model
      }, '[VERTEX-CACHE] ❌ Cache creation failed');

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Extend the TTL of an existing cache
   */
  async extendCacheTTL(
    cacheName: string,
    ttlSeconds: number
  ): Promise<boolean> {
    if (!this.initialized || !this.genAI) {
      return false;
    }

    try {
      await (this.genAI as any).caches.update(cacheName, {
        ttl: `${ttlSeconds}s`
      });

      // Update expiry in Redis and database
      const newExpiresAt = new Date(Date.now() + ttlSeconds * 1000);

      // Find and update Redis entry
      const keys = await this.redis.keys(`${REDIS_KEY_PREFIX}*`);
      for (const key of keys) {
        const metadata = await this.redis.get<CachedContentMetadata>(key);
        if (metadata?.cacheName === cacheName) {
          metadata.expiresAt = newExpiresAt;
          await this.redis.set(key, metadata, ttlSeconds + REDIS_KEY_TTL_BUFFER_SECONDS);
          break;
        }
      }

      // Update database (if we have a table for this)
      // This is a placeholder - actual implementation depends on schema

      this.logger.info({
        cacheName,
        newTtlSeconds: ttlSeconds,
        newExpiresAt: newExpiresAt.toISOString()
      }, '[VERTEX-CACHE] Cache TTL extended');

      return true;
    } catch (error: any) {
      this.logger.error({ error: error.message, cacheName },
        '[VERTEX-CACHE] Failed to extend cache TTL');
      return false;
    }
  }

  /**
   * Delete a cache from Google's servers and our storage
   */
  async deleteCache(cacheName: string): Promise<boolean> {
    if (!this.initialized || !this.genAI) {
      return false;
    }

    try {
      // Delete from Google
      await (this.genAI as any).caches.delete(cacheName);

      // Delete from Redis
      const keys = await this.redis.keys(`${REDIS_KEY_PREFIX}*`);
      for (const key of keys) {
        const metadata = await this.redis.get<CachedContentMetadata>(key);
        if (metadata?.cacheName === cacheName) {
          await this.redis.del(key);
          break;
        }
      }

      this.logger.info({ cacheName }, '[VERTEX-CACHE] Cache deleted');
      return true;
    } catch (error: any) {
      this.logger.error({ error: error.message, cacheName },
        '[VERTEX-CACHE] Failed to delete cache');
      return false;
    }
  }

  /**
   * List all active caches from Google
   */
  async listCaches(): Promise<CachedContentMetadata[]> {
    if (!this.initialized || !this.genAI) {
      return [];
    }

    try {
      const response = await (this.genAI as any).caches.list();
      const caches: CachedContentMetadata[] = [];

      for (const cache of response?.cachedContents || []) {
        caches.push({
          cacheName: cache.name,
          contentHash: '', // Not available from Google
          model: cache.model,
          createdAt: new Date(cache.createTime),
          expiresAt: new Date(cache.expireTime),
          tokenCount: cache.usageMetadata?.totalTokenCount,
          usageCount: 0,
          lastUsedAt: new Date(cache.createTime),
        });
      }

      return caches;
    } catch (error: any) {
      this.logger.error({ error: error.message }, '[VERTEX-CACHE] Failed to list caches');
      return [];
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & typeof this.stats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      totalCaches: this.stats.creates,
      activeCaches: this.stats.creates - this.stats.errors,
      totalUsageCount: this.stats.hits,
      estimatedSavings: 0, // Would need cost tracking integration
      hitRate,
      avgCacheLifeMinutes: this.defaultTtlSeconds / 60,
      ...this.stats,
    };
  }

  /**
   * Check if the cache manager is ready
   */
  isReady(): boolean {
    return this.initialized && this.genAI !== null;
  }

  // =============================================================================
  // Private Helper Methods
  // =============================================================================

  /**
   * Store cache metadata in Redis
   */
  private async cacheToRedis(
    contentHash: string,
    metadata: CachedContentMetadata
  ): Promise<void> {
    const redisKey = `${REDIS_KEY_PREFIX}${contentHash}`;
    const ttlSeconds = Math.max(
      1,
      Math.floor((new Date(metadata.expiresAt).getTime() - Date.now()) / 1000) + REDIS_KEY_TTL_BUFFER_SECONDS
    );

    await this.redis.set(redisKey, metadata, ttlSeconds);
  }

  /**
   * Look up cache metadata from database using Prisma
   */
  private async lookupFromDatabase(
    contentHash: string,
    model: string
  ): Promise<CachedContentMetadata | null> {
    try {
      const result = await prisma.vertexContentCache.findFirst({
        where: {
          content_hash: contentHash,
          model: model,
          expires_at: { gt: new Date() }
        },
        orderBy: { created_at: 'desc' }
      });

      if (result) {
        return {
          cacheName: result.cache_name,
          contentHash: result.content_hash,
          model: result.model,
          createdAt: result.created_at,
          expiresAt: result.expires_at,
          tokenCount: result.token_count || undefined,
          usageCount: result.usage_count,
          lastUsedAt: result.last_used_at,
          userId: result.user_id || undefined,
          sessionId: result.session_id || undefined,
        };
      }
    } catch (error: any) {
      // Table may not exist yet - that's okay, just log debug
      this.logger.debug({ error: error.message },
        '[VERTEX-CACHE] Database lookup failed (table may not exist)');
    }

    return null;
  }

  /**
   * Save cache metadata to database using Prisma
   */
  private async saveToDatabase(metadata: CachedContentMetadata): Promise<void> {
    try {
      await prisma.vertexContentCache.upsert({
        where: {
          content_hash_model: {
            content_hash: metadata.contentHash,
            model: metadata.model
          }
        },
        create: {
          cache_name: metadata.cacheName,
          content_hash: metadata.contentHash,
          model: metadata.model,
          expires_at: metadata.expiresAt,
          token_count: metadata.tokenCount || null,
          usage_count: metadata.usageCount,
          last_used_at: metadata.lastUsedAt,
          user_id: metadata.userId || null,
          session_id: metadata.sessionId || null,
        },
        update: {
          cache_name: metadata.cacheName,
          expires_at: metadata.expiresAt,
          usage_count: { increment: 1 },
          last_used_at: new Date(),
        }
      });
    } catch (error: any) {
      // Table may not exist yet - log and continue
      this.logger.debug({ error: error.message },
        '[VERTEX-CACHE] Database save failed (table may not exist)');
    }
  }

  /**
   * Update usage count for a cache
   */
  private async updateUsageCount(cacheName: string, contentHash: string): Promise<void> {
    try {
      // Update Redis
      const redisKey = `${REDIS_KEY_PREFIX}${contentHash}`;
      const metadata = await this.redis.get<CachedContentMetadata>(redisKey);
      if (metadata) {
        metadata.usageCount++;
        metadata.lastUsedAt = new Date();
        const ttlSeconds = Math.max(
          1,
          Math.floor((new Date(metadata.expiresAt).getTime() - Date.now()) / 1000) + REDIS_KEY_TTL_BUFFER_SECONDS
        );
        await this.redis.set(redisKey, metadata, ttlSeconds);
      }

      // Update database using Prisma
      await prisma.vertexContentCache.updateMany({
        where: { cache_name: cacheName },
        data: {
          usage_count: { increment: 1 },
          last_used_at: new Date()
        }
      });
    } catch (error) {
      // Non-critical, just log debug
      this.logger.debug({ cacheName }, '[VERTEX-CACHE] Usage count update failed');
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let managerInstance: GoogleVertexCacheManager | null = null;

/**
 * Get or create the singleton GoogleVertexCacheManager instance
 */
export function getVertexCacheManager(logger?: Logger): GoogleVertexCacheManager {
  if (!managerInstance) {
    managerInstance = new GoogleVertexCacheManager(logger);
  }
  return managerInstance;
}

/**
 * Initialize the Vertex cache manager with a GenAI client
 */
export async function initializeVertexCacheManager(
  genAIClient: GoogleGenAI,
  logger?: Logger
): Promise<GoogleVertexCacheManager> {
  const manager = getVertexCacheManager(logger);
  await manager.initialize(genAIClient);
  return manager;
}
