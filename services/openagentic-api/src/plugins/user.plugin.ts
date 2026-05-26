/**
 * User Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all user-specific route registrations.
 *
 * Includes:
 * - User permissions endpoint
 * - Available MCP tools endpoint (with permission filtering)
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { PrismaClient } from '@prisma/client';
import { UserPermissionsService } from '../services/UserPermissionsService.js';

interface UserPluginOptions {
  prisma: PrismaClient;
  authMiddleware: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  mcpProxyUrl: string;
}

const userPlugin: FastifyPluginAsync<UserPluginOptions> = async (
  fastify: FastifyInstance,
  options: UserPluginOptions
) => {
  const { prisma, authMiddleware, mcpProxyUrl } = options;

  loggers.routes.info('Registering user routes plugin...');

  const userPermissionsService = new UserPermissionsService(prisma, loggers.services);

  // User permissions endpoint - returns the authenticated user's resolved permissions
  fastify.get('/api/user/permissions', {
    onRequest: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const userId = user?.userId || user?.id;
      const userGroups = user?.groups || [];
      const isAdmin = user?.isAdmin || false;

      if (!userId) {
        return reply.status(401).send({ error: 'User not authenticated' });
      }

      // Get resolved permissions for this user
      const permissions = await userPermissionsService.getUserPermissions(userId, userGroups);

      // Return permissions with admin status
      return reply.send({
        ...permissions,
        isAdmin,
        // Admins always have AWCode access
        canUseAwcode: isAdmin || permissions.canUseAwcode,
        // Admins always have Flows access; non-admins only if granted
        workflowsEnabled: isAdmin || permissions.workflowsEnabled,
        // MCP panel visible if any MCP access
        mcpPanelEnabled: permissions.allowedMcpServers.length === 0 || permissions.allowedMcpServers.length > 0,
      });
    } catch (error: any) {
      loggers.routes.error({ error }, 'Failed to get user permissions');
      return reply.status(500).send({
        error: 'Failed to get user permissions',
        message: error.message
      });
    }
  });

  loggers.routes.info('User Permissions API endpoint registered at /api/user/permissions');

  // Available MCP tools endpoint (with user permission filtering)
  fastify.get('/api/user/available-tools', {
    onRequest: authMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      loggers.routes.debug('Fetching available MCP tools from MCP Proxy');

      // Get user info from auth middleware
      const user = (request as any).user;
      const userId = user?.userId || user?.id;
      const userGroups = user?.groups || [];
      const isAdmin = user?.isAdmin || false;
      const isLocalAccount = user?.localAccount === true;

      // Get user permissions for MCP filtering
      let userPermissions: any = null;
      if (userId) {
        try {
          userPermissions = await userPermissionsService.getUserPermissions(userId, userGroups);
        } catch (permError) {
          loggers.routes.warn('Failed to get user permissions for MCP filtering, using defaults');
        }
      }

      // Build headers for MCP proxy request
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Only send Authorization header for Azure AD users
      if (!isLocalAccount && user?.accessToken) {
        headers['Authorization'] = `Bearer ${user.accessToken}`;
        loggers.routes.debug('Using Azure AD token for MCP proxy auth');
      } else {
        loggers.routes.debug('Local admin user - accessing MCP proxy without token');
      }

      // Fetch MCP tools directly from MCP Proxy with no limit
      const response = await fetch(`${mcpProxyUrl}/v1/mcp/tools?limit=1000`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        loggers.routes.warn(`MCP Proxy endpoint unavailable (${response.status}), returning empty tools list`);
        return reply.send({
          tools: { functions: [], toolsByServer: {} },
          servers: [],
          available: false
        });
      }

      const mcpData = await response.json() as { tools?: Array<{ server?: string; serverName?: string }> };

      // Transform MCP Proxy response to match UI expectations
      const toolsByServer: Record<string, any[]> = {};
      const allFunctions: any[] = [];
      const servers: any[] = [];

      // Helper function to check if a server is admin-only
      const isAdminOnlyServer = (serverName: string): boolean => {
        return serverName.toLowerCase().includes('admin');
      };

      // Helper function to check if a server should be visible to this user
      const isServerAllowed = (serverName: string): boolean => {
        const serverNameLower = serverName.toLowerCase();

        // Admin-only servers are only visible to admins
        if (isAdminOnlyServer(serverNameLower)) {
          return isAdmin;
        }

        // If user has permissions, apply them
        if (userPermissions) {
          // Check if server is explicitly denied
          if (userPermissions.deniedMcpServers.includes(serverName) ||
              userPermissions.deniedMcpServers.includes(serverNameLower)) {
            return false;
          }

          // If allowed list is empty, allow all (except denied and admin-only)
          if (userPermissions.allowedMcpServers.length === 0) {
            return true;
          }

          // Check if in allowed list
          return userPermissions.allowedMcpServers.includes(serverName) ||
                 userPermissions.allowedMcpServers.includes(serverNameLower);
        }

        // Default: allow all non-admin servers
        return true;
      };

      // Group tools by server and create server objects
      if (mcpData.tools && Array.isArray(mcpData.tools)) {
        const serverMap = new Map<string, any[]>();

        mcpData.tools.forEach((tool: any) => {
          const serverName = tool.server || tool.serverName || 'default';

          // Skip tools from servers the user shouldn't see
          if (!isServerAllowed(serverName)) {
            return;
          }

          if (!serverMap.has(serverName)) {
            serverMap.set(serverName, []);
          }
          serverMap.get(serverName)!.push(tool);
          allFunctions.push(tool);
        });

        // Create server objects from the map
        serverMap.forEach((tools, serverName) => {
          const serverId = serverName.toLowerCase().replace(/[^a-z0-9]/g, '_');
          toolsByServer[serverId] = tools;
          servers.push({
            id: serverId,
            name: serverName,
            isConnected: true,
            status: 'connected',
            tools: tools,
            toolCount: tools.length
          });
        });
      }

      const transformedData = {
        tools: {
          functions: allFunctions,
          toolsByServer
        },
        servers,
        available: true,
        totalTools: allFunctions.length,
        connectedServers: servers.length
      };

      loggers.routes.info(`✅ Fetched ${allFunctions.length} tools from ${servers.length} MCP servers via MCP Proxy (filtered for user ${userId})`);
      return reply.send(transformedData);

    } catch (error: any) {
      loggers.routes.warn('MCP tools unavailable from MCP Proxy, returning empty list:', error.message);
      return reply.send({
        tools: { functions: [], toolsByServer: {} },
        servers: [],
        available: false,
        error: 'MCP services temporarily unavailable'
      });
    }
  });

  loggers.routes.info('MCP Tools API endpoint registered at /api/user/available-tools');
  loggers.routes.info('✅ User routes plugin registered successfully');
};

export default fp(userPlugin, {
  name: 'user-routes',
  dependencies: []
});
