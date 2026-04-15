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
 * Unified Rate Limit Service
 *
 * Loads tiers from Prisma RateLimit model, caches in Redis (TTL 60s).
 * Resolution chain: user override → group → global tier → hardcoded defaults.
 * Records violations to RateLimitViolation model.
 */

import { getRedisClient } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes;

const REDIS_CACHE_KEY = 'rate-limits:tiers';
const REDIS_CACHE_TTL = 60; // seconds

export interface RateLimitTierConfig {
  name: string;
  displayName: string;
  description: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  workflowExecutionsPerHour: number;
  concurrentWorkflows: number;
  codeExecutionsPerHour: number;
  codeExecutionTimeoutSec: number;
}

// Hardcoded defaults — used if database has nothing
const HARDCODED_TIERS: Record<string, RateLimitTierConfig> = {
  free: {
    name: 'free',
    displayName: 'Free Tier',
    description: 'Free tier with basic rate limits',
    requestsPerMinute: 5,
    requestsPerHour: 60,
    requestsPerDay: 200,
    tokensPerDay: 50000,
    tokensPerMinute: 10000,
    tokensPerHour: 30000,
    workflowExecutionsPerHour: 5,
    concurrentWorkflows: 1,
    codeExecutionsPerHour: 5,
    codeExecutionTimeoutSec: 60
  },
  standard: {
    name: 'standard',
    displayName: 'Standard Tier',
    description: 'Standard tier for regular users',
    requestsPerMinute: 20,
    requestsPerHour: 500,
    requestsPerDay: 2000,
    tokensPerDay: 500000,
    tokensPerMinute: 50000,
    tokensPerHour: 300000,
    workflowExecutionsPerHour: 50,
    concurrentWorkflows: 5,
    codeExecutionsPerHour: 25,
    codeExecutionTimeoutSec: 300
  },
  premium: {
    name: 'premium',
    displayName: 'Premium Tier',
    description: 'Premium tier for power users',
    requestsPerMinute: 60,
    requestsPerHour: 2000,
    requestsPerDay: 10000,
    tokensPerDay: 2000000,
    tokensPerMinute: 100000,
    tokensPerHour: 1000000,
    workflowExecutionsPerHour: 100,
    concurrentWorkflows: 10,
    codeExecutionsPerHour: 50,
    codeExecutionTimeoutSec: 300
  },
  unlimited: {
    name: 'unlimited',
    displayName: 'Unlimited',
    description: 'No rate limits applied',
    requestsPerMinute: -1,
    requestsPerHour: -1,
    requestsPerDay: -1,
    tokensPerDay: -1,
    tokensPerMinute: -1,
    tokensPerHour: -1,
    workflowExecutionsPerHour: -1,
    concurrentWorkflows: -1,
    codeExecutionsPerHour: -1,
    codeExecutionTimeoutSec: -1
  }
};

/**
 * Convert a Prisma RateLimit row to a TierConfig
 */
function dbRowToTier(row: any): RateLimitTierConfig {
  return {
    name: row.name,
    displayName: row.description || row.name,
    description: row.description || '',
    requestsPerMinute: row.requests_per_minute,
    requestsPerHour: row.requests_per_hour,
    requestsPerDay: row.requests_per_day,
    tokensPerDay: row.tokens_per_day,
    tokensPerMinute: row.tokens_per_minute,
    tokensPerHour: row.tokens_per_hour,
    workflowExecutionsPerHour: row.workflow_executions_per_hour,
    concurrentWorkflows: row.concurrent_workflows,
    codeExecutionsPerHour: row.code_executions_per_hour,
    codeExecutionTimeoutSec: row.code_execution_timeout_sec
  };
}

class RateLimitService {
  private tiersCache: Record<string, RateLimitTierConfig> | null = null;
  private tiersCacheExpiry = 0;

