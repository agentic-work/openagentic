/**
 * Authentication Routes
 * 
 * Core authentication endpoints supporting multiple providers including
 * Azure AD OAuth2, local authentication, and API key management.
 * Handles user sessions, token management, and profile operations.
 * 
 */

import { FastifyPluginAsync, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AzureADAuthService } from '../auth/azureADAuth.js';
import { validateAnyToken, extractBearerToken } from '../auth/tokenValidator.js';
import { UserAuthService } from '../services/UserAuthService.js';
import { AzureOBOService } from '../services/AzureOBOService.js';
import { AdminValidationService } from '../services/AdminValidationService.js';
import { AzureTokenService } from '../services/AzureTokenService.js';
import { ChatMCPService } from './chat/services/ChatMCPService.js';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';
import { AuditTrail, AuditEventType, AuditSeverity } from '../utils/auditTrail.js';
import { logAuthEvent } from '../services/audit/authAuditLogger.js';

interface TokenValidateRequest {
  token: string;
  graphToken?: string; // Optional Microsoft Graph token for fetching group memberships
}

interface UserInfoResponse {
  userId: string;
  tenantId: string;
  email?: string;
  name?: string;
  isAdmin: boolean;
  groups?: string[];
}

// Initialize user MCP instances based on their role - UNIFIED FOR ALL AUTH METHODS
async function initializeUserMCPInstances(
  userId: string,
  token: string,
  email: string | undefined,
  isAdmin: boolean,
  groups: string[] = [],
  logger: any
): Promise<void> {
  const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';

  logger.info({
    userId,
    email,
    isAdmin,
    groups,
    mcpoUrl,
    authMethod: 'azure-ad'
  }, 'USER LOGIN: Notifying MCP orchestrator to spawn Azure MCP with appropriate service principal');

  try {
    // Call the SAME user-login endpoint for ALL auth methods
    // MCP orchestrator will spawn Azure MCP with correct SP based on groups/admin status
    const loginResponse = await fetch(`${mcpoUrl}/api/mcp/user-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId
      },
      body: JSON.stringify({
        userId: userId,
        email: email || '',
        groups: groups, // Pass the actual groups for auditing
        token: token,
        isAdmin: isAdmin // Pass admin status for SP selection
      })
    });

    if (loginResponse.ok) {
      const result = await loginResponse.json();
      logger.info({
        userId,
        email,
        isAdmin,
        groups,
        azureStatus: result.azure,
        memoryStatus: result.memory,
        spType: isAdmin ? 'ADMIN' : 'READ-ONLY'
      }, 'AUDIT: Successfully spawned Azure MCP for user with appropriate service principal');
    } else {
      const errorText = await loginResponse.text();
      logger.error({
        userId,
        email,
        status: loginResponse.status,
        error: errorText
      }, 'AUDIT: Failed to spawn Azure MCP for user');
    }
  } catch (error) {
    logger.error({
      userId,
      email,
      error: error.message
    }, 'AUDIT: Error calling MCP orchestrator for user login');
    // Don't fail login if MCP initialization fails
  }
}

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const azureADAuthService = new AzureADAuthService({}, fastify.log as any);
  const oboService = new AzureOBOService(fastify.log);
  const azureTokenService = new AzureTokenService(fastify.log as any);
  const mcpService = new ChatMCPService(fastify.log);
  const auditTrail = new AuditTrail();
  const adminValidation = new AdminValidationService(
    prisma,
    azureTokenService,
    mcpService,
    fastify.log as any
  );
  const logger = fastify.log;

  // MCP Proxy URL for per-user Azure MCP sessions
  const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
  
  // Use Prisma instead of raw Pool - tables are managed by migrations

  /**
   * Validate token and get user info with admin status
   */
  // Prisma client imported above

  fastify.post<{ Body: TokenValidateRequest }>('/api/auth/validate', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          graphToken: { type: 'string' }
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
    const { token, graphToken } = request.body;

    try {
      // Validate ANY token (local or Azure AD)
      const validationResult = await validateAnyToken(token);

      if (!validationResult.isValid) {
        return reply.code(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      const user = validationResult.user!;
      let isAdmin = user.isAdmin || false;
      let groups = user.groups || [];

      // If we have a Graph token, fetch fresh group memberships
      if (graphToken) {
        try {
          const freshGroups = await azureADAuthService.getGroupMemberships(graphToken);
          groups = freshGroups;
          isAdmin = await azureADAuthService.isUserAdmin(graphToken);
          
          // Update user object with fresh data
          user.groups = groups;
          user.isAdmin = isAdmin;
        } catch (error) {
          request.log.warn({ error }, 'Failed to fetch group memberships from Graph API');
          // Continue with token-based groups
        }
      }

      // Store user token in database for MCP usage
      try {
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
        await prisma.userAuthToken.upsert({
          where: { user_id: user.userId },
          update: { 
            access_token: token,
            expires_at: expiresAt,
            updated_at: new Date()
          },
          create: { 
            user_id: user.userId,
            access_token: token,
            expires_at: expiresAt
          }
        });
        
        // CRITICAL: Sync Azure AD admin status with local user record
        // This maps Azure AD admin groups to local is_admin field
        try {
          // First check if user exists by azure_oid
          let localUser = await prisma.user.findFirst({
            where: { 
              OR: [
                { azure_oid: user.userId },
                { email: user.email }
              ]
            }
          });
          
          if (localUser) {
            // Update existing user's admin status from Azure AD
            await prisma.user.update({
              where: { id: localUser.id },
              data: {
                is_admin: isAdmin,  // Map Azure AD admin groups to local admin flag
                groups: isAdmin ? ['admin', ...groups] : groups,
                azure_oid: user.userId,  // Ensure Azure OID is set
                azure_tenant_id: user.tenantId,
                updated_at: new Date()
              }
            });
            
            logger.info({ 
              userId: localUser.id, 
              azureOid: user.userId, 
              isAdmin,
              groups 
            }, 'Synced Azure AD admin status with existing local user');
            
            // Validate first-time admin if needed
            if (isAdmin) {
              const validationResult = await adminValidation.validateFirstTimeAdmin(
                localUser.id,
                user.email || '',
                token
              );
              
              if (!validationResult.isValid) {
                logger.warn({
                  userId: localUser.id,
                  errors: validationResult.errors
                }, 'Admin Azure MCP validation required');
                
                // Store validation requirement in response
                return reply.code(403).send({
                  error: 'Admin validation required',
                  requiresValidation: true,
                  validationErrors: validationResult.errors,
                  redirectUrl: '/admin/azure-setup'
                });
              }
            }
          } else if (user.email) {
            // Create new local user for Azure AD user
            const newUser = await prisma.user.create({
              data: {
                email: user.email,
                name: user.name || 'Azure User',
                azure_oid: user.userId,
                azure_tenant_id: user.tenantId,
                is_admin: isAdmin,  // Set admin based on Azure AD groups
                groups: isAdmin ? ['admin', ...groups] : groups,
                theme: 'system',
                force_password_change: false  // Azure users don't use local passwords
              }
            });
            
            logger.info({
              userId: newUser.id,
              azureOid: user.userId,
              isAdmin,
              email: user.email
            }, 'Created new local user for Azure AD user with mapped admin status');

            // Legacy "assign Admin Mode prompt template on first login" block
            // RIPPED 2026-05-11 (chatmode-rip Phase E final). The
            // PromptTemplate + UserPromptAssignment tables are gone;
            // admin vs member system prompts are now resolved per-turn via
            // getSystemPromptForRole() against the rbac_system_prompts table.

            // Validate first-time admin if needed
            if (isAdmin) {
              const validationResult = await adminValidation.validateFirstTimeAdmin(
                newUser.id,
                user.email,
                token
              );
              
              if (!validationResult.isValid) {
                logger.warn({
                  userId: newUser.id,
                  errors: validationResult.errors
                }, 'Admin Azure MCP validation required');
                
                // Store validation requirement in response
                return reply.code(403).send({
                  error: 'Admin validation required',
                  requiresValidation: true,
                  validationErrors: validationResult.errors,
                  redirectUrl: '/admin/azure-setup'
                });
              }
            }
          }
        } catch (syncError) {
          logger.warn({ error: syncError }, 'Failed to sync Azure AD user with local database');
          // Don't fail the auth - user can still use the app
        }
        
        logger.info({ userId: user.userId, isAdmin }, 'Stored user token for MCP usage');
      } catch (error) {
        logger.error({ error }, 'Failed to store user token');
      }

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
            authType: 'azure-ad'
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
   * Used by openagenticflows service to validate user tokens
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

        // Validate ANY token (local or Azure AD)
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
              { azure_oid: user.userId },
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
      const roles: string[] = []; // dbUser.user_roles.map(ur => ur.role.id);
      const permissions: string[] = [];

      // for (const userRole of dbUser.user_roles) {
      //   for (const rolePerm of userRole.role.role_permissions) {
      //     if (!permissions.includes(rolePerm.permission.id)) {
      //       permissions.push(rolePerm.permission.id);
      //     }
      //   }
      // }

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
        // Check for OpenAgentic session cookies
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
    const graphToken = request.headers['x-graph-token'] as string;

    try {
      // First try to validate as a local JWT token
      let user: any;
      let isLocalAuth = false;
      
      try {
        const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
        
        // Try to decode and verify as JWT
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;
        
        // If successful, it's a local JWT token
        isLocalAuth = true;
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
                { azure_oid: user.userId },
                { email: user.email }
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

      // Step 3: If still no groups AND we have Graph token, fetch from Microsoft Graph (most reliable for first login)
      if (graphToken && !isLocalAuth && groups.length === 0) {
        try {
          request.log.info({ userId: user.userId }, 'Fetching fresh group memberships from Microsoft Graph for first-time login');
          const freshGroups = await azureADAuthService.getGroupMemberships(graphToken);
          const freshIsAdmin = await azureADAuthService.isUserAdmin(graphToken);

          if (freshGroups && freshGroups.length > 0) {
            groups = freshGroups;
            isAdmin = freshIsAdmin;

            request.log.info({
              userId: user.userId,
              source: 'microsoft-graph',
              groupCount: groups.length,
              isAdmin: freshIsAdmin
            }, 'Admin status from Microsoft Graph (first-time login)');

            // CRITICAL: Update database immediately to avoid this lookup next time
            try {
              await prisma.user.upsert({
                where: { email: user.email },
                update: {
                  groups: groups,
                  is_admin: freshIsAdmin,
                  last_login_at: new Date()
                },
                create: {
                  azure_oid: user.userId,
                  email: user.email,
                  name: user.name,
                  groups: groups,
                  is_admin: freshIsAdmin,
                  azure_tenant_id: user.tenantId,
                  last_login_at: new Date()
                }
              });

              request.log.info({
                userId: user.userId,
                email: user.email,
                isAdmin: freshIsAdmin,
                groupCount: groups.length
              }, 'Successfully cached admin status and groups to database');
            } catch (dbError) {
              request.log.error({ error: dbError }, 'Failed to cache admin status to database');
            }
          }
        } catch (error) {
          request.log.warn({ error }, 'Failed to fetch group memberships from Microsoft Graph');
        }
      }

      // Step 4: Final fallback - if we still have no group info but token indicates admin, trust the token
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
    // Try to extract user ID from auth header for MCP cleanup
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        // Notify MCP orchestrator of logout to cleanup Azure MCP
        const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
        await fetch(`${mcpoUrl}/api/core/user-logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': decoded.userId || decoded.id
          },
          body: JSON.stringify({
            userId: decoded.userId || decoded.id,
            email: decoded.email
          })
        });

        logger.info({
          userId: decoded.userId || decoded.id,
          email: decoded.email
        }, 'AUDIT: User logout - notified MCP orchestrator to cleanup Azure MCP');

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

        // NOTE: Per-user Azure MCP sessions no longer used - OBO tokens per-request
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to notify MCP orchestrator of logout');
      }
    }

    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    // Try to extract user ID from auth header for MCP cleanup
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        // Try local JWT first
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
          // Notify MCP orchestrator of logout to cleanup Azure MCP
          const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
          const logoutResponse = await fetch(`${mcpoUrl}/api/core/user-logout`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': userId
            },
            body: JSON.stringify({
              userId: userId,
              email: email
            })
          });

          if (logoutResponse.ok) {
            const result = await logoutResponse.json();
            logger.info({
              userId,
              email,
              cleaned: result.cleaned
            }, 'AUDIT: User logout - successfully cleaned up Azure MCP instances');

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
                  endpoint: '/api/auth/logout (POST)',
                  mcpCleaned: result.cleaned
                },
                success: true
              });
            } catch (auditError) {
              logger.warn({ error: auditError, userId }, 'Failed to log logout audit event');
            }
          } else {
            logger.warn({
              userId,
              email,
              status: logoutResponse.status
            }, 'AUDIT: User logout - failed to cleanup Azure MCP instances');
          }

          // NOTE: Per-user Azure MCP sessions no longer used - OBO tokens per-request
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to process logout cleanup');
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
   * Get available MCP servers for user
   */
  fastify.get('/api/auth/user-mcps', {
    preHandler: async (request, reply): Promise<void> => {
      // Verify auth token
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
    }
  }, async (request, reply) => {
    try {
      // Get user from token
      const authHeader = request.headers.authorization!;
      const token = authHeader.replace('Bearer ', '');
      
      // Get configured MCP servers that should be auto-spawned
      // These are the built-in MCPs that every user should have
      const autoSpawnMCPs = await prisma.mCPServerConfig.findMany({
        where: {
          enabled: true
          // auto_spawn field doesn't exist, just get all enabled
        },
        select: {
          id: true,
          name: true,
          description: true
        }
      });
      
      // If no auto-spawn MCPs configured, return defaults
      const mcpTypes = autoSpawnMCPs.length > 0 ? autoSpawnMCPs.map(mcp => ({
        id: mcp.id.replace('-mcp', ''), // Remove -mcp suffix for compatibility
        name: mcp.name,
        description: mcp.description
      })) : [
        // Default MCPs every user should have
        { id: 'azure', name: 'Azure MCP', description: 'Microsoft Azure operations' },
        { id: 'memory', name: 'Memory MCP', description: 'Persistent memory and knowledge storage' }
      ];
      
      return reply.send({ mcpTypes });
    } catch (error) {
      logger.error({ error }, 'Failed to get user MCPs');
      return reply.code(500).send({ error: 'Failed to get user MCPs' });
    }
  });

  /**
   * Spawn user-specific MCP instances
   */
  fastify.post<{ Body: { userId: string; mcpType: string } }>('/api/auth/spawn-mcp', {
    preHandler: async (request, reply): Promise<void> => {
      // Verify auth token
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
      // Continue to handler
    }
  }, async (request, reply) => {
    const { userId, mcpType } = request.body;
    
    try {
      // First check if the requested MCP server exists in the database
      // Try exact match first, then try with -mcp suffix
      let mcpServer = await prisma.mCPServerConfig.findUnique({
        where: { id: mcpType }
      });
      
      // If not found, try with -mcp suffix (for backward compatibility)
      if (!mcpServer && !mcpType.endsWith('-mcp')) {
        mcpServer = await prisma.mCPServerConfig.findUnique({
          where: { id: `${mcpType}-mcp` }
        });
      }
      
      if (!mcpServer) {
        logger.error({ userId, mcpType }, 'MCP server config not found');
        return reply.code(400).send({ 
          error: 'Invalid MCP type',
          message: `MCP server '${mcpType}' not found in configuration`
        });
      }
      
      if (!mcpServer.enabled) {
        return reply.code(400).send({ 
          error: 'MCP server disabled',
          message: `MCP server '${mcpServer.name}' is currently disabled`
        });
      }
      
      const serverId = mcpServer.id;
      
      // Check if an instance already exists using Prisma
      const existingInstance = await prisma.mCPInstance.findFirst({
        where: {
          user_id: userId,
          server_id: serverId,
          status: 'active'
        }
      });
      
      if (existingInstance) {
        logger.info({ userId, mcpType, instanceId: existingInstance.id }, 'Found existing MCP instance, checking if still running...');
        
        // Verify the instance is actually running in the orchestrator
        try {
          const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
          const healthResponse = await fetch(`${mcpoUrl}/api/core/user-instances/${userId}`, {
            method: 'GET',
            headers: {
              'x-user-id': userId
            }
          });
          
          if (healthResponse.ok) {
            const healthData = await healthResponse.json() as { instances?: Array<{ serverId: string; status: string }> };
            const instances = healthData.instances || [];
            const isRunning = instances.some((inst: any) => 
              inst.serverId === serverId && inst.status === 'running'
            );
            
            if (isRunning) {
              logger.info({ userId, mcpType, instanceId: existingInstance.id }, 'Existing instance is running, reusing it');
              return reply.send({
                success: true,
                instanceId: existingInstance.id,
                connectionInfo: existingInstance.config
              });
            } else {
              logger.warn({ userId, mcpType, instanceId: existingInstance.id }, 'Existing instance not running, will recreate');
              // Mark the old instance as inactive
              await prisma.mCPInstance.update({
                where: { id: existingInstance.id },
                data: { status: 'inactive' }
              });
            }
          }
        } catch (error) {
          logger.warn({ 
            userId, 
            mcpType, 
            error: error.message 
          }, 'Could not verify instance status, will recreate');
          // Mark as inactive if we can't verify
          await prisma.mCPInstance.update({
            where: { id: existingInstance.id },
            data: { status: 'inactive' }
          });
        }
      }
      
      // For Azure MCP, verify user has valid Azure token
      if (mcpType === 'azure' || mcpType === 'azure-mcp') {
        const azureToken = await prisma.userAuthToken.findUnique({
          where: {
            user_id: userId
          }
        });
        
        if (!azureToken) {
          return reply.code(400).send({ 
            error: 'Azure account not linked',
            message: 'User must link Azure account for Azure MCP access'
          });
        }
      }
      
      // Create new MCP instance in database
      const newInstance = await prisma.mCPInstance.create({
        data: {
          instance_id: `${userId}-${serverId}-${Date.now()}`,
          user_id: userId,
          server_id: serverId,
          status: 'active',
          config: { host: 'localhost', port: 3001 }
        }
      });
      
      // CRITICAL: Actually spawn the MCP instance in the orchestrator!
      try {
        const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
        const authHeader = request.headers.authorization!;
        const token = authHeader.substring(7);
        
        logger.info({ 
          userId, 
          mcpType,
          mcpoUrl,
          endpoint: `${mcpoUrl}/api/mcp/user-instances/spawn`
        }, 'Calling MCP orchestrator to spawn instance');
        
        // Call the MCP orchestrator to actually spawn the instance
        const spawnResponse = await fetch(`${mcpoUrl}/api/mcp/user-instances/spawn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId,  // CRITICAL: Set the x-user-id header!
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            userId: userId,
            mcpType: mcpType.replace('-mcp', ''), // Send 'azure' not 'azure-mcp'
            token: token
          })
        });
        
        if (!spawnResponse.ok) {
          const errorText = await spawnResponse.text();
          logger.error({ 
            userId, 
            mcpType,
            status: spawnResponse.status,
            error: errorText
          }, 'MCP orchestrator failed to spawn instance');
          
          // Clean up the database record since spawn failed
          await prisma.mCPInstance.delete({
            where: { id: newInstance.id }
          });
          
          return reply.code(500).send({ 
            error: 'Failed to spawn MCP instance',
            message: `Orchestrator error: ${errorText}`
          });
        }
        
        const spawnResult = await spawnResponse.json();
        logger.info({ 
          userId, 
          mcpType, 
          instanceId: newInstance.id,
          spawnResult
        }, 'MCP instance spawned successfully in orchestrator');
        
      } catch (error) {
        logger.error({ 
          userId, 
          mcpType,
          error: error.message
        }, 'Failed to call MCP orchestrator');
        
        // Clean up the database record since spawn failed
        await prisma.mCPInstance.delete({
          where: { id: newInstance.id }
        });
        
        return reply.code(500).send({ 
          error: 'Failed to spawn MCP instance',
          message: 'Could not connect to MCP orchestrator'
        });
      }
      
      return reply.send({
        success: true,
        instanceId: newInstance.id,
        connectionInfo: newInstance.config
      });
    } catch (error: any) {
      logger.error({ 
        userId, 
        mcpType, 
        error: error.message,
        stack: error.stack 
      }, 'Failed to spawn user MCP');
      return reply.code(500).send({ 
        error: 'Failed to spawn MCP instance',
        details: error.message 
      });
    }
  });

  /**
   * Admin Azure MCP validation endpoint
   */
  fastify.post('/api/admin/validate-azure', {
    preHandler: async (request, reply): Promise<void> => {
      // Verify auth token
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
    }
  }, async (request, reply) => {
    const authHeader = request.headers.authorization!;
    const token = authHeader.substring(7);
    
    try {
      // Validate the token first (local or Azure AD)
      const tokenValidation = await validateAnyToken(token);
      
      if (!tokenValidation.isValid || !tokenValidation.user) {
        return reply.code(401).send({
          error: 'Invalid token',
          message: tokenValidation.error || 'Token validation failed'
        });
      }
      
      const user = tokenValidation.user;
      
      // Check if user is admin
      if (!user.isAdmin) {
        return reply.code(403).send({
          error: 'Admin access required',
          message: 'This endpoint is only available for administrators'
        });
      }
      
      // Find local user by Azure OID
      const localUser = await prisma.user.findFirst({
        where: { 
          OR: [
            { azure_oid: user.userId },
            { email: user.email }
          ]
        }
      });
      
      if (!localUser) {
        return reply.code(404).send({
          error: 'User not found',
          message: 'Local user record not found'
        });
      }
      
      // Perform admin validation
      const adminValidationResult = await adminValidation.validateFirstTimeAdmin(
        localUser.id,
        user.email || '',
        token
      );
      
      if (!adminValidationResult.isValid) {
        return reply.code(403).send({
          error: 'Validation failed',
          isValid: false,
          azureLinked: adminValidationResult.azureLinked,
          mcpWorking: adminValidationResult.mcpWorking,
          requiresSetup: adminValidationResult.requiresSetup,
          errors: adminValidationResult.errors
        });
      }
      
      // Return successful validation
      return reply.send({
        isValid: true,
        azureLinked: adminValidationResult.azureLinked,
        mcpWorking: adminValidationResult.mcpWorking,
        subscriptionName: adminValidationResult.subscriptionName,
        subscriptionId: adminValidationResult.subscriptionId,
        errors: []
      });
      
    } catch (error: any) {
      logger.error({ error }, 'Admin Azure validation error');
      return reply.code(500).send({
        error: 'Validation failed',
        message: error.message
      });
    }
  });

  /**
   * On-Behalf-Of token endpoint for MCP Orchestrator
   */
  fastify.post<{ Body: { userAccessToken: string; scopes: string[] } }>('/api/auth/obo', {
    schema: {
      body: {
        type: 'object',
        required: ['userAccessToken', 'scopes'],
        properties: {
          userAccessToken: { type: 'string' },
          scopes: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            expiresOn: { type: 'string' },
            tokenType: { type: 'string' },
            scopes: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { userAccessToken, scopes } = request.body;
    
    try {
      logger.info({ scopes }, 'OBO token request received');
      
      // Acquire OBO token
      const oboResponse = await oboService.acquireTokenOnBehalfOf({
        userAccessToken,
        scopes
      });
      
      if (!oboResponse) {
        logger.error('Failed to acquire OBO token - no response');
        return reply.code(500).send({
          error: 'Failed to acquire OBO token',
          message: 'No response from OBO service'
        });
      }
      
      logger.info({ 
        scopes: oboResponse.scopes,
        expiresOn: oboResponse.expiresOn
      }, 'OBO token acquired successfully');
      
      return reply.send({
        accessToken: oboResponse.accessToken,
        expiresOn: oboResponse.expiresOn.toISOString(),
        tokenType: oboResponse.tokenType,
        scopes: oboResponse.scopes
      });
    } catch (error: any) {
      logger.error({ error, scopes }, 'Failed to acquire OBO token');
      
      // Handle specific MSAL errors
      if (error.errorCode === 'invalid_grant') {
        return reply.code(401).send({
          error: 'Invalid grant',
          message: 'The provided token is invalid or expired'
        });
      }
      
      if (error.errorCode === 'invalid_client') {
        return reply.code(401).send({
          error: 'Invalid client',
          message: 'Client authentication failed'
        });
      }
      
      return reply.code(500).send({
        error: 'Failed to acquire OBO token',
        message: error.message || 'Unknown error occurred'
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
            { azure_oid: user.userId },
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

  // SECURITY: Test-login and test-users endpoints removed in v0.4.0 hardening (F-001e)
  // All authentication must go through Azure AD or API key flows

  // Missing Authentication Routes that UI expects
  
  // Change password endpoint
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
      // Validate current token (local or Azure AD)
      const validationResult = await validateAnyToken(token);
      if (!validationResult.isValid || !validationResult.user) {
        return reply.status(401).send({ error: 'Invalid authentication token' });
      }

      const userId = validationResult.user.userId;

      // For Azure AD users, password change must be done through Azure AD
      return reply.status(400).send({
        error: 'Password change not supported',
        message: 'Azure AD users must change their password through the Azure portal or their organization\'s password policy.',
        redirectUrl: 'https://account.microsoft.com/security/password/change'
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
          token: { type: 'string' },
          graphToken: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { token, graphToken } = request.body;

    try {
      const validationResult = await validateAnyToken(token);
      
      if (!validationResult.isValid) {
        return reply.status(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      const user = validationResult.user!;
      let isAdmin = user.isAdmin || false;
      let groups = user.groups || [];

      if (graphToken) {
        try {
          const freshGroups = await azureADAuthService.getGroupMemberships(graphToken);
          groups = freshGroups;
          isAdmin = await azureADAuthService.isUserAdmin(graphToken);
          
          user.groups = groups;
          user.isAdmin = isAdmin;
        } catch (error) {
          request.log.warn({ error }, 'Failed to fetch group memberships from Graph API');
        }
      }

      const response: UserInfoResponse = {
        userId: user.userId,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        isAdmin,
        groups
      };

      // Initialize user's MCP instances based on their role
      try {
        await initializeUserMCPInstances(user.userId, token, user.email, isAdmin, groups, logger);
      } catch (error) {
        logger.warn({ error, userId: user.userId }, 'Failed to initialize user MCP instances');
        // Don't fail the login if MCP initialization fails
      }

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
            authType: 'azure-ad'
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
    const graphToken = request.headers['x-graph-token'] as string;

    try {
      const validationResult = await validateAnyToken(token);
      const user = validationResult.user!;
      
      if (!validationResult.isValid) {
        return reply.status(401).send({
          error: 'Invalid token',
          message: validationResult.error || 'Token validation failed'
        });
      }

      let isAdmin = user.isAdmin || false;
      let groups = user.groups || [];

      if (graphToken) {
        try {
          groups = await azureADAuthService.getGroupMemberships(graphToken);
          isAdmin = await azureADAuthService.isUserAdmin(graphToken);
        } catch (error) {
          request.log.warn({ error }, 'Failed to fetch group memberships');
        }
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
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to get user info'
      });
    }
  });

  // Azure AD OAuth Flow Endpoints
  
  /**
   * Initiate Azure AD login - redirect to Microsoft
   */
  /**
   * Generic login endpoint - redirects to Azure AD
   * This provides a consistent /api/auth/login endpoint for the frontend
   */
  fastify.get('/api/auth/login', async (request, reply) => {
    const authUrl = await azureADAuthService.getAuthUrl();
    
    logger.info('Redirecting to Azure AD for authentication via /api/auth/login');
    
    // Direct redirect to Azure AD (not JSON response)
    return reply.redirect(authUrl);
  });

  fastify.get('/api/auth/microsoft', async (request, reply) => {
    const authUrl = await azureADAuthService.getAuthUrl();

    logger.info('Redirecting to Azure AD for authentication');

    // Direct redirect to Azure AD (not JSON response)
    return reply.redirect(authUrl);
  });

  /**
   * Microsoft/Azure AD login - alias for /api/auth/microsoft
   * Provides consistent /login endpoint matching other providers (Google)
   */
  fastify.get('/api/auth/microsoft/login', async (request, reply) => {
    const authUrl = await azureADAuthService.getAuthUrl();

    logger.info('Redirecting to Azure AD for authentication via /api/auth/microsoft/login');

    // Direct redirect to Azure AD (not JSON response)
    return reply.redirect(authUrl);
  });
  
  /**
   * Azure AD callback endpoint - handles the redirect from Microsoft
   */
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/api/auth/microsoft/callback', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { code, error, state } = request.query;
    
    logger.info({ 
      hasCode: !!code, 
      hasError: !!error, 
      hasState: !!state,
      state,
      error,
      codeLength: code?.length,
      fullUrl: request.url,
      headers: request.headers
    }, 'Azure AD callback received');
    
    if (error) {
      logger.error({ error, state }, 'Azure AD authentication error');
      return reply.code(400).send({
        error: 'Authentication failed',
        message: error
      });
    }
    
    if (!code) {
      logger.error({ state }, 'No authorization code received from Azure AD');
      return reply.code(400).send({
        error: 'Missing authorization code',
        message: 'No authorization code received from Azure AD'
      });
    }
    
    try {
      logger.info({ codeLength: code.length, state }, 'Exchanging authorization code for token');
      // Exchange code for token (passing state for PKCE)
      const tokenResponse = await azureADAuthService.exchangeCodeForToken(code, state);

      if (!tokenResponse || !tokenResponse.idToken) {
        throw new Error('Failed to obtain ID token from Azure AD');
      }

      // Validate the ID token and get user info (ID token is for our app, access token is for MS Graph)
      // NOTE: This is an Azure AD OAuth callback, so it WILL be an Azure AD token
      const validationResult = await validateAnyToken(tokenResponse.idToken);

      if (!validationResult.isValid || !validationResult.user) {
        throw new Error(validationResult.error || 'Token validation failed');
      }

      const user = validationResult.user;

      // CRITICAL FIX: Fetch groups from Graph API since ID tokens don't include groups by default
      if (tokenResponse.accessToken) {
        try {
          logger.info({ userId: user.userId, email: user.email }, 'Fetching groups from Microsoft Graph API');
          const freshGroups = await azureADAuthService.getGroupMemberships(tokenResponse.accessToken);

          // Pass token groups as fallback to admin detection
          const tokenGroups = user.groups || [];
          const isAdmin = await azureADAuthService.isUserAdmin(tokenResponse.accessToken, tokenGroups);

          // Update user object with fresh group data BEFORE database sync
          user.groups = freshGroups;
          user.isAdmin = isAdmin;

          logger.info({
            userId: user.userId,
            email: user.email,
            groupCount: freshGroups.length,
            groups: freshGroups,
            tokenGroups,
            isAdmin
          }, 'Successfully fetched user groups from Graph API');
        } catch (error) {
          logger.warn({ error, userId: user.userId, email: user.email }, 'Failed to fetch groups from Graph API - using token groups');
          // Continue with whatever groups are in the token (likely empty)
        }
      }

      // Sync Azure AD user with local database FIRST (before token upsert)
      let localUser: any;
      // Use upsert to ensure idempotent user creation/update
      let azureUserId = `azure_${user.userId}`;
      let isNewUser = false;

      try {
        // Log user creation/sync attempt
        logger.info({ userId: user.userId, email: user.email, isAdmin: user.isAdmin }, 'Syncing Azure AD user');

        // First try to find existing user by email to handle migration cases
        const existingUserByEmail = await prisma.user.findUnique({
          where: { email: user.email }
        });

        if (existingUserByEmail && existingUserByEmail.id !== azureUserId) {
          // User exists with different ID - update their Azure OID and use their existing ID
          logger.info({
            existingId: existingUserByEmail.id,
            newAzureId: azureUserId
          }, 'Migrating existing user to Azure ID');

          localUser = await prisma.user.update({
            where: { id: existingUserByEmail.id },
            data: {
              azure_oid: user.userId,
              azure_tenant_id: user.tenantId,
              is_admin: user.isAdmin,
              groups: user.isAdmin ? ['admin', ...(user.groups || [])] : (user.groups || []),
              updated_at: new Date()
            }
          });

          // Use the existing user's ID for subsequent operations
          azureUserId = existingUserByEmail.id;
        } else {
          // Normal upsert by Azure ID
          localUser = await prisma.user.upsert({
            where: {
              id: azureUserId // Use the deterministic ID based on Azure OID
            },
            create: {
              id: azureUserId,
              email: user.email,
              name: user.name || 'Azure User',
              azure_oid: user.userId,
              azure_tenant_id: user.tenantId,
              is_admin: user.isAdmin,
              groups: user.isAdmin ? ['admin', ...(user.groups || [])] : (user.groups || []),
              theme: 'system',
              force_password_change: false
            },
            update: {
              email: user.email, // Update email in case it changed
              name: user.name || 'Azure User',
              is_admin: user.isAdmin,
              groups: user.isAdmin ? ['admin', ...(user.groups || [])] : (user.groups || []),
              azure_oid: user.userId,
              azure_tenant_id: user.tenantId,
              updated_at: new Date()
            }
          });
        }

        // Check if this was a new user creation
        isNewUser = !localUser.updated_at || (new Date().getTime() - new Date(localUser.created_at).getTime() < 5000);
        logger.info({ userId: azureUserId, isNewUser }, 'User sync completed');

        // 🔒 SECURITY: Check if user account is locked - block login entirely
        if (localUser.is_locked) {
          logger.warn({
            userId: azureUserId,
            email: user.email,
            lockedAt: localUser.locked_at,
            lockedReason: localUser.locked_reason
          }, '🔒 BLOCKED: Locked user attempted to login');

          // Redirect to error page with locked message
          // Derive UI URL from request origin/host to support any environment
          const protocol = request.headers['x-forwarded-proto'] || 'https';
          const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost:5173';
          const baseUrl = `${protocol}://${host}`;
          const errorMessage = encodeURIComponent('Your account has been locked. Please contact an administrator.');

          logger.info({
            baseUrl,
            protocol,
            host
          }, '🔒 Redirecting locked user to login page');

          return reply.redirect(`${baseUrl}/login?error=account_locked&message=${errorMessage}`);
        }

        // Legacy "assign Admin Mode prompt template on Azure AD callback"
        // block RIPPED 2026-05-11 (chatmode-rip Phase E final). The
        // PromptTemplate + UserPromptAssignment tables are gone; admin
        // vs member system prompts are now resolved per-turn via
        // getSystemPromptForRole() against the rbac_system_prompts table.

        // Now store access token for MCP/Graph API usage (only if user sync succeeded)
        // CRITICAL: Store refresh token for auto-refresh when access token expires
        try {
          // Use token's actual expiration time if available, otherwise default to 1 hour
          const expiresAt = tokenResponse.expiresOn
            ? new Date(tokenResponse.expiresOn)
            : new Date(Date.now() + 3600000);

          await prisma.userAuthToken.upsert({
            where: { user_id: azureUserId },
            update: {
              access_token: tokenResponse.accessToken,
              // CRITICAL: Store ID token for AWS Identity Center OBO (has app's client ID as audience)
              id_token: tokenResponse.idToken || null,
              // CRITICAL: Store refresh token for automatic token renewal
              refresh_token: (tokenResponse as any).refreshToken || null,
              expires_at: expiresAt,
              updated_at: new Date()
            },
            create: {
              user_id: azureUserId,
              access_token: tokenResponse.accessToken,
              // CRITICAL: Store ID token for AWS Identity Center OBO (has app's client ID as audience)
              id_token: tokenResponse.idToken || null,
              // CRITICAL: Store refresh token for automatic token renewal
              refresh_token: (tokenResponse as any).refreshToken || null,
              expires_at: expiresAt
            }
          });

          logger.info({
            userId: azureUserId,
            hasIdToken: !!tokenResponse.idToken,
            hasRefreshToken: !!(tokenResponse as any).refreshToken,
            expiresAt: expiresAt.toISOString()
          }, 'Auth token stored successfully (with ID token and refresh token)');
        } catch (tokenError) {
          logger.error({ error: tokenError, userId: azureUserId }, 'Failed to store auth token');
          // Don't fail the whole authentication flow for token storage issues
        }
      } catch (syncError) {
        logger.error({ error: syncError }, 'Failed to sync Azure AD user with local database');
        return reply.status(500).send({
          error: 'Failed to sync user data',
          message: 'User synchronization failed during authentication'
        });
      }

      // Initialize user MCP instances with groups for auditing
      try {
        logger.info({ userId: azureUserId }, 'Initializing MCP instances for user');
        await initializeUserMCPInstances(
          azureUserId, // Use database ID for MCP instances
          tokenResponse.accessToken,
          user.email,
          user.isAdmin || false,
          user.groups || [],
          logger
        );
        logger.info({ userId: azureUserId }, 'MCP instances initialized successfully');
      } catch (error) {
        logger.warn({ error, userId: azureUserId }, 'Failed to initialize user MCP instances');
      }

      // NOTE: Per-user Azure MCP sessions (via azmcp) have been REMOVED
      // Azure MCP now uses OBO tokens injected per-request via openagentic_azure MCP server
      // The user's Azure token is stored in the database and passed to MCP tools on each request
      logger.info({ userId: azureUserId, email: user.email }, 'Azure MCP uses per-request OBO tokens (no separate session needed)');

      // Create a minimal API JWT token for the frontend
      const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();

      // Create minimal JWT token with only essential authorization data
      const apiToken = jwt.sign(
        {
          userId: azureUserId, // Use the database ID (azure_prefixed), not raw Azure OID
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          tenantId: user.tenantId
          // Groups and Azure tokens are stored in DB, not in JWT to keep size small
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Store JWT token in Redis with a short session ID to avoid large URLs
      const redisClient = getRedisClient();
      const sessionId = jwt.sign({ type: 'auth-session', userId: azureUserId }, JWT_SECRET, { expiresIn: '10m' });

      // Store the actual API token in Redis with the session ID as key (10 minute expiry)
      const sessionStored = await redisClient.set(`auth-session:${sessionId}`, apiToken, 600);

      if (!sessionStored) {
        logger.warn({ userId: azureUserId }, 'Failed to store auth session in Redis, falling back to URL parameter');
        // Fallback to original URL method if Redis fails
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
          throw new Error('FRONTEND_URL environment variable is required');
        }
        const redirectUrl = `${frontendUrl}/auth/callback?token=${encodeURIComponent(apiToken)}&success=true`;
        return reply.redirect(redirectUrl);
      }

      // Redirect back to frontend with session ID instead of full JWT token
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) {
        throw new Error('FRONTEND_URL environment variable is required');
      }
      const redirectUrl = `${frontendUrl}/auth/callback?session=${encodeURIComponent(sessionId)}&success=true`;

      // Audit successful Azure AD OAuth login
      try {
        await auditTrail.log({
          timestamp: new Date(),
          eventType: AuditEventType.LOGIN_SUCCESS,
          severity: AuditSeverity.INFO,
          userId: azureUserId,
          userEmail: user.email,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          action: 'Azure AD OAuth login successful',
          details: {
            endpoint: '/api/auth/microsoft/callback',
            isAdmin: user.isAdmin,
            groupCount: user.groups?.length || 0,
            authType: 'azure-ad-oauth',
            isNewUser,
            tenantId: user.tenantId
          },
          success: true
        });
      } catch (auditError) {
        logger.warn({ error: auditError, userId: azureUserId }, 'Failed to log OAuth login audit event');
      }

      // Persist SSO login to the dedicated auth_audit_log for the unified
      // admin audit feed (first-class event/provider/success columns).
      await logAuthEvent({
        event: 'sso_login',
        provider: 'azure',
        success: true,
        userId: azureUserId,
        userEmail: user.email,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        detail: { isAdmin: user.isAdmin, isNewUser, tenantId: user.tenantId },
      });

      logger.info({ userId: azureUserId, frontendUrl, sessionId: sessionId.substring(0, 20) + '...' }, 'Redirecting user to frontend with session ID');
      return reply.redirect(redirectUrl);
      
    } catch (error: any) {
      logger.error({
        error: error.message || error,
        stack: error.stack,
        errorType: typeof error,
        errorName: error.name
      }, 'Azure AD callback processing failed');
      await logAuthEvent({
        event: 'login_failed',
        provider: 'azure',
        success: false,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        detail: { reason: 'azure_callback_error', message: error?.message },
      });
      return reply.code(500).send({
        error: 'Authentication failed',
        message: error.message || 'Failed to process Azure AD callback'
      });
    }
  });

  /**
   * Microsoft logout endpoint - matches Azure AD app registration
   */
  fastify.get('/api/auth/microsoft/logout', async (request, reply) => {
    // Return success and let the client handle token cleanup
    return reply.send({ success: true, message: 'Microsoft logout successful' });
  });

  fastify.post('/api/auth/microsoft/logout', async (request, reply) => {
    // Return success and let the client handle token cleanup
    return reply.send({ success: true, message: 'Microsoft logout successful' });
  });

  /**
   * Exchange session ID for JWT token endpoint
   * Called by frontend after OAuth callback to get the actual JWT token
   */
  fastify.post<{ Body: { sessionId: string } }>('/api/auth/exchange-session', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { sessionId } = request.body;

    if (!sessionId) {
      return reply.code(400).send({
        error: 'Missing session ID',
        message: 'Session ID is required'
      });
    }

    try {
      // Verify the session ID is valid (but don't decode it)
      const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET || (() => { throw new Error('FATAL: JWT_SECRET must be set'); })();
      jwt.verify(sessionId, JWT_SECRET);

      // Get the stored token from Redis
      const redisClient = getRedisClient();
      const apiToken = await redisClient.get(`auth-session:${sessionId}`) as string | null;

      if (!apiToken) {
        logger.warn({ sessionId: sessionId.substring(0, 20) + '...' }, 'Session not found or expired');
        return reply.code(404).send({
          error: 'Session not found',
          message: 'Authentication session not found or expired'
        });
      }

      // Delete the session from Redis (one-time use)
      await redisClient.del(`auth-session:${sessionId}`);

      logger.info({ sessionId: sessionId.substring(0, 20) + '...' }, 'Successfully exchanged session for JWT token');

      return reply.send({
        token: apiToken,
        success: true
      });

    } catch (error: any) {
      logger.error({ error: error.message, sessionId: sessionId.substring(0, 20) + '...' }, 'Session exchange failed');
      return reply.code(400).send({
        error: 'Invalid session',
        message: 'Invalid or expired session ID'
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
