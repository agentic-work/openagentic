/**
 * MCP Management API
 * 
 * Unified endpoint for registering and managing MCP servers.
 * Handles both internal database and MCP Proxy synchronization.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { MCPSyncService } from '../../services/MCPSyncService.js';
import { logger } from '../../utils/logger.js';
import { adminMiddleware } from '../../middleware/unifiedAuth.js';
import { credentialAuditService } from '../../services/CredentialAuditService.js';

// Validation schemas
const RegisterMCPSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'ID must be alphanumeric with underscores/hyphens'),
  name: z.string(),
  description: z.string().optional(),
  transport: z.enum(['stdio', 'http', 'sse']),
  
  // For stdio transport
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  
  // For HTTP/SSE transport
  server_url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  
  // Capabilities and permissions
  capabilities: z.array(z.string()).optional(),
  require_obo: z.boolean().optional().default(false),
  user_isolated: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  
  // For third-party MCPs from npm or other sources
  package_name: z.string().optional(), // e.g., "@modelcontextprotocol/server-github"
  package_version: z.string().optional(),
  auto_install: z.boolean().optional().default(false)
});

const UpdateMCPSchema = RegisterMCPSchema.partial().omit({ id: true });

export default async function mcpManagementRoutes(fastify: FastifyInstance) {
  const mcpSync = new MCPSyncService(logger);
  
  // Start sync service on startup
  await mcpSync.startSync();
  
  // List all registered MCP servers
  fastify.get('/admin/mcp/servers', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'List all MCP servers',
      description: 'Get all registered Model Context Protocol servers with their status and sync state',
      response: {
        200: {
          type: 'object',
          properties: {
            servers: {
              type: 'array',
              items: { type: 'object', additionalProperties: true }
            },
            total: { type: 'number' },
            synced_count: { type: 'number' }
          }
        },
        500: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get from our database
      const dbServers = await prisma.mCPServerConfig.findMany({
        include: {
          status: true,
          _count: {
            select: { instances: true }
          }
        }
      });

      // Get from MCP Proxy to verify sync
      const proxyServers = await mcpSync.getMCPProxyServers();

      // Combine and mark sync status
      const servers = dbServers.map(server => ({
        ...server,
        synced_to_proxy: proxyServers.some(ls => ls.alias === server.id),
        instance_count: server._count.instances
      }));

      return reply.send({
        servers,
        total: servers.length,
        synced_count: servers.filter(s => s.synced_to_proxy).length
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list MCP servers');
      return reply.code(500).send({ error: 'Failed to list MCP servers' });
    }
  });

  // List all available MCP tools from all servers (returns all tools from MCP proxy)
  fastify.get('/api/admin/mcp/tools-list', { preHandler: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fetch tools directly from MCP Proxy
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

      logger.info({ mcpProxyUrl }, 'Fetching tools from MCP Proxy');

      const response = await fetch(`${mcpProxyUrl}/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        logger.error({
          status: response.status,
          statusText: response.statusText
        }, 'MCP Proxy returned error for /tools');
        return reply.code(response.status).send({
          error: 'Failed to fetch tools from MCP Proxy',
          details: response.statusText
        });
      }

      const data = await response.json() as { tools?: any[] };

      logger.info({
        toolCount: data.tools?.length || 0
      }, 'Successfully fetched MCP tools');

      return reply.send({
        tools: data.tools || [],
        total: data.tools?.length || 0,
        source: 'mcp-proxy'
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch MCP tools');
      return reply.code(500).send({
        error: 'Failed to fetch MCP tools',
        details: error.message
      });
    }
  });

  // Execute an MCP tool (used by tool testing in Admin Portal)
  fastify.post('/api/mcp', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Execute MCP tool',
      description: 'Execute a Model Context Protocol tool via JSON-RPC',
      body: { type: 'object', additionalProperties: true },
      response: {
        200: { type: 'object', additionalProperties: true },
        400: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        500: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } }
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        method: string;
        params?: {
          name?: string;
          arguments?: Record<string, any>;
        };
        server?: string;
        id?: string;
      };

      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

      logger.info({
        method: body.method,
        toolName: body.params?.name,
        server: body.server
      }, 'Proxying MCP tool execution to MCP Proxy');

      // Forward the request to MCP Proxy
      const response = await fetch(`${mcpProxyUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error({
          status: response.status,
          error: data
        }, 'MCP Proxy returned error for tool execution');
        return reply.code(response.status).send(data);
      }

      logger.info({
        method: body.method,
        toolName: body.params?.name,
        success: true
      }, 'MCP tool execution completed');

      return reply.send(data);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to execute MCP tool');
      return reply.code(500).send({
        error: {
          message: 'Failed to execute MCP tool',
          details: error.message
        }
      });
    }
  });

  // Register a new MCP server
  fastify.post('/admin/mcp/servers', { preHandler: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = RegisterMCPSchema.parse(request.body);
      
      // Check if server already exists
      const existing = await prisma.mCPServerConfig.findUnique({
        where: { id: body.id }
      });
      
      if (existing) {
        return reply.code(409).send({ error: 'MCP server with this ID already exists' });
      }
      
      // If it's an npm package and auto_install is true, install it
      if (body.package_name && body.auto_install) {
        // This would need to be implemented based on your container setup
        // For now, we'll just note it in the metadata
        logger.info({ 
          package: body.package_name, 
          version: body.package_version 
        }, 'Auto-install requested for MCP package');
      }
      
      // Create in database
      const server = await prisma.mCPServerConfig.create({
        data: {
          id: body.id,
          name: body.name,
          description: body.description,
          command: body.command || '',
          args: body.args || [],
          env: body.env || {},
          capabilities: body.capabilities || [],
          require_obo: body.require_obo || false,
          user_isolated: body.user_isolated || false,
          enabled: body.enabled !== false,
          metadata: {
            transport: body.transport,
            server_url: body.server_url,
            headers: body.headers,
            package_name: body.package_name,
            package_version: body.package_version
          }
        }
      });
      
      // Create initial status record
      await prisma.mCPServerStatus.create({
        data: {
          server_id: server.id,
          status: 'registered'
        }
      });
      
      // Sync to MCP Proxy
      try {
        await mcpSync.registerMCPServerWithProxy(server);
      } catch (syncError) {
        logger.error({
          serverId: server.id,
          error: syncError
        }, 'Failed to sync to MCP Proxy, but server was registered in database');
      }
      
      logger.info({
        serverId: server.id,
        serverName: server.name
      }, 'MCP server registered successfully');

      // Audit log the MCP server registration
      const adminUser = (request as any).user;
      await credentialAuditService.log({
        userId: adminUser?.id || 'unknown',
        userEmail: adminUser?.email,
        action: 'create',
        entityType: 'mcp_server',
        entityId: server.id,
        entityName: server.name,
        changes: { transport: { new: body.transport }, enabled: { new: body.enabled !== false } },
        request,
      });

      return reply.send({
        success: true,
        server: {
          id: server.id,
          name: server.name,
          status: 'registered'
        }
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ 
          error: 'Invalid request', 
          details: error.errors 
        });
      }
      
      logger.error({ error }, 'Failed to register MCP server');
      return reply.code(500).send({ error: 'Failed to register MCP server' });
    }
  });
  
  // Update an MCP server
  fastify.patch('/admin/mcp/servers/:serverId', { preHandler: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    try {
      const { serverId } = request.params;
      const body = UpdateMCPSchema.parse(request.body);
      
      // Update in database
      const server = await prisma.mCPServerConfig.update({
        where: { id: serverId },
        data: {
          ...body,
          metadata: {
            ...(body as any).metadata,
            updated_at: new Date().toISOString()
          }
        }
      });
      
      // Re-sync to MCP Proxy
      await mcpSync.registerMCPServerWithProxy(server);

      // Audit log the MCP server update
      const adminUser = (request as any).user;
      await credentialAuditService.log({
        userId: adminUser?.id || 'unknown',
        userEmail: adminUser?.email,
        action: 'update',
        entityType: 'mcp_server',
        entityId: serverId,
        entityName: server.name,
        changes: body as Record<string, { old?: unknown; new?: unknown }>,
        request,
      });

      return reply.send({
        success: true,
        server
      });
    } catch (error) {
      logger.error({ error, serverId: request.params.serverId }, 'Failed to update MCP server');
      return reply.code(500).send({ error: 'Failed to update MCP server' });
    }
  });
  
  // Delete an MCP server
  fastify.delete('/admin/mcp/servers/:serverId', { preHandler: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    try {
      const { serverId } = request.params;
      
      // Check for active instances
      const activeInstances = await prisma.mCPInstance.count({
        where: {
          server_id: serverId,
          status: 'running'
        }
      });
      
      if (activeInstances > 0) {
        return reply.code(409).send({ 
          error: 'Cannot delete server with active instances',
          active_instances: activeInstances
        });
      }
      
      // Unregister from MCP Proxy
      try {
        await mcpSync.unregisterMCPServer(serverId);
      } catch (error) {
        logger.warn({ serverId, error }, 'Failed to unregister from MCP Proxy');
      }
      
      // Capture server name before deletion for audit
      const serverToDelete = await prisma.mCPServerConfig.findUnique({
        where: { id: serverId },
        select: { name: true }
      });

      // Delete from database (cascade will handle related records)
      await prisma.mCPServerConfig.delete({
        where: { id: serverId }
      });

      logger.info({ serverId }, 'MCP server deleted');

      // Audit log the MCP server deletion
      const adminUser = (request as any).user;
      await credentialAuditService.log({
        userId: adminUser?.id || 'unknown',
        userEmail: adminUser?.email,
        action: 'delete',
        entityType: 'mcp_server',
        entityId: serverId,
        entityName: serverToDelete?.name || serverId,
        request,
      });

      return reply.send({
        success: true,
        message: 'MCP server deleted successfully'
      });
    } catch (error) {
      logger.error({ error, serverId: request.params.serverId }, 'Failed to delete MCP server');
      return reply.code(500).send({ error: 'Failed to delete MCP server' });
    }
  });
  
  // Force sync all servers
  fastify.post('/admin/mcp/sync', { preHandler: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await mcpSync.syncMCPServers();

      const dbCount = await prisma.mCPServerConfig.count({ where: { enabled: true } });
      const proxyServers = await mcpSync.getMCPProxyServers();

      return reply.send({
        success: true,
        db_servers: dbCount,
        proxy_servers: proxyServers.length,
        synced: dbCount === proxyServers.length
      });
    } catch (error) {
      logger.error({ error }, 'Failed to sync MCP servers');
      return reply.code(500).send({ error: 'Failed to sync MCP servers' });
    }
  });
  
  // Test an MCP server connection
  fastify.post('/admin/mcp/servers/:serverId/test', { preHandler: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
    try {
      const { serverId } = request.params;
      
      // Get server config
      const server = await prisma.mCPServerConfig.findUnique({
        where: { id: serverId }
      });
      
      if (!server) {
        return reply.code(404).send({ error: 'MCP server not found' });
      }
      
      // Try to list tools from the server
      const testUrl = `${process.env.MCP_ORCHESTRATOR_URL || 'http://mcp-orchestrator:3001'}/api/mcp/tools`;
      const response = await fetch(testUrl, {
        headers: {
          'x-mcp-server': serverId,
          'Authorization': `Bearer ${process.env.API_SECRET_KEY}`
        }
      });
      
      if (response.ok) {
        const data = await response.json() as { tools?: any[] };
        return reply.send({
          success: true,
          status: 'connected',
          tools_count: data.tools?.length || 0
        });
      } else {
        return reply.send({
          success: false,
          status: 'failed',
          error: response.statusText
        });
      }
    } catch (error) {
      logger.error({ error, serverId: request.params.serverId }, 'Failed to test MCP server');
      return reply.code(500).send({ error: 'Failed to test MCP server' });
    }
  });
}

// Example registration payloads for common third-party MCPs:
export const THIRD_PARTY_MCP_EXAMPLES = {
  github: {
    id: 'github_mcp',
    name: 'GitHub MCP',
    description: 'GitHub repository operations',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
    package_name: '@modelcontextprotocol/server-github',
    capabilities: ['tools', 'resources']
  },
  
  filesystem: {
    id: 'filesystem_mcp',
    name: 'Filesystem MCP',
    description: 'File system operations',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/allowed/path'],
    package_name: '@modelcontextprotocol/server-filesystem',
    capabilities: ['tools', 'resources']
  },
  
  postgres: {
    id: 'postgres_mcp',
    name: 'PostgreSQL MCP',
    description: 'PostgreSQL database operations',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { DATABASE_URL: '${DATABASE_URL}' },
    package_name: '@modelcontextprotocol/server-postgres',
    capabilities: ['tools', 'resources', 'prompts']
  },
  
  slack: {
    id: 'slack_mcp',
    name: 'Slack MCP',
    description: 'Slack workspace operations',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { 
      SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}',
      SLACK_TEAM_ID: '${SLACK_TEAM_ID}'
    },
    package_name: '@modelcontextprotocol/server-slack',
    capabilities: ['tools', 'resources']
  }
};