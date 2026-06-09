/**
 * Authentication Routes
 *
 * Core authentication endpoints for the OSS edition: local username/password
 * (see routes/local-auth.ts) plus inter-service token validation and API-key
 * management. Handles session validation, token verification, and profile
 * operations against locally-issued HS256 JWTs and oa_/oa_sys_ API keys.
 */

import { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { validateAnyToken } from '../auth/tokenValidator.js';
import { prisma } from '../utils/prisma.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../utils/auditTrail.js';

interface TokenValidateRequest {
  token: string;
}

interface UserInfoResponse {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  isAdmin: boolean;
  groups?: string[];
}

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const auditTrail = new AuditTrail();
  const logger = fastify.log;

  // Use Prisma instead of raw Pool - tables are managed by migrations

  /**
   * Validate token and get user info with admin status
   */
  fastify.post<{ Body: TokenValidateRequest }>('/api/auth/validate', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            tenantId: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            isAdmin: { type: 'boolean' },
            groups: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.body;

    try {
      const validationResult = await validateAnyToken(token);

      if (!validationResult.isValid) {
        return reply.code(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      const user = validationResult.user!;
      const isAdmin = user.isAdmin || false;
      const groups = user.groups || [];

      const response: UserInfoResponse = {
        userId: user.userId,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        isAdmin,
        groups
      };

      // Audit successful login/token validation
      try {
        await auditTrail.log({
          timestamp: new Date(),
          eventType: AuditEventType.LOGIN_SUCCESS,
          severity: AuditSeverity.INFO,
          userId: user.userId,
          userEmail: user.email,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          action: 'Token validation successful',
          details: {
            endpoint: '/api/auth/validate',
            isAdmin,
            groupCount: groups?.length || 0,
            authType: 'local'
          },
          success: true
        });
      } catch (auditError) {
        logger.warn({ error: auditError, userId: user.userId }, 'Failed to log login audit event');
      }

      return reply.send(response);
    } catch (error) {
      request.log.error({ error }, 'Token validation error');
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to validate token'
      });
    }
  });

  /**
   * Verify token for service-to-service authentication
   * Used by openagentic-workflows service to validate user tokens
   * Supports both JWT tokens and API keys
   */
  fastify.post('/api/auth/verify', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7);

    try {
      let dbUser: any = null;

      // Check if this is an API key (starts with oa_ for user keys or oa_sys_ for system tokens)
      if (token.startsWith('oa_')) {
        logger.info({ tokenPrefix: token.substring(0, 15) + '...' }, '[Auth] Validating API key');

        // Find all active API keys
        const apiKeys = await prisma.apiKey.findMany({
          where: {
            is_active: true,
            OR: [
              { expires_at: null },
              { expires_at: { gt: new Date() } }
            ]
          },
          include: {
            user: true
          }
        });

        // Compare token against each key hash
        let matchedKey = null;
        for (const apiKey of apiKeys) {
          const isMatch = await bcrypt.compare(token, apiKey.key_hash);
          if (isMatch) {
            matchedKey = apiKey;
            break;
          }
        }

        if (!matchedKey) {
          logger.warn({ tokenPrefix: token.substring(0, 15) + '...' }, '[Auth] Invalid or expired API key');
          return reply.code(401).send({
            error: 'Invalid API key',
            message: 'API key is invalid, expired, or has been revoked'
          });
        }

        // Update last_used_at timestamp
        await prisma.apiKey.update({
          where: { id: matchedKey.id },
          data: { last_used_at: new Date() }
        });

        dbUser = matchedKey.user;

        logger.info({
          userId: dbUser.id,
          email: dbUser.email,
          tokenName: matchedKey.name,
          tokenId: matchedKey.id
        }, '[Auth] API key validated successfully');

      } else {
        // JWT token validation
        logger.info({ tokenPrefix: token.substring(0, 20) + '...' }, '[Auth] Validating JWT token');

        const validationResult = await validateAnyToken(token);

        if (!validationResult.isValid) {
          return reply.code(401).send({
            error: 'Invalid token',
            message: validationResult.error || 'Token validation failed'
          });
        }

        const user = validationResult.user!;

        // Get user from database to fetch roles and permissions
        dbUser = await prisma.user.findFirst({
          where: {
            OR: [
              { email: user.email },
              { id: user.userId }
            ]
          }
        });

        if (!dbUser) {
          return reply.code(404).send({
            error: 'User not found',
            message: 'User not found in database'
          });
        }

        logger.info({
          userId: dbUser.id,
          email: dbUser.email
        }, '[Auth] JWT token validated successfully');
      }

      // TODO: Re-enable when RBAC schema is added
      // Extract roles and permissions
      const roles: string[] = [];
      const permissions: string[] = [];

      // Return user context with roles and permissions
      return reply.send({
        user: {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          is_admin: dbUser.is_admin,
          roles,
          permissions
        }
      });

    } catch (error) {
      request.log.error({ error }, '[Auth] Token verification error');
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to verify token'
      });
    }
  });

  /**
   * GET version of auth/verify for nginx auth_request
   * nginx auth_request uses GET by default for internal subrequests
   * Returns 200 for valid session, 401 for invalid
   */
  fastify.get('/api/auth/verify', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const cookieHeader = request.headers.cookie;

    // Try to extract token from Authorization header first, then from cookie
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (cookieHeader) {
      // Parse cookies - check multiple possible cookie names
      const cookies = cookieHeader.split(';').map(c => c.trim());
      for (const cookie of cookies) {
        // Check for OpenAgentic session cookies (set by local login)
        if (cookie.startsWith('openagentic_token=') ||
            cookie.startsWith('session=') ||
            cookie.startsWith('oa_session=')) {
          token = cookie.split('=')[1];
          break;
        }
      }
      // If no session cookie found, try 'token' cookie (legacy)
      if (!token) {
        for (const cookie of cookies) {
          if (cookie.startsWith('token=')) {
            token = cookie.split('=')[1];
            break;
          }
        }
      }
    }

    if (!token) {
      // No token found - reject
      logger.debug('[Auth Verify GET] No token found in headers or cookies');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      // Validate the token
      const validationResult = await validateAnyToken(token);

      if (!validationResult.isValid || !validationResult.user) {
        logger.debug({ error: validationResult.error }, '[Auth Verify GET] Token validation failed');
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Token is valid - set user info headers for nginx auth_request_set
      // These headers will be passed to downstream services
      const user = validationResult.user;
      reply.header('X-Auth-User-Id', user.userId);
      reply.header('X-Auth-User-Email', user.email);
      reply.header('X-Auth-User-Name', user.name || user.email);
      reply.header('X-Auth-User-Admin', user.isAdmin ? 'true' : 'false');
      reply.header('X-Auth-Token-Type', validationResult.tokenType || 'unknown');

      logger.debug({ userId: user.userId, email: user.email }, '[Auth Verify GET] Token validated successfully');
      return reply.code(200).send({ status: 'ok' });

    } catch (error) {
      logger.error({ error }, '[Auth Verify GET] Token verification error');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  /**
   * Get current user info from request headers
   */
  fastify.get('/api/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7);

    try {
      // First try to validate as a local JWT token
      let user: any;

      try {
        const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();

        // Try to decode and verify as JWT
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;

        // If successful, it's a local JWT token
        user = {
          userId: decoded.userId || decoded.id,
          email: decoded.email,
          name: decoded.name,
          isAdmin: decoded.isAdmin || false,
          groups: decoded.groups || [],
          tenantId: decoded.tenantId || 'local'
        };
      } catch (jwtError) {
        // Not a valid local JWT, use unified validator
        const validationResult = await validateAnyToken(token);

        if (!validationResult.isValid) {
          return reply.code(401).send({
            error: 'Invalid token',
            message: validationResult.error || 'Token validation failed'
          });
        }

        user = validationResult.user!;
      }

      let isAdmin = user.isAdmin || false;
      let groups = user.groups || [];

      // ENHANCED ADMIN DETECTION: Handle first-time login and database race conditions

      // Step 1: Try to get groups from JWT first (fastest)
      if (user.groups && user.groups.length > 0) {
        groups = user.groups;
        isAdmin = user.isAdmin || false;
        request.log.info({ userId: user.userId, source: 'jwt', groupCount: groups.length, isAdmin }, 'Admin status from JWT token');
      }

      // Step 2: If no groups in JWT, fetch from database (for existing users)
      if (groups.length === 0) {
        try {
          const localUser = await prisma.user.findFirst({
            where: {
              OR: [
                { email: user.email },
                { id: user.userId }
              ]
            },
            select: { groups: true, is_admin: true }
          });

          if (localUser && localUser.groups && localUser.groups.length > 0) {
            groups = localUser.groups;
            isAdmin = localUser.is_admin || false;
            request.log.info({ userId: user.userId, source: 'database', groupCount: groups.length, isAdmin }, 'Admin status from database');
          }
        } catch (error) {
          request.log.warn({ error }, 'Failed to fetch groups from database');
        }
      }

      // Step 3: Final fallback - if we still have no group info but token indicates admin, trust the token
      if (groups.length === 0 && (user.isAdmin || user.is_admin)) {
        isAdmin = true;
        request.log.warn({
          userId: user.userId,
          source: 'token-fallback',
          tokenIsAdmin: user.isAdmin || user.is_admin
        }, 'Using admin status from token as final fallback (no groups available)');
      }

      const response: UserInfoResponse = {
        userId: user.userId,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        isAdmin,
        groups
      };

      return reply.send(response);
    } catch (error) {
      request.log.error({ error }, 'Get user info error');
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to get user info'
      });
    }
  });

  /**
   * Logout endpoint
   * Supports both GET and POST for compatibility
   */
  fastify.get('/api/auth/logout', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        // Audit successful logout
        try {
          await auditTrail.log({
            timestamp: new Date(),
            eventType: AuditEventType.LOGOUT,
            severity: AuditSeverity.INFO,
            userId: decoded.userId || decoded.id,
            userEmail: decoded.email,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            action: 'User logout successful',
            details: {
              endpoint: '/api/auth/logout (GET)'
            },
            success: true
          });
        } catch (auditError) {
          logger.warn({ error: auditError, userId: decoded.userId || decoded.id }, 'Failed to log logout audit event');
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to audit logout');
      }
    }

    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        let userId: string | undefined;
        let email: string | undefined;

        try {
          const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          userId = decoded.userId || decoded.id;
          email = decoded.email;
        } catch {
          // Try unified validator
          const validationResult = await validateAnyToken(token);
          if (validationResult.isValid && validationResult.user) {
            userId = validationResult.user.userId;
            email = validationResult.user.email;
          }
        }

        if (userId) {
          // Audit successful logout
          try {
            await auditTrail.log({
              timestamp: new Date(),
              eventType: AuditEventType.LOGOUT,
              severity: AuditSeverity.INFO,
              userId: userId,
              userEmail: email,
              ipAddress: request.ip,
              userAgent: request.headers['user-agent'],
              action: 'User logout successful',
              details: {
                endpoint: '/api/auth/logout (POST)'
              },
              success: true
            });
          } catch (auditError) {
            logger.warn({ error: auditError, userId }, 'Failed to log logout audit event');
          }
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to process logout');
      }
    }

    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  /**
   * Accept disclaimer endpoint
   * Records the timestamp when user accepted the federal government system disclaimer
   */
  fastify.post('/api/auth/accept-disclaimer', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);

    try {
      // Validate token and get user ID
      const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId || decoded.id;

      if (!userId) {
        return reply.code(401).send({ error: 'Invalid token' });
      }

      // Update user's disclaimer_accepted_at timestamp
      await prisma.user.update({
        where: { id: userId },
        data: {
          disclaimer_accepted_at: new Date()
        }
      });

      logger.info({
        userId,
        email: decoded.email,
        timestamp: new Date()
      }, 'AUDIT: User accepted federal government system disclaimer');

      return reply.send({
        success: true,
        message: 'Disclaimer accepted successfully'
      });
    } catch (error) {
      logger.error({ error }, 'Failed to record disclaimer acceptance');
      return reply.code(500).send({
        error: 'Failed to record disclaimer acceptance'
      });
    }
  });

  /**
   * Lightweight token validation for service-to-service auth (openagentic-proxy, etc.)
   * Validates the Bearer token from the Authorization header and returns user identity.
   * Supports both JWT tokens and API keys (oa_* for user keys, oa_sys_* for system tokens).
   */
  fastify.post('/api/auth/validate-token', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing Bearer token' });
    }

    const token = authHeader.substring(7);

    try {
      // Check if this is an API key (oa_ for user keys, oa_sys_ for system tokens)
      if (token.startsWith('oa_')) {
        const apiKeys = await prisma.apiKey.findMany({
          where: {
            is_active: true,
            OR: [
              { expires_at: null },
              { expires_at: { gt: new Date() } }
            ]
          },
          include: { user: true }
        });

        for (const apiKey of apiKeys) {
          const isMatch = await bcrypt.compare(token, apiKey.key_hash);
          if (isMatch) {
            await prisma.apiKey.update({
              where: { id: apiKey.id },
              data: { last_used_at: new Date() }
            });
            return reply.send({
              userId: apiKey.user.id,
              email: apiKey.user.email,
              isAdmin: apiKey.user.is_admin || false,
              groups: apiKey.user.groups || [],
              authMethod: 'api-key',
            });
          }
        }

        return reply.code(401).send({ error: 'Invalid API key' });
      }

      // JWT token validation
      const validationResult = await validateAnyToken(token);
      if (!validationResult.isValid || !validationResult.user) {
        return reply.code(401).send({ error: validationResult.error || 'Invalid token' });
      }

      const user = validationResult.user;

      // Look up local user for groups/admin
      const dbUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: user.email },
            { id: user.userId }
          ]
        }
      });

      return reply.send({
        userId: dbUser?.id || user.userId,
        email: dbUser?.email || user.email,
        isAdmin: dbUser?.is_admin || user.isAdmin || false,
        groups: dbUser?.groups || user.groups || [],
        authMethod: validationResult.tokenType || 'jwt',
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'validate-token failed');
      return reply.code(500).send({ error: 'Token validation failed' });
    }
  });

  // Change password endpoint (local username/password accounts)
  fastify.post<{
    Body: {
      currentPassword: string;
      newPassword: string;
    };
  }>('/change-password', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send({ error: 'Authentication required' });
        return;
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 8 }
        }
      }
    }
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    const authHeader = request.headers.authorization!;
    const token = authHeader.substring(7);

    try {
      // Validate current token (local JWT or API key)
      const validationResult = await validateAnyToken(token);
      if (!validationResult.isValid || !validationResult.user) {
        return reply.status(401).send({ error: 'Invalid authentication token' });
      }

      const userId = validationResult.user.userId;

      // Load the local user record and its password hash
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { id: userId },
            { email: validationResult.user.email }
          ]
        }
      });

      if (!user || !user.password_hash) {
        return reply.status(400).send({
          error: 'Password change not supported',
          message: 'This account does not have a local password set.'
        });
      }

      // Verify the current password
      const currentMatches = await bcrypt.compare(currentPassword, user.password_hash);
      if (!currentMatches) {
        return reply.status(401).send({
          error: 'Invalid current password',
          message: 'The current password is incorrect.'
        });
      }

      // Hash and store the new password
      const newHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password_hash: newHash,
          force_password_change: false,
          updated_at: new Date()
        }
      });

      logger.info({ userId: user.id }, 'AUDIT: User changed local password');

      return reply.send({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error) {
      fastify.log.error({ err: error }, 'Password change error');
      return reply.status(500).send({
        error: 'Failed to change password',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Token validation endpoint (mapped from /api/auth/validate)
  fastify.post<{ Body: TokenValidateRequest }>('/validate-token', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.body;

    try {
      const validationResult = await validateAnyToken(token);

      if (!validationResult.isValid) {
        return reply.status(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      const user = validationResult.user!;
      const isAdmin = user.isAdmin || false;
      const groups = user.groups || [];

      const response: UserInfoResponse = {
        userId: user.userId,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        isAdmin,
        groups
      };

      // Audit successful token validation
      try {
        await auditTrail.log({
          timestamp: new Date(),
          eventType: AuditEventType.LOGIN_SUCCESS,
          severity: AuditSeverity.INFO,
          userId: user.userId,
          userEmail: user.email,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          action: 'Login token validation successful',
          details: {
            endpoint: '/validate-token',
            isAdmin,
            groupCount: groups?.length || 0,
            authType: 'local'
          },
          success: true
        });
      } catch (auditError) {
        logger.warn({ error: auditError, userId: user.userId }, 'Failed to log login audit event');
      }

      return reply.send({ valid: true, user: response });
    } catch (error) {
      request.log.error({ error }, 'Token validation error');
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to validate token'
      });
    }
  });

  // User info endpoint (mapped from /api/auth/me)
  fastify.get('/user-info', async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'No authentication token provided'
      });
    }

    const token = authHeader.substring(7);

    try {
      const validationResult = await validateAnyToken(token);
      const user = validationResult.user!;

      if (!validationResult.isValid) {
        return reply.status(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      const isAdmin = user.isAdmin || false;
      const groups = user.groups || [];

      const response: UserInfoResponse = {
        userId: user.userId,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        isAdmin,
        groups
      };

      return reply.send(response);
    } catch (error) {
      request.log.error({ error }, 'Get user info error');
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to get user info'
      });
    }
  });

  // Get client IP for security checks
  fastify.get('/api/auth/client-ip', async (request, reply) => {
    // Extract client IP from various possible headers
    const clientIp =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      'UNKNOWN';

    logger.info({ clientIp }, 'Client IP requested');

    return reply.send({ ip: clientIp });
  });

  // Log intrusion attempts (honeypot) - rate limited, uses server-detected IP only
  fastify.post('/api/security/log-intrusion', async (request: FastifyRequest, reply: FastifyReply) => {
    const { action } = (request.body || {}) as { action?: string };

    // SECURITY: Use server-detected IP only — never trust client-reported IP
    const clientIp = request.ip || 'UNKNOWN';
    const userAgent = (request.headers['user-agent'] || 'UNKNOWN').substring(0, 500);
    const referer = (request.headers['referer'] || 'NONE').substring(0, 500);
    // Sanitize action to prevent log injection
    const sanitizedAction = (action || 'unknown').replace(/[\r\n\t]/g, ' ').substring(0, 200);

    logger.warn({
      event: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      ip: clientIp,
      action: sanitizedAction,
      userAgent,
      referer,
    }, 'Intrusion attempt detected');

    // Log to audit trail with WARNING severity (not CRITICAL - to prevent alert fatigue from automated probes)
    try {
      await auditTrail.log({
        timestamp: new Date(),
        eventType: AuditEventType.SECURITY_ALERT,
        userId: 'UNAUTHORIZED',
        severity: AuditSeverity.WARNING,
        action: `Unauthorized access attempt from IP ${clientIp}`,
        ipAddress: clientIp,
        userAgent,
        details: {
          attemptedAction: sanitizedAction,
          referer,
          endpoint: '/login'
        },
        success: false
      });
    } catch (error) {
      logger.error({ error }, 'Failed to log intrusion to audit trail');
    }

    return reply.send({ success: true });
  });

  fastify.log.info('Authentication routes registered');
};
