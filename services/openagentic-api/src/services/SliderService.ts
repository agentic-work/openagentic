/**
 * SliderService - Manages intelligence slider for cost/quality tradeoff
 *
 * The slider (0-100) controls:
 * - Model selection preferences (cheaper vs more capable)
 * - Thinking/reasoning budget allocation
 * - Cascading/retry strategies
 *
 * Resolution order: Per-user → Global → Default (50)
 */

import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { ModelConfigurationService } from './ModelConfigurationService.js';
import { getRedisClient } from '../utils/redis-client.js';

// Slider configuration derived from position
export interface SliderConfig {
  position: number;           // 0-100
  costWeight: number;         // Derived: 1 - (position/100) - higher = prefer cheaper
  qualityWeight: number;      // Derived: position/100 - higher = prefer quality
  enableThinking: boolean;    // position > 40
  enableCascading: boolean;   // position > 60
  maxThinkingBudget: number;  // Derived from position
  source: 'user' | 'global' | 'default' | 'budget-auto-adjust';
}

// Global slider storage format in SystemConfiguration
interface GlobalSliderValue {
  value: number;
  setBy: string;
  setAt: string;
}

const GLOBAL_SLIDER_KEY = 'global_intelligence_slider';
// Default to ECONOMICAL mode (30) to use cheaper models for simple queries
// Can be overridden via DEFAULT_SLIDER_POSITION env var
// Slider modes: 0-40 = ECONOMICAL (Haiku), 41-60 = BALANCED, 61-100 = PREMIUM (Sonnet/Opus)
const DEFAULT_SLIDER_POSITION = Number.parseInt(process.env.DEFAULT_SLIDER_POSITION || '30', 10);

// Cache for slider configs
interface CachedSlider {
  config: SliderConfig;
  expiresAt: number;
}

export class SliderService {
  private prisma: PrismaClient;
  private logger: pino.Logger;
  // Static caches shared across all SliderService instances
  // This is critical because admin-slider.ts and auth.stage.ts create separate instances
  private static cache: Map<string, CachedSlider> = new Map();
  private static globalCache: CachedSlider | null = null;
  private cacheTtlMs = 60_000; // 1 minute cache

