/**
 * Account Linking and Integration Routes
 * 
 * Manages the linking of local user accounts with Azure AD accounts,
 * enabling hybrid authentication and account synchronization.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import jwt from 'jsonwebtoken';
import { AzureOBOService } from '../services/AzureOBOService.js';
import { prisma } from '../utils/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET or SIGNING_SECRET environment variable is required for account linking');
}

interface AccountLinkingRequest {
  localToken: string;
  azureToken: string;
}

interface AccountLinkingResponse {
  success: boolean;
  linkedUserId: string;
  message: string;
}

export const accountLinkingRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  // Note: AzureOBOService instantiated here for historical reasons but not
  // currently consumed by any route in this file. Kept for future link-account
  // OBO flows. Removing the unused variable would silence the import too.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _oboService = new AzureOBOService(logger);
  
  // Using Prisma instead of Pool
  
  /**
   * POST /api/auth/link-accounts
   * Link a local account with an Azure AD account
   */
  fastify.post<{Body: AccountLinkingRequest}>('/link-accounts', async (request, reply) => {
    try {
      const { localToken, azureToken } = request.body;
      
      if (!localToken || !azureToken) {
        return reply.code(400).send({ 
          success: false,
          error: 'Both localToken and azureToken are required' 
        });
      }

      // Verify local token
      const localDecoded = jwt.verify(localToken, JWT_SECRET) as any;
      if (!localDecoded.userId && !localDecoded.sub) {
        return reply.code(400).send({ 
          success: false,
          error: 'Invalid local token' 
        });
      }

      // Verify Azure token (simplified - just decode for now)
      const azureDecoded = jwt.decode(azureToken) as any;
      if (!azureDecoded || !azureDecoded.oid) {
        return reply.code(400).send({ 
          success: false,
          error: 'Invalid Azure token' 
        });
      }

      const localUserId = localDecoded.userId || localDecoded.sub;
      const azureOid = azureDecoded.oid;
      const azureEmail = azureDecoded.email || azureDecoded.preferred_username;

      logger.info({
        localUserId,
        azureOid,
        azureEmail
      }, 'Linking local account with Azure AD account');

      // Check if this Azure account is already linked
      const existingLink = await prisma.linkedAzureAccount.findFirst({
        where: { 
          azure_oid: azureOid
        }
      });

      if (existingLink) {
        return reply.code(409).send({
          success: false,
          error: 'This Azure account is already linked to another user'
        });
      }

      // Update or create the linking
      await prisma.linkedAzureAccount.upsert({
        where: {
          user_id: localUserId
        },
        update: {
          azure_oid: azureOid,
          azure_email: azureEmail,
          azure_access_token: azureToken,
          token_expires_at: azureDecoded.exp ? new Date(azureDecoded.exp * 1000) : new Date(Date.now() + 3600000),
          updated_at: new Date()
        },
        create: {
          user_id: localUserId,
          azure_oid: azureOid,
          azure_email: azureEmail,
          azure_access_token: azureToken,
          token_expires_at: azureDecoded.exp ? new Date(azureDecoded.exp * 1000) : new Date(Date.now() + 3600000)
        }
      });

      logger.info({
        localUserId,
        azureOid,
        azureEmail
      }, 'Successfully linked local account with Azure AD');

      return reply.send({
        success: true,
        linkedUserId: localUserId,
        message: 'Accounts successfully linked'
      } as AccountLinkingResponse);

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to link accounts');
      
      return reply.code(500).send({
        success: false,
        error: 'Failed to link accounts',
        details: error.message
      });
    }
  });

  /**
   * GET /api/auth/linked-status/:userId
   * Get the linking status for a user
   */
  fastify.get<{Params: {userId: string}}>('/linked-status/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      
      const linkedAccount = await prisma.linkedAzureAccount.findUnique({
        where: {
          user_id: userId
        }
      });

      return reply.send({
        userId,
        isLinked: !!linkedAccount,
        linkedAt: linkedAccount?.linked_at || null,
        azureEmail: linkedAccount ? 'redacted' : null
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get linking status');
      
      return reply.code(500).send({
        error: 'Failed to get linking status',
        details: error.message
      });
    }
  });

  /**
   * DELETE /api/auth/unlink/:userId
   * Unlink Azure account from local account
   */
  fastify.delete<{Params: {userId: string}}>('/unlink/:userId', async (request, reply) => {
    try {
      const { userId } = request.params;
      
      const deleted = await prisma.linkedAzureAccount.delete({
        where: {
          user_id: userId
        }
      }).then(() => ({ count: 1 })).catch(() => ({ count: 0 }));

      if (deleted.count === 0) {
        return reply.code(404).send({
          success: false,
          error: 'No linked Azure account found'
        });
      }

      logger.info({ userId }, 'Successfully unlinked Azure account');

      return reply.send({
        success: true,
        message: 'Azure account unlinked successfully'
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to unlink account');
      
      return reply.code(500).send({
        success: false,
        error: 'Failed to unlink account',
        details: error.message
      });
    }
  });

  // Missing routes that UI expects

  /**
   * GET /accounts/linked-azure
   * Get linked Azure account information for authenticated user
   */
  fastify.get('/accounts/linked-azure', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Fastify v5: calling reply.send() in a preHandler is not enough to abort
        // the lifecycle — Fastify v5 requires the reply to be returned (sent AND
        // returned). We await-and-return so Fastify sees a settled reply and skips
        // the main handler, preventing ERR_HTTP_HEADERS_SENT (double-send).
        await reply.status(401).send({ error: 'Authentication required' });
        return;
      }
    },
    schema: {
    }
  }, async (request, reply) => {
    try {
      const authHeader = request.headers.authorization!;
      const token = authHeader.substring(7);
      
      // Decode token to get user ID
      const decoded = jwt.decode(token) as any;
      if (!decoded || (!decoded.userId && !decoded.sub)) {
        return reply.status(401).send({ error: 'Invalid authentication token' });
      }
      
      const userId = decoded.userId || decoded.sub;
      
      const linkedAccount = await prisma.linkedAzureAccount.findUnique({
        where: { user_id: userId },
        select: {
          azure_oid: true,
          azure_email: true,
          linked_at: true,
          updated_at: true,
          token_expires_at: true
        }
      });

      if (!linkedAccount) {
        return reply.status(404).send({
          linked: false,
          message: 'No Azure account is linked to this user'
        });
      }

      return reply.send({
        linked: true,
        azureAccount: {
          oid: linkedAccount.azure_oid,
          email: linkedAccount.azure_email,
          linkedAt: linkedAccount.linked_at,
          lastUpdated: linkedAccount.updated_at,
          tokenExpiry: linkedAccount.token_expires_at,
          isTokenValid: linkedAccount.token_expires_at > new Date()
        }
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get linked Azure account info');
      return reply.status(500).send({
        error: 'Failed to get linked Azure account information',
        message: error.message
      });
    }
  });

  /**
   * DELETE /accounts/unlink-azure
   * Unlink Azure account for authenticated user
   */
  fastify.delete('/accounts/unlink-azure', {
    preHandler: async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Fastify v5: calling reply.send() in a preHandler is not enough to abort
        // the lifecycle — Fastify v5 requires the reply to be returned (sent AND
        // returned). We await-and-return so Fastify sees a settled reply and skips
        // the main handler, preventing ERR_HTTP_HEADERS_SENT (double-send).
        await reply.status(401).send({ error: 'Authentication required' });
        return;
      }
    },
    schema: {
    }
  }, async (request, reply) => {
    try {
      const authHeader = request.headers.authorization!;
      const token = authHeader.substring(7);
      
      // Decode token to get user ID
      const decoded = jwt.decode(token) as any;
      if (!decoded || (!decoded.userId && !decoded.sub)) {
        return reply.status(401).send({ error: 'Invalid authentication token' });
      }
      
      const userId = decoded.userId || decoded.sub;

      // Check if account is linked
      const linkedAccount = await prisma.linkedAzureAccount.findUnique({
        where: { user_id: userId }
      });

      if (!linkedAccount) {
        return reply.status(404).send({
          success: false,
          error: 'No Azure account is linked to this user'
        });
      }

      // Delete the linked account
      await prisma.linkedAzureAccount.delete({
        where: { user_id: userId }
      });

      // Also clean up any stored Azure tokens
      await prisma.userAuthToken.deleteMany({
        where: { user_id: userId }
      }).catch(() => {
        // Don't fail if no tokens to delete
      });

      logger.info({ 
        userId, 
        azureEmail: linkedAccount.azure_email 
      }, 'Successfully unlinked Azure account');

      return reply.send({
        success: true,
        message: 'Azure account has been unlinked successfully',
        unlinkedAccount: {
          email: linkedAccount.azure_email,
          linkedSince: linkedAccount.linked_at
        }
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to unlink Azure account');
      return reply.status(500).send({
        success: false,
        error: 'Failed to unlink Azure account',
        message: error.message
      });
    }
  });

  fastify.log.info('Account linking routes registered - link, status, unlink, and UI-specific endpoints');
};

export default accountLinkingRoutes;