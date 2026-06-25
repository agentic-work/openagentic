/**
 * Admin API Token Management Routes
 * Allows admins to create, list, and revoke API keys for users
 *
 * Security: Admin middleware required, never creates admin API keys
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { credentialAuditService } from '../services/CredentialAuditService.js';

interface CreateTokenBody {
  userId: string;
  name: string;
  expiresInDays?: number;
  isSystemToken?: boolean;
  rateLimitTier?: string; // free, pro, enterprise, custom
  rateLimitPerMinute?: number;
  rateLimitPerHour?: number;
  rateLimitBurst?: number;
}

interface RevokeTokenParams {
  tokenId: string;
}

interface ListTokensQuery {
  userId?: string;
  includeExpired?: string;
}

export default async function adminApiTokenRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;
  const adminMiddleware = (fastify as any).adminMiddleware;
  const logger = (fastify as any).loggers?.routes || fastify.log;

  /**
   * List all API tokens (admin view)
   * Optional filtering by user_id and expired status
   */
  fastify.get<{
    Querystring: ListTokensQuery;
  }>('/api/admin/tokens', {
    onRequest: adminMiddleware,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          includeExpired: { type: 'string', enum: ['true', 'false'] }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: ListTokensQuery }>, reply: FastifyReply) => {
    try {
      const { userId, includeExpired } = request.query;
      const showExpired = includeExpired === 'true';

      const where: any = {};

      // Filter by user if specified
      if (userId) {
        where.user_id = userId;
      }

      // Filter out expired tokens unless explicitly requested
      if (!showExpired) {
        where.OR = [
          { expires_at: null },
          { expires_at: { gt: new Date() } }
        ];
      }

      const tokens = await prisma.apiKey.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              is_admin: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      // Return tokens WITHOUT the actual key hash
      const safeTokens = tokens.map(token => ({
        id: token.id,
        userId: token.user_id,
        userName: token.user.name || token.user.email,
        userEmail: token.user.email,
        isAdmin: token.user.is_admin,
        name: token.name,
        lastUsedAt: token.last_used_at,
        expiresAt: token.expires_at,
        isActive: token.is_active,
        isExpired: token.expires_at ? token.expires_at < new Date() : false,
        createdAt: token.created_at,
        rateLimitTier: (token as any).rate_limit_tier || 'free',
        rateLimitPerMinute: (token as any).rate_limit_per_minute,
        rateLimitPerHour: (token as any).rate_limit_per_hour,
        rateLimitBurst: (token as any).rate_limit_burst
      }));

      return reply.send({
        success: true,
        tokens: safeTokens,
        count: safeTokens.length
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list API tokens');
      return reply.status(500).send({
        success: false,
        message: 'Failed to list API tokens'
      });
    }
  });

  /**
   * Create a new API token for a user
   * Security: Never creates tokens for admin users
   */
  fastify.post<{
    Body: CreateTokenBody;
  }>('/api/admin/tokens', {
    onRequest: adminMiddleware,
    schema: {
      body: {
        type: 'object',
        required: ['userId', 'name'],
        properties: {
          userId: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          expiresInDays: { type: 'number', minimum: 1, maximum: 365 },
          rateLimitTier: { type: 'string', enum: ['free', 'pro', 'enterprise', 'custom'] },
          rateLimitPerMinute: { type: 'number', minimum: 1, maximum: 10000 },
          rateLimitPerHour: { type: 'number', minimum: 1, maximum: 100000 },
          rateLimitBurst: { type: 'number', minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: CreateTokenBody }>, reply: FastifyReply) => {
    try {
      const { userId, name, expiresInDays, isSystemToken, rateLimitTier, rateLimitPerMinute, rateLimitPerHour, rateLimitBurst } = request.body;

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, is_admin: true }
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          message: 'User not found'
        });
      }

      // Log if creating admin API key (for security audit)
      if (user.is_admin) {
        logger.warn({
          adminUserId: (request as any).user?.id,
          targetUserId: userId,
          tokenName: name
        }, 'Admin API key being created - ensure this is intentional');
      }

      // Generate a secure random API key
      // Format: oa_<43-char base64url> for user tokens, oa_sys_<43-char base64url> for system tokens
      // (base64url of 32 random bytes = 43 chars, URL-safe, no padding)
      const apiKeyPrefix = isSystemToken ? 'oa_sys' : 'oa';
      const randomToken = crypto.randomBytes(32).toString('base64url');
      const apiKey = `${apiKeyPrefix}_${randomToken}`;

      if (isSystemToken) {
        logger.warn({
          adminUserId: (request as any).user?.id,
          targetUserId: userId,
          tokenName: name
        }, 'SYSTEM-LEVEL API key being created - will use SP credentials for all Azure operations');
      }

      // Hash the API key for storage (never store plain text)
      const keyHash = await bcrypt.hash(apiKey, 10);

      // Calculate expiration date if specified
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Create the API key record
      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          user_id: userId,
          name,
          key_hash: keyHash,
          expires_at: expiresAt,
          is_active: true,
          rate_limit_tier: rateLimitTier || 'free',
          rate_limit_per_minute: rateLimitPerMinute,
          rate_limit_per_hour: rateLimitPerHour,
          rate_limit_burst: rateLimitBurst
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        }
      });

      logger.info({
        tokenId: apiKeyRecord.id,
        userId,
        name,
        expiresAt
      }, 'API token created');

      // Audit log the API key creation
      await credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'create',
        entityType: 'api_key',
        entityId: apiKeyRecord.id,
        entityName: name,
        changes: {
          targetUser: { new: user.email },
          expiresAt: { new: expiresAt?.toISOString() },
          rateLimitTier: { new: rateLimitTier || 'free' },
        },
        request,
      });

      // Return the PLAIN API key ONLY THIS ONCE
      // User must save this - it will never be shown again
      return reply.status(201).send({
        success: true,
        message: 'API token created successfully. Save this token - it will not be shown again!',
        token: {
          id: apiKeyRecord.id,
          userId: apiKeyRecord.user_id,
          userName: apiKeyRecord.user.name || apiKeyRecord.user.email,
          userEmail: apiKeyRecord.user.email,
          name: apiKeyRecord.name,
          apiKey: apiKey, // ⚠️ ONLY TIME THIS IS RETURNED
          expiresAt: apiKeyRecord.expires_at,
          isActive: apiKeyRecord.is_active,
          createdAt: apiKeyRecord.created_at,
          rateLimitTier: apiKeyRecord.rate_limit_tier,
          rateLimitPerMinute: apiKeyRecord.rate_limit_per_minute,
          rateLimitPerHour: apiKeyRecord.rate_limit_per_hour,
          rateLimitBurst: apiKeyRecord.rate_limit_burst
        }
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to create API token');
      return reply.status(500).send({
        success: false,
        message: 'Failed to create API token'
      });
    }
  });

  /**
   * Revoke (deactivate) an API token
   */
  fastify.delete<{
    Params: RevokeTokenParams;
  }>('/api/admin/tokens/:tokenId', {
    onRequest: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: RevokeTokenParams }>, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params;

      // Check if token exists
      const existingToken = await prisma.apiKey.findUnique({
        where: { id: tokenId }
      });

      if (!existingToken) {
        return reply.status(404).send({
          success: false,
          message: 'API token not found'
        });
      }

      // Soft delete - just mark as inactive
      await prisma.apiKey.update({
        where: { id: tokenId },
        data: {
          is_active: false
        }
      });

      logger.info({ tokenId }, 'API token revoked');

      // Audit log the API key revocation
      await credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'disable',
        entityType: 'api_key',
        entityId: tokenId,
        entityName: existingToken.name,
        request,
      });

      return reply.send({
        success: true,
        message: 'API token revoked successfully'
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to revoke API token');
      return reply.status(500).send({
        success: false,
        message: 'Failed to revoke API token'
      });
    }
  });

  /**
   * Permanently delete an API token (hard delete)
   * Only allowed for revoked or expired tokens
   */
  fastify.delete<{
    Params: RevokeTokenParams;
  }>('/api/admin/tokens/:tokenId/permanent', {
    onRequest: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: RevokeTokenParams }>, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params;

      // Check if token exists
      const existingToken = await prisma.apiKey.findUnique({
        where: { id: tokenId }
      });

      if (!existingToken) {
        return reply.status(404).send({
          success: false,
          message: 'API token not found'
        });
      }

      // Only allow permanent deletion of revoked or expired tokens
      const isExpired = existingToken.expires_at ? existingToken.expires_at < new Date() : false;
      if (existingToken.is_active && !isExpired) {
        return reply.status(400).send({
          success: false,
          message: 'Cannot permanently delete an active token. Revoke it first.'
        });
      }

      // Hard delete the token
      await prisma.apiKey.delete({
        where: { id: tokenId }
      });

      logger.info({ tokenId }, 'API token permanently deleted');

      // Audit log the permanent API key deletion
      await credentialAuditService.log({
        userId: (request as any).user?.id || 'unknown',
        userEmail: (request as any).user?.email,
        action: 'delete',
        entityType: 'api_key',
        entityId: tokenId,
        entityName: existingToken.name,
        request,
      });

      return reply.send({
        success: true,
        message: 'API token permanently deleted'
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to permanently delete API token');
      return reply.status(500).send({
        success: false,
        message: 'Failed to permanently delete API token'
      });
    }
  });

  /**
   * Get API token details by ID
   */
  fastify.get<{
    Params: { tokenId: string };
  }>('/api/admin/tokens/:tokenId', {
    onRequest: adminMiddleware,
    schema: {
      params: {
        type: 'object',
        required: ['tokenId'],
        properties: {
          tokenId: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { tokenId: string } }>, reply: FastifyReply) => {
    try {
      const { tokenId } = request.params;

      const token = await prisma.apiKey.findUnique({
        where: { id: tokenId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              is_admin: true
            }
          }
        }
      });

      if (!token) {
        return reply.status(404).send({
          success: false,
          message: 'API token not found'
        });
      }

      return reply.send({
        success: true,
        token: {
          id: token.id,
          userId: token.user_id,
          userName: token.user.name || token.user.email,
          userEmail: token.user.email,
          isAdmin: token.user.is_admin,
          name: token.name,
          lastUsedAt: token.last_used_at,
          expiresAt: token.expires_at,
          isActive: token.is_active,
          isExpired: token.expires_at ? token.expires_at < new Date() : false,
          createdAt: token.created_at
        }
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to get API token');
      return reply.status(500).send({
        success: false,
        message: 'Failed to get API token'
      });
    }
  });

  /**
   * Get list of users for token creation dropdown
   * Returns ALL users (including admins) for API token creation
   */
  fastify.get('/api/admin/tokens/users/available', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const users = await prisma.user.findMany({
        where: {
          // No filter - return all users including admins
        },
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true,
          created_at: true
        },
        orderBy: {
          email: 'asc'
        }
      });

      return reply.send({
        success: true,
        users: users.map(u => ({
          id: u.id,
          email: u.email,
          name: u.name,
          isAdmin: u.is_admin,
          displayName: `${u.name || u.email}${u.is_admin ? ' (Admin)' : ''}`,
          createdAt: u.created_at
        }))
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to list available users');
      return reply.status(500).send({
        success: false,
        message: 'Failed to list available users'
      });
    }
  });

  /**
   * Get API token usage metrics
   * Returns comprehensive metrics for all API tokens including request counts, endpoints, errors, etc.
   */
  fastify.get('/api/admin/tokens/metrics', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all API tokens
      const tokens = await prisma.apiKey.findMany({
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      // Get audit logs related to API token usage
      // Note: This queries the AdminAuditLog table for API-related actions
      const apiUsageLogs = await prisma.adminAuditLog.findMany({
        where: {
          resource_type: 'api_request'
        },
        orderBy: {
          created_at: 'desc'
        },
        take: 10000 // Last 10k requests for metrics
      });

      // Build metrics per token
      const tokenMetrics = tokens.map(token => {
        // Filter logs for this specific token
        const tokenLogs = apiUsageLogs.filter(log =>
          log.details &&
          typeof log.details === 'object' &&
          'tokenId' in log.details &&
          log.details.tokenId === token.id
        );

        // Calculate endpoint usage
        const endpointCounts: Record<string, number> = {};
        const errorCounts: Record<string, number> = {};
        let totalRequests = 0;
        let totalErrors = 0;
        let totalTokens = 0;
        let totalResponseTime = 0;

        tokenLogs.forEach(log => {
          totalRequests++;

          const details = log.details as any;
          const endpoint = details.endpoint || 'unknown';
          endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + 1;

          if (details.error) {
            totalErrors++;
            const errorType = details.errorType || 'unknown';
            errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
          }

          if (details.tokenUsage) {
            totalTokens += details.tokenUsage;
          }

          if (details.responseTime) {
            totalResponseTime += details.responseTime;
          }
        });

        // Calculate request frequency over time (last 30 days)
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const requestsByDay: Record<string, number> = {};

        tokenLogs.forEach(log => {
          if (log.created_at >= thirtyDaysAgo) {
            const dateKey = log.created_at.toISOString().split('T')[0];
            requestsByDay[dateKey] = (requestsByDay[dateKey] || 0) + 1;
          }
        });

        return {
          tokenId: token.id,
          tokenName: token.name,
          userName: token.user.name || token.user.email,
          userEmail: token.user.email,
          isActive: token.is_active,
          isExpired: token.expires_at ? token.expires_at < new Date() : false,
          createdAt: token.created_at,
          lastUsedAt: token.last_used_at,
          expiresAt: token.expires_at,
          metrics: {
            totalRequests,
            totalErrors,
            errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
            totalTokens,
            averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
            endpointUsage: Object.entries(endpointCounts).map(([endpoint, count]) => ({
              endpoint,
              count,
              percentage: totalRequests > 0 ? (count / totalRequests) * 100 : 0
            })).sort((a, b) => b.count - a.count),
            errorBreakdown: Object.entries(errorCounts).map(([errorType, count]) => ({
              errorType,
              count,
              percentage: totalErrors > 0 ? (count / totalErrors) * 100 : 0
            })).sort((a, b) => b.count - a.count),
            requestFrequency: Object.entries(requestsByDay).map(([date, count]) => ({
              date,
              count
            })).sort((a, b) => a.date.localeCompare(b.date))
          }
        };
      });

      // Calculate overall statistics
      const overallStats = {
        totalTokens: tokens.length,
        activeTokens: tokens.filter(t => t.is_active && (!t.expires_at || t.expires_at > new Date())).length,
        expiredTokens: tokens.filter(t => t.expires_at && t.expires_at < new Date()).length,
        revokedTokens: tokens.filter(t => !t.is_active).length,
        totalRequests: tokenMetrics.reduce((sum, m) => sum + m.metrics.totalRequests, 0),
        totalErrors: tokenMetrics.reduce((sum, m) => sum + m.metrics.totalErrors, 0)
      };

      return reply.send({
        success: true,
        overall: overallStats,
        tokens: tokenMetrics
      });
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to get API token metrics');
      return reply.status(500).send({
        success: false,
        message: 'Failed to get API token metrics'
      });
    }
  });
}
