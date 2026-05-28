/**
 * Admin MCP Access Control Routes
 * Manage which Azure AD groups can access which MCP servers
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { enterpriseOnly } from '../middleware/enterpriseOnly.js';

const logger = loggers.routes.child({ component: 'AdminMCPAccess' });

const adminMCPAccessRoutes: FastifyPluginAsync = async (fastify) => {

  // OSS gate — per-route. The `/servers` listing is free (admin needs it
  // to see what MCPs are running). Azure-AD policy routes are enterprise.
  /**
   * Get all MCP access policies
   */
  fastify.get('/policies', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const policies = await prisma.mCPAccessPolicy.findMany({
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        },
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ]
      });

      return reply.code(200).send(policies);
    } catch (error) {
      logger.error('Error fetching MCP access policies:', error);
      return reply.code(500).send({ error: 'Failed to fetch MCP access policies' });
    }
  });

  /**
   * Get default policies
   */
  fastify.get('/default-policies', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const defaultPolicies = await prisma.mCPDefaultPolicy.findMany({
        orderBy: { policy_type: 'asc' }
      });

      return reply.code(200).send(defaultPolicies);
    } catch (error) {
      logger.error('Error fetching MCP default policies:', error);
      return reply.code(500).send({ error: 'Failed to fetch MCP default policies' });
    }
  });

  /**
   * Create a new MCP access policy
   */
  fastify.post('/policies', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        azure_group_id,
        azure_group_name,
        server_id,
        access_type,
        priority = 1000,
        reason,
        is_enabled = true
      } = request.body as any;

      // Validate required fields
      if (!azure_group_id || !azure_group_name || !server_id || !access_type) {
        return reply.code(400).send({
          error: 'Missing required fields: azure_group_id, azure_group_name, server_id, access_type'
        });
      }

      if (!['allow', 'deny'].includes(access_type)) {
        return reply.code(400).send({
          error: 'access_type must be either "allow" or "deny"'
        });
      }

      // Verify the server exists
      const server = await prisma.mCPServerConfig.findUnique({
        where: { id: server_id }
      });

      if (!server) {
        return reply.code(404).send({ error: 'MCP server not found' });
      }

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPAccessPolicy.create({
        data: {
          azure_group_id,
          azure_group_name,
          server_id,
          access_type,
          priority: Number(priority),
          reason,
          is_enabled,
          created_by: userId,
          updated_by: userId
        },
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        }
      });

      return reply.code(201).send(policy);
    } catch (error: any) {
      logger.error('Error creating MCP access policy:', error);

      if (error.code === 'P2002') {
        return reply.code(409).send({
          error: 'Policy already exists for this Azure group and MCP server combination'
        });
      }

      return reply.code(500).send({ error: 'Failed to create MCP access policy' });
    }
  });

  /**
   * Update an MCP access policy
   */
  fastify.put('/policies/:id', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as any;
      const {
        azure_group_name,
        access_type,
        priority,
        reason,
        is_enabled
      } = request.body as any;

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPAccessPolicy.update({
        where: { id },
        data: {
          ...(azure_group_name && { azure_group_name }),
          ...(access_type && { access_type }),
          ...(priority !== undefined && { priority: Number(priority) }),
          ...(reason !== undefined && { reason }),
          ...(is_enabled !== undefined && { is_enabled }),
          updated_by: userId
        },
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        }
      });

      return reply.code(200).send(policy);
    } catch (error: any) {
      logger.error('Error updating MCP access policy:', error);

      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'MCP access policy not found' });
      }

      return reply.code(500).send({ error: 'Failed to update MCP access policy' });
    }
  });

  /**
   * Delete an MCP access policy
   */
  fastify.delete('/policies/:id', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as any;

      await prisma.mCPAccessPolicy.delete({
        where: { id }
      });

      return reply.code(204).send();
    } catch (error: any) {
      logger.error('Error deleting MCP access policy:', error);

      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'MCP access policy not found' });
      }

      return reply.code(500).send({ error: 'Failed to delete MCP access policy' });
    }
  });

  /**
   * Update default policy
   */
  fastify.put('/default-policies/:policy_type', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { policy_type } = request.params as any;
      const { default_access, description } = request.body as any;

      if (!['user_default', 'admin_default'].includes(policy_type)) {
        return reply.code(400).send({
          error: 'policy_type must be either "user_default" or "admin_default"'
        });
      }

      if (!['allow', 'deny'].includes(default_access)) {
        return reply.code(400).send({
          error: 'default_access must be either "allow" or "deny"'
        });
      }

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPDefaultPolicy.upsert({
        where: { policy_type },
        update: {
          default_access,
          description,
          updated_by: userId
        },
        create: {
          policy_type,
          default_access,
          description,
          created_by: userId,
          updated_by: userId
        }
      });

      return reply.code(200).send(policy);
    } catch (error) {
      logger.error('Error updating MCP default policy:', error);
      return reply.code(500).send({ error: 'Failed to update MCP default policy' });
    }
  });

  // GET /servers — deleted 2026-05-27. The canonical impl lives in routes/admin/mcp-management.ts.
  /**
   * Get access summary for a specific Azure group
   */
  fastify.get('/access-summary/:azure_group_id', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { azure_group_id } = request.params as any;

      // Get all policies for this group
      const policies = await prisma.mCPAccessPolicy.findMany({
        where: {
          azure_group_id,
          is_enabled: true
        },
        include: {
          server: true
        },
        orderBy: { priority: 'asc' }
      });

      // Get all servers
      const allServers = await prisma.mCPServerConfig.findMany({
        where: { enabled: true },
        orderBy: { name: 'asc' }
      });

      // Get default policies
      const defaultPolicies = await prisma.mCPDefaultPolicy.findMany();
      const userDefault = defaultPolicies.find(p => p.policy_type === 'user_default');

      // Calculate effective access for each server
      const accessSummary = allServers.map(server => {
        const policy = policies.find(p => p.server_id === server.id);

        return {
          server: {
            id: server.id,
            name: server.name,
            description: server.description
          },
          access: policy ? policy.access_type : (userDefault?.default_access || 'deny'),
          hasExplicitPolicy: !!policy,
          policy: policy || null
        };
      });

      return reply.code(200).send({
        azure_group_id,
        access_summary: accessSummary
      });
    } catch (error) {
      logger.error('Error fetching access summary:', error);
      return reply.code(500).send({ error: 'Failed to fetch access summary' });
    }
  });

  /**
   * Test access for a user (for debugging/admin testing)
   */
  fastify.post('/test-access', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id, server_id } = request.body as any;

      if (!user_id || !server_id) {
        return reply.code(400).send({
          error: 'Missing required fields: user_id, server_id'
        });
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: {
          id: true,
          email: true,
          name: true,
          groups: true,
          is_admin: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Import and use the access control service
      const { mcpAccessControlService } = await import('../services/MCPAccessControlService.js');

      const accessResult = await mcpAccessControlService.checkAccess(
        user.id,
        server_id,
        user.groups || [],
        user.is_admin || false,
        logger
      );

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          groups: user.groups,
          is_admin: user.is_admin
        },
        server_id,
        access_result: accessResult
      });
    } catch (error) {
      logger.error('Error testing access:', error);
      return reply.code(500).send({ error: 'Failed to test access' });
    }
  });

  /**
   * Get all accessible servers for a user (for debugging/admin testing)
   */
  fastify.post('/accessible-servers', {
    onRequest: adminMiddleware,
    preHandler: [enterpriseOnly]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id } = request.body as any;

      if (!user_id) {
        return reply.code(400).send({
          error: 'Missing required field: user_id'
        });
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: {
          id: true,
          email: true,
          name: true,
          groups: true,
          is_admin: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Import and use the access control service
      const { mcpAccessControlService } = await import('../services/MCPAccessControlService.js');

      const accessibleServerIds = await mcpAccessControlService.getAccessibleServers(
        user.id,
        user.groups || [],
        user.is_admin || false,
        logger
      );

      // Get full server details
      const servers = await prisma.mCPServerConfig.findMany({
        where: {
          id: { in: accessibleServerIds }
        },
        select: {
          id: true,
          name: true,
          description: true,
          enabled: true
        }
      });

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          groups: user.groups,
          is_admin: user.is_admin
        },
        accessible_servers: servers,
        total_count: servers.length
      });
    } catch (error) {
      logger.error('Error fetching accessible servers:', error);
      return reply.code(500).send({ error: 'Failed to fetch accessible servers' });
    }
  });
};

export default adminMCPAccessRoutes;
