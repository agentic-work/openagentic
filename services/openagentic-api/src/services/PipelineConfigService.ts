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

import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import {
  PipelineConfiguration,
  getDefaultPipelineConfiguration,
  validatePipelineConfiguration
} from '../routes/chat/pipeline/pipeline-config.schema.js';

const SYSTEM_CONFIG_KEY = 'pipeline_configuration';
const CACHE_KEY = 'config:pipeline';
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Minimal Redis interface for pipeline config caching
 * Compatible with both ioredis Redis and UnifiedRedisClient
 */
interface RedisLike {
  get<T = any>(key: string): Promise<T | string | null>;
  set(key: string, value: any, ttl?: number): Promise<any>;
  del(key: string): Promise<any>;
}

export class PipelineConfigService {
  private logger: pino.Logger;
  private prisma: PrismaClient;
  private redis: RedisLike | null;
  private cachedConfig: PipelineConfiguration | null = null;
  private cacheTimestamp: number = 0;
  private readonly IN_MEMORY_CACHE_TTL_MS = 60000; // 1 minute in-memory cache

  constructor(prisma: PrismaClient, redis?: RedisLike | null) {
    this.logger = pino({ name: 'PipelineConfigService' });
    this.prisma = prisma;
    this.redis = redis || null;
  }

  /**
   * Get the current pipeline configuration
   * Uses multi-level caching: in-memory -> Redis -> database
   */
  async getConfiguration(): Promise<PipelineConfiguration> {
    // 1. Check in-memory cache
    if (this.cachedConfig && Date.now() - this.cacheTimestamp < this.IN_MEMORY_CACHE_TTL_MS) {
      return this.cachedConfig;
    }

    // 2. Try Redis cache
    if (this.redis) {
      try {
        const cached = await this.redis.get<PipelineConfiguration>(CACHE_KEY);
        if (cached) {
          // Handle both pre-parsed objects (UnifiedRedisClient) and raw strings (ioredis)
          const config = typeof cached === 'string'
            ? JSON.parse(cached) as PipelineConfiguration
            : cached;
          this.cachedConfig = config;
          this.cacheTimestamp = Date.now();
          return config;
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to read pipeline config from Redis');
      }
    }

    // 3. Load from database
    const config = await this.loadFromDatabase();

    // Cache it
    await this.cacheConfig(config);

    return config;
  }

  /**
   * Update pipeline configuration
   */
  async updateConfiguration(
    updates: Partial<PipelineConfiguration>,
    updatedBy: string
  ): Promise<PipelineConfiguration> {
    // Get current config
    const current = await this.getConfiguration();

    // Deep merge updates
    const merged = this.deepMerge(current, updates) as PipelineConfiguration;
    merged.updatedAt = new Date().toISOString();
    merged.updatedBy = updatedBy;

    // Validate
    const errors = validatePipelineConfiguration(merged);
    if (errors.length > 0) {
      throw new Error(`Invalid configuration: ${errors.join(', ')}`);
    }

    // Save to database
    await this.saveToDatabase(merged);

    // Invalidate caches
    await this.invalidateCache();

    // Update in-memory cache
    this.cachedConfig = merged;
    this.cacheTimestamp = Date.now();

    this.logger.info({
      updatedBy,
      version: merged.version
    }, 'Pipeline configuration updated');

    return merged;
  }

  /**
   * Update a specific stage configuration
   */
  async updateStageConfig<K extends keyof PipelineConfiguration['stages']>(
    stageName: K,
    stageConfig: Partial<PipelineConfiguration['stages'][K]>,
    updatedBy: string
  ): Promise<PipelineConfiguration> {
    const current = await this.getConfiguration();

    const updates: Partial<PipelineConfiguration> = {
      stages: {
        ...current.stages,
        [stageName]: {
          ...current.stages[stageName],
          ...stageConfig
        }
      }
    };

    return this.updateConfiguration(updates, updatedBy);
  }

  /**
   * Reset configuration to defaults
   */
  async resetToDefaults(updatedBy: string): Promise<PipelineConfiguration> {
    const defaults = getDefaultPipelineConfiguration();
    defaults.updatedBy = updatedBy;

    await this.saveToDatabase(defaults);
    await this.invalidateCache();

    this.cachedConfig = defaults;
    this.cacheTimestamp = Date.now();

    this.logger.info({ updatedBy }, 'Pipeline configuration reset to defaults');

    return defaults;
  }

  /**
   * Get a specific value from the configuration
   */
  async getValue<T>(path: string): Promise<T | undefined> {
    const config = await this.getConfiguration();
    return this.getNestedValue(config, path) as T | undefined;
  }

  /**
   * Load configuration from database
   */
  private async loadFromDatabase(): Promise<PipelineConfiguration> {
    try {
      const record = await this.prisma.systemConfiguration.findUnique({
        where: { key: SYSTEM_CONFIG_KEY }
      });

      if (record?.value) {
        const stored = typeof record.value === 'string'
          ? JSON.parse(record.value)
          : record.value;

        // Merge with defaults to ensure all fields exist
        const defaults = getDefaultPipelineConfiguration();
        return this.deepMerge(defaults, stored) as PipelineConfiguration;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to load pipeline config from database, using defaults');
    }

    return getDefaultPipelineConfiguration();
  }

  /**
   * Save configuration to database
   * Note: updatedBy is stored in the JSON value, not as a separate column
   */
  private async saveToDatabase(config: PipelineConfiguration): Promise<void> {
    await this.prisma.systemConfiguration.upsert({
      where: { key: SYSTEM_CONFIG_KEY },
      create: {
        key: SYSTEM_CONFIG_KEY,
        value: config as any,
        description: 'Chat pipeline stage configuration'
      },
      update: {
        value: config as any
      }
    });
  }

  /**
   * Cache configuration in Redis
   */
  private async cacheConfig(config: PipelineConfiguration): Promise<void> {
    this.cachedConfig = config;
    this.cacheTimestamp = Date.now();

    if (this.redis) {
      try {
        // Use set with TTL (compatible with both ioredis and UnifiedRedisClient)
        await this.redis.set(CACHE_KEY, config, CACHE_TTL_SECONDS);
      } catch (error) {
        this.logger.warn({ error }, 'Failed to cache pipeline config in Redis');
      }
    }
  }

  /**
   * Invalidate all caches
   */
  private async invalidateCache(): Promise<void> {
    this.cachedConfig = null;
    this.cacheTimestamp = 0;

    if (this.redis) {
      try {
        await this.redis.del(CACHE_KEY);
      } catch (error) {
        this.logger.warn({ error }, 'Failed to invalidate Redis cache');
      }
    }
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

// Singleton instance
let instance: PipelineConfigService | null = null;

export function getPipelineConfigService(prisma: PrismaClient, redis?: RedisLike | null): PipelineConfigService {
  if (!instance) {
    instance = new PipelineConfigService(prisma, redis);
  }
  return instance;
}

export function resetPipelineConfigServiceInstance(): void {
  instance = null;
}
