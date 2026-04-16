import { createClient, RedisClientType } from 'redis';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import { 
  SessionCache, 
  MemoryIndex, 
  ContextCacheEntry, 
  CacheKey, 
  CacheOptions, 
  CacheStats, 
  CacheMetrics 
} from '../types/Cache.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface RedisConfig {
  host: string;
  port: number;
  db?: number;
  password?: string;
  keyPrefix?: string;
  defaultTTL?: number;
  maxRetries?: number;
  retryDelay?: number;
  connectTimeout?: number;
}

export class RedisMemoryCache {
  private client: RedisClientType;
  private config: RedisConfig;
  private metrics: {
    operations: {
      gets: number;
      sets: number;
      deletes: number;
      hits: number;
      misses: number;
    };
    latencies: number[];
  };
  private connected: boolean = false;

  constructor(config: RedisConfig) {
    this.config = {
      keyPrefix: 'memory:',
      defaultTTL: 3600,
      maxRetries: 3,
      retryDelay: 1000,
      connectTimeout: 5000,
      ...config
    };

    this.metrics = {
      operations: {
        gets: 0,
        sets: 0,
        deletes: 0,
        hits: 0,
        misses: 0
      },
      latencies: []
    };

    this.client = createClient({
      socket: {
        host: this.config.host,
        port: this.config.port,
        connectTimeout: this.config.connectTimeout
      },
      database: this.config.db || 0,
      password: this.config.password
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      console.log('Redis client connected');
      this.connected = true;
    });

    this.client.on('error', (err: Error) => {
      console.error('Redis client error:', err);
      this.connected = false;
    });

    this.client.on('end', () => {
      console.log('Redis client disconnected');
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
    }
  }

  private getKey(type: CacheKey['type'], userId: string, identifier: string): string {
    return `${this.config.keyPrefix}${type}:${userId}:${identifier}`;
  }

  private getKeyByPattern(pattern: string): string {
    return `${this.config.keyPrefix}${pattern}`;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    retries: number = this.config.maxRetries!
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const latency = Date.now() - startTime;
        this.trackLatency(latency);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < retries) {
          const delay = this.config.retryDelay! * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  private trackLatency(latency: number): void {
    this.metrics.latencies.push(latency);
    // Keep only last 1000 latencies for memory efficiency
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies = this.metrics.latencies.slice(-1000);
    }
  }

  private async compressData(data: string): Promise<string> {
    try {
      const compressed = await gzipAsync(Buffer.from(data));
      return compressed.toString('base64');
    } catch (error) {
      console.warn('Compression failed, using uncompressed data:', error);
      return data;
    }
  }

  private async decompressData(compressedData: string): Promise<string> {
    try {
      const buffer = Buffer.from(compressedData, 'base64');
      const decompressed = await gunzipAsync(buffer);
      return decompressed.toString();
    } catch (error) {
      console.warn('Decompression failed, treating as uncompressed:', error);
      return compressedData;
    }
  }

  private async setWithOptions(
    key: string, 
    value: string, 
    options: CacheOptions = {}
  ): Promise<void> {
    await this.connect();
    
    const ttl = options.ttl || this.config.defaultTTL!;
    let finalValue = value;

    // Compress if enabled and data is large
    if (options.compress && value.length > 1024) {
      finalValue = await this.compressData(value);
      key = `${key}:compressed`;
    }

    await this.executeWithRetry(async () => {
      await this.client.set(key, finalValue, { EX: ttl });
      this.metrics.operations.sets++;
    });
  }

  private async getWithOptions(
    key: string, 
    options: CacheOptions & { sliding?: boolean } = {}
  ): Promise<string | null> {
    await this.connect();
    
    const result = await this.executeWithRetry<string | null>(async () => {
      this.metrics.operations.gets++;
      
      // Try compressed version first
      const compressedKey = `${key}:compressed`;
      let value = await this.client.get(compressedKey) as string | null;
      let isCompressed = false;
      
      if (value) {
        isCompressed = true;
      } else {
        value = await this.client.get(key) as string | null;
      }

      if (value) {
        this.metrics.operations.hits++;
        
        // Extend TTL if sliding window is enabled
        if (options.sliding && options.ttl) {
          const targetKey = isCompressed ? compressedKey : key;
          await this.client.expire(targetKey, options.ttl);
        }
        
        // Decompress if needed
        if (isCompressed) {
          return await this.decompressData(value);
        }
        
        return value;
      } else {
        this.metrics.operations.misses++;
        return null;
      }
    });

    return result;
  }

  // Session Cache Operations
  async setSessionCache(
    userId: string, 
    sessionId: string, 
    cache: SessionCache, 
    options: CacheOptions = {}
  ): Promise<void> {
    const key = this.getKey('session', userId, sessionId);
    const value = JSON.stringify(cache);
    await this.setWithOptions(key, value, options);
  }

  async getSessionCache(
    userId: string, 
    sessionId: string, 
    options: CacheOptions & { sliding?: boolean } = {}
  ): Promise<SessionCache | null> {
    const key = this.getKey('session', userId, sessionId);
    const value = await this.getWithOptions(key, options);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value) as SessionCache;
    } catch (error) {
      throw new Error(`Failed to parse session cache data: ${error}`);
    }
  }

  // Memory Index Operations
  async setMemoryIndex(
    userId: string, 
    index: MemoryIndex, 
    options: CacheOptions = {}
  ): Promise<void> {
    const key = this.getKey('memory_index', userId, '');
    const value = JSON.stringify(index);
    await this.setWithOptions(key, value, options);
  }

  async getMemoryIndex(
    userId: string, 
    options: CacheOptions & { sliding?: boolean } = {}
  ): Promise<MemoryIndex | null> {
    const key = this.getKey('memory_index', userId, '');
    const value = await this.getWithOptions(key, options);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value) as MemoryIndex;
    } catch (error) {
      throw new Error(`Failed to parse memory index data: ${error}`);
    }
  }

  // Context Cache Operations
  async setContextCache(
    contextKey: string, 
    entry: ContextCacheEntry, 
    options: CacheOptions = {}
  ): Promise<void> {
    const key = this.getKeyByPattern(`context:${contextKey}`);
    const value = JSON.stringify(entry);
    await this.setWithOptions(key, value, options);
  }

  async getContextCache(
    contextKey: string, 
    trackHit: boolean = false,
    options: CacheOptions & { sliding?: boolean } = {}
  ): Promise<ContextCacheEntry | null> {
    const key = this.getKeyByPattern(`context:${contextKey}`);
    const value = await this.getWithOptions(key, options);
    
    if (!value) return null;
    
    try {
      const entry = JSON.parse(value) as ContextCacheEntry;
      
      // Track hit count if requested
      if (trackHit) {
        entry.hitCount++;
        entry.lastAccessed = Date.now();
        // Update the cache with new hit count
        await this.setContextCache(contextKey, entry, options);
      }
      
      return entry;
    } catch (error) {
      throw new Error(`Failed to parse context cache data: ${error}`);
    }
  }

  // Batch Operations
  async batchGet(keys: string[]): Promise<Record<string, string | null>> {
    await this.connect();
    
    const prefixedKeys = keys.map(key => `${this.config.keyPrefix}${key}`);
    
    const values = await this.executeWithRetry<(string | null)[]>(async () => {
      this.metrics.operations.gets += keys.length;
      return await this.client.mGet(prefixedKeys) as (string | null)[];
    });

    const result: Record<string, string | null> = {};
    keys.forEach((key, index) => {
      result[key] = values[index];
      if (values[index]) {
        this.metrics.operations.hits++;
      } else {
        this.metrics.operations.misses++;
      }
    });

    return result;
  }

  async batchSet(
    data: Record<string, string>, 
    options: CacheOptions = {}
  ): Promise<void> {
    await this.connect();
    
    const ttl = options.ttl || this.config.defaultTTL!;
    
    await this.executeWithRetry(async () => {
      const promises = [];
      
      for (const [key, value] of Object.entries(data)) {
        const prefixedKey = `${this.config.keyPrefix}${key}`;
        promises.push(this.client.set(prefixedKey, value, { EX: ttl }));
        this.metrics.operations.sets++;
      }
      
      await Promise.all(promises);
    });
  }

  // Cache Invalidation
  async invalidateByPattern(pattern: string): Promise<number> {
    await this.connect();
    
    return await this.executeWithRetry(async () => {
      const keys = await this.client.keys(pattern);
      if (keys.length === 0) return 0;
      
      const deletedCount = await this.client.del(keys);
      this.metrics.operations.deletes += keys.length;
      return deletedCount;
    });
  }

  async invalidateUserCache(userId: string): Promise<number> {
    const pattern = this.getKeyByPattern(`*:${userId}*`);
    return await this.invalidateByPattern(pattern);
  }

  async delete(key: string): Promise<boolean> {
    await this.connect();
    
    return await this.executeWithRetry(async () => {
      const prefixedKey = `${this.config.keyPrefix}${key}`;
      const result = await this.client.del(prefixedKey);
      this.metrics.operations.deletes++;
      return result > 0;
    });
  }

  // Statistics and Monitoring
  async getStats(): Promise<CacheStats> {
    await this.connect();
    
    const info = await this.client.info('stats');
    const dbsize = await this.client.dbSize();
    
    // Parse Redis info for hit/miss statistics
    const stats = info.split('\r\n').reduce((acc: Record<string, string>, line: string) => {
      const [key, value] = line.split(':');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);

    const hits = parseInt(stats.keyspace_hits || '0');
    const misses = parseInt(stats.keyspace_misses || '0');
    const total = hits + misses;
    
    return {
      hitRate: total > 0 ? hits / total : 0,
      missRate: total > 0 ? misses / total : 0,
      evictionRate: 0, // Would need additional Redis configuration to track
      averageLatency: this.calculateAverageLatency(),
      memoryUsage: parseInt(stats.used_memory || '0'),
      keyCount: dbsize,
      lastUpdated: Date.now()
    };
  }

  async getMetrics(): Promise<CacheMetrics> {
    const latencies = this.metrics.latencies;
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    return {
      operations: { ...this.metrics.operations },
      performance: {
        averageLatency: this.calculateAverageLatency(),
        p95Latency: sortedLatencies[p95Index] || 0,
        p99Latency: sortedLatencies[p99Index] || 0
      },
      memory: {
        used: 0, // Would need Redis memory info
        available: 0, // Would need system memory info
        evictions: 0 // Would need Redis eviction stats
      },
      byType: {
        session: { count: 0, hitRate: 0, averageSize: 0 },
        memory_index: { count: 0, hitRate: 0, averageSize: 0 },
        context: { count: 0, hitRate: 0, averageSize: 0 },
        embedding: { count: 0, hitRate: 0, averageSize: 0 },
        summary: { count: 0, hitRate: 0, averageSize: 0 }
      }
    };
  }

  private calculateAverageLatency(): number {
    if (this.metrics.latencies.length === 0) return 0;
    const sum = this.metrics.latencies.reduce((acc, latency) => acc + latency, 0);
    return sum / this.metrics.latencies.length;
  }

  // Health Check
  async ping(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  // Get connection status
  isConnected(): boolean {
    return this.connected;
  }

  // Memory cleanup
  async cleanup(): Promise<void> {
    // Clear old latency data
    this.metrics.latencies = [];
    
    // Reset operation counters (optional)
    this.metrics.operations = {
      gets: 0,
      sets: 0,
      deletes: 0,
      hits: 0,
      misses: 0
    };
  }
}