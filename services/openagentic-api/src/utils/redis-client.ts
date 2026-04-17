/**
 * Unified Redis Client Singleton
 * 
 * Single Redis connection shared across all services to prevent
 * connection pool exhaustion and resource contention.
 * 
 * Features:
 * - Connection pooling and health monitoring
 * - Graceful degradation when Redis unavailable  
 * - Comprehensive error handling and logging
 * - TTL management and JSON serialization
 */

import { createClient, RedisClientType } from 'redis';
import type { Logger } from 'pino';

export interface RedisClientConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  defaultTTL?: number;
  maxRetries?: number;
  retryDelay?: number;
  connectTimeout?: number;
}

class UnifiedRedisClient {
  private client: RedisClientType | null = null;
  private logger: Logger | null = null;
  private connected = false;
  private connecting = false;
  private config: RedisClientConfig;
  private readonly defaultTTL: number;

  constructor() {
    this.config = {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST || 'openagentic-redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      db: 0,
      keyPrefix: 'openagentic:',
      defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '3600'),
      maxRetries: 50,
      retryDelay: 2000,
      connectTimeout: 10000
    };
    this.defaultTTL = this.config.defaultTTL!;
  }

  async initialize(logger: Logger): Promise<void> {
    if (this.connecting || this.connected) {
      return;
    }

    this.logger = logger;
    this.connecting = true;

    try {
      const connectionUrl = this.config.url || 
        `redis://${this.config.password ? `:${this.config.password}@` : ''}${this.config.host}:${this.config.port}/${this.config.db}`;

      this.logger.debug(`Initializing Redis client: ${connectionUrl.replace(/:[^@]*@/, ':***@')}`);

      this.client = createClient({
        url: connectionUrl,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > this.config.maxRetries!) {
              this.logger?.error(`Redis reconnection failed after ${retries} attempts`);
              return false;
            }
            const delay = Math.min(retries * this.config.retryDelay!, 5000);
            this.logger?.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
          },
          connectTimeout: this.config.connectTimeout
        }
      });

      // Event handlers
      this.client.on('error', (err: Error) => {
        this.logger?.error({ err }, 'Redis client error');
        this.connected = false;
      });

      this.client.on('connect', () => {
        this.logger?.info('Redis client connected successfully');
        this.connected = true;
      });

      this.client.on('disconnect', () => {
        this.logger?.warn('Redis client disconnected');
        this.connected = false;
      });

      this.client.on('reconnecting', () => {
        this.logger?.info('Redis client reconnecting...');
        this.connected = false;
      });

      await this.client.connect();
      this.connecting = false;
      this.connected = true;  // Set connected after successful connect

    } catch (error) {
      this.connecting = false;
      this.logger?.warn({ err: error }, 'Failed to initialize Redis client - operating without cache');
      this.client = null;
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (!this.isConnected()) return null;

    try {
      const fullKey = `${this.config.keyPrefix}${key}`;
      const value = await this.client!.get(fullKey);
      if (!value) return null;
      
      return JSON.parse(value as string) as T;
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis GET error');
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!this.isConnected()) return false;

    try {
      const fullKey = `${this.config.keyPrefix}${key}`;
      const serialized = JSON.stringify(value);
      await this.client!.setEx(fullKey, ttlSeconds || this.defaultTTL, serialized);
      return true;
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis SET error');
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isConnected()) return false;

    try {
      const fullKey = `${this.config.keyPrefix}${key}`;
      await this.client!.del(fullKey);
      return true;
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis DEL error');
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isConnected()) return false;

    try {
      const fullKey = `${this.config.keyPrefix}${key}`;
      const result = await this.client!.exists(fullKey);
      return result === 1;
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis EXISTS error');
      return false;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    if (!this.isConnected()) return [];

    try {
      const fullPattern = `${this.config.keyPrefix}${pattern}`;
      const keys = await this.client!.keys(fullPattern);
      // Remove prefix from returned keys
      return keys.map(key => key.substring(this.config.keyPrefix!.length));
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis KEYS error');
      return [];
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.isConnected()) return false;

    try {
      const fullKey = `${this.config.keyPrefix}${key}`;
      await this.client!.expire(fullKey, seconds);
      return true;
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis EXPIRE error');
      return false;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected()) return false;

    try {
      const result = await this.client!.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger?.error({ err: error }, 'Redis PING error');
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger?.info('Redis client disconnected gracefully');
      } catch (error) {
        this.logger?.warn({ err: error }, 'Error during Redis disconnect');
      } finally {
        this.client = null;
        this.connected = false;
      }
    }
  }

  // High-level caching methods
  async cacheSession(sessionId: string, userId: string, data: any): Promise<boolean> {
    return this.set(`session:${userId}:${sessionId}`, data, 7200); // 2 hours
  }

  async getCachedSession(sessionId: string, userId: string): Promise<any> {
    return this.get(`session:${userId}:${sessionId}`);
  }

  async cacheModelResponse(promptHash: string, response: any): Promise<boolean> {
    return this.set(`model:${promptHash}`, response, 1800); // 30 minutes
  }

  async getCachedModelResponse(promptHash: string): Promise<any> {
    return this.get(`model:${promptHash}`);
  }

  async cacheUserData(userId: string, data: any): Promise<boolean> {
    return this.set(`user:${userId}`, data, 1800); // 30 minutes
  }

  async getCachedUserData(userId: string): Promise<any> {
    return this.get(`user:${userId}`);
  }

  async cacheMCPResult(toolName: string, userId: string, argsHash: string, result: any): Promise<boolean> {
    return this.set(`mcp:${toolName}:${userId}:${argsHash}`, result, 600); // 10 minutes
  }

  async getCachedMCPResult(toolName: string, userId: string, argsHash: string): Promise<any> {
    return this.get(`mcp:${toolName}:${userId}:${argsHash}`);
  }

  /**
   * Acquire a distributed lock using SETNX (SET if Not eXists)
   * This is atomic and safe for multiple concurrent processes
   *
   * @param lockKey - The key name for the lock
   * @param lockValue - A unique value to identify the lock holder (e.g., instance ID)
   * @param ttlSeconds - Time-to-live for the lock (auto-release safety)
   * @returns true if lock was acquired, false if already held by another process
   */
  async acquireLock(lockKey: string, lockValue: string, ttlSeconds: number = 300): Promise<boolean> {
    if (!this.isConnected()) {
      this.logger?.warn('Redis not connected - allowing operation without lock (single instance mode)');
      return true; // Allow operation if Redis is down
    }

    try {
      const fullKey = `${this.config.keyPrefix}lock:${lockKey}`;
      // NX = only set if not exists, EX = set expiration
      const result = await this.client!.set(fullKey, lockValue, {
        NX: true,
        EX: ttlSeconds
      });
      const acquired = result === 'OK';

      this.logger?.info({
        lockKey,
        acquired,
        ttlSeconds,
        lockHolder: lockValue
      }, `[DISTRIBUTED-LOCK] Lock ${acquired ? 'acquired' : 'already held'}`);

      return acquired;
    } catch (error) {
      this.logger?.error({ err: error, lockKey }, 'Redis SETNX (lock acquisition) error');
      return true; // Allow operation on error (fail-open for availability)
    }
  }

  /**
   * Release a distributed lock (only if we hold it)
   * Uses Lua script for atomic check-and-delete
   *
   * @param lockKey - The key name for the lock
   * @param lockValue - The value that was used to acquire the lock
   * @returns true if lock was released, false if not held by us
   */
  async releaseLock(lockKey: string, lockValue: string): Promise<boolean> {
    if (!this.isConnected()) return true;

    try {
      const fullKey = `${this.config.keyPrefix}lock:${lockKey}`;

      // Lua script for atomic check-and-delete
      // Only delete if the value matches (we hold the lock)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.client!.eval(script, {
        keys: [fullKey],
        arguments: [lockValue]
      });

      const released = result === 1;
      this.logger?.info({
        lockKey,
        released,
        lockHolder: lockValue
      }, `[DISTRIBUTED-LOCK] Lock ${released ? 'released' : 'not held by us'}`);

      return released;
    } catch (error) {
      this.logger?.error({ err: error, lockKey }, 'Redis lock release error');
      return false;
    }
  }

  /**
   * Get the current holder of a lock
   *
   * @param lockKey - The key name for the lock
   * @returns The lock holder value, or null if not locked
   */
  async getLockHolder(lockKey: string): Promise<string | null> {
    if (!this.isConnected()) return null;

    try {
      const fullKey = `${this.config.keyPrefix}lock:${lockKey}`;
      return await this.client!.get(fullKey);
    } catch (error) {
      this.logger?.error({ err: error, lockKey }, 'Redis get lock holder error');
      return null;
    }
  }

  /**
   * Extend the TTL of a lock we hold
   *
   * @param lockKey - The key name for the lock
   * @param lockValue - The value that was used to acquire the lock
   * @param ttlSeconds - New TTL to set
   * @returns true if extended, false if not held by us
   */
  async extendLock(lockKey: string, lockValue: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isConnected()) return true;

    try {
      const fullKey = `${this.config.keyPrefix}lock:${lockKey}`;

      // Lua script for atomic check-and-expire
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.client!.eval(script, {
        keys: [fullKey],
        arguments: [lockValue, ttlSeconds.toString()]
      });

      return result === 1;
    } catch (error) {
      this.logger?.error({ err: error, lockKey }, 'Redis extend lock error');
      return false;
    }
  }

  /**
   * Publish a message to a Redis pub/sub channel
   */
  async publish(channel: string, message: string): Promise<number> {
    if (!this.client || !this.connected) return 0;
    try {
      return await this.client.publish(channel, message);
    } catch (error) {
      this.logger?.error({ err: error, channel }, 'Redis publish error');
      return 0;
    }
  }

  /**
   * Create a duplicate client for pub/sub subscriptions.
   * Subscribed clients can't run other commands, so we need a separate connection.
   */
  async duplicate(): Promise<RedisClientType> {
    const connectionUrl = this.config.url ||
      `redis://${this.config.password ? `:${this.config.password}@` : ''}${this.config.host}:${this.config.port}/${this.config.db}`;
    const subscriber = createClient({ url: connectionUrl });
    await subscriber.connect();
    return subscriber as RedisClientType;
  }

  /**
   * Subscribe to a Redis pub/sub channel (creates a duplicate connection internally)
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    try {
      const subscriber = await this.duplicate();
      await subscriber.subscribe(channel, (message: string) => {
        callback(message);
      });
      this.logger?.info({ channel }, 'Redis subscribed to channel');
    } catch (error) {
      this.logger?.error({ err: error, channel }, 'Redis subscribe error');
      throw error;
    }
  }
}

// Singleton instance
const unifiedRedisClient = new UnifiedRedisClient();

// Export singleton and factory function
export { unifiedRedisClient };

// Export the type for type annotations
export type { UnifiedRedisClient };

export function getRedisClient(): UnifiedRedisClient {
  return unifiedRedisClient;
}

export async function initializeRedis(logger: Logger): Promise<UnifiedRedisClient> {
  await unifiedRedisClient.initialize(logger);
  return unifiedRedisClient;
}