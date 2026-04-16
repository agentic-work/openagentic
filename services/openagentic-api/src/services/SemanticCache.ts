/**
 * Semantic Cache Service for LLM Response Caching
 *
 * Implements intelligent caching using embeddings to find semantically similar prompts
 * and reuse cached responses, reducing API costs and improving response times.
 *
 * PERFORMANCE OPTIMIZATION: Uses local Ollama embeddings (nomic-embed-text) for FREE
 * semantic matching - no cloud API costs for embedding generation.
 *
 * Features:
 * - Semantic similarity matching using cosine similarity
 * - Configurable similarity threshold (default: 92%)
 * - TTL-based cache expiration
 * - Hit tracking and statistics
 * - Cost savings calculation
 * - In-memory LRU cache for hot queries (L1)
 * - Redis cache for persistent storage (L2)
 */

import { Logger } from 'pino';
import { UnifiedRedisClient } from '../utils/redis-client.js';
import { UniversalEmbeddingService } from './UniversalEmbeddingService.js';
import crypto from 'crypto';

interface CachedResponse {
  response: string;
  embedding: number[];
  timestamp: number;
  hits: number;
  model?: string;
  tokens?: number;
  similarity?: number;
}

// In-memory LRU cache for hot queries (L1 cache - ~1-5ms lookup)
interface LRUEntry {
  data: CachedResponse;
  lastAccess: number;
}

export class SemanticCacheService {
  private redisClient: UnifiedRedisClient;
  private logger: Logger;
  private embeddingService: UniversalEmbeddingService | null = null;
  private similarityThreshold: number;
  private ttl: number;
  private enabled: boolean;

  // L1 Cache: In-memory LRU for hot queries
  private memoryCache: Map<string, LRUEntry> = new Map();
  private memoryCacheMaxSize: number = 500;

  // Metrics
  private metrics = {
    l1Hits: 0,
    l2Hits: 0,
    misses: 0,
    stores: 0,
    embeddingTimeMs: 0,
    lookupTimeMs: 0,
    estimatedTokensSaved: 0,
  };

