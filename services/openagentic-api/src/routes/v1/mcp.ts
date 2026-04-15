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
 * Unified MCP Routes - API v1
 *
 * Consolidates all MCP-related endpoints under /api/v1/mcp/*
 * Replaces the scattered MCP routes from:
 * - /mcp/* (root level convenience)
 * - /api/admin/mcp/* (admin routes)
 * - /api/chat/mcp/* (chat-specific)
 *
 * @module routes/v1/mcp
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware, adminMiddleware } from '../../middleware/unifiedAuth.js';
import { loggers } from '../../utils/logger.js';

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

interface MCPServerParams {
  id: string;
}

/**
 * MCP Routes Plugin
 *
 * All MCP server and tool management endpoints
 */
export const mcpRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // ============================================================================
  // READ OPERATIONS (Auth required, not admin)
  // ============================================================================

  /**
   * GET /api/v1/mcp/servers
   * List all MCP servers with their status
   */
  fastify.get('/servers', {
    preHandler: authMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'List all MCP servers',
      description: 'Returns all configured MCP servers with their current status',
      response: {
        200: {
          type: 'object',
          properties: {
            servers: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  enabled: { type: 'boolean' },
                  last_error: { type: ['string', 'null'] },
                  transport: { type: 'string' },
                  pid: { type: ['number', 'null'] }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': (request as any).user?.id || 'system'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP Proxy returned ${response.status}`);
      }

      const data = await response.json();
      // Wrap response to match schema: { servers: {...} }
      return reply.send({ servers: data });
    } catch (error) {
      logger.error({ err: error }, '[MCP v1] Failed to list servers');
      return reply.code(503).send({
        error: 'MCP service unavailable',
        message: error.message
      });
    }
  });

  /**
   * GET /api/v1/mcp/tools
   * List all available tools from all MCP servers
   */
  fastify.get('/tools', {
    preHandler: authMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'List all MCP tools',
      description: 'Returns all tools from all running MCP servers',
      response: {
        200: {
          type: 'object',
          properties: {
            tools: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  server: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  inputSchema: { type: 'object' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${MCP_PROXY_URL}/tools?limit=1000`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': (request as any).user?.id || 'system'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP Proxy returned ${response.status}`);
      }

      const data = await response.json();
      // Ensure response has tools array to match schema
      if (data.tools) {
        return reply.send(data);
      }
      return reply.send({ tools: Array.isArray(data) ? data : [] });
    } catch (error) {
      logger.error({ err: error }, '[MCP v1] Failed to list tools');
      return reply.code(503).send({
        error: 'MCP service unavailable',
        message: error.message
      });
    }
  });

  /**
   * GET /api/v1/mcp/health
   * MCP system health status
   */
  fastify.get('/health', {
    preHandler: authMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'MCP health status',
      description: 'Returns health status of the MCP proxy and servers'
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${MCP_PROXY_URL}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return reply.send({
          status: 'unhealthy',
          proxy: 'error',
          message: `MCP Proxy returned ${response.status}`
        });
      }

      const data = await response.json();
      return reply.send({
        status: 'healthy',
        proxy: 'connected',
        ...data
      });
    } catch (error) {
      logger.warn({ err: error }, '[MCP v1] Health check failed');
      return reply.send({
        status: 'unhealthy',
        proxy: 'unreachable',
        error: error.message
      });
    }
  });

  /**
   * GET /api/v1/mcp/stats
   * MCP statistics for admin dashboard
   * UAT Requirements: UC-030, UC-021
   */
  fastify.get('/stats', {
    preHandler: authMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'MCP statistics',
      description: 'Returns comprehensive MCP statistics for monitoring'
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Gather stats from MCP Proxy
      const [serversRes, toolsRes, healthRes] = await Promise.all([
        fetch(`${MCP_PROXY_URL}/servers`).catch(() => null),
        fetch(`${MCP_PROXY_URL}/tools?limit=1000`).catch(() => null),
        fetch(`${MCP_PROXY_URL}/health`).catch(() => null)
      ]);

      const servers = serversRes?.ok ? await serversRes.json() : {};
      const toolsData = toolsRes?.ok ? await toolsRes.json() : { tools: [] };
      const health = healthRes?.ok ? await healthRes.json() : { status: 'unknown' };

      const serverList = Object.entries(servers);
      const runningServers = serverList.filter(([_, v]: [string, any]) => v.status === 'running');
      const stoppedServers = serverList.filter(([_, v]: [string, any]) => v.status === 'stopped');
      const errorServers = serverList.filter(([_, v]: [string, any]) => v.status === 'error');

      // Group tools by server
      const toolsByServer: Record<string, number> = {};
      (toolsData.tools || []).forEach((tool: any) => {
        const server = tool.server || 'unknown';
        toolsByServer[server] = (toolsByServer[server] || 0) + 1;
      });

      return reply.send({
        summary: {
          totalServers: serverList.length,
          runningServers: runningServers.length,
          stoppedServers: stoppedServers.length,
          errorServers: errorServers.length,
          totalTools: toolsData.tools?.length || 0,
          proxyStatus: health.status || 'unknown'
        },
        servers: serverList.map(([name, info]: [string, any]) => ({
          name,
          status: info.status,
          enabled: info.enabled,
          toolCount: toolsByServer[name] || 0,
          lastError: info.last_error || null,
          transport: info.transport || 'stdio'
        })),
        toolDistribution: toolsByServer,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ err: error }, '[MCP v1] Failed to get stats');
      return reply.code(503).send({
        error: 'MCP service unavailable',
        message: error.message
      });
    }
  });

  /**
   * GET /api/v1/mcp/status
   * Detailed MCP status for chat
   */
  fastify.get('/status', {
    preHandler: authMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'MCP status for chat',
      description: 'Returns MCP status optimized for chat UI display'
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [serversRes, toolsRes] = await Promise.all([
        fetch(`${MCP_PROXY_URL}/servers`),
        fetch(`${MCP_PROXY_URL}/tools?limit=100`)
      ]);

      const servers = serversRes.ok ? await serversRes.json() : { error: 'unavailable' };
      const tools = toolsRes.ok ? await toolsRes.json() : { tools: [] };

      const runningServers = Object.entries(servers)
        .filter(([_, v]: [string, any]) => v.status === 'running')
        .length;

      return reply.send({
        enabled: true,
        connected: runningServers > 0,
        serverCount: Object.keys(servers).length,
        runningCount: runningServers,
        toolCount: tools.tools?.length || 0,
        servers,
        tools: tools.tools?.slice(0, 20) // First 20 tools for preview
      });
    } catch (error) {
      logger.error({ err: error }, '[MCP v1] Status check failed');
      return reply.send({
        enabled: true,
        connected: false,
        error: error.message
      });
    }
  });

  // ============================================================================
  // ADMIN OPERATIONS (Admin role required)
  // ============================================================================

  /**
   * POST /api/v1/mcp/servers
   * Add a new MCP server
   */
  fastify.post('/servers', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Add MCP server',
      description: 'Add a new MCP server configuration (admin only)',
      body: {
        type: 'object',
        required: ['name', 'command'],
        properties: {
          name: { type: 'string', description: 'Server identifier' },
          command: {
            type: 'array',
            items: { type: 'string' },
            description: 'Command to start the server'
          },
          env: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Environment variables'
          },
          transport: {
            type: 'string',
            enum: ['stdio', 'http'],
            default: 'stdio'
          },
          enabled: { type: 'boolean', default: true }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = request.body as any;
      logger.info({ config: config.name }, '[MCP v1] Adding server');

      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      const result = await response.json();
      return reply.code(201).send(result);
    } catch (error) {
      logger.error({ err: error }, '[MCP v1] Failed to add server');
      return reply.code(500).send({
        error: 'Failed to add MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /api/v1/mcp/servers/:id/start
   * Start an MCP server
   */
  fastify.post<{ Params: MCPServerParams }>('/servers/:id/start', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Start MCP server',
      description: 'Start a stopped MCP server (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Server ID' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      logger.info({ serverId: id }, '[MCP v1] Starting server');

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/start`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return reply.send({ success: true, server: id, action: 'started' });
    } catch (error) {
      logger.error({ err: error, serverId: id }, '[MCP v1] Failed to start server');
      return reply.code(500).send({
        error: 'Failed to start server',
        message: error.message
      });
    }
  });

  /**
   * POST /api/v1/mcp/servers/:id/stop
   * Stop an MCP server
   */
  fastify.post<{ Params: MCPServerParams }>('/servers/:id/stop', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Stop MCP server',
      description: 'Stop a running MCP server (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Server ID' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      logger.info({ serverId: id }, '[MCP v1] Stopping server');

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/stop`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return reply.send({ success: true, server: id, action: 'stopped' });
    } catch (error) {
      logger.error({ err: error, serverId: id }, '[MCP v1] Failed to stop server');
      return reply.code(500).send({
        error: 'Failed to stop server',
        message: error.message
      });
    }
  });

  /**
   * POST /api/v1/mcp/servers/:id/restart
   * Restart an MCP server
   */
  fastify.post<{ Params: MCPServerParams }>('/servers/:id/restart', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Restart MCP server',
      description: 'Restart an MCP server (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Server ID' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      logger.info({ serverId: id }, '[MCP v1] Restarting server');

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/restart`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return reply.send({ success: true, server: id, action: 'restarted' });
    } catch (error) {
      logger.error({ err: error, serverId: id }, '[MCP v1] Failed to restart server');
      return reply.code(500).send({
        error: 'Failed to restart server',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/v1/mcp/servers/:id
   * Remove an MCP server
   */
  fastify.delete<{ Params: MCPServerParams }>('/servers/:id', {
    preHandler: adminMiddleware,
    schema: {
      tags: ['MCP'],
      summary: 'Remove MCP server',
      description: 'Remove an MCP server configuration (admin only)',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Server ID' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      logger.info({ serverId: id }, '[MCP v1] Removing server');

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return reply.send({ success: true, server: id, action: 'removed' });
    } catch (error) {
      logger.error({ err: error, serverId: id }, '[MCP v1] Failed to remove server');
      return reply.code(500).send({
        error: 'Failed to remove server',
        message: error.message
      });
    }
  });

  logger.info('✅ MCP v1 routes registered');
};

export default mcpRoutes;
