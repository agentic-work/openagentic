/**
 * Base Repository Pattern with Redis Caching
 * 
 * FIXES ABSTRACTION LAYER ISSUES:
 * - Separates database logic from business logic
 * - Provides consistent caching across all repositories
 * - Makes testing easier with mock repositories
 * - Enables performance monitoring and optimization
 * - Type-safe database operations
 */

import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';

export interface CacheConfig {
  defaultTTL?: number;
  keyPrefix?: string;
  enableCaching?: boolean;
}

export interface QueryOptions {
  cache?: {
    ttl?: number;
    key?: string;
  };
  transaction?: PrismaClient;
}

export interface IRepository<T> {
  findById(id: string, options?: QueryOptions): Promise<T | null>;
  findMany(filter: any, options?: QueryOptions): Promise<T[]>;
  create(data: Partial<T>, options?: QueryOptions): Promise<T>;
  update(id: string, data: Partial<T>, options?: QueryOptions): Promise<T>;
  delete(id: string, options?: QueryOptions): Promise<void>;
  count(filter?: any, options?: QueryOptions): Promise<number>;
}

/**
 * Abstract base repository providing consistent data access patterns
 */
export abstract class BaseRepository<T> implements IRepository<T> {
  protected cache: Redis | null = null;
  protected cacheConfig: Required<CacheConfig>;
  protected logger: any;

  constructor(
    protected prisma: PrismaClient,
    protected modelName: string,
    cacheConfig: CacheConfig = {},
    logger?: Logger
  ) {
    this.cacheConfig = {
      defaultTTL: cacheConfig.defaultTTL || 3600, // 1 hour default
      keyPrefix: cacheConfig.keyPrefix || 'repo',
      enableCaching: cacheConfig.enableCaching !== false
    };

    // Initialize Redis cache if enabled
    if (this.cacheConfig.enableCaching) {
      try {
        const redisHost = process.env.REDIS_HOST || 'redis';
        const redisPort = process.env.REDIS_PORT || '6379';
        const redisUrl = process.env.REDIS_URL || `redis://${redisHost}:${redisPort}`;
        this.cache = new Redis(redisUrl);
        this.cache.on('error', (error: any) => {
          this.logger?.warn?.('Redis cache error', { error, repository: this.modelName });
        });
      } catch (error) {
        this.logger?.warn?.('Failed to initialize Redis cache', { error, repository: this.modelName });
        this.cache = null;
      }
    }

    this.logger = logger || console as any;
  }

  /**
   * Find record by ID with caching support
   */
  async findById(id: string, options: QueryOptions = {}): Promise<T | null> {
    const cacheKey = this.getCacheKey(`${this.modelName}:${id}`);
    const db = options.transaction || this.prisma;

    try {
      // Check cache first (unless in transaction)
      if (this.cacheConfig.enableCaching && !options.transaction) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger?.debug?.('Cache hit', { key: cacheKey, repository: this.modelName });
          return cached as T;
        }
      }

      // Fetch from database
      const result = await (db as any)[this.modelName].findUnique({
        where: { id }
      });

