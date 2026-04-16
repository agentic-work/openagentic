/**
 * Local Authentication Routes
 * 
 * Handles local username/password authentication, session management,
 * and password operations including password changes and validation.
 * 
 */

import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { trackAuthAttempt } from '../metrics/index.js';
import { prisma } from '../utils/prisma.js';
import { getJWTSecret } from '../utils/secrets.js';
import { AdminValidationService } from '../services/AdminValidationService.js';
import { AzureTokenService } from '../services/AzureTokenService.js';
import { ChatMCPService } from './chat/services/ChatMCPService.js';

interface User {
  id: string;
  email: string;
  name?: string;
  passwordHash?: string;
  groups?: string[];
  azureOid?: string;
  azureTenantId?: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface LoginRequest {
  username: string; // Can be email
  password: string;
}

interface CreateUserRequest {
  email: string;
  name: string;
  password: string;
  groups?: string[];
  azureOid?: string;
  azureTenantId?: string;
  isAdmin?: boolean;
}

interface UpdateGroupsRequest {
  groups: string[];
}

interface MapAzureRequest {
  azureOid: string;
  azureTenantId: string;
}

// JWT secret will be loaded from Vault or environment
let JWT_SECRET: string;

// Initialize JWT secret on startup
(async () => {
  JWT_SECRET = await getJWTSecret();
})();

// Helper function to get default model from environment
const getDefaultModel = (): string => {
  // Allow model router as valid "model" - it will handle routing internally
  const defaultModel = process.env.AZURE_OPENAI_DEPLOYMENT || process.env.DEFAULT_MODEL;
  if (!defaultModel) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT or DEFAULT_MODEL environment variable is required');
  }
  return defaultModel;
};

// Password hashing utilities using bcrypt
  // Prisma client imported above

const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 10);
};

const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  try {
    const isValid = await bcrypt.compare(password, hashedPassword);
    
    // Secure logging - no sensitive data exposed
    if (!isValid) {
      console.warn('Password verification failed', { 
        timestamp: new Date().toISOString()
      });
    }
    
    return isValid;
  } catch (error: any) {
    console.log('Password verification error - Full details:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      hashedPasswordFormat: hashedPassword?.substring(0, 7)
    });
    return false;
  }
};

// JWT verification middleware with session validation
// Returns decoded token on success, null on failure (after sending error response)
const verifyToken = async (request: FastifyRequest, reply: any) => {
  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.code(401).send({ error: 'No authorization header' });
    return null;
  }
  
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Verify session exists and is active
    const sessionResult = await prisma.userSession.findMany({
      where: {
        user_id: decoded.userId,
        token: token,
        expires_at: {
          gt: new Date()
        },
        is_active: true
      }
    });
    
    if (sessionResult.length === 0) {
      reply.code(401).send({ error: 'Session expired or invalid' });
      return null;
    }

    // Update last accessed
    await prisma.userSession.updateMany({
      where: {
        user_id: decoded.userId,
        token: token
      },
      data: {
        last_accessed_at: new Date()
      }
    });

    return decoded;
  } catch (error) {
    reply.code(401).send({ error: 'Invalid token' });
    return null;
  }
};

