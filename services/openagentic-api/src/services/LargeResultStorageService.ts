/**
 * Large Result Storage Service
 *
 * Stores massive tool results in Redis to prevent context window bloat.
 * Multi-pod safe: uses shared Redis backend, NOT in-memory storage.
 * Enables semantic querying of stored results instead of re-including full data.
 *
 * Architecture (multi-pod AKS):
 *   Tool execution → Result > 100KB → Store in Redis (shared) → Return dataset ref to LLM
 *   LLM calls query_data → DataQueryTool → LargeResultStorageService.getResult() → Redis
 *   Any pod can serve any request since all state is in Redis.
 */

import type { Logger } from 'pino';
import { getRedisClient, type UnifiedRedisClient } from '../utils/redis-client.js';

export interface StoredResultInfo {
  resultId: string;
  summary: string;
  sizeBytes: number;
  chunkCount: number;
}

interface StoredResult {
  userId: string;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  result: any;
  chunks: Array<{ text: string; metadata: Record<string, any> }>;
  summary: string;
  timestamp: number;
}

const REDIS_KEY_PREFIX = 'large_result:';

export class LargeResultStorageService {
  private readonly SIZE_THRESHOLD = 100 * 1024; // 100KB
  private readonly TOKEN_THRESHOLD = 25000; // 25K tokens
  private readonly TTL_SECONDS = 48 * 60 * 60; // 48 hours

  private redis: UnifiedRedisClient | null = null;

  constructor(private readonly logger: Logger) {
    this.initRedis();
  }

  private async initRedis(): Promise<void> {
    try {
      this.redis = getRedisClient();
    } catch (error) {
      this.logger.warn({ error }, 'LargeResultStorageService: Redis not available');
    }
  }

  /**
   * Check if a tool result should be stored (size threshold)
   */
  shouldStoreResult(result: any): boolean {
    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');
    const estimatedTokens = Math.ceil(sizeBytes / 4);

    this.logger.info({
      sizeBytes,
      estimatedTokens,
      threshold: this.SIZE_THRESHOLD,
      shouldStore: sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD
    }, 'Checking if result should be stored');

    return sizeBytes > this.SIZE_THRESHOLD || estimatedTokens > this.TOKEN_THRESHOLD;
  }

  /**
   * Store a large tool result in Redis (multi-pod safe)
   */
  async storeResult(params: {
    userId: string;
    sessionId: string;
    toolName: string;
    toolCallId: string;
    result: any;
  }): Promise<StoredResultInfo> {
    const { userId, sessionId, toolName, toolCallId, result } = params;

    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const resultId = `result_${timestamp}_${random}`;

    const resultStr = JSON.stringify(result);
    const sizeBytes = Buffer.byteLength(resultStr, 'utf8');

    this.logger.info({
      resultId,
      userId,
      sessionId,
      toolName,
      sizeBytes,
      sizeMB: (sizeBytes / 1024 / 1024).toFixed(2),
      threshold: this.SIZE_THRESHOLD
    }, '📦 Storing large tool result in Redis (multi-pod safe)');

    const summary = this.generateSummary(toolName, result);
    const chunks = this.chunkResult(toolName, result);

    const stored: StoredResult = {
      userId,
      sessionId,
      toolName,
      toolCallId,
      result,
      chunks,
      summary,
      timestamp
    };

    // Store in Redis — multi-pod safe
    if (this.redis) {
      try {
        const key = `${REDIS_KEY_PREFIX}${resultId}`;
        await this.redis.set(key, stored, this.TTL_SECONDS);
        this.logger.info({ resultId, key }, '✅ Large result stored in Redis');
      } catch (error) {
        this.logger.error({ error, resultId }, '❌ Failed to store large result in Redis — result will be lost');
        throw new Error(`Failed to store large result in Redis: ${error}`);
      }
    } else {
      this.logger.error({ resultId }, '❌ Redis not available — cannot store large result (multi-pod requires Redis)');
      throw new Error('Redis not available — large result storage requires Redis for multi-pod safety');
    }

    this.logger.info({
      resultId,
      chunkCount: chunks.length,
      summary,
      tokensSaved: Math.ceil(sizeBytes / 4)
    }, '✅ Large result stored successfully in Redis - context tokens saved!');

    return {
      resultId,
      summary,
      sizeBytes,
      chunkCount: chunks.length
    };
  }

  /**
   * Retrieve a stored result by ID from Redis (multi-pod safe)
   */
  getResult(resultId: string): { result: any; toolName: string; summary: string; timestamp: number } | null {
    // This needs to be async for Redis, but interface is sync for backwards compat
    // Use getResultAsync instead for new code
    this.logger.warn({ resultId }, 'Sync getResult() called — use getResultAsync() for multi-pod');
    return null;
  }

  /**
   * Async version - retrieves from Redis (multi-pod safe)
   */
  async getResultAsync(resultId: string): Promise<{ result: any; toolName: string; summary: string; timestamp: number } | null> {
    if (!this.redis) {
      this.logger.warn({ resultId }, 'Redis not available for result retrieval');
      return null;
    }

    try {
      const key = `${REDIS_KEY_PREFIX}${resultId}`;
      const stored = await this.redis.get<StoredResult>(key);

      if (!stored) {
        this.logger.debug({ resultId }, 'Result not found in Redis');
        return null;
      }

      this.logger.info({
        resultId,
        toolName: stored.toolName,
        summary: stored.summary
      }, '📦 Retrieved stored result from Redis');

      return {
        result: stored.result,
        toolName: stored.toolName,
        summary: stored.summary,
        timestamp: stored.timestamp
      };
    } catch (error) {
      this.logger.error({ error, resultId }, 'Failed to retrieve result from Redis');
      return null;
    }
  }

