/**
 * Unified Authentication Middleware
 *
 * SIMPLIFIED VERSION - Uses single token validator
 *
 * Provides authentication for all routes, supporting local JWT tokens and
 * oa_/oa_sys_ API keys, plus the internal-service-secret bypass.
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
    localAccount: boolean;
    accessToken?: string;  // Optional for local accounts
    /**
     * Caller's tenant id, propagated from the validated UserContext.
     * Local JWT: 'local'.
     * API key: 'api-key'.
     * SEV-0 Flows-fix-A1: this field is REQUIRED by `defaultTenantExtractor`
     * in middleware/tenantContext.ts — its absence is what caused every
     * Flows execution to ship tenantId:null to workflows-svc and 400.
     */
    tenantId?: string | null;
  };
  requestId?: string;
}

/**
 * Pure helper: build the `request.user` payload from a validated UserContext.
 *
 * Exported so the unit-test pin (middleware/__tests__/unifiedAuth-tenantId-propagation.test.ts)
 * can assert that `tenantId` is propagated end-to-end without spinning up a
 * full Fastify instance (the Bun raw.writableEnded quirk makes that
 * unreliable — see workflows-integration.test.ts for prior art).
 *
 * SEV-0 Flows-fix-A1: this MUST forward `tenantId` from the validated user
 * onto the request.user object so `defaultTenantExtractor` can resolve it.
 */
export function buildRequestUser(
  validatedUser: {
    userId: string;
    email: string;
    name?: string;
    isAdmin?: boolean;
    groups?: string[];
    tenantId?: string;
  },
  tokenType: 'local' | 'api-key',
  token: string,
): AuthenticatedRequest['user'] & { authMethod: string } {
  return {
    id: validatedUser.userId,
    userId: validatedUser.userId,
    email: validatedUser.email,
    name: validatedUser.name,
    groups: validatedUser.groups || [],
    isAdmin: validatedUser.isAdmin || false,
    localAccount: tokenType === 'local',
    accessToken: token,
    authMethod: tokenType,
    // SEV-0 Flows-fix-A1: tokenValidator populates this for every token type
    // (local: 'local', api-key: 'api-key'). Pre-fix this field was dropped
    // here and every authenticated request had request.tenantId === null,
    // breaking Flows end-to-end.
    tenantId: validatedUser.tenantId ?? null,
  };
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

        // INTERNAL-AUTH USER PROPAGATION (2026-05-14):
        // When the internal-secret-authenticated service forwards an
        // X-User-Id header, resolve that real user from the DB and
        // attach them as request.user instead of a synthetic service
        // identity. This unblocks the engine→api gap surfaced by the
        // capstone: data_source_query + create_subflow both call api
        // endpoints that filter by userId (service.getById(id, userId),
        // workflows.created_by FK) — without a real user resolution,
        // those requests 404 or violate FK constraints.
        //
        // The internal secret is the AUTHENTICATION; X-User-Id is the
        // IDENTITY CLAIM. Both must be valid: the secret proves the
        // caller is a trusted in-cluster service, the header tells us
        // which end-user that service is acting on behalf of.
        const forwardedUserId = request.headers['x-user-id'] as string | undefined;
        const forwardedUserEmail = request.headers['x-user-email'] as string | undefined;
        if (forwardedUserId) {
          try {
            const { prisma } = await import('../utils/prisma.js');
            const user = await prisma.user.findUnique({
              where: { id: forwardedUserId },
              select: { id: true, email: true, name: true, is_admin: true, azure_tenant_id: true, groups: true },
            });
            if (user) {
              loggers.auth.debug({
                requestId,
                duration: Date.now() - startTime,
                mode: 'internal-service-as-user',
                service: requestFrom,
                userId: user.id,
                clientIp: request.ip,
              }, '[AUTH] Internal service authenticated, acting as forwarded user');

              (request as any).user = {
                id: user.id,
                userId: user.id,
                email: user.email,
                name: user.name,
                isAdmin: user.is_admin,
                groups: user.groups ?? [],
                tenantId: user.azure_tenant_id ?? null,
                localAccount: false,
                accessToken: 'internal-service-token',
                forwardedFrom: requestFrom,
              };
              return;
            }
            // X-User-Id was provided but the user does not exist — fall
            // through to the service identity so the request still
            // authenticates as an internal caller (but writes that
            // require a real user FK will still fail correctly).
            loggers.auth.warn({
              requestId,
              service: requestFrom,
              forwardedUserId,
              forwardedUserEmail,
            }, '[AUTH] Internal-service forwarded X-User-Id did not match any user row');
          } catch (err: any) {
            loggers.auth.warn({
              requestId,
              service: requestFrom,
              forwardedUserId,
              err: err.message,
            }, '[AUTH] Failed to resolve internal-service forwarded user — falling back to service identity');
          }
        }

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
          email: `${requestFrom}@internal.openagentic.io`,
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
    // API keys have format: oa_<43-base64url-chars> (user keys),
    // or oa_sys_<...> (system / inter-service tokens).
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
    // - openagentic_token: Set by the local login flow
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

    // Build unified user object via the exported helper so the SEV-0
    // Flows-fix-A1 unit test can pin field-copy semantics — notably the
    // tenantId propagation that drives every tenanted DB query downstream.
    (request as any).user = buildRequestUser(user as any, result.tokenType!, token);

    // For LOCAL auth, reconcile the request.user.id with the DB record.
    if (result.tokenType === 'local' && user.userId) {
      try {
        const dbUser = await prisma.user.findFirst({
          where: { id: user.userId },
          select: { id: true }
        });

        // Sev-0 — JWT was minted with a non-DB id (or the DB id rotated
        // post-mint). Without this fallback, every authenticated POST after
        // session creation 403s SESSION_NOT_OWNED because request.user.id
        // stays at the stale id.
        if (!dbUser && user.email) {
          const byEmail = await prisma.user.findUnique({
            where: { email: user.email },
            select: { id: true }
          });
          if (byEmail) {
            (request as any).user.id = byEmail.id;
            (request as any).user.userId = byEmail.id;
            loggers.auth.info({
              requestId,
              tokenUserId: user.userId,
              dbUserId: byEmail.id,
              email: user.email
            }, '[AUTH] Local-token user.id missed DB; remapped via email lookup');
          }
        }
      } catch (dbError) {
        loggers.auth.warn({
          requestId,
          userId: user.userId,
          error: dbError
        }, '[AUTH] Failed to reconcile local-auth user id with database');
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
    await reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
    return;
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
      await reply.code(403).send({
        error: 'Forbidden',
        message: 'Administrator access required'
      });
      return;
    }
  } catch (error: any) {
    await reply.code(401).send({
      error: 'Unauthorized',
      message: error.message || 'Authentication required'
    });
    return;
  }
}

/**
 * Plugin registration for Fastify
 */
export const authMiddlewarePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate('authenticate', authMiddleware);
  fastify.decorate('authenticateAdmin', adminMiddleware);
};