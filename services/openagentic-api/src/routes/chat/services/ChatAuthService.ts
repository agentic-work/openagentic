/**
 * Chat Authentication Service
 *
 * Handles authentication, authorization, and rate limiting for chat operations
 */

import { prisma } from '../../../utils/prisma.js';
import type { Logger } from 'pino';
import { AzureTokenService } from '../../../services/AzureTokenService.js';

export interface UserLimits {
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
}

export interface LimitCheckResult {
  isLimited: boolean;
  limitType?: 'daily_requests' | 'monthly_requests' | 'daily_tokens' | 'monthly_tokens' | 'rate_minute' | 'rate_hour';
  currentValue?: number;
  limitValue?: number;
  message?: string;
}

export class ChatAuthService {
  private prisma = prisma;
  private azureTokenService: AzureTokenService;

  constructor(private logger: any) {
    this.logger = logger.child({ service: 'ChatAuthService' }) as Logger;
    this.azureTokenService = new AzureTokenService(this.logger);
  }

  /**
   * Check rate limiting for user using Redis sliding window
   */
  async checkRateLimit(
    userId: string,
    rateLimitPerMinute: number,
    rateLimitPerHour: number,
    redis?: any
  ): Promise<boolean> {
    try {
      if (!redis) {
        this.logger.debug({ userId }, 'Redis not available for rate limiting');
        return false;
      }

      const now = Date.now();
      const minuteKey = `ratelimit:minute:${userId}`;
      const hourKey = `ratelimit:hour:${userId}`;

      // Check minute rate limit using sorted set sliding window
      const minuteWindowStart = now - 60000; // 1 minute ago
      await redis.zremrangebyscore(minuteKey, 0, minuteWindowStart);
      const minuteCount = await redis.zcard(minuteKey);

      if (minuteCount >= rateLimitPerMinute) {
        this.logger.warn({
          userId,
          currentCount: minuteCount,
          limit: rateLimitPerMinute
        }, 'Rate limit exceeded (per minute)');
        return true;
      }

      // Check hour rate limit
      const hourWindowStart = now - 3600000; // 1 hour ago
      await redis.zremrangebyscore(hourKey, 0, hourWindowStart);
      const hourCount = await redis.zcard(hourKey);

      if (hourCount >= rateLimitPerHour) {
        this.logger.warn({
          userId,
          currentCount: hourCount,
          limit: rateLimitPerHour
        }, 'Rate limit exceeded (per hour)');
        return true;
      }

      // Add current request to sliding window
      await redis.zadd(minuteKey, now, `${now}-${Math.random()}`);
      await redis.zadd(hourKey, now, `${now}-${Math.random()}`);

      // Set TTL on keys
      await redis.expire(minuteKey, 120); // 2 minutes
      await redis.expire(hourKey, 7200);  // 2 hours

      this.logger.debug({
        userId,
        minuteCount: minuteCount + 1,
        hourCount: hourCount + 1,
        rateLimitPerMinute,
        rateLimitPerHour
      }, 'Rate limit check passed');

      return false;

    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'Rate limit check failed');

      // If rate limiting service is down, don't block requests
      return false;
    }
  }

  /**
   * Check user-specific token and request limits
   * Uses both Redis counters (for today) and DB metrics (for month)
   */
  async checkUserLimits(
    userId: string,
    limits: UserLimits,
    redis?: any
  ): Promise<LimitCheckResult> {
    try {
      // Get current date info for daily/monthly calculations
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Check daily request limit
      if (limits.dailyRequestLimit !== null) {
        const dailyRequests = await this.getDailyRequestCount(userId, todayStart, redis);
        if (dailyRequests >= limits.dailyRequestLimit) {
          return {
            isLimited: true,
            limitType: 'daily_requests',
            currentValue: dailyRequests,
            limitValue: limits.dailyRequestLimit,
            message: `Daily request limit reached (${dailyRequests}/${limits.dailyRequestLimit})`
          };
        }
      }

      // Check monthly request limit
      if (limits.monthlyRequestLimit !== null) {
        const monthlyRequests = await this.getMonthlyRequestCount(userId, monthStart);
        if (monthlyRequests >= limits.monthlyRequestLimit) {
          return {
            isLimited: true,
            limitType: 'monthly_requests',
            currentValue: monthlyRequests,
            limitValue: limits.monthlyRequestLimit,
            message: `Monthly request limit reached (${monthlyRequests}/${limits.monthlyRequestLimit})`
          };
        }
      }

      // Check daily token limit
      if (limits.dailyTokenLimit !== null) {
        const dailyTokens = await this.getDailyTokenCount(userId, todayStart, redis);
        if (dailyTokens >= limits.dailyTokenLimit) {
          return {
            isLimited: true,
            limitType: 'daily_tokens',
            currentValue: dailyTokens,
            limitValue: limits.dailyTokenLimit,
            message: `Daily token limit reached (${dailyTokens}/${limits.dailyTokenLimit})`
          };
        }
      }

      // Check monthly token limit
      if (limits.monthlyTokenLimit !== null) {
        const monthlyTokens = await this.getMonthlyTokenCount(userId, monthStart);
        if (monthlyTokens >= limits.monthlyTokenLimit) {
          return {
            isLimited: true,
            limitType: 'monthly_tokens',
            currentValue: monthlyTokens,
            limitValue: limits.monthlyTokenLimit,
            message: `Monthly token limit reached (${monthlyTokens}/${limits.monthlyTokenLimit})`
          };
        }
      }

      return { isLimited: false };
    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'User limits check failed');

      // On error, allow request but log warning
      return { isLimited: false };
    }
  }

  /**
   * Get daily request count from Redis counter (fast) with DB fallback
   */
  private async getDailyRequestCount(userId: string, todayStart: Date, redis?: any): Promise<number> {
    const dateKey = todayStart.toISOString().split('T')[0]; // YYYY-MM-DD
    const cacheKey = `userlimit:daily_requests:${userId}:${dateKey}`;

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached !== null) {
          return parseInt(cached, 10);
        }
      } catch (e) {
        // Fall through to DB query
      }
    }

    // Query DB for accurate count (using TokenUsage table)
    const count = await this.prisma.tokenUsage.count({
      where: {
        user_id: userId,
        timestamp: { gte: todayStart }
      }
    });

    // Cache result
    if (redis) {
      await redis.set(cacheKey, count.toString(), 'EX', 300).catch(() => {}); // 5 min cache
    }

    return count;
  }

  /**
   * Get monthly request count from DB (TokenUsage table)
   */
  private async getMonthlyRequestCount(userId: string, monthStart: Date): Promise<number> {
    const count = await this.prisma.tokenUsage.count({
      where: {
        user_id: userId,
        timestamp: { gte: monthStart }
      }
    });
    return count;
  }

  /**
   * Get daily token count from Redis counter (fast) with DB fallback
   */
  private async getDailyTokenCount(userId: string, todayStart: Date, redis?: any): Promise<number> {
    const dateKey = todayStart.toISOString().split('T')[0];
    const cacheKey = `userlimit:daily_tokens:${userId}:${dateKey}`;

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached !== null) {
          return parseInt(cached, 10);
        }
      } catch (e) {
        // Fall through to DB query
      }
    }

    // Query DB for accurate count (using TokenUsage table)
    const result = await this.prisma.tokenUsage.aggregate({
      where: {
        user_id: userId,
        timestamp: { gte: todayStart }
      },
      _sum: {
        total_tokens: true
      }
    });

    const totalTokens = result._sum.total_tokens || 0;

    // Cache result
    if (redis) {
      await redis.set(cacheKey, totalTokens.toString(), 'EX', 300).catch(() => {});
    }

    return totalTokens;
  }

  /**
   * Get monthly token count from DB (TokenUsage table)
   */
  private async getMonthlyTokenCount(userId: string, monthStart: Date): Promise<number> {
    const result = await this.prisma.tokenUsage.aggregate({
      where: {
        user_id: userId,
        timestamp: { gte: monthStart }
      },
      _sum: {
        total_tokens: true
      }
    });
    return result._sum.total_tokens || 0;
  }

  /**
   * Increment usage counters after a request completes
   * Called from completion stage after LLM response
   */
  async incrementUsageCounters(userId: string, tokensUsed: number, redis?: any): Promise<void> {
    if (!redis) return;

    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];

    try {
      // Increment daily request counter
      const requestKey = `userlimit:daily_requests:${userId}:${dateKey}`;
      await redis.incr(requestKey);
      await redis.expire(requestKey, 86400 * 2); // 2 days TTL

      // Increment daily token counter
      const tokenKey = `userlimit:daily_tokens:${userId}:${dateKey}`;
      await redis.incrby(tokenKey, tokensUsed);
      await redis.expire(tokenKey, 86400 * 2);

      this.logger.debug({
        userId,
        tokensUsed,
        dateKey
      }, 'Usage counters incremented');
    } catch (error) {
      this.logger.warn({
        userId,
        error: error.message
      }, 'Failed to increment usage counters');
    }
  }

  /**
   * Get Azure token information for user
   * Automatically refreshes expired tokens using MSAL if refresh token is available
   */
  async getAzureTokenInfo(userId: string): Promise<any | null> {
    try {
      // Use AzureTokenService which handles auto-refresh
      const tokenInfo = await this.azureTokenService.getOrRefreshToken(userId);

      if (!tokenInfo) {
        this.logger.debug({ userId }, 'No Azure token found for user');
        return null;
      }

      this.logger.debug({
        userId,
        hasToken: true,
        hasIdToken: !!tokenInfo.id_token,
        isExpired: tokenInfo.is_expired,
        wasRefreshed: !tokenInfo.is_expired,
        expiresAt: tokenInfo.expires_at
      }, 'Azure token info retrieved (with auto-refresh)');

      return {
        hasToken: true,
        isExpired: tokenInfo.is_expired,
        accessToken: tokenInfo.access_token, // For Azure ARM OBO (aud: management.azure.com)
        idToken: tokenInfo.id_token,         // For AWS IC OBO (aud: app's client ID)
        expiresAt: tokenInfo.expires_at,
        scope: 'https://management.azure.com/.default',
        updatedAt: new Date()
      };

    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'Azure token info retrieval failed');

      return null;
    }
  }

  /**
   * Validate user permissions for specific operations
   */
  async validatePermissions(userId: string, operation: string): Promise<boolean> {
    try {
      // Get user with groups and roles
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          is_admin: true,
          groups: true
        }
      });
      
      if (!user) {
        this.logger.warn({ userId }, 'User not found for permission check');
        return false;
      }
      
      // Admin users have all permissions
      if (user.is_admin) {
        this.logger.debug({ userId, operation }, 'Admin user - permission granted');
        return true;
      }
      
      // Define operation permission requirements
      const operationPermissions: Record<string, string[]> = {
        'admin.read': ['admin', 'moderator'],
        'admin.write': ['admin'],
        'mcp.execute': ['admin', 'developer', 'user'],
        'chat.create': ['admin', 'developer', 'user'],
        'chat.delete': ['admin', 'moderator'],
        'user.manage': ['admin'],
        'system.configure': ['admin']
      };
      
      // Check if operation requires specific roles
      const requiredRoles = operationPermissions[operation];
      if (!requiredRoles) {
        // Unknown operation - allow by default for backward compatibility
        this.logger.debug({ userId, operation }, 'Unknown operation - allowing');
        return true;
      }
      
      // Check if user has any of the required roles
      const userGroups = user.groups || [];
      const userRoles = userGroups; // Use groups as roles for now
      const hasPermission = requiredRoles.some(role => 
        userRoles.includes(role) || userGroups.includes(role)
      );
      
      this.logger.debug({ 
        userId,
        operation,
        requiredRoles,
        userRoles,
        userGroups,
        hasPermission
      }, 'Permission validation completed');
      
      return hasPermission;
      
    } catch (error) {
      this.logger.error({ 
        userId,
        operation,
        error: error.message 
      }, 'Permission validation failed');
      
      return false;
    }
  }

  /**
   * Health check for auth service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check if auth services are available
      // For now, always return healthy
      
      return true;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Auth service health check failed');
      
      return false;
    }
  }
}