export const localAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  
  /**
   * POST /login
   * Authenticate local user with email/password
   */
  fastify.post<{ Body: LoginRequest }>('/login', async (request, reply) => {
    const { username, password } = request.body;
    
    // Debug logging to diagnose the issue
    logger.info({ 
      hasBody: !!request.body,
      bodyKeys: request.body ? Object.keys(request.body) : 'no body',
      username: username,
      hasUsername: !!username,
      hasPassword: !!password 
    }, 'Login request debug info');
    
    try {
      // Validate input
      if (!username || !password) {
        logger.warn({ username, hasPassword: !!password }, 'Missing username or password');
        return reply.code(400).send({ error: 'Username and password are required' });
      }

      // Track authentication attempt (will track success later)
      trackAuthAttempt('local_login', 'failure');

      // Find user by email
      const user = await prisma.user.findFirst({
        where: {
          email: username
        }
      });

      if (!user || !user.password_hash) {
        logger.warn({ email: username }, 'Login attempt for non-existent user');
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        logger.warn({ email: username }, 'Invalid password attempt');
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Check if password change is required (only if ADMIN_REQUIRE_PASSWORD_RESET is true)
      const requirePasswordReset = process.env.ADMIN_REQUIRE_PASSWORD_RESET !== 'false';
      if (requirePasswordReset && user.force_password_change) {
        logger.info({ email: username }, 'User requires password change on first login');
        // Don't create a session token yet - they need to change password first
        return reply.code(403).send({ 
          error: 'Password change required',
          requiresPasswordChange: true,
          userId: user.id,
          email: user.email,
          message: 'You must change your password before proceeding'
        });
      } else if (user.force_password_change && !requirePasswordReset) {
        // Clear the force_password_change flag if password reset is disabled
        await prisma.user.update({
          where: { id: user.id },
          data: { force_password_change: false }
        });
        logger.info({ email: username }, 'Password reset requirement bypassed due to ADMIN_REQUIRE_PASSWORD_RESET=false');
      }

      // Generate JWT token (minimal payload to avoid database size constraints)
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin
          // Groups stored in DB, not in JWT to keep token size small
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Store session in database
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);

      await prisma.userSession.upsert({
        where: { token: token },
        update: {
          token: token,
          expires_at: expiresAt,
          last_accessed_at: new Date(),
          is_active: true,
          ip_address: request.ip,
          user_agent: request.headers['user-agent']
        },
        create: {
          user_id: user.id,
          token: token,
          expires_at: expiresAt,
          last_accessed_at: new Date(),
          is_active: true,
          ip_address: request.ip,
          user_agent: request.headers['user-agent']
        }
      });

      logger.info({ email: user.email, isAdmin: user.is_admin }, 'User logged in successfully');
      
      // Track successful authentication
      trackAuthAttempt('local_login', 'success');
      
      // CRITICAL: Call MCP orchestrator to spawn Azure MCP for this user
      // Admin users get admin SP, regular users get read-only SP
      try {
        const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';

        logger.info({
          userId: user.id,
          email: user.email,
          isAdmin: user.is_admin,
          groups: user.groups || [],
          mcpoUrl
        }, 'LOCAL USER LOGIN: Notifying MCP orchestrator to spawn Azure MCP');

        // Call the user-login endpoint which will spawn Azure MCP with appropriate SP
        const loginResponse = await fetch(`${mcpoUrl}/api/mcp/user-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id
          },
          body: JSON.stringify({
            userId: user.id,
            email: user.email,
            groups: user.groups || [],
            token: token,
            isAdmin: user.is_admin
          })
        });

        if (!loginResponse.ok) {
          const errorText = await loginResponse.text();
          logger.error({
            userId: user.id,
            email: user.email,
            status: loginResponse.status,
            error: errorText
          }, 'AUDIT: Failed to spawn Azure MCP for local user');
        } else {
          const result = await loginResponse.json();
          logger.info({
            userId: user.id,
            email: user.email,
            isAdmin: user.is_admin,
            groups: user.groups || [],
            azureMCPStatus: result.azure,
            memoryMCPStatus: result.memory,
            spType: user.is_admin ? 'ADMIN' : 'READ-ONLY'
          }, 'AUDIT: Successfully spawned Azure MCP for local user with appropriate service principal');
        }
      } catch (error) {
        logger.error({
          userId: user.id,
          email: user.email,
          error: error.message
        }, 'AUDIT: Error calling MCP orchestrator for local user login');
        // Don't fail login if MCP notification fails
      }

      // Check if user has any sessions, if not create an initial one
      try {
        const existingSessions = await prisma.chatSession.findMany({
          where: { 
            user_id: user.id,
            deleted_at: null
          },
          take: 1
        });

        if (existingSessions.length === 0) {
          // Create initial "New Chat" session for first-time users
          const defaultModel = getDefaultModel();
          await prisma.chatSession.create({
            data: {
              id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              user_id: user.id,
              title: 'New Chat',
              model: defaultModel,
              message_count: 0,
              is_active: true
            }
          });
          logger.info({ userId: user.id }, 'Created initial chat session for new user');
        }
      } catch (sessionError) {
        // Don't fail login if session creation fails
        logger.warn({ error: sessionError }, 'Failed to create initial session');
      }

      return reply.send({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          groups: user.groups
        }
      });
    } catch (error) {
      logger.error({ error }, 'Login error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /logout  
   * Logout and invalidate session
   */
  fastify.post('/logout', async (request, reply) => {
    try {
      const decoded = await verifyToken(request, reply);
      if (!decoded) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Deactivate session
      await prisma.userSession.updateMany({
        where: {
          user_id: decoded.userId,
          is_active: true
        },
        data: {
          is_active: false
        }
      });

      // Kill user's Azure MCP instances on logout
      try {
        // Mark instances as inactive in DB
        await prisma.mCPInstance.updateMany({
          where: {
            user_id: decoded.userId,
            status: 'active'
          },
          data: {
            status: 'inactive'
          }
        });

        // Notify MCP orchestrator to kill Azure MCP processes
        const mcpoUrl = process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001';
        const logoutResponse = await fetch(`${mcpoUrl}/api/core/user-logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': decoded.userId
          },
          body: JSON.stringify({
            userId: decoded.userId,
            email: decoded.email
          })
        });

        if (logoutResponse.ok) {
          const result = await logoutResponse.json();
          logger.info({
            userId: decoded.userId,
            email: decoded.email,
            cleaned: result.cleaned
          }, 'AUDIT: Local user logout - successfully killed Azure MCP instances');
        } else {
          logger.warn({
            userId: decoded.userId,
            status: logoutResponse.status
          }, 'AUDIT: Local user logout - failed to kill Azure MCP instances');
        }
      } catch (error) {
        logger.warn({
          userId: decoded.userId,
          error: error.message
        }, 'Failed to cleanup MCP instances on logout');
        // Don't fail logout if MCP cleanup fails
      }

      return reply.send({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      logger.error({ error }, 'Logout error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /validate
   * Validate password and check if password change is required
   */
  fastify.post<{ Body: { password: string } }>('/validate', async (request, reply) => {
    try {
      const decoded = await verifyToken(request, reply);
      if (!decoded) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { password } = request.body;
      if (!password) {
        return reply.code(400).send({ error: 'Password is required' });
      }

      // Get user with password hash
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user || !user.password_hash) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Verify the password
      const isValid = await verifyPassword(password, user.password_hash);
      
      // Check if password change is required
      const requiresPasswordChange = user.force_password_change || false;

      return reply.send({
        valid: isValid,
        requiresPasswordChange,
        userId: user.id,
        email: user.email
      });
    } catch (error) {
      logger.error({ error }, 'Password validation error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /change-password
   * Change user password (works with token OR email/password for forced changes)
   */
  fastify.post<{ Body: { currentPassword: string; newPassword: string; email?: string } }>('/change-password', async (request, reply) => {
    try {
      const { currentPassword, newPassword, email } = request.body;
      if (!currentPassword || !newPassword) {
        return reply.code(400).send({ error: 'Current and new passwords are required' });
      }

      let user;
      
      // Check if this is a forced password change (no token, but email provided)
      if (email && !request.headers.authorization) {
        // Find user by email for forced password change
        user = await prisma.user.findUnique({
          where: { email }
        });
        
        if (!user || !user.password_hash) {
          return reply.code(404).send({ error: 'User not found' });
        }
        
        // Verify current password
        const isValid = await verifyPassword(currentPassword, user.password_hash);
        if (!isValid) {
          return reply.code(401).send({ error: 'Current password is incorrect' });
        }
        
        // Only allow this path if force_password_change is true
        if (!user.force_password_change) {
          return reply.code(401).send({ error: 'Token required for password change' });
        }
      } else {
        // Normal password change with token
        const decoded = await verifyToken(request, reply);
        if (!decoded) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
        
        // Get user with password hash
        user = await prisma.user.findUnique({
          where: { id: decoded.userId }
        });

        if (!user || !user.password_hash) {
          return reply.code(404).send({ error: 'User not found' });
        }

        // Verify current password
        const isValid = await verifyPassword(currentPassword, user.password_hash);
        if (!isValid) {
          return reply.code(401).send({ error: 'Current password is incorrect' });
        }
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword);

      // Update password and clear force password change flag
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password_hash: newPasswordHash,
          force_password_change: false,
          updated_at: new Date()
        }
      });

      logger.info({ userId: user.id, email: user.email }, 'Password changed successfully');

      // If this was a forced password change, generate a token now
      if (email && !request.headers.authorization) {
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.is_admin
            // Groups stored in DB, not in JWT to keep token size small
          },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Store session in database
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await prisma.userSession.create({
          data: {
            user_id: user.id,
            token: token,
            expires_at: expiresAt,
            last_accessed_at: new Date(),
            is_active: true,
            ip_address: request.ip,
            user_agent: request.headers['user-agent']
          }
        });

        // Create initial session for first-time users
        try {
          const existingSessions = await prisma.chatSession.findMany({
            where: { 
              user_id: user.id,
              deleted_at: null
            },
            take: 1
          });

          if (existingSessions.length === 0) {
            const defaultModel = getDefaultModel();
            await prisma.chatSession.create({
              data: {
                id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                user_id: user.id,
                title: 'New Chat',
                model: defaultModel,
                message_count: 0,
                is_active: true
              }
            });
            logger.info({ userId: user.id }, 'Created initial chat session after password change');
          }
        } catch (sessionError) {
          logger.warn({ error: sessionError }, 'Failed to create initial session after password change');
        }

        return reply.send({
          success: true,
          message: 'Password changed successfully',
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin: user.is_admin,
            groups: user.groups
          }
        });
      }

      return reply.send({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      logger.error({ error }, 'Password change error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /me
   * Get current user info
   */
  fastify.get('/me', async (request, reply) => {
    try {
      const decoded = await verifyToken(request, reply);
      if (!decoded) {
        // verifyToken already sent the error response
        return reply;
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          name: true,
          is_admin: true,
          groups: true,
          created_at: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          groups: user.groups,
          createdAt: user.created_at
        }
      });
    } catch (error) {
      logger.error({ error }, 'Get user error');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Session cleanup task
   */
  const cleanupSessions = async () => {
    try {
      const result = await prisma.userSession.updateMany({
        where: {
          expires_at: { lt: new Date() },
          is_active: true
        },
        data: {
          is_active: false
        }
      });

      if (result.count > 0) {
        logger.info(`Cleaned up ${result.count} expired sessions`);
      }
    } catch (error) {
      logger.error({ error }, 'Session cleanup error');
    }
  };

  // Run cleanup every hour
  setInterval(cleanupSessions, 60 * 60 * 1000);
  
  // Run initial cleanup
  cleanupSessions();
};