  /**
   * Get all tiers — checks Redis cache, then DB, then hardcoded defaults.
   */
  async getTiers(): Promise<Record<string, RateLimitTierConfig>> {
    // In-memory hot cache (process-local, 10s)
    if (this.tiersCache && Date.now() < this.tiersCacheExpiry) {
      return this.tiersCache;
    }

    // Try Redis cache
    const redis = getRedisClient();
    if (redis.isConnected()) {
      try {
        const cached = await redis.get<Record<string, RateLimitTierConfig>>(REDIS_CACHE_KEY);
        if (cached) {
          this.tiersCache = cached;
          this.tiersCacheExpiry = Date.now() + 10_000;
          return cached;
        }
      } catch (e) {
        // Redis unavailable, continue to DB
      }
    }

    // Load from database
    try {
      const dbTiers = await prisma.rateLimit.findMany({
        where: { scope: 'global', is_active: true }
      });

      if (dbTiers.length > 0) {
        const tiers: Record<string, RateLimitTierConfig> = {};
        for (const row of dbTiers) {
          tiers[row.name] = dbRowToTier(row);
        }
        // Cache in Redis
        await redis.set(REDIS_CACHE_KEY, tiers, REDIS_CACHE_TTL);
        this.tiersCache = tiers;
        this.tiersCacheExpiry = Date.now() + 10_000;
        return tiers;
      }
    } catch (e) {
      logger.warn({ err: e }, '[RateLimitService] DB read failed, using hardcoded defaults');
    }

    // Fallback to hardcoded
    this.tiersCache = { ...HARDCODED_TIERS };
    this.tiersCacheExpiry = Date.now() + 10_000;
    return this.tiersCache;
  }

  /**
   * Seed default tiers into DB if none exist
   */
  async seedDefaults(): Promise<void> {
    try {
      const existing = await prisma.rateLimit.count({ where: { scope: 'global' } });
      if (existing > 0) return;

      logger.info('[RateLimitService] Seeding default rate limit tiers...');
      for (const [name, tier] of Object.entries(HARDCODED_TIERS)) {
        await prisma.rateLimit.create({
          data: {
            name,
            description: tier.description,
            scope: 'global',
            requests_per_minute: tier.requestsPerMinute,
            requests_per_hour: tier.requestsPerHour,
            requests_per_day: tier.requestsPerDay,
            tokens_per_minute: tier.tokensPerMinute,
            tokens_per_hour: tier.tokensPerHour,
            tokens_per_day: tier.tokensPerDay,
            workflow_executions_per_hour: tier.workflowExecutionsPerHour,
            concurrent_workflows: tier.concurrentWorkflows,
            code_executions_per_hour: tier.codeExecutionsPerHour,
            code_execution_timeout_sec: tier.codeExecutionTimeoutSec,
            is_active: true
          }
        });
      }
      logger.info('[RateLimitService] Default tiers seeded');
      this.invalidateCache();
    } catch (e) {
      logger.error({ err: e }, '[RateLimitService] Failed to seed defaults');
    }
  }

  /**
   * Update a global tier
   */
  async updateTier(tierName: string, updates: Partial<RateLimitTierConfig>): Promise<RateLimitTierConfig | null> {
    try {
      const existing = await prisma.rateLimit.findFirst({
        where: { name: tierName, scope: 'global' }
      });

      if (!existing) return null;

      const data: any = {};
      if (updates.requestsPerMinute !== undefined) data.requests_per_minute = updates.requestsPerMinute;
      if (updates.requestsPerHour !== undefined) data.requests_per_hour = updates.requestsPerHour;
      if (updates.requestsPerDay !== undefined) data.requests_per_day = updates.requestsPerDay;
      if (updates.tokensPerDay !== undefined) data.tokens_per_day = updates.tokensPerDay;
      if (updates.tokensPerMinute !== undefined) data.tokens_per_minute = updates.tokensPerMinute;
      if (updates.tokensPerHour !== undefined) data.tokens_per_hour = updates.tokensPerHour;
      if (updates.workflowExecutionsPerHour !== undefined) data.workflow_executions_per_hour = updates.workflowExecutionsPerHour;
      if (updates.concurrentWorkflows !== undefined) data.concurrent_workflows = updates.concurrentWorkflows;
      if (updates.codeExecutionsPerHour !== undefined) data.code_executions_per_hour = updates.codeExecutionsPerHour;
      if (updates.codeExecutionTimeoutSec !== undefined) data.code_execution_timeout_sec = updates.codeExecutionTimeoutSec;
      if (updates.description !== undefined) data.description = updates.description;
      if (updates.displayName !== undefined) data.description = updates.displayName;

      const updated = await prisma.rateLimit.update({
        where: { id: existing.id },
        data
      });

      this.invalidateCache();
      return dbRowToTier(updated);
    } catch (e) {
      logger.error({ err: e }, '[RateLimitService] Failed to update tier');
      return null;
    }
  }

  /**
   * Get effective rate limit config for a user.
   * Resolution: user override → group → global tier → hardcoded default.
   */
  async getEffectiveLimits(userId: string): Promise<{ tier: RateLimitTierConfig; source: string }> {
    // 1. Check user-specific override
    try {
      const userOverride = await prisma.rateLimit.findFirst({
        where: { scope: 'user', user_id: userId, is_active: true }
      });
      if (userOverride) {
        return { tier: dbRowToTier(userOverride), source: 'user' };
      }
    } catch (e) {
      // continue
    }

    // 2. Check API key tier assignment
    try {
      const apiKey = await prisma.apiKey.findFirst({
        where: { user_id: userId, is_active: true },
        select: { rate_limit_tier: true }
      });

      if (apiKey?.rate_limit_tier) {
        const tiers = await this.getTiers();
        const tierConfig = tiers[apiKey.rate_limit_tier];
        if (tierConfig) {
          return { tier: tierConfig, source: 'assigned' };
        }
      }
    } catch (e) {
      // continue
    }

    // 3. Global default (standard)
    const tiers = await this.getTiers();
    return { tier: tiers.standard || HARDCODED_TIERS.standard, source: 'default' };
  }

  /**
   * Get user-specific override from RateLimit table
   */
  async getUserOverride(userId: string): Promise<RateLimitTierConfig | null> {
    try {
      const override = await prisma.rateLimit.findFirst({
        where: { scope: 'user', user_id: userId, is_active: true }
      });
      return override ? dbRowToTier(override) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Set user-specific override
   */
  async setUserOverride(userId: string, tierName: string, customLimits?: Partial<RateLimitTierConfig>): Promise<void> {
    const tiers = await this.getTiers();
    const baseTier = tiers[tierName] || HARDCODED_TIERS.standard;

    // Merge custom limits over base tier
    const limits = { ...baseTier, ...customLimits };

    await prisma.rateLimit.upsert({
      where: {
        id: (await prisma.rateLimit.findFirst({
          where: { scope: 'user', user_id: userId }
        }))?.id || 'new-' + userId
      },
      update: {
        name: tierName === 'custom' ? `custom-${userId}` : tierName,
        description: `User override: ${tierName}`,
        requests_per_minute: limits.requestsPerMinute,
        requests_per_hour: limits.requestsPerHour,
        requests_per_day: limits.requestsPerDay,
        tokens_per_minute: limits.tokensPerMinute,
        tokens_per_hour: limits.tokensPerHour,
        tokens_per_day: limits.tokensPerDay,
        workflow_executions_per_hour: limits.workflowExecutionsPerHour,
        concurrent_workflows: limits.concurrentWorkflows,
        code_executions_per_hour: limits.codeExecutionsPerHour,
        code_execution_timeout_sec: limits.codeExecutionTimeoutSec,
        is_active: true
      },
      create: {
        name: tierName === 'custom' ? `custom-${userId}` : tierName,
        description: `User override: ${tierName}`,
        scope: 'user',
        user_id: userId,
        requests_per_minute: limits.requestsPerMinute,
        requests_per_hour: limits.requestsPerHour,
        requests_per_day: limits.requestsPerDay,
        tokens_per_minute: limits.tokensPerMinute,
        tokens_per_hour: limits.tokensPerHour,
        tokens_per_day: limits.tokensPerDay,
        workflow_executions_per_hour: limits.workflowExecutionsPerHour,
        concurrent_workflows: limits.concurrentWorkflows,
        code_executions_per_hour: limits.codeExecutionsPerHour,
        code_execution_timeout_sec: limits.codeExecutionTimeoutSec,
        is_active: true
      }
    });

    this.invalidateCache();
  }

  /**
   * Delete user override
   */
  async deleteUserOverride(userId: string): Promise<void> {
    try {
      await prisma.rateLimit.deleteMany({
        where: { scope: 'user', user_id: userId }
      });
      // Clear tier assignment on API keys
      await prisma.apiKey.updateMany({
        where: { user_id: userId },
        data: { rate_limit_tier: null }
      }).catch(() => {});
    } catch (e) {
      logger.error({ err: e }, '[RateLimitService] Failed to delete user override');
    }
    this.invalidateCache();
  }

  /**
   * Record a rate limit violation to the database (async, non-blocking).
   */
  async recordViolation(data: {
    userId?: string;
    userEmail?: string;
    violationType: string;
    limitValue: number;
    actualValue: number;
    tierName?: string;
    endpoint?: string;
    ipAddress?: string;
    metadata?: any;
  }): Promise<void> {
    // Fire and forget — don't block the request
    prisma.rateLimitViolation.create({
      data: {
        user_id: data.userId || null,
        user_email: data.userEmail || null,
        violation_type: data.violationType,
        limit_value: data.limitValue,
        actual_value: data.actualValue,
        tier_name: data.tierName || null,
        endpoint: data.endpoint || null,
        ip_address: data.ipAddress || null,
        metadata: data.metadata || undefined
      }
    }).catch(err => {
      logger.warn({ err }, '[RateLimitService] Failed to record violation');
    });
  }

  /**
   * Query violations from DB
   */
  async getViolations(filters: {
    userId?: string;
    violationType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ violations: any[]; total: number }> {
    const where: any = {};
    if (filters.userId) where.user_id = filters.userId;
    if (filters.violationType) where.violation_type = filters.violationType;
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = new Date(filters.startDate);
      if (filters.endDate) where.created_at.lte = new Date(filters.endDate);
    }

    const [violations, total] = await Promise.all([
      prisma.rateLimitViolation.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: filters.limit || 100,
        skip: filters.offset || 0
      }),
      prisma.rateLimitViolation.count({ where })
    ]);

    return { violations, total };
  }

