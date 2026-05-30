/**
 * Azure AD Synchronization Routes
 * 
 * Handles synchronization of Azure Active Directory users with local database,
 * including user creation, updates, and group membership management.
 * 
 */

import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../utils/prisma.js';

interface AzureADUser {
  oid: string;
  email: string;
  name?: string;
  groups?: string[];
  isAdmin?: boolean;  // Support both camelCase and snake_case
  is_admin?: boolean;
}

export const azureADSyncRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;
  
  // Using Prisma instead of Pool

  /**
   * POST /api/auth/azure/sync
   * Sync Azure AD user to local database
   */
    // Prisma client imported above

fastify.post<{ Body: AzureADUser }>('/api/auth/azure/sync', async (request, reply) => {
    const { oid, email, name, groups = [], isAdmin = false, is_admin = false } = request.body;
    const finalIsAdmin = isAdmin || is_admin; // Support both formats
    
    logger.info({ 
      oid, 
      email, 
      name, 
      groups, 
      isAdmin,
      is_admin,
      finalIsAdmin,
      requestBody: request.body 
    }, 'Azure AD sync request received');
    
    if (!oid || !email) {
      return reply.code(400).send({
        success: false,
        error: 'Missing required fields: oid and email'
      });
    }
    
    try {
      // Check if user exists by azureOid or email
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { azure_oid: oid },
            { email: email }
          ]
        }
      });
      
      let userId: string;
      let message: string;
      
      if (existingUser) {
        // Update existing user
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            azure_oid: oid,
            azure_tenant_id: 'default-tenant',
            name: name,
            is_admin: finalIsAdmin,
            groups: groups,
            updated_at: new Date()
          }
        });
        
        userId = existingUser.id;
        message = 'User updated successfully';
        logger.info({ userId, email, oid, isAdmin: finalIsAdmin }, 'Azure AD user updated');
      } else {
        // Create new user
        const newUser = await prisma.user.create({
          data: {
            id: `azure_${oid}`,
            email,
            name: name || email,
            azure_oid: oid,
            azure_tenant_id: 'default-tenant',
            is_admin: finalIsAdmin,
            groups: groups,
            created_at: new Date(),
            updated_at: new Date()
          }
        });
        
        userId = newUser.id;
        message = 'User created successfully';
        logger.info({ userId, email, oid, isAdmin: finalIsAdmin }, 'Azure AD user created');
      }
      
      return reply.send({
        success: true,
        userId,
        message
      });
    } catch (error) {
      logger.error({ error }, 'Failed to sync Azure AD user');
      return reply.code(500).send({
        success: false,
        error: 'Failed to sync user'
      });
    }
  });

  /**
   * GET /api/auth/azure/user/:oid
   * Get user by Azure OID
   */
  fastify.get<{ Params: { oid: string } }>('/api/auth/azure/user/:oid', async (request, reply) => {
    const { oid } = request.params;
    
    try {
      const user = await prisma.user.findFirst({
        where: { azure_oid: oid },
        select: {
          id: true,
          email: true,
          name: true,
          azure_oid: true,
          azure_tenant_id: true,
          is_admin: true,
          groups: true,
          created_at: true,
          updated_at: true
        }
      });
      
      if (!user) {
        return reply.code(404).send({
          success: false,
          error: 'User not found'
        });
      }
      
      return reply.send({
        success: true,
        user: {
          ...user,
          groups: Array.isArray(user.groups) ? user.groups : (user.groups ? JSON.parse(user.groups as string) : [])
        }
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get Azure AD user');
      return reply.code(500).send({
        success: false,
        error: 'Failed to get user'
      });
    }
  });
};