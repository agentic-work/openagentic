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
 * Admin Rate Limits Routes
 *
 * Provides endpoints for managing rate limit configuration backed by
 * Prisma RateLimit model + Redis cache via RateLimitService.
 *
 * Endpoints:
 * - GET  /  - Get all rate limit configurations
 * - GET  /tiers - Get tier definitions
 * - PUT  /tiers/:tierName - Update tier
 * - GET  /users/:userId - Get user-specific rate limits
 * - PUT  /users/:userId - Set user rate limit override
 * - DELETE /users/:userId - Clear user override
 * - GET  /violations - Get violation history (DB-persisted)
 * - GET  /stats - Get rate limit statistics
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { rateLimitService, RateLimitTierConfig } from '../services/RateLimitService.js';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';

/**
 * Sync rate limit config to Redis so the Fastify rate limiter picks it up immediately.
 * Key: platform:rate_limits
 * Format: { defaultMax, adminMax, tiers: { free: N, standard: N, premium: N, unlimited: N } }
 */
async function syncRateLimitsToRedis() {
  try {
    const tiers = await rateLimitService.getTiers();
    const config: Record<string, any> = {
      defaultMax: 120,
      adminMax: 300,
      tiers: {},
    };
    // getTiers may return array or Record -- handle both
    const tierEntries = Array.isArray(tiers)
      ? tiers.map((t: any) => [t.name, t])
      : Object.entries(tiers);
    for (const [name, tier] of tierEntries) {
      const t = tier as any;
      config.tiers[name] = t.requestsPerMinute || 120;
      if (name === 'free') config.defaultMax = t.requestsPerMinute || 60;
    }
    const redis = getRedisClient();
    await redis.set('platform:rate_limits', config, 0); // 0 = no expiry
    loggers.routes.info({ tiers: Object.keys(config.tiers) }, '[RateLimits] Synced to Redis for live enforcement');
  } catch (err: any) {
    loggers.routes.warn({ error: err.message }, '[RateLimits] Failed to sync to Redis (rate limiter will use defaults)');
  }
}

interface UserIdParams {
  userId: string;
}

interface TierNameParams {
  tierName: string;
}

interface ViolationsQuery {
  userId?: string;
  violationType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export const adminRateLimitsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Seed default tiers on first load and sync to Redis
  rateLimitService.seedDefaults().then(() => {
    syncRateLimitsToRedis();
  }).catch(err => {
    logger.warn({ err }, '[RateLimits] Failed to seed defaults on startup');
  });

  /**
   * GET / - Get all rate limit configurations
   */
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tiers = await rateLimitService.getTiers();

      // Get user overrides from RateLimit table
      const userOverrides = await prisma.rateLimit.findMany({
        where: { scope: 'user', is_active: true },
        include: { user: { select: { email: true, name: true } } }
      });

      const overrides = userOverrides.map(o => ({
        userId: o.user_id,
        userEmail: o.user?.email || null,
        userName: o.user?.name || null,
        tier: o.name.startsWith('custom-') ? 'custom' : o.name,
        requestsPerMinute: o.requests_per_minute,
        requestsPerHour: o.requests_per_hour,
        requestsPerDay: o.requests_per_day,
        tokensPerDay: o.tokens_per_day
      }));

