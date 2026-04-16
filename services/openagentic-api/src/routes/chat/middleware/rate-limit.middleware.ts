/**
 * Rate Limiting Middleware for Chat API
 * 
 * Implements rate limiting based on user ID and IP address
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticatedRequest } from './auth.middleware.js';

interface RateLimitOptions {
  rateLimitPerMinute: number;
  rateLimitPerHour?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (request: FastifyRequest) => string;
}

interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ totalHits: number; resetTime: Date }>;
  reset(key: string): Promise<void>;
}

/**
 * In-memory rate limit store (for development/testing)
 */
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  async increment(key: string, windowMs: number): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now();
    const existing = this.store.get(key);
    
    if (!existing || now > existing.resetTime) {
      // Create new entry
      const resetTime = now + windowMs;
      this.store.set(key, { count: 1, resetTime });
      return { totalHits: 1, resetTime: new Date(resetTime) };
    } else {
      // Increment existing
      existing.count++;
      return { totalHits: existing.count, resetTime: new Date(existing.resetTime) };
    }
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * Redis-based rate limit store
 */
class RedisStore implements RateLimitStore {
  constructor(private redis: any) {}

  async increment(key: string, windowMs: number): Promise<{ totalHits: number; resetTime: Date }> {
    const multi = this.redis.multi();
    const resetTime = Date.now() + windowMs;
    
    multi.incr(key);
    multi.pexpire(key, windowMs);
    
    const results = await multi.exec();
    const totalHits = results[0][1];
    
    return { totalHits, resetTime: new Date(resetTime) };
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/**
 * Rate limiting middleware
 */
export function rateLimitMiddleware(options: RateLimitOptions) {
  // Use Redis for production rate limiting
  const store = process.env.REDIS_HOST && process.env.NODE_ENV !== 'test' 
    ? new RedisStore({
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD
      })
    : new MemoryStore(); // Fallback to memory for testing/development
  
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    try {
      // Generate rate limit key
      const key = options.keyGenerator 
        ? options.keyGenerator(request)
        : generateRateLimitKey(request);
      
      // Check minute limit
      const minuteKey = `${key}:minute`;
      const minuteResult = await store.increment(minuteKey, 60 * 1000);
      
      if (minuteResult.totalHits > options.rateLimitPerMinute) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests per minute',
            retryAfter: Math.ceil((minuteResult.resetTime.getTime() - Date.now()) / 1000)
          }
        });
      }
      
      // Check hour limit if configured
      if (options.rateLimitPerHour) {
        const hourKey = `${key}:hour`;
        const hourResult = await store.increment(hourKey, 60 * 60 * 1000);
        
        if (hourResult.totalHits > options.rateLimitPerHour) {
          return reply.code(429).send({
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many requests per hour',
              retryAfter: Math.ceil((hourResult.resetTime.getTime() - Date.now()) / 1000)
            }
          });
        }
      }
      
      // Add rate limit headers
      reply.header('X-RateLimit-Limit-Minute', options.rateLimitPerMinute);
      reply.header('X-RateLimit-Remaining-Minute', Math.max(0, options.rateLimitPerMinute - minuteResult.totalHits));
      reply.header('X-RateLimit-Reset-Minute', Math.ceil(minuteResult.resetTime.getTime() / 1000));
      
      if (options.rateLimitPerHour) {
        const hourResult = await store.increment(`${key}:hour`, 60 * 60 * 1000);
        reply.header('X-RateLimit-Limit-Hour', options.rateLimitPerHour);
        reply.header('X-RateLimit-Remaining-Hour', Math.max(0, options.rateLimitPerHour - hourResult.totalHits));
      }
      
      return; // Explicit return for successful rate limit check
      
    } catch (error) {
      request.log.error({ error: error.message }, 'Rate limiting failed');
      // Don't block requests if rate limiting fails
      return; // Explicit return for error case
    }
  };
}

/**
 * Generate rate limit key based on user or IP
 */
function generateRateLimitKey(request: AuthenticatedRequest): string {
  // Prefer user-based rate limiting
  if (request.user?.id) {
    return `user:${request.user.id}`;
  }
  
  // Fall back to IP-based rate limiting
  const ip = request.headers['x-forwarded-for'] as string || 
            request.headers['x-real-ip'] as string || 
            request.socket.remoteAddress || 
            'unknown';
  
  return `ip:${Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim()}`;
}

/**
 * Rate limiting middleware plugin
 */
export const rateLimitMiddlewarePlugin = async (
  fastify: any, 
  options: RateLimitOptions
) => {
  const middleware = rateLimitMiddleware(options);
  
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip rate limiting for health checks
    if (request.url === '/health' || request.url.startsWith('/docs')) {
      return;
    }
    
    await middleware(request as AuthenticatedRequest, reply);
  });
};

/**
 * Burst rate limiting for expensive operations
 */
export function burstRateLimitMiddleware(options: {
  maxBurst: number;
  windowMs: number;
  costFunction?: (request: FastifyRequest) => number;
}) {
  const store = new MemoryStore();
  
  return async (request: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    try {
      const key = `burst:${generateRateLimitKey(request)}`;
      const cost = options.costFunction ? options.costFunction(request) : 1;
      
      // Check if we can afford this request
      const current = await store.increment(key, options.windowMs);
      
      if (current.totalHits > options.maxBurst) {
        return reply.code(429).send({
          error: {
            code: 'BURST_RATE_LIMITED',
            message: 'Too many expensive operations',
            retryAfter: Math.ceil((current.resetTime.getTime() - Date.now()) / 1000)
          }
        });
      }
      
      // Increment by cost for future requests
      if (cost > 1) {
        for (let i = 1; i < cost; i++) {
          await store.increment(key, options.windowMs);
        }
      }
      
      return; // Explicit return for successful burst rate limit check
      
    } catch (error) {
      request.log.error({ error: error.message }, 'Burst rate limiting failed');
      return; // Explicit return for error case
    }
  };
}

/**
 * Adaptive rate limiting based on system load
 */
export function adaptiveRateLimitMiddleware(options: {
  baseLimit: number;
  maxLimit: number;
  loadThreshold: number;
  getSystemLoad: () => Promise<number>;
}) {
  return async (request: AuthenticatedRequest, reply: FastifyReply) => {
    try {
      const systemLoad = await options.getSystemLoad();
      
      // Calculate dynamic limit based on system load
      const loadFactor = Math.max(0, 1 - (systemLoad - options.loadThreshold));
      const dynamicLimit = Math.floor(
        options.baseLimit + (options.maxLimit - options.baseLimit) * loadFactor
      );
      
      // Apply dynamic rate limiting
      const dynamicMiddleware = rateLimitMiddleware({
        rateLimitPerMinute: dynamicLimit
      });
      
      await dynamicMiddleware(request, reply);
      
    } catch (error) {
      request.log.error({ error: error.message }, 'Adaptive rate limiting failed');
      
      // Fall back to base rate limiting
      const fallbackMiddleware = rateLimitMiddleware({
        rateLimitPerMinute: options.baseLimit
      });
      
      await fallbackMiddleware(request, reply);
    }
  };
}