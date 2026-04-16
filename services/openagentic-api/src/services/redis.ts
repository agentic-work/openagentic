/**
 * Redis Service (DEPRECATED - USE UNIFIED REDIS CLIENT)
 * 
 * This service is deprecated in favor of the unified Redis client.
 * Use getRedisClient() from utils/redis-client.ts instead.
 * 
 * @deprecated Use getRedisClient() from utils/redis-client.ts instead
 */

import { Logger } from 'pino';
import { getRedisClient, initializeRedis } from '../utils/redis-client.js';

export interface RedisService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<void>;
}

class UnifiedRedisServiceWrapper implements RedisService {
  private redisClient = getRedisClient();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'UnifiedRedisWrapper' }) as Logger;
    initializeRedis(this.logger);
  }

  async get(key: string): Promise<string | null> {
    const result = await this.redisClient.get(key);
    return result ? JSON.stringify(result) : null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.redisClient.set(key, JSON.parse(value), ttl);
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.redisClient.exists(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.redisClient.keys(pattern);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redisClient.expire(key, seconds);
  }
}

// In-memory fallback for backwards compatibility
class InMemoryRedisService implements RedisService {
  private store = new Map<string, { value: string; expires?: number }>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'InMemoryRedis' }) as Logger;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    
    if (entry.expires && Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    
    return entry.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const entry: { value: string; expires?: number } = { value };
    if (ttl) {
      entry.expires = Date.now() + ttl * 1000;
    }
    this.store.set(key, entry);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    return Array.from(this.store.keys()).filter(key => key.startsWith(prefix));
  }

  async expire(key: string, seconds: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expires = Date.now() + seconds * 1000;
    }
  }
}

// Create singleton instance
let redisInstance: RedisService | null = null;

export function createRedisService(logger: Logger): RedisService {
  if (!redisInstance) {
    try {
      // Try unified Redis client first
      redisInstance = new UnifiedRedisServiceWrapper(logger);
      logger.info('Redis service initialized (unified client)');
    } catch (error) {
      // Fallback to in-memory
      logger.warn({ error }, 'Failed to connect to Redis, using in-memory fallback');
      redisInstance = new InMemoryRedisService(logger);
    }
  }
  return redisInstance;
}

// Export default instance
export const redis = createRedisService({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  })
} as any);