/**
 * Rate Limiting Utility
 * Implements tiered rate limiting with Redis backing
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { rateLimitService } from '../services/RateLimitService.js';

const logger: any = pino({
  name: 'rate-limiter',
  level: process.env.LOG_LEVEL || 'info'
});

// Redis client for rate limiting
let redis: Redis | null = null;

/**
 * Initialize Redis connection
 */
export function initializeRateLimiter(): void {
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis connection failed after 3 retries');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      }
    });

    redis.on('connect', () => {
      logger.info('Redis connected for rate limiting');
    });

    redis.on('error', (error) => {
      logger.error({ error }, 'Redis connection error');
      redis = null; // Fallback to in-memory
    });
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Redis for rate limiting');
    redis = null;
  }
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  max: number;          // Maximum requests
  window: number;       // Time window in seconds
  keyPrefix?: string;   // Redis key prefix
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Default rate limit tiers
 */
export const RateLimitTiers = {
  // Very strict for auth endpoints
  auth: {
    max: 5,
    window: 60, // 5 requests per minute
    keyPrefix: 'rl:auth:'
  },
  
  // Strict for admin operations
  admin: {
    max: 30,
    window: 60, // 30 requests per minute
    keyPrefix: 'rl:admin:'
  },
  
  // Moderate for API endpoints
  api: {
    max: 100,
    window: 60, // 100 requests per minute
    keyPrefix: 'rl:api:'
  },
  
  // Lenient for read operations
  read: {
    max: 300,
    window: 60, // 300 requests per minute
    keyPrefix: 'rl:read:'
  },
  
  // Very strict for expensive operations
  expensive: {
    max: 10,
    window: 300, // 10 requests per 5 minutes
    keyPrefix: 'rl:expensive:'
  }
};

/**
 * In-memory fallback for rate limiting
 */
const memoryStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Check rate limit using Redis or in-memory fallback
 */
async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = config.window * 1000;
  const resetAt = now + windowMs;

  // Try Redis first
  if (redis) {
    try {
      const fullKey = `${config.keyPrefix || 'rl:'}${key}`;
      
      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline();
      pipeline.incr(fullKey);
      pipeline.expire(fullKey, config.window);
      
      const results = await pipeline.exec();
      if (!results) {
        throw new Error('Redis pipeline failed');
      }
      
      const count = results[0][1] as number;
      const allowed = count <= config.max;
      const remaining = Math.max(0, config.max - count);
      
      return { allowed, remaining, resetAt };
    } catch (error) {
      logger.warn({ error }, 'Redis rate limit check failed, falling back to memory');
    }
  }

  // Fallback to in-memory store
  const memKey = `${config.keyPrefix || 'rl:'}${key}`;
  const entry = memoryStore.get(memKey);

  if (!entry || entry.resetAt < now) {
    // Create new entry
    memoryStore.set(memKey, { count: 1, resetAt });
    return { allowed: true, remaining: config.max - 1, resetAt };
  }

  // Increment existing entry
  entry.count++;
  const allowed = entry.count <= config.max;
  const remaining = Math.max(0, config.max - entry.count);

  return { allowed, remaining, resetAt };
}

/**
 * Rate limiting middleware factory
 */
export function rateLimit(config: RateLimitConfig) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Determine the key for rate limiting
    const user = (request as any).user;
    const key = user?.id || user?.email || request.ip || 'anonymous';

    // Check rate limit
    const { allowed, remaining, resetAt } = await checkRateLimit(key, config);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', config.max.toString());
    reply.header('X-RateLimit-Remaining', remaining.toString());
    reply.header('X-RateLimit-Reset', new Date(resetAt).toISOString());

    if (!allowed) {
      logger.warn({ key, config }, 'Rate limit exceeded');
      reply.header('Retry-After', Math.ceil((resetAt - Date.now()) / 1000).toString());

      // Record violation asynchronously (non-blocking)
      const reqUser = (request as any).user;
      rateLimitService.recordViolation({
        userId: reqUser?.id || reqUser?.userId || undefined,
        userEmail: reqUser?.email || undefined,
        violationType: config.keyPrefix?.replace('rl:', '').replace(':', '') || 'requests_per_minute',
        limitValue: config.max,
        actualValue: config.max + 1,
        endpoint: request.url,
        ipAddress: request.ip
      }).catch(() => {});

      await reply.status(429).send({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please retry after ${new Date(resetAt).toISOString()}`,
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000)
      });
      return;
    }

    // Log rate limit info for monitoring
    if (remaining < config.max * 0.2) {
      logger.info({ key, remaining, config }, 'Rate limit warning - low remaining requests');
    }
    // Continue to next handler if rate limit not exceeded
  };
}

/**
 * Apply different rate limits based on endpoint type
 */
export function applyRateLimit(type: keyof typeof RateLimitTiers) {
  return rateLimit(RateLimitTiers[type]);
}

/**
 * Custom rate limit for specific operations
 */
export function customRateLimit(max: number, window: number, keyPrefix?: string) {
  return rateLimit({ max, window, keyPrefix });
}

/**
 * Clean up expired entries from memory store (runs periodically)
 */
export function cleanupMemoryStore(): void {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now) {
      memoryStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned }, 'Cleaned expired rate limit entries');
  }
}

// Run cleanup every minute
setInterval(cleanupMemoryStore, 60000);

/**
 * Reset rate limit for a specific key (useful for testing)
 */
export async function resetRateLimit(key: string, prefix?: string): Promise<void> {
  const fullKey = `${prefix || 'rl:'}${key}`;

  if (redis) {
    try {
      await redis.del(fullKey);
    } catch (error) {
      logger.error({ error }, 'Failed to reset rate limit in Redis');
    }
  }

  // Also clear from memory store
  memoryStore.delete(fullKey);
}

/**
 * Get current rate limit status for a key
 */
export async function getRateLimitStatus(
  key: string,
  config: RateLimitConfig
): Promise<{ count: number; remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = config.window * 1000;
  const fullKey = `${config.keyPrefix || 'rl:'}${key}`;

  if (redis) {
    try {
      const count = await redis.get(fullKey);
      const ttl = await redis.ttl(fullKey);
      
      if (count) {
        const countNum = Number.parseInt(count);
        return {
          count: countNum,
          remaining: Math.max(0, config.max - countNum),
          resetAt: now + (ttl * 1000)
        };
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get rate limit status from Redis');
    }
  }

  // Check memory store
  const entry = memoryStore.get(fullKey);
  if (entry && entry.resetAt > now) {
    return {
      count: entry.count,
      remaining: Math.max(0, config.max - entry.count),
      resetAt: entry.resetAt
    };
  }

  // No existing limit
  return {
    count: 0,
    remaining: config.max,
    resetAt: now + windowMs
  };
}