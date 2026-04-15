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
 * Admin MCP Management API Routes
 *
 * Provides comprehensive MCP proxy management:
 * - Dynamic server configuration (JSON-based)
 * - Server lifecycle management (start/stop/restart)
 * - Health monitoring
 * - Tool discovery and registry
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

// MCP Proxy base URL (from environment or default to localhost)
const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://localhost:8001';

export default async function adminMCPManagementRoutes(fastify: FastifyInstance) {
  /**
   * GET /admin/mcp/servers
   * List all MCP servers with status
   */
  fastify.get('/mcp/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching all MCP servers');

      // Forward request to MCP proxy
      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform the MCP proxy response (dict of server_name -> status)
      // into the format the UI expects (array of server objects)
      const servers = Object.entries(data).map(([serverName, serverInfo]: [string, any]) => ({
        id: serverName,
        name: serverName,
        command: serverInfo.command || [],
        args: serverInfo.args || [],
        env: serverInfo.env || {},
        enabled: serverInfo.enabled ?? true,
        status: serverInfo.status || 'unknown',
        health: serverInfo.health || null,
        tools: serverInfo.tools || [],
        toolCount: serverInfo.tool_count || 0,
        createdAt: serverInfo.created_at || new Date().toISOString(),
        updatedAt: serverInfo.updated_at || new Date().toISOString(),
        source: serverInfo.source || 'manual',
        pid: serverInfo.pid || null,
        lastError: serverInfo.last_error || null
      }));

      logger.info('[ADMIN-MCP] Successfully fetched MCP servers', {
        serverCount: servers.length
      });

      return reply.send({ servers });
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP servers', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP servers',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers
   * Add a new MCP server from JSON configuration
   */
  fastify.post('/mcp/servers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = request.body as any;

      logger.info('[ADMIN-MCP] Adding new MCP server', {
        name: config.name,
        command: config.command
      });

      // Validate required fields
      if (!config.name || !config.command || !Array.isArray(config.command)) {
        return reply.status(400).send({
          error: 'Invalid configuration',
          message: 'Configuration must include "name" and "command" (array)'
        });
      }

      // Forward to MCP proxy
      const response = await fetch(`${MCP_PROXY_URL}/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully added MCP server', {
        serverId: data.id,
        name: config.name
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to add MCP server', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to add MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/start
   * Start an MCP server
   */
  fastify.post('/mcp/servers/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Starting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully started MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to start MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to start MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/stop
   * Stop an MCP server
   */
  fastify.post('/mcp/servers/:id/stop', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Stopping MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully stopped MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to stop MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to stop MCP server',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/:id/restart
   * Restart an MCP server
   */
  fastify.post('/mcp/servers/:id/restart', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Restarting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully restarted MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to restart MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to restart MCP server',
        message: error.message
      });
    }
  });

  /**
   * DELETE /admin/mcp/servers/:id
   * Delete an MCP server
   */
  fastify.delete('/mcp/servers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;

      logger.info('[ADMIN-MCP] Deleting MCP server', { serverId: id });

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully deleted MCP server', { serverId: id });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to delete MCP server', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to delete MCP server',
        message: error.message
      });
    }
  });

  /**
   * PATCH /admin/mcp/servers/:id/enabled
   * Enable or disable an MCP server at runtime
   * State is persisted to Redis and survives restarts
   */
  fastify.patch('/mcp/servers/:id/enabled', async (
    request: FastifyRequest<{ Params: { id: string }; Body: { enabled: boolean } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const { enabled } = request.body;

      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          error: 'Invalid request',
          message: 'Request body must include "enabled" (boolean)'
        });
      }

      logger.info('[ADMIN-MCP] Setting server enabled state', {
        serverId: id,
        enabled
      });

      // Use API internal key for service-to-service auth (grants admin access)
      const apiInternalKey = process.env.API_INTERNAL_KEY || '';  // MUST be set in env
      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/enabled`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiInternalKey}`
        },
        body: JSON.stringify({ enabled })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully set server enabled state', {
        serverId: id,
        enabled,
        action: data.action
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to set server enabled state', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to set server enabled state',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/servers/:id/enabled
   * Get the enabled state of a specific MCP server
   */
  fastify.get('/mcp/servers/:id/enabled', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;

      const response = await fetch(`${MCP_PROXY_URL}/servers/${id}/enabled`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();
      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to get server enabled state', {
        serverId: request.params.id,
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to get server enabled state',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/servers/enabled
   * List enabled states for all MCP servers
   */
  fastify.get('/mcp/servers-enabled', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await fetch(`${MCP_PROXY_URL}/servers/enabled`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errorData.detail || errorData.error || response.statusText);
      }

      const data = await response.json();
      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to list server enabled states', {
        error: error.message
      });
      return reply.status(500).send({
        error: 'Failed to list server enabled states',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/health
   * Get health status of all MCP servers
   */
  fastify.get('/mcp/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching MCP health status');

      const response = await fetch(`${MCP_PROXY_URL}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully fetched MCP health status');

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP health status', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP health status',
        message: error.message
      });
    }
  });

  /**
   * GET /admin/mcp/tools-list
   * Get all tools from all running MCP servers
   */
  fastify.get('/mcp/tools-list', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('[ADMIN-MCP] Fetching all MCP tools');

      const response = await fetch(`${MCP_PROXY_URL}/tools`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`MCP proxy returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('[ADMIN-MCP] Successfully fetched MCP tools', {
        toolCount: data.tools?.length || 0
      });

      return reply.send(data);
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to fetch MCP tools', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch MCP tools',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/manifest
   * Import MCP servers from a manifest file (Claude Desktop format or custom)
   *
   * Supports both Claude Desktop manifest format:
   * {
   *   "mcpServers": {
   *     "server-name": {
   *       "command": "npx",
   *       "args": ["-y", "@mcp/server-name"],
   *       "env": { "API_KEY": "..." }
   *     }
   *   }
   * }
   *
   * And array format:
   * {
   *   "servers": [
   *     { "name": "server-name", "command": ["npx", "-y", "@mcp/server-name"], "env": {...} }
   *   ]
   * }
   */
  fastify.post('/mcp/servers/manifest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifest = request.body as any;

      logger.info('[ADMIN-MCP] Processing MCP manifest upload');

      // Results tracking
      const results: Array<{
        name: string;
        success: boolean;
        message: string;
        serverId?: string;
      }> = [];

      // Parse manifest - support both Claude Desktop and array formats
      let serversToAdd: Array<{ name: string; command: string[]; args?: string[]; env?: Record<string, string> }> = [];

      // Format 1: Claude Desktop manifest format { mcpServers: { name: config } }
      if (manifest.mcpServers && typeof manifest.mcpServers === 'object') {
        logger.info('[ADMIN-MCP] Detected Claude Desktop manifest format');

        for (const [serverName, config] of Object.entries(manifest.mcpServers)) {
          const serverConfig = config as any;

          // Convert Claude Desktop format to our format
          // Claude Desktop: { command: "npx", args: ["-y", "@mcp/server"] }
          // Our format: { name: "server", command: ["npx", "-y", "@mcp/server"] }
          let command: string[];
          if (typeof serverConfig.command === 'string') {
            command = [serverConfig.command, ...(serverConfig.args || [])];
          } else if (Array.isArray(serverConfig.command)) {
            command = serverConfig.command;
          } else {
            results.push({
              name: serverName,
              success: false,
              message: 'Invalid command format - must be string or array'
            });
            continue;
          }

          serversToAdd.push({
            name: serverName,
            command,
            env: serverConfig.env || {}
          });
        }
      }
      // Format 2: Array format { servers: [{ name, command, ... }] }
      else if (manifest.servers && Array.isArray(manifest.servers)) {
        logger.info('[ADMIN-MCP] Detected array manifest format');

        for (const serverConfig of manifest.servers) {
          if (!serverConfig.name || !serverConfig.command) {
            results.push({
              name: serverConfig.name || 'unknown',
              success: false,
              message: 'Missing required fields: name and command'
            });
            continue;
          }

          serversToAdd.push({
            name: serverConfig.name,
            command: Array.isArray(serverConfig.command) ? serverConfig.command : [serverConfig.command, ...(serverConfig.args || [])],
            env: serverConfig.env || {}
          });
        }
      }
      else {
        return reply.status(400).send({
          error: 'Invalid manifest format',
          message: 'Manifest must contain either "mcpServers" object (Claude Desktop format) or "servers" array'
        });
      }

      if (serversToAdd.length === 0) {
        return reply.status(400).send({
          error: 'No servers found',
          message: 'Manifest contained no valid server configurations'
        });
      }

      logger.info('[ADMIN-MCP] Adding servers from manifest', {
        serverCount: serversToAdd.length,
        serverNames: serversToAdd.map(s => s.name)
      });

      // Add each server
      for (const serverConfig of serversToAdd) {
        try {
          const response = await fetch(`${MCP_PROXY_URL}/servers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(serverConfig)
          });

          if (response.ok) {
            const data = await response.json();
            results.push({
              name: serverConfig.name,
              success: true,
              message: 'Server added successfully',
              serverId: data.id || serverConfig.name
            });
          } else {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            results.push({
              name: serverConfig.name,
              success: false,
              message: errorData.error || errorData.detail || response.statusText
            });
          }
        } catch (error: any) {
          results.push({
            name: serverConfig.name,
            success: false,
            message: error.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      logger.info('[ADMIN-MCP] Manifest import completed', {
        total: results.length,
        success: successCount,
        failed: failCount
      });

      return reply.send({
        message: `Imported ${successCount} of ${results.length} servers`,
        total: results.length,
        success: successCount,
        failed: failCount,
        results
      });
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to process manifest', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to process manifest',
        message: error.message
      });
    }
  });

  /**
   * POST /admin/mcp/servers/validate-manifest
   * Validate a manifest without importing
   */
  fastify.post('/mcp/servers/validate-manifest', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifest = request.body as any;

      logger.info('[ADMIN-MCP] Validating MCP manifest');

      const validationResults: Array<{
        name: string;
        valid: boolean;
        errors: string[];
        warnings: string[];
      }> = [];

      let format: 'claude-desktop' | 'array' | 'unknown' = 'unknown';

      // Detect and validate format
      if (manifest.mcpServers && typeof manifest.mcpServers === 'object') {
        format = 'claude-desktop';

        for (const [serverName, config] of Object.entries(manifest.mcpServers)) {
          const serverConfig = config as any;
          const errors: string[] = [];
          const warnings: string[] = [];

          // Validate server name
          if (!serverName || typeof serverName !== 'string') {
            errors.push('Invalid server name');
          } else if (!/^[a-zA-Z0-9_-]+$/.test(serverName)) {
            warnings.push('Server name contains special characters - may cause issues');
          }

          // Validate command
          if (!serverConfig.command) {
            errors.push('Missing required field: command');
          } else if (typeof serverConfig.command !== 'string' && !Array.isArray(serverConfig.command)) {
            errors.push('Command must be a string or array');
          }

          // Validate args
          if (serverConfig.args && !Array.isArray(serverConfig.args)) {
            errors.push('Args must be an array');
          }

          // Validate env
          if (serverConfig.env && typeof serverConfig.env !== 'object') {
            errors.push('Env must be an object');
          } else if (serverConfig.env) {
            // Check for sensitive env vars
            const sensitiveKeys = ['API_KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL'];
            for (const key of Object.keys(serverConfig.env)) {
              if (sensitiveKeys.some(s => key.toUpperCase().includes(s))) {
                warnings.push(`Environment variable "${key}" may contain sensitive data`);
              }
            }
          }

          validationResults.push({
            name: serverName,
            valid: errors.length === 0,
            errors,
            warnings
          });
        }
      } else if (manifest.servers && Array.isArray(manifest.servers)) {
        format = 'array';

        for (const serverConfig of manifest.servers) {
          const errors: string[] = [];
          const warnings: string[] = [];
          const name = serverConfig.name || 'unknown';

          if (!serverConfig.name) {
            errors.push('Missing required field: name');
          }
          if (!serverConfig.command) {
            errors.push('Missing required field: command');
          }

          validationResults.push({
            name,
            valid: errors.length === 0,
            errors,
            warnings
          });
        }
      } else {
        return reply.status(400).send({
          error: 'Invalid manifest format',
          message: 'Manifest must contain either "mcpServers" object or "servers" array',
          valid: false
        });
      }

      const allValid = validationResults.every(r => r.valid);
      const hasWarnings = validationResults.some(r => r.warnings.length > 0);

      return reply.send({
        valid: allValid,
        format,
        serverCount: validationResults.length,
        hasWarnings,
        results: validationResults
      });
    } catch (error: any) {
      logger.error('[ADMIN-MCP] Failed to validate manifest', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to validate manifest',
        message: error.message,
        valid: false
      });
    }
  });
}