  constructor(prisma: PrismaClient, logger: pino.Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ service: 'SliderService' });
  }

  /**
   * Derive full slider configuration from position value
   */
  private deriveConfig(position: number, source: 'user' | 'global' | 'default' | 'budget-auto-adjust'): SliderConfig {
    // Clamp position to 0-100
    const clampedPosition = Math.max(0, Math.min(100, position));

    return {
      position: clampedPosition,
      costWeight: 1 - (clampedPosition / 100),
      qualityWeight: clampedPosition / 100,
      enableThinking: true, // Always enable thinking — models that support it should use it
      enableCascading: clampedPosition > 60,
      maxThinkingBudget: this.calculateThinkingBudget(clampedPosition),
      source,
    };
  }

  /**
   * Calculate thinking budget based on slider position
   * Position 0-40: 4000 tokens (basic thinking — always available)
   * Position 41-60: 4000-8000 tokens (moderate thinking)
   * Position 61-100: 8000-32000 tokens (extended thinking)
   */
  private calculateThinkingBudget(position: number): number {
    if (position <= 40) return 4000; // Minimum budget so thinking always works
    if (position <= 60) {
      // Linear scale from 4000 to 8000
      return Math.floor(4000 + ((position - 40) / 20) * 4000);
    }
    // Linear scale from 8000 to 32000
    return Math.floor(8000 + ((position - 60) / 40) * 24000);
  }

  /**
   * Get slider configuration for a user
   * Resolution: Per-user → Global → Default
   */
  async getSliderConfig(userId: string): Promise<SliderConfig> {
    // Check user cache
    const cacheKey = `user:${userId}`;
    const cached = SliderService.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.config;
    }

    try {
      // 1. Check for user-specific slider
      const userPerms = await this.prisma.userPermissions.findUnique({
        where: { user_id: userId },
        select: { intelligence_slider: true },
      });

      if (userPerms?.intelligence_slider !== null && userPerms?.intelligence_slider !== undefined) {
        const config = this.deriveConfig(userPerms.intelligence_slider, 'user');
        SliderService.cache.set(cacheKey, { config, expiresAt: Date.now() + this.cacheTtlMs });

        this.logger.debug({
          userId,
          position: config.position,
          source: 'user',
        }, 'Resolved user-specific slider');

        return config;
      }

      // 2. Check for global slider
      const globalPosition = await this.getGlobalSlider();
      if (globalPosition !== null) {
        const config = this.deriveConfig(globalPosition, 'global');
        SliderService.cache.set(cacheKey, { config, expiresAt: Date.now() + this.cacheTtlMs });

        this.logger.debug({
          userId,
          position: config.position,
          source: 'global',
        }, 'Resolved global slider');

        return config;
      }

      // 3. Auto-configure based on available models (if only one model, use its optimal position)
      let defaultPosition = DEFAULT_SLIDER_POSITION;
      try {
        const modelConfig = await ModelConfigurationService.getConfig();
        if (modelConfig.sliderConfig.autoConfigured) {
          defaultPosition = modelConfig.sliderConfig.defaultPosition;
          this.logger.debug({
            userId,
            position: defaultPosition,
            autoConfigured: true,
            modelCount: modelConfig.availableModels.length,
            defaultModel: modelConfig.defaultModel.modelId,
          }, 'Using auto-configured slider based on model configuration');
        }
      } catch (error) {
        this.logger.warn({ error }, 'Failed to get model config for slider auto-configuration, using default');
      }

      const config = this.deriveConfig(defaultPosition, 'default');
      SliderService.cache.set(cacheKey, { config, expiresAt: Date.now() + this.cacheTtlMs });

      this.logger.debug({
        userId,
        position: config.position,
        source: 'default',
      }, 'Using default slider');

      return config;

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get slider config, using default');
      return this.deriveConfig(DEFAULT_SLIDER_POSITION, 'default');
    }
  }

  /**
   * Get the global slider value
   * Returns null if not set
   */
  async getGlobalSlider(): Promise<number | null> {
    // Check cache
    if (SliderService.globalCache && SliderService.globalCache.expiresAt > Date.now()) {
      return SliderService.globalCache.config.position;
    }

    try {
      const config = await this.prisma.systemConfiguration.findUnique({
        where: { key: GLOBAL_SLIDER_KEY },
      });

      if (config?.value) {
        const sliderValue = config.value as unknown as GlobalSliderValue;
        if (typeof sliderValue.value === 'number') {
          const derivedConfig = this.deriveConfig(sliderValue.value, 'global');
          SliderService.globalCache = {
            config: derivedConfig,
            expiresAt: Date.now() + this.cacheTtlMs,
          };
          return sliderValue.value;
        }
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get global slider');
      return null;
    }
  }

  /**
   * Get global slider with metadata (for admin API)
   */
  async getGlobalSliderWithMeta(): Promise<GlobalSliderValue | null> {
    try {
      const config = await this.prisma.systemConfiguration.findUnique({
        where: { key: GLOBAL_SLIDER_KEY },
      });

      if (config?.value) {
        return config.value as unknown as GlobalSliderValue;
      }

      return null;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get global slider metadata');
      return null;
    }
  }

  /**
   * Set the global slider (admin only)
   */
  async setGlobalSlider(value: number, adminId: string): Promise<void> {
    const clampedValue = Math.max(0, Math.min(100, value));

    const sliderData: GlobalSliderValue = {
      value: clampedValue,
      setBy: adminId,
      setAt: new Date().toISOString(),
    };

    await this.prisma.systemConfiguration.upsert({
      where: { key: GLOBAL_SLIDER_KEY },
      create: {
        key: GLOBAL_SLIDER_KEY,
        value: sliderData as any,
        description: 'Global intelligence slider (0-100) for cost/quality tradeoff',
        is_active: true,
      },
      update: {
        value: sliderData as any,
        updated_at: new Date(),
      },
    });

    // Invalidate static caches (shared across all SliderService instances)
    SliderService.globalCache = null;
    SliderService.cache.clear(); // Clear all user caches since global changed

    // Also clear Redis slider caches so all future requests get fresh values
    try {
      const redis = getRedisClient();
      if (redis.isConnected()) {
        const sliderKeys = await redis.keys('slider:config:*');
        for (const key of sliderKeys) {
          await redis.del(key);
        }
        this.logger.info({ keysCleared: sliderKeys.length }, 'Cleared Redis slider caches');
      }
    } catch (redisError) {
      this.logger.warn({ error: redisError }, 'Failed to clear Redis slider caches (non-fatal)');
    }

    this.logger.info({
      value: clampedValue,
      adminId,
    }, 'Global slider updated');
  }

  /**
   * Set user-specific slider (admin only)
   */
  async setUserSlider(userId: string, value: number, adminId: string): Promise<void> {
    const clampedValue = Math.max(0, Math.min(100, value));

    // Upsert user permissions with slider
    await this.prisma.userPermissions.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        intelligence_slider: clampedValue,
        slider_set_by: adminId,
        slider_set_at: new Date(),
        created_by: adminId,
      },
      update: {
        intelligence_slider: clampedValue,
        slider_set_by: adminId,
        slider_set_at: new Date(),
        updated_by: adminId,
      },
    });

    // Invalidate user cache
    SliderService.cache.delete(`user:${userId}`);

    this.logger.info({
      userId,
      value: clampedValue,
      adminId,
    }, 'User slider updated');
  }

  /**
   * Clear user-specific slider (use global/default instead)
   */
  async clearUserSlider(userId: string, adminId: string): Promise<void> {
    await this.prisma.userPermissions.updateMany({
      where: { user_id: userId },
      data: {
        intelligence_slider: null,
        slider_set_by: adminId,
        slider_set_at: new Date(),
        updated_by: adminId,
      },
    });

    // Invalidate user cache
    SliderService.cache.delete(`user:${userId}`);

    this.logger.info({
      userId,
      adminId,
    }, 'User slider cleared');
  }

  /**
   * Get user's raw slider value (for admin viewing their own slider)
   */
  async getUserSliderValue(userId: string): Promise<{ value: number | null; source: 'user' | 'global' | 'default' }> {
    try {
      const userPerms = await this.prisma.userPermissions.findUnique({
        where: { user_id: userId },
        select: { intelligence_slider: true },
      });

      if (userPerms?.intelligence_slider !== null && userPerms?.intelligence_slider !== undefined) {
        return { value: userPerms.intelligence_slider, source: 'user' };
      }

      const globalValue = await this.getGlobalSlider();
      if (globalValue !== null) {
        return { value: globalValue, source: 'global' };
      }

      return { value: DEFAULT_SLIDER_POSITION, source: 'default' };
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get user slider value');
      return { value: DEFAULT_SLIDER_POSITION, source: 'default' };
    }
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    SliderService.cache.clear();
    SliderService.globalCache = null;
  }
}

export default SliderService;