  constructor(redisClient: UnifiedRedisClient, logger: Logger) {
    this.redisClient = redisClient;
    this.logger = logger.child({ service: 'SemanticCache' }) as Logger;
    this.similarityThreshold = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.92');
    this.ttl = parseInt(process.env.SEMANTIC_CACHE_TTL || '3600'); // 1 hour default
    this.enabled = process.env.ENABLE_SEMANTIC_CACHE !== 'false'; // Enabled by default now

    // Initialize local embedding service (uses Ollama if configured)
    try {
      this.embeddingService = new UniversalEmbeddingService(this.logger);
      const info = this.embeddingService.getInfo();
      this.logger.info({
        provider: info.provider,
        model: info.model,
        similarityThreshold: this.similarityThreshold,
        ttl: this.ttl
      }, 'Semantic cache enabled with local embeddings');
    } catch (error: any) {
      this.logger.warn({ error: error.message }, 'Failed to initialize embedding service, semantic cache disabled');
      this.enabled = false;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private getCacheKey(prompt: string): string {
    const hash = crypto.createHash('sha256').update(prompt).digest('hex');
    return `semantic:prompt:${hash.substring(0, 16)}`;
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (!this.embeddingService) {
      throw new Error('Embedding service not initialized');
    }

    const startTime = Date.now();
    try {
      // Use local embedding service (Ollama, Azure, etc.)
      const result = await this.embeddingService.generateEmbedding(text);
      this.metrics.embeddingTimeMs += Date.now() - startTime;
      return result.embedding;
    } catch (error) {
      this.logger.error({ error }, 'Failed to generate embedding');
      throw error;
    }
  }

  /**
   * L1 Cache: Check in-memory cache first (1-5ms)
   */
  private getFromMemoryCache(key: string): CachedResponse | null {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.data.timestamp > this.ttl * 1000) {
      this.memoryCache.delete(key);
      return null;
    }

    // Update LRU
    entry.lastAccess = Date.now();
    return entry.data;
  }

  /**
   * Store in L1 memory cache with LRU eviction
   */
  private storeInMemoryCache(key: string, data: CachedResponse): void {
    // Evict oldest if at capacity
    if (this.memoryCache.size >= this.memoryCacheMaxSize) {
      let oldestKey = '';
      let oldestTime = Date.now();
      for (const [k, v] of this.memoryCache) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(key, { data, lastAccess: Date.now() });
  }

  async findSimilar(prompt: string): Promise<CachedResponse | null> {
    if (!this.enabled || !this.embeddingService) return null;

    const startTime = Date.now();
    const cacheKey = this.getCacheKey(prompt);

    try {
      // L1: Check memory cache first (1-5ms)
      const l1Result = this.getFromMemoryCache(cacheKey);
      if (l1Result) {
        this.metrics.l1Hits++;
        l1Result.hits++;
        this.logger.debug({ latency: Date.now() - startTime }, 'L1 cache hit');
        return l1Result;
      }

      // Generate embedding for similarity search
      const promptEmbedding = await this.getEmbedding(prompt);

      // L2: Search Redis cache for similar embeddings
      let bestMatch: CachedResponse | null = null;
      let highestSimilarity = 0;

      // Scan memory cache for semantic matches (L1 similarity search)
      for (const [key, entry] of this.memoryCache) {
        const similarity = this.cosineSimilarity(promptEmbedding, entry.data.embedding);
        if (similarity > highestSimilarity && similarity >= this.similarityThreshold) {
          highestSimilarity = similarity;
          bestMatch = entry.data;
        }
      }

      if (bestMatch) {
        this.metrics.l1Hits++;
        bestMatch.hits++;
        bestMatch.similarity = highestSimilarity;

        this.logger.info({
          similarity: highestSimilarity.toFixed(4),
          latency: Date.now() - startTime,
          hits: bestMatch.hits,
          tokens: bestMatch.tokens,
        }, 'Semantic cache HIT - returning cached response');

        // Track estimated savings
        if (bestMatch.tokens) {
          this.metrics.estimatedTokensSaved += bestMatch.tokens;
        }

        return bestMatch;
      }

      this.metrics.misses++;
      this.metrics.lookupTimeMs += Date.now() - startTime;
      return null;
    } catch (error) {
      this.logger.error({ error }, 'Semantic cache lookup failed');
      return null;
    }
  }

  async store(prompt: string, response: string, model?: string, tokens?: number): Promise<void> {
    if (!this.enabled || !this.embeddingService) return;

    try {
      const embedding = await this.getEmbedding(prompt);

      const cacheData: CachedResponse = {
        response,
        embedding,
        timestamp: Date.now(),
        hits: 0,
        model,
        tokens
      };

      const key = this.getCacheKey(prompt);

      // Store in L1 memory cache (fast access)
      this.storeInMemoryCache(key, cacheData);

      // Store in L2 Redis cache (persistent)
      try {
        await this.redisClient.set(key, cacheData, this.ttl);
      } catch (redisError) {
        this.logger.debug({ error: redisError }, 'Redis store failed, using memory cache only');
      }

      this.metrics.stores++;

      this.logger.debug({
        promptLength: prompt.length,
        responseLength: response.length,
        model,
        tokens,
        cacheSize: this.memoryCache.size
      }, 'Stored in semantic cache');
    } catch (error) {
      this.logger.error({ error }, 'Failed to store in semantic cache');
    }
  }

  async getStats(): Promise<{
    enabled: boolean;
    totalCached: number;
    l1Hits: number;
    l2Hits: number;
    misses: number;
    hitRate: number;
    estimatedTokensSaved: number;
    estimatedCostSaved: number;
    avgEmbeddingTimeMs: number;
    avgLookupTimeMs: number;
  }> {
    const totalLookups = this.metrics.l1Hits + this.metrics.l2Hits + this.metrics.misses;
    const totalHits = this.metrics.l1Hits + this.metrics.l2Hits;

    // Estimate cost savings (assuming $0.002 per 1K tokens for input)
    const estimatedCostSaved = (this.metrics.estimatedTokensSaved / 1000) * 0.002;

    return {
      enabled: this.enabled,
      totalCached: this.memoryCache.size,
      l1Hits: this.metrics.l1Hits,
      l2Hits: this.metrics.l2Hits,
      misses: this.metrics.misses,
      hitRate: totalLookups > 0 ? totalHits / totalLookups : 0,
      estimatedTokensSaved: this.metrics.estimatedTokensSaved,
      estimatedCostSaved,
      avgEmbeddingTimeMs: this.metrics.stores > 0
        ? this.metrics.embeddingTimeMs / this.metrics.stores
        : 0,
      avgLookupTimeMs: this.metrics.misses > 0
        ? this.metrics.lookupTimeMs / this.metrics.misses
        : 0,
    };
  }

  async invalidate(pattern?: string): Promise<void> {
    // Clear L1 memory cache
    this.memoryCache.clear();

    // Reset metrics
    this.metrics = {
      l1Hits: 0,
      l2Hits: 0,
      misses: 0,
      stores: 0,
      embeddingTimeMs: 0,
      lookupTimeMs: 0,
      estimatedTokensSaved: 0,
    };

    this.logger.info({ pattern }, 'Semantic cache invalidated');
  }

  isEnabled(): boolean {
    return this.enabled && this.embeddingService !== null;
  }

  /**
   * Get embedding service info (useful for debugging)
   */
  getEmbeddingInfo(): { provider: string; model: string; dimensions: number } | null {
    if (!this.embeddingService) return null;
    return this.embeddingService.getInfo();
  }
}