      // Cache result if found
      if (result && this.cacheConfig.enableCaching && !options.transaction) {
        const ttl = options.cache?.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, result, ttl);
        this.logger?.debug?.('Cached result', { key: cacheKey, ttl, repository: this.modelName });
      }

      return result;
    } catch (error) {
      this.logger?.error?.('Failed to find by ID', { 
        id, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Find multiple records with optional caching
   */
  async findMany(filter: any = {}, options: QueryOptions = {}): Promise<T[]> {
    const cacheKey = options.cache?.key || this.getCacheKey(`${this.modelName}:findMany:${this.hashFilter(filter)}`);
    const db = options.transaction || this.prisma;

    try {
      // Check cache first (unless in transaction)
      if (this.cacheConfig.enableCaching && !options.transaction && options.cache) {
        const cached = await this.getFromCache(cacheKey);
        if (cached) {
          this.logger?.debug?.('Cache hit', { key: cacheKey, repository: this.modelName });
          return cached as T[];
        }
      }

      // Fetch from database
      const results = await (db as any)[this.modelName].findMany(filter);

      // Cache results if caching is requested
      if (this.cacheConfig.enableCaching && !options.transaction && options.cache) {
        const ttl = options.cache.ttl || this.cacheConfig.defaultTTL;
        await this.setCache(cacheKey, results, ttl);
        this.logger?.debug?.('Cached results', { 
          key: cacheKey, 
          count: results.length, 
          ttl, 
          repository: this.modelName 
        });
      }

      return results;
    } catch (error) {
      this.logger?.error?.('Failed to find many', { 
        filter, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Create new record with cache invalidation
   */
  async create(data: Partial<T>, options: QueryOptions = {}): Promise<T> {
    const db = options.transaction || this.prisma;

    try {
      const result = await (db as any)[this.modelName].create({ data });

      // Invalidate related caches
      await this.invalidateCache((result as any).id);

      this.logger?.info?.('Created record', { 
        id: (result as any).id, 
        repository: this.modelName 
      });

      return result;
    } catch (error) {
      this.logger?.error?.('Failed to create', { 
        data, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Update record with cache invalidation
   */
  async update(id: string, data: Partial<T>, options: QueryOptions = {}): Promise<T> {
    const db = options.transaction || this.prisma;

    try {
      const result = await (db as any)[this.modelName].update({
        where: { id },
        data
      });

      // Invalidate cache
      await this.invalidateCache(id);

      this.logger?.info?.('Updated record', { 
        id, 
        repository: this.modelName 
      });

      return result;
    } catch (error) {
      this.logger?.error?.('Failed to update', { 
        id, 
        data, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Delete record with cache invalidation
   * Uses soft delete if model supports it (has deleted_at field)
   */
  async delete(id: string, options: QueryOptions = {}): Promise<void> {
    const db = options.transaction || this.prisma;

    try {
      // Check if model supports soft delete by trying to find a deleted_at field
      // We do this by attempting to update deleted_at first
      try {
        await (db as any)[this.modelName].update({
          where: { id },
          data: { deleted_at: new Date() }
        });

        this.logger?.info?.('Soft deleted record', { 
          id, 
          repository: this.modelName 
        });
      } catch (softDeleteError) {
        // If soft delete fails, fall back to hard delete
        // This happens when the model doesn't have a deleted_at field
        this.logger?.debug?.('Soft delete not supported, using hard delete', {
          id,
          repository: this.modelName,
          error: softDeleteError.message
        });

        await (db as any)[this.modelName].delete({ where: { id } });

        this.logger?.info?.('Hard deleted record', { 
          id, 
          repository: this.modelName 
        });
      }

      // Invalidate cache
      await this.invalidateCache(id);

    } catch (error) {
      this.logger?.error?.('Failed to delete', { 
        id, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  /**
   * Count records matching filter
   */
  async count(filter: any = {}, options: QueryOptions = {}): Promise<number> {
    const db = options.transaction || this.prisma;

    try {
      return await (db as any)[this.modelName].count({ where: filter });
    } catch (error) {
      this.logger?.error?.('Failed to count', { 
        filter, 
        error, 
        repository: this.modelName 
      });
      throw error;
    }
  }

  // ===== PROTECTED HELPER METHODS =====

  protected getCacheKey(suffix: string): string {
    return `${this.cacheConfig.keyPrefix}:${suffix}`;
  }

  protected async getFromCache(key: string): Promise<T | T[] | null> {
    if (!this.cache) return null;

    try {
      const cached = await this.cache.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger?.warn?.('Cache get error', { key, error });
      return null;
    }
  }

  protected async setCache(key: string, value: any, ttl: number): Promise<void> {
    if (!this.cache) return;

    try {
      // Use set with EX option instead of deprecated setex
      await this.cache.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      this.logger?.warn?.('Cache set error', { key, error });
    }
  }

  protected async invalidateCache(id?: string): Promise<void> {
    if (!this.cache) return;

    try {
      if (id) {
        // Invalidate specific record cache
        const specificKey = this.getCacheKey(`${this.modelName}:${id}`);
        await this.cache.del(specificKey);
      }

      // Invalidate pattern-based keys for this model
      const pattern = this.getCacheKey(`${this.modelName}:*`);
      const keys = await this.cache.keys(pattern);
      
      if (keys.length > 0) {
        await this.cache.del(...keys);
        this.logger?.debug?.('Invalidated cache keys', { 
          pattern, 
          count: keys.length, 
          repository: this.modelName 
        });
      }
    } catch (error) {
      this.logger?.warn?.('Cache invalidation error', { id, error, repository: this.modelName });
    }
  }

  private hashFilter(filter: any): string {
    // Simple hash for cache key generation
    return Buffer.from(JSON.stringify(filter)).toString('base64').slice(0, 16);
  }

  /**
   * Execute multiple operations in a transaction
   */
  async transaction<R>(
    callback: (repositories: { [key: string]: BaseRepository<any> }) => Promise<R>
  ): Promise<R> {
    return this.prisma.$transaction(async (tx) => {
      // Create new repository instances with transaction client
      const txRepositories: { [key: string]: BaseRepository<any> } = {};
      
      // This would need to be implemented by the repository container
      // For now, return empty object - subclasses can override
      return callback(txRepositories);
    });
  }
}

/**
 * Repository factory for creating type-safe repositories
 */
export class RepositoryFactory {
  constructor(
    private prisma: PrismaClient,
    private cacheConfig: CacheConfig = {},
    private logger?: Logger
  ) {}

  create<T>(modelName: string, repositoryClass?: new (...args: any[]) => BaseRepository<T>): BaseRepository<T> {
    if (repositoryClass) {
      return new repositoryClass(this.prisma, modelName, this.cacheConfig, this.logger);
    }
    
    // Return generic repository
    return new (class extends BaseRepository<T> {})(
      this.prisma, 
      modelName, 
      this.cacheConfig, 
      this.logger
    );
  }
}