      return reply.send({
        tiers: Object.values(tiers),
        userOverrides: overrides,
        totalUsersWithOverrides: overrides.length,
        defaultTier: 'standard'
      });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to get rate limit configurations');
      return reply.code(500).send({ error: 'Failed to get rate limit configurations', message: error.message });
    }
  });

  /**
   * GET /tiers - Get all rate limit tier configurations
   */
  fastify.get('/tiers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tiers = await rateLimitService.getTiers();
      return reply.send({ tiers: Object.values(tiers), defaultTier: 'standard' });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to get rate limit tiers');
      return reply.code(500).send({ error: 'Failed to get rate limit tiers', message: error.message });
    }
  });

  /**
   * PUT /tiers/:tierName - Update a tier configuration
   */
  fastify.put<{ Params: TierNameParams; Body: Partial<RateLimitTierConfig> }>(
    '/tiers/:tierName',
    async (request, reply) => {
      try {
        const { tierName } = request.params;
        const updates = request.body;

        const updated = await rateLimitService.updateTier(tierName, updates);
        if (!updated) {
          return reply.code(404).send({ error: 'Tier not found', message: `Tier '${tierName}' does not exist` });
        }

        logger.info({ tierName, updates }, '[RateLimits] Tier updated');
        // Sync to Redis so Fastify rate limiter picks up changes immediately
        await syncRateLimitsToRedis();
        return reply.send({ success: true, tier: updated });
      } catch (error: any) {
        logger.error({ error }, '[RateLimits] Failed to update tier');
        return reply.code(500).send({ error: 'Failed to update tier', message: error.message });
      }
    }
  );

  /**
   * GET /users/:userId - Get rate limits for a specific user
   */
  fastify.get<{ Params: UserIdParams }>('/users/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found', message: `User '${userId}' does not exist` });
      }

      const { tier: effectiveTier, source } = await rateLimitService.getEffectiveLimits(userId);
      const userOverride = await rateLimitService.getUserOverride(userId);

      return reply.send({
        userId,
        userEmail: user.email,
        userName: user.name,
        tier: effectiveTier.name,
        source,
        hasCustomLimits: source === 'user',
        limits: {
          requestsPerMinute: effectiveTier.requestsPerMinute,
          requestsPerHour: effectiveTier.requestsPerHour,
          requestsPerDay: effectiveTier.requestsPerDay,
          tokensPerDay: effectiveTier.tokensPerDay,
          tokensPerMinute: effectiveTier.tokensPerMinute,
          tokensPerHour: effectiveTier.tokensPerHour,
          workflowExecutionsPerHour: effectiveTier.workflowExecutionsPerHour,
          concurrentWorkflows: effectiveTier.concurrentWorkflows,
          codeExecutionsPerHour: effectiveTier.codeExecutionsPerHour,
          codeExecutionTimeoutSec: effectiveTier.codeExecutionTimeoutSec
        },
        customOverrides: userOverride ? {
          requestsPerMinute: userOverride.requestsPerMinute,
          requestsPerHour: userOverride.requestsPerHour,
          requestsPerDay: userOverride.requestsPerDay,
          tokensPerDay: userOverride.tokensPerDay
        } : null
      });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to get user rate limits');
      return reply.code(500).send({ error: 'Failed to get user rate limits', message: error.message });
    }
  });

  /**
   * PUT /users/:userId - Set user-specific rate limit override
   */
  fastify.put<{ Params: UserIdParams; Body: { tier?: string; requestsPerMinute?: number; requestsPerHour?: number; requestsPerDay?: number; tokensPerDay?: number } }>(
    '/users/:userId',
    async (request, reply) => {
      try {
        const { userId } = request.params;
        const { tier, ...customLimits } = request.body;

        const existingUser = await prisma.user.findUnique({ where: { id: userId } });
        if (!existingUser) {
          return reply.code(404).send({ error: 'User not found', message: `User '${userId}' does not exist` });
        }

        await rateLimitService.setUserOverride(userId, tier || 'custom', customLimits);

        logger.info({ userId, tier }, '[RateLimits] User rate limits updated');
        return reply.send({ success: true, userId, tier: tier || 'custom' });
      } catch (error: any) {
        logger.error({ error }, '[RateLimits] Failed to set user rate limits');
        return reply.code(500).send({ error: 'Failed to set user rate limits', message: error.message });
      }
    }
  );

  /**
   * DELETE /users/:userId - Clear user-specific rate limit override
   */
  fastify.delete<{ Params: UserIdParams }>('/users/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      await rateLimitService.deleteUserOverride(userId);

      logger.info({ userId }, '[RateLimits] User rate limits cleared');
      return reply.send({ success: true, userId, message: 'User rate limits cleared, now using default tier', defaultTier: 'standard' });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to clear user rate limits');
      return reply.code(500).send({ error: 'Failed to clear user rate limits', message: error.message });
    }
  });

  /**
   * GET /violations - Get rate limit violation history (DB-persisted)
   */
  fastify.get<{ Querystring: ViolationsQuery }>('/violations', async (request, reply) => {
    try {
      const { userId, violationType, startDate, endDate, limit = 100, offset = 0 } = request.query;
      const { violations, total } = await rateLimitService.getViolations({
        userId, violationType, startDate, endDate, limit: Number(limit), offset: Number(offset)
      });

      // Compute stats from recent violations
      const byType: Record<string, number> = {};
      for (const v of violations) {
        byType[v.violation_type] = (byType[v.violation_type] || 0) + 1;
      }

      return reply.send({
        violations: violations.map(v => ({
          id: v.id,
          userId: v.user_id,
          userEmail: v.user_email,
          violationType: v.violation_type,
          limitValue: v.limit_value,
          actualValue: v.actual_value,
          tierName: v.tier_name,
          endpoint: v.endpoint,
          timestamp: v.created_at.toISOString()
        })),
        stats: { total, byType },
        query: { userId, violationType, startDate, endDate, limit, offset }
      });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to get violations');
      return reply.code(500).send({ error: 'Failed to get violations', message: error.message });
    }
  });

  /**
   * GET /stats - Get rate limit statistics
   */
  fastify.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await rateLimitService.getStats();
      return reply.send(stats);
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to get stats');
      return reply.code(500).send({ error: 'Failed to get stats', message: error.message });
    }
  });

  /**
   * PUT /global-default - Set the global default tier for all users
   * Syncs to Redis immediately so the rate limiter picks it up.
   */
  fastify.put<{ Body: { defaultTier: string } }>('/global-default', async (request, reply) => {
    try {
      const { defaultTier } = request.body;
      if (!defaultTier) {
        return reply.code(400).send({ error: 'defaultTier is required' });
      }

      // Verify tier exists
      const tiers = await rateLimitService.getTiers();
      const tierNames = Array.isArray(tiers) ? tiers.map((t: any) => t.name) : Object.keys(tiers);
      if (!tierNames.includes(defaultTier)) {
        return reply.code(400).send({ error: `Tier "${defaultTier}" does not exist` });
      }

      // Store in Redis for the rate limiter + persist to DB setting
      await syncRateLimitsToRedis();

      // Also store the default tier choice
      try {
        const redis = getRedisClient();
        const configStr = await redis.get('platform:rate_limits');
        const config = configStr ? (typeof configStr === 'string' ? JSON.parse(configStr) : configStr) : {};
        config.globalDefaultTier = defaultTier;
        // Set the defaultMax based on the selected tier
        const selectedTier = Array.isArray(tiers) ? tiers.find((t: any) => t.name === defaultTier) : tiers[defaultTier];
        if (selectedTier) {
          config.defaultMax = (selectedTier as any).requestsPerMinute || 120;
        }
        await redis.set('platform:rate_limits', config, 0);
      } catch {}

      logger.info({ defaultTier }, '[RateLimits] Global default tier updated');
      return reply.send({ success: true, defaultTier });
    } catch (error: any) {
      logger.error({ error }, '[RateLimits] Failed to set global default tier');
      return reply.code(500).send({ error: 'Failed to set global default', message: error.message });
    }
  });

  logger.info('Admin Rate Limits routes registered (DB-backed + Redis sync)');
};

export default adminRateLimitsRoutes;