  /**
   * Get stats about rate limiting
   */
  async getStats(): Promise<any> {
    const [totalUsers, violationsByType, recentViolations, tierCounts] = await Promise.all([
      prisma.user.count(),
      prisma.rateLimitViolation.groupBy({
        by: ['violation_type'],
        _count: true,
        where: { created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      }),
      prisma.rateLimitViolation.findMany({
        orderBy: { created_at: 'desc' },
        take: 10
      }),
      prisma.rateLimit.groupBy({
        by: ['name'],
        where: { scope: 'user', is_active: true },
        _count: true
      })
    ]);

    // Build tier distribution
    const tierDistribution: Record<string, number> = { free: 0, standard: 0, premium: 0, unlimited: 0, custom: 0 };
    let assignedUsers = 0;
    for (const tc of tierCounts) {
      const name = tc.name.startsWith('custom-') ? 'custom' : tc.name;
      tierDistribution[name] = (tierDistribution[name] || 0) + tc._count;
      assignedUsers += tc._count;
    }
    tierDistribution.standard += Math.max(0, totalUsers - assignedUsers);

    // Violations by type
    const violationStats: Record<string, number> = {};
    for (const v of violationsByType) {
      violationStats[v.violation_type] = v._count;
    }

    return {
      totalUsers,
      tierDistribution,
      violations24h: violationStats,
      recentViolations,
      totalViolations: Object.values(violationStats).reduce((a, b) => a + b, 0)
    };
  }

  /**
   * Invalidate Redis and in-memory caches
   */
  private invalidateCache(): void {
    this.tiersCache = null;
    this.tiersCacheExpiry = 0;
    const redis = getRedisClient();
    redis.del(REDIS_CACHE_KEY).catch(() => {});
  }
}

// Singleton
export const rateLimitService = new RateLimitService();
export default rateLimitService;