  /**
   * Check if a result exists in Redis
   */
  async hasResult(resultId: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const key = `${REDIS_KEY_PREFIX}${resultId}`;
      const data = await this.redis.get(key);
      return data !== null;
    } catch {
      return false;
    }
  }

  /**
   * Generate a brief summary of the result
   */
  private generateSummary(toolName: string, result: any): string {
    const toolLower = toolName.toLowerCase();

    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      return `Found ${result.subscriptions.length} subscriptions`;
    }

    if ((toolLower.includes('resource') || toolLower.includes('list')) && Array.isArray(result)) {
      return `Found ${result.length} resources`;
    }

    if (Array.isArray(result)) {
      return `Returned ${result.length} items`;
    }

    if (typeof result === 'object' && result !== null) {
      const keys = Object.keys(result);
      return `Result with ${keys.length} properties: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
    }

    return 'Large result stored';
  }

  /**
   * Break result into semantic chunks for querying
   */
  private chunkResult(
    toolName: string,
    result: any
  ): Array<{ text: string; metadata: Record<string, any> }> {
    const chunks: Array<{ text: string; metadata: Record<string, any> }> = [];

    if (result.subscriptions && Array.isArray(result.subscriptions)) {
      for (const sub of result.subscriptions) {
        const text = `Subscription: ${sub.displayName || sub.name || 'Unknown'} (ID: ${sub.subscriptionId || sub.id})
State: ${sub.state || 'unknown'}`;
        chunks.push({
          text,
          metadata: {
            subscriptionId: sub.subscriptionId || sub.id,
            displayName: sub.displayName || sub.name,
            state: sub.state
          }
        });
      }
      return chunks;
    }

    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) {
        chunks.push({
          text: JSON.stringify(result[i], null, 2),
          metadata: { type: 'array_item', index: i }
        });
      }
      return chunks;
    }

    if (typeof result === 'object' && result !== null) {
      for (const [key, value] of Object.entries(result)) {
        chunks.push({
          text: `${key}: ${JSON.stringify(value, null, 2)}`,
          metadata: { property: key }
        });
      }
    }

    return chunks;
  }

  /**
   * Query stored results from Redis (multi-pod safe)
   */
  async queryStoredResult(params: {
    resultId: string;
    query: string;
    limit?: number;
  }): Promise<Array<{ text: string; score: number; metadata: Record<string, any> }>> {
    const { resultId, query, limit = 10 } = params;

    const stored = await this.getResultFromRedis(resultId);
    if (!stored) {
      throw new Error(`Stored result '${resultId}' not found or has expired (TTL: ${this.TTL_SECONDS / 3600}h). Please re-fetch the data.`);
    }

    this.logger.info({
      resultId,
      query,
      chunkCount: stored.chunks.length
    }, 'Querying stored result from Redis');

    const queryLower = query.toLowerCase();
    const results = stored.chunks
      .map((chunk: any) => ({
        text: chunk.text,
        metadata: chunk.metadata,
        score: this.calculateMatchScore(chunk.text, queryLower)
      }))
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);

    this.logger.info({
      resultId,
      matchCount: results.length,
      topScore: results[0]?.score || 0
    }, 'Query completed from Redis');

    return results;
  }

  private async getResultFromRedis(resultId: string): Promise<StoredResult | null> {
    if (!this.redis) return null;
    try {
      const key = `${REDIS_KEY_PREFIX}${resultId}`;
      return await this.redis.get<StoredResult>(key);
    } catch (error) {
      this.logger.error({ error, resultId }, 'Redis get failed');
      return null;
    }
  }

  private calculateMatchScore(text: string, query: string): number {
    const textLower = text.toLowerCase();
    const keywords = query.split(/\s+/);
    let score = 0;
    for (const keyword of keywords) {
      if (textLower.includes(keyword)) score += 1;
    }
    return score;
  }

  /**
   * Create a compact tool message for stored results
   */
  createStoredResultMessage(params: {
    resultId: string;
    toolName: string;
    summary: string;
    sizeBytes: number;
    chunkCount: number;
  }): string {
    const { resultId, toolName, summary, sizeBytes, chunkCount } = params;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
    const tokensSaved = Math.ceil(sizeBytes / 4);
    const ttlHours = this.TTL_SECONDS / 3600;

    return `📦 **Large result stored in Redis** (${sizeMB}MB / ~${tokensSaved.toLocaleString()} tokens saved from context!)

**Tool**: ${toolName}
**Summary**: ${summary}
**Chunks**: ${chunkCount} semantic chunks available

**How to query this data**:
To search for specific information in this stored result, ask me questions like:
- "Which subscriptions have AKS clusters?"
- "Show me production subscriptions"
- "Find subscriptions in eastus region"

I'll automatically search the stored data semantically instead of re-loading all ${sizeMB}MB into context.

**Result ID**: \`${resultId}\` (auto-expires in ${ttlHours} hours, shared across all pods)`;
  }

  /**
   * Get full result from Redis
   */
  async getFullResult(resultId: string): Promise<any | null> {
    const stored = await this.getResultFromRedis(resultId);
    return stored?.result || null;
  }
}

// =============================================================================
// SINGLETON ACCESSOR
// =============================================================================

import logger from '../utils/logger.js';

let _instance: LargeResultStorageService | null = null;

export function getLargeResultStorageService(): LargeResultStorageService {
  if (!_instance) {
    _instance = new LargeResultStorageService(logger.child({ service: 'LargeResultStorageService' }));
  }
  return _instance;
}

export function setLargeResultStorageServiceInstance(instance: LargeResultStorageService): void {
  _instance = instance;
}
