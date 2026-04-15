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
 * Unified Authentication Middleware
 *
 * SIMPLIFIED VERSION - Uses single token validator
 *
 * Provides authentication for all routes, supporting both local JWT and Azure AD tokens.
 */

import { FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';
import { prisma } from '../utils/prisma.js';
import { loggers } from '../utils/logger.js';

/**
 * Extended request type with authenticated user
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    userId: string;
    email: string;
    name?: string;
    isAdmin: boolean;
    groups: string[];
    oid?: string;
    azureOid?: string;
    localAccount: boolean;
    accessToken?: string;  // Optional for local accounts
  };
  requestId?: string;
}

/**
 * Main authentication hook that validates tokens and attaches user to request
 */
export async function unifiedAuthHook(request: FastifyRequest): Promise<void> {
  const requestId = (request as any).requestId || 'unknown';
  const startTime = Date.now();

  try {
    // SECURITY: DEV_AUTH_BYPASS removed in v0.4.0 hardening
    // All authentication must go through proper channels

    // INTERNAL SERVICE BYPASS: Allow internal services (MCP Proxy, Agent Proxy) to call APIs
    // SECURITY: Requires shared secret (INTERNAL_SERVICE_SECRET) - IP check alone is insufficient
    // because nginx ingress runs inside the cluster and forwards with internal IPs.
    const requestFrom = request.headers['x-request-from'] as string;
    const internalServices = ['mcp-proxy', 'openagentic-proxy', 'internal'];
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;

    if (requestFrom && internalServices.includes(requestFrom.toLowerCase())) {
      const providedSecret = request.headers['x-internal-secret'] as string;

      // SECURITY: If INTERNAL_SERVICE_SECRET is configured, require it to match (timing-safe)
      const crypto = await import('crypto');
      if (internalSecret && providedSecret &&
          internalSecret.length === providedSecret.length &&
          crypto.timingSafeEqual(Buffer.from(internalSecret), Buffer.from(providedSecret))) {
        loggers.auth.debug({
          requestId,
          duration: Date.now() - startTime,
          mode: 'internal-service',
          service: requestFrom,
          clientIp: request.ip
        }, '[AUTH] Internal service authentication via shared secret');

        (request as any).user = {
          id: `service-${requestFrom}`,
          userId: `service-${requestFrom}`,
          email: `${requestFrom}@internal.openagentics.io`,
          name: `${requestFrom} Service`,
          isAdmin: false,
          groups: ['internal-services'],
          localAccount: true,
          accessToken: 'internal-service-token'
        };

        return;
      }

      // SECURITY: Block if secret doesn't match or isn't configured
      // IP-only fallback removed in v0.4.0 hardening (F-002)
      loggers.auth.warn({
        requestId,
        clientIp: request.ip,
        requestFrom,
        hasSecret: !!providedSecret,
        secretConfigured: !!internalSecret,
      }, '[AUTH] BLOCKED: x-request-from without valid internal secret');
    }

    // Check for API key first (X-API-Key header)
    // API keys have format: awc_<64-hex-chars>
    let token = request.headers['x-api-key'] as string;

    // If no API key, extract bearer token from header OR query params (for SSE where EventSource can't send headers)
    if (!token) {
      token = extractBearerToken(request.headers.authorization);
    }

    // If no token in header, check query params (specifically for SSE endpoints)
    if (!token) {
      const queryParams = request.query as { token?: string };
      token = queryParams.token || null;
    }

    // If no token in header or query, check cookies
    // Check multiple cookie names for compatibility:
    // - openagentic_token: Set by Google OAuth login flow
    // - accessToken: Legacy cookie name
    if (!token) {
      const cookies = (request as any).cookies as Record<string, string> | undefined;
      // Debug: Log raw cookie header and parsed cookies
      const rawCookieHeader = request.headers.cookie;
      loggers.auth.info({
        requestId,
        rawCookieHeader: rawCookieHeader?.substring(0, 100),
        cookieKeys: cookies ? Object.keys(cookies) : 'undefined',
        hasOpenagenticToken: !!cookies?.openagentic_token
      }, '[AUTH DEBUG] Cookie parsing check');

      token = cookies?.openagentic_token || cookies?.accessToken || null;
      if (token) {
        const cookieName = cookies?.openagentic_token ? 'openagentic_token' : 'accessToken';
        loggers.auth.debug({ requestId, cookieName }, '[AUTH] Token extracted from cookie');
      }
    }

    if (!token) {
      throw new Error('No authentication token provided');
    }

    // Validate token using unified validator
    const result = await validateAnyToken(token, {
      logger: loggers.auth
    });

    if (!result.isValid) {
      throw new Error(result.error || 'Invalid authentication token');
    }

    const user = result.user!;

    // Build unified user object
    (request as any).user = {
      id: user.userId,
      userId: user.userId,
      oid: (user as any).oid,
      email: user.email,
      name: user.name,
      groups: user.groups || [],
      isAdmin: user.isAdmin || false,
      azureOid: (user as any).azureOid || (user as any).oid,
      localAccount: result.tokenType === 'local',
      accessToken: token,
      authMethod: result.tokenType  // 'api-key' | 'azure-ad' | 'local' — used by tool execution to decide auth strategy
    };

    // CRITICAL: For LOCAL auth, load azure_oid from database if available
    // This enables OBO authentication for users who have linked Azure AD accounts
    if (result.tokenType === 'local' && user.userId) {
      try {
        const dbUser = await prisma.user.findFirst({
          where: { id: user.userId },
          select: { azure_oid: true }
        });

        if (dbUser?.azure_oid) {
          (request as any).user.azureOid = dbUser.azure_oid;
          (request as any).user.oid = dbUser.azure_oid;

          loggers.auth.debug({
            requestId,
            userId: user.userId,
            azureOid: dbUser.azure_oid
          }, '[AUTH] Loaded azure_oid from database for local auth user');
        }
      } catch (dbError) {
        loggers.auth.warn({
          requestId,
          userId: user.userId,
          error: dbError
        }, '[AUTH] Failed to load azure_oid from database - OBO may not work');
      }
    }

    // Auto-sync Azure AD users to database
    if (result.tokenType === 'azure-ad' && user.email) {
      try {
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { azure_oid: (user as any).oid },
              { email: user.email }
            ]
          }
        });

        if (!existingUser) {
          // Auto-create Azure AD user in database
          const newUser = await prisma.user.create({
            data: {
              id: `azure_${(user as any).oid || user.userId}`,
              email: user.email,
              name: user.name || user.email,
              azure_oid: (user as any).oid,
              azure_tenant_id: user.tenantId || 'default-tenant',
              is_admin: user.isAdmin,
              groups: user.groups,
              created_at: new Date(),
              updated_at: new Date()
            }
          });

          // Update user ID to match database record
          (request as any).user.id = newUser.id;
          (request as any).user.userId = newUser.id;

          loggers.auth.info({
            requestId,
            userId: newUser.id,
            email: user.email,
            azureOid: (user as any).oid
          }, '[AUTH] Auto-created Azure AD user in database');
        } else {
          // Update user ID to match existing database record
          (request as any).user.id = existingUser.id;
          (request as any).user.userId = existingUser.id;

          // Update existing user's Azure AD info
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              azure_oid: (user as any).oid,
              name: user.name,
              is_admin: user.isAdmin,
              groups: user.groups,
              updated_at: new Date()
            }
          });
        }
      } catch (dbError) {
        loggers.auth.error({
          requestId,
          error: dbError,
          userEmail: user.email,
          azureOid: (user as any).oid
        }, '[AUTH] Failed to auto-sync Azure AD user to database');
        // Continue with authentication even if DB sync fails
      }
    }

    (request as any).requestId = requestId;

    // Store API key info on request for tracking
    if (result.tokenType === 'api-key' && result.apiKeyId) {
      (request as any).apiKeyId = result.apiKeyId;
      (request as any).apiKeyName = result.apiKeyName;

      // Log API key usage to AdminAuditLog for metrics
      // This is done async to not block the request
      prisma.adminAuditLog.create({
        data: {
          admin_user_id: (request as any).user.id,
          action: 'api_request',
          resource_type: 'api_key_usage',
          resource_id: result.apiKeyId || 'unknown',
          details: {
            tokenId: result.apiKeyId,
            tokenName: result.apiKeyName,
            endpoint: request.url,
            method: request.method,
            timestamp: new Date().toISOString()
          }
        }
      }).catch(err => {
        loggers.auth.warn({ error: err.message }, '[AUTH] Failed to log API request for metrics');
      });
    }

    loggers.auth.debug({
      requestId,
      userId: (request as any).user.id,
      email: (request as any).user.email,
      tokenType: result.tokenType,
      apiKeyId: result.apiKeyId,
      duration: Date.now() - startTime
    }, '[AUTH] Authentication successful');

  } catch (error: any) {
    loggers.auth.warn({
      requestId,
      error: error.message,
      duration: Date.now() - startTime
    }, '[AUTH] Authentication failed');

    // Clear any partial user data
    delete (request as any).user;

    throw error;
  }
}

/**
 * Middleware function for use with preHandler
 */
export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await unifiedAuthHook(request);
  } catch (error: any) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
  }
}

/**
 * Admin middleware function
 */
export async function adminMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await unifiedAuthHook(request);
    const user = (request as any).user;
    if (!user?.isAdmin) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Administrator access required'
      });
      return;
    }
  } catch (error: any) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
  }
}

/**
 * Plugin registration for Fastify
 */
export const authMiddlewarePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', authMiddleware);
  fastify.decorate('authenticateAdmin', adminMiddleware);
};