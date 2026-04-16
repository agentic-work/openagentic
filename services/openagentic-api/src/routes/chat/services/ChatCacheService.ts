/**
 * Chat Cache Service
 * 
 * Handles caching for improved performance and reduced API calls
 */

import type { Logger } from 'pino';

export class ChatCacheService {
  constructor(
    private redis: any,
    private logger: any
  ) {
    this.logger = logger.child({ service: 'ChatCacheService' }) as Logger;
  }

  /**
   * Get cached data
   */
  async get(key: string): Promise<any | null> {
    try {
      if (!this.redis) {
        this.logger.debug({ key }, 'Redis not available, cache miss');
        return null;
      }
      
      const cached = await this.redis.get(key);
      if (cached) {
        this.logger.debug({ key }, 'Cache hit');
        return JSON.parse(cached);
      }
      
      this.logger.debug({ key }, 'Cache miss');
      return null;
      
    } catch (error) {
      this.logger.error({ 
        key,
        error: error.message 
      }, 'Failed to get from cache');
      
      return null;
    }
  }

  /**
   * Set cached data
   */
  async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    try {
      if (!this.redis) {
        this.logger.debug({ key }, 'Redis not available, skipping cache set');
        return;
      }
      
      // Use set with EX option instead of deprecated setex
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      
      this.logger.debug({ key, ttlSeconds }, 'Cache set');
      
    } catch (error) {
      this.logger.error({ 
        key,
        error: error.message 
      }, 'Failed to set cache');
    }
  }

  /**
   * Delete cached data
   */
  async delete(key: string): Promise<void> {
    try {
      if (!this.redis) {
        this.logger.debug({ key }, 'Redis not available, skipping cache delete');
        return;
      }
      
      await this.redis.del(key);
      
      this.logger.debug({ key }, 'Cache deleted');
      
    } catch (error) {
      this.logger.error({ 
        key,
        error: error.message 
      }, 'Failed to delete from cache');
    }
  }

  /**
   * Cache user prompt template
   */
  async cacheUserPrompt(userId: string, promptTemplate: any, ttlSeconds: number = 1800): Promise<void> {
    const key = `user_prompt:${userId}`;
    await this.set(key, promptTemplate, ttlSeconds);
  }

  /**
   * Get cached user prompt template
   */
  async getCachedUserPrompt(userId: string): Promise<any | null> {
    const key = `user_prompt:${userId}`;
    return await this.get(key);
  }

  /**
   * Cache MCP tools for instance
   */
  async cacheMCPTools(instanceId: string, tools: any[], ttlSeconds: number = 600): Promise<void> {
    const key = `mcp_tools:${instanceId}`;
    await this.set(key, tools, ttlSeconds);
  }

  /**
   * Get cached MCP tools
   */
  async getCachedMCPTools(instanceId: string): Promise<any[] | null> {
    const key = `mcp_tools:${instanceId}`;
    return await this.get(key);
  }

  /**
   * Cache session data
   */
  async cacheSession(sessionId: string, session: any, ttlSeconds: number = 3600): Promise<void> {
    const key = `session:${sessionId}`;
    await this.set(key, session, ttlSeconds);
  }

  /**
   * Get cached session
   */
  async getCachedSession(sessionId: string): Promise<any | null> {
    const key = `session:${sessionId}`;
    return await this.get(key);
  }

  /**
   * Invalidate cached session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await this.delete(key);
  }

  /**
   * Cache rate limit data
   */
  async incrementRateLimit(userId: string, window: 'minute' | 'hour'): Promise<number> {
    try {
      if (!this.redis) {
        this.logger.debug({ userId, window }, 'Redis not available, rate limiting disabled');
        return 0;
      }
      
      const key = `rate_limit:${userId}:${window}`;
      const ttl = window === 'minute' ? 60 : 3600;
      
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttl);
      }
      
      this.logger.debug({ 
        userId, 
        window, 
        count 
      }, 'Rate limit incremented');
      
      return count;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        window,
        error: error.message 
      }, 'Failed to increment rate limit');
      
      return 0;
    }
  }

  /**
   * Get current rate limit count
   */
  async getRateLimitCount(userId: string, window: 'minute' | 'hour'): Promise<number> {
    try {
      if (!this.redis) {
        return 0;
      }
      
      const key = `rate_limit:${userId}:${window}`;
      const count = await this.redis.get(key);
      
      return count ? parseInt(count, 10) : 0;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        window,
        error: error.message 
      }, 'Failed to get rate limit count');
      
      return 0;
    }
  }

  /**
   * Cache completion response for potential reuse
   */
  async cacheCompletion(
    hash: string, 
    response: any, 
    ttlSeconds: number = 300
  ): Promise<void> {
    const key = `completion:${hash}`;
    await this.set(key, response, ttlSeconds);
  }

  /**
   * Get cached completion response
   */
  async getCachedCompletion(hash: string): Promise<any | null> {
    const key = `completion:${hash}`;
    return await this.get(key);
  }

  /**
   * Clear user-specific cache
   */
  async clearUserCache(userId: string): Promise<void> {
    try {
      if (!this.redis) {
        return;
      }
      
      const patterns = [
        `user_prompt:${userId}`,
        `rate_limit:${userId}:*`,
        `session:*` // Could be more specific if we stored user->session mapping
      ];
      
      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
      
      this.logger.info({ userId }, 'User cache cleared');
      
    } catch (error) {
      this.logger.error({ 
        userId,
        error: error.message 
      }, 'Failed to clear user cache');
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<any> {
    try {
      if (!this.redis) {
        return {
          available: false,
          keyCount: 0,
          memoryUsage: 0
        };
      }
      
      const info = await this.redis.info();
      const keyCount = await this.redis.dbsize();
      
      return {
        available: true,
        keyCount,
        info: info
      };
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Failed to get cache stats');
      
      return {
        available: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // SNAPPY UI CACHING - High-impact caching for instant page loads
  // ============================================================================

  /**
   * Cache sidebar session list (lightweight, no messages)
   * This is hit on EVERY page load - keep it fast
   */
  async cacheSidebarSessions(userId: string, sessions: any[], ttlSeconds: number = 300): Promise<void> {
    const key = `sidebar:sessions:${userId}`;
    await this.set(key, sessions, ttlSeconds);
    this.logger.debug({ userId, count: sessions.length }, 'Cached sidebar sessions');
  }

  /**
   * Get cached sidebar sessions - returns instantly if cached
   */
  async getCachedSidebarSessions(userId: string): Promise<any[] | null> {
    const key = `sidebar:sessions:${userId}`;
    return await this.get(key);
  }

  /**
   * Invalidate sidebar cache when sessions change
   */
  async invalidateSidebarSessions(userId: string): Promise<void> {
    const key = `sidebar:sessions:${userId}`;
    await this.delete(key);
    this.logger.debug({ userId }, 'Invalidated sidebar sessions cache');
  }

  /**
   * Cache user profile/permissions for fast auth checks
   * Every API request checks user - this makes it instant
   */
  async cacheUserProfile(userId: string, profile: any, ttlSeconds: number = 1800): Promise<void> {
    const key = `user:profile:${userId}`;
    await this.set(key, profile, ttlSeconds);
  }

  /**
   * Get cached user profile - skips DB on every API call
   */
  async getCachedUserProfile(userId: string): Promise<any | null> {
    const key = `user:profile:${userId}`;
    return await this.get(key);
  }

  /**
   * Invalidate user profile cache on permission changes
   */
  async invalidateUserProfile(userId: string): Promise<void> {
    const key = `user:profile:${userId}`;
    await this.delete(key);
  }

  /**
   * Cache intelligence slider value - checked on every chat request
   */
  async cacheSliderValue(userId: string, value: number, ttlSeconds: number = 3600): Promise<void> {
    const key = `slider:${userId}`;
    await this.set(key, { value, cachedAt: Date.now() }, ttlSeconds);
  }

  /**
   * Get cached slider value - instant slider resolution
   */
  async getCachedSliderValue(userId: string): Promise<number | null> {
    const key = `slider:${userId}`;
    const cached = await this.get(key);
    return cached?.value ?? null;
  }

  /**
   * Track user's last active session for quick resume
   */
  async setLastActiveSession(userId: string, sessionId: string): Promise<void> {
    const key = `user:last_session:${userId}`;
    await this.set(key, { sessionId, timestamp: Date.now() }, 86400); // 24 hours
  }

  /**
   * Get user's last active session for instant resume on app open
   */
  async getLastActiveSession(userId: string): Promise<string | null> {
    const key = `user:last_session:${userId}`;
    const cached = await this.get(key);
    return cached?.sessionId ?? null;
  }

  /**
   * Cache session messages for instant message list render
   * Use shorter TTL since messages change frequently
   */
  async cacheSessionMessages(sessionId: string, messages: any[], ttlSeconds: number = 120): Promise<void> {
    const key = `session:messages:${sessionId}`;
    await this.set(key, messages, ttlSeconds);
  }

  /**
   * Get cached session messages
   */
  async getCachedSessionMessages(sessionId: string): Promise<any[] | null> {
    const key = `session:messages:${sessionId}`;
    return await this.get(key);
  }

  /**
   * Invalidate session messages cache when new message added
   */
  async invalidateSessionMessages(sessionId: string): Promise<void> {
    const key = `session:messages:${sessionId}`;
    await this.delete(key);
  }

  /**
   * Cache global system config (slider default, features, etc.)
   */
  async cacheSystemConfig(config: any, ttlSeconds: number = 300): Promise<void> {
    const key = 'system:config';
    await this.set(key, config, ttlSeconds);
  }

  /**
   * Get cached system config
   */
  async getCachedSystemConfig(): Promise<any | null> {
    const key = 'system:config';
    return await this.get(key);
  }

  /**
   * Health check for cache service
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.redis) {
        return false; // Cache not available but not critical
      }
      
      // Test basic Redis operations
      const testKey = `health_check:${Date.now()}`;
      await this.redis.set(testKey, 'test', 'EX', 5);
      const result = await this.redis.get(testKey);
      await this.redis.del(testKey);
      
      return result === 'test';
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Cache service health check failed');
      
      return false;
    }
  }
}