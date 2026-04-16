/**
 * Chat MCP Service
 *
 * Lightweight service for MCP server configuration and database operations.
 * MCP tool execution is handled through MCP Proxy.
 *
 * IMPORTANT: This service fetches MCP servers DYNAMICALLY from mcp-proxy.
 * NO hardcoded server IDs or names - servers are discovered at runtime.
 */

import { MCPServer } from '../interfaces/mcp.types.js';
import { prisma } from '../../../utils/prisma.js';
import type { Logger } from 'pino';

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

export class ChatMCPService {
  private prisma = prisma;
  private cachedServers: MCPServer[] | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache

  constructor(private logger: any) {
    this.logger = logger.child({ service: 'ChatMCPService' }) as Logger;
    this.logger.info('ChatMCPService initialized with DYNAMIC MCP discovery');
  }

  /**
   * Get MCP servers configured for user - DYNAMICALLY from mcp-proxy
   * NO hardcoded server IDs or names
   */
  async getUserMCPServers(userId: string): Promise<MCPServer[]> {
    try {
      this.logger.debug({ userId }, 'Getting MCP servers for user (dynamic discovery)');

      // Check cache first
      if (this.cachedServers && Date.now() < this.cacheExpiry) {
        this.logger.debug({ serverCount: this.cachedServers.length }, 'Using cached MCP servers');
        return this.cachedServers;
      }

      // Fetch servers dynamically from mcp-proxy
      const servers = await this.fetchServersFromProxy(userId);

      // Cache the results
      this.cachedServers = servers;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      this.logger.info({
        userId,
        serverCount: servers.length,
        serverIds: servers.map(s => s.id)
      }, 'Discovered MCP servers dynamically from mcp-proxy');

      return servers;

    } catch (error) {
      this.logger.error({
        userId,
        error: error.message
      }, 'Failed to get user MCP servers');

      return [];
    }
  }

  /**
   * Fetch servers dynamically from mcp-proxy
   * NO hardcoded server IDs - discovers what's actually running
   */
  private async fetchServersFromProxy(userId: string): Promise<MCPServer[]> {
    try {
      // First try to get servers from mcp-proxy's /servers endpoint
      const response = await fetch(`${MCP_PROXY_URL}/servers`);

      if (!response.ok) {
        this.logger.warn({
          status: response.status,
          statusText: response.statusText
        }, 'Failed to fetch servers from mcp-proxy, falling back to database');
        return this.listServers();
      }

      const data = await response.json();
      const proxyServers = data.servers || [];

      // Transform proxy server format to MCPServer format
      const servers: MCPServer[] = proxyServers.map((server: any) => ({
        id: server.name || server.id,
        name: server.name || server.id,
        description: server.description || `MCP Server: ${server.name}`,
        enabled: server.status === 'running' || server.status === 'connected' || true,
        transport: server.transport || 'stdio',
        userIsolated: server.user_isolated || server.userIsolated || false,
        requireObo: server.supports_obo || server.requireObo || false,
        capabilities: {
          tools: true,
          resources: server.capabilities?.resources || false,
          prompts: server.capabilities?.prompts || false,
          logging: true
        }
      }));

      return servers;

    } catch (error: any) {
      this.logger.error({
        error: error.message,
        userId
      }, 'Error fetching servers from mcp-proxy, falling back to database');
      return this.listServers();
    }
  }

  /**
   * List all MCP servers from database
   */
  async listServers(): Promise<MCPServer[]> {
    try {
      this.logger.debug('Listing MCP servers');
      
      // Query MCP server configurations from database
      const servers = await this.prisma.mCPServerConfig.findMany({
        where: {
          enabled: true
        },
        orderBy: {
          name: 'asc'
        }
      });
      
      // Transform to MCPServer format
      const mcpServers: MCPServer[] = servers.map(server => ({
        id: server.id,
        name: server.name,
        description: server.description || '',
        enabled: server.enabled,
        transport: 'stdio', // Default transport
        userIsolated: server.user_isolated,
        requireObo: server.require_obo,
        capabilities: {
          tools: server.capabilities?.includes('tools') ?? true,
          resources: server.capabilities?.includes('resources') ?? false,
          prompts: server.capabilities?.includes('prompts') ?? false,
          logging: server.capabilities?.includes('logging') ?? true
        },
        command: server.command,
        args: server.args,
        env: (typeof server.env === 'object' && server.env !== null && !Array.isArray(server.env)) 
          ? server.env as Record<string, string> 
          : {}
      }));
      
      this.logger.info({ 
        serverCount: mcpServers.length 
      }, 'Listed MCP servers successfully');
      
      return mcpServers;
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'Failed to list MCP servers');
      
      return [];
    }
  }

  /**
   * List all MCP instances (not needed with MCP Proxy)
   */
  async listInstances(): Promise<any[]> {
    this.logger.warn('listInstances called but not needed with MCP Proxy');
    return [];
  }

  /**
   * Restart MCP server (not applicable with MCP Proxy)
   */
  async restartServer(serverId: string): Promise<void> {
    this.logger.warn({ serverId }, 'restartServer called but not applicable with MCP Proxy');
  }

  /**
   * List tools - fetches all available tools from MCP Proxy
   * NOTE: Azure MCP tools now use OBO tokens per-request, no separate per-user sessions
   */
  async listTools(authHeader?: string, userId?: string): Promise<any> {
    this.logger.info({ userId }, 'listTools called - fetching tools from MCP Proxy');

    const toolsByServer: Record<string, any[]> = {};
    const allTools: any[] = [];

    // Fetch all tools from MCP Proxy
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
      const response = await fetch(`${mcpProxyUrl}/tools`);

      if (response.ok) {
        const data = await response.json();

        // data.tools is an array of tools with server info
        if (data.tools && Array.isArray(data.tools)) {
          for (const tool of data.tools) {
            const serverName = tool.server || 'unknown';
            if (!toolsByServer[serverName]) {
              toolsByServer[serverName] = [];
            }
            toolsByServer[serverName].push(tool);
            allTools.push(tool);
          }

          this.logger.info({
            userId,
            toolCount: allTools.length,
            servers: Object.keys(toolsByServer)
          }, '✅ Loaded tools from MCP Proxy');
        }
      } else {
        this.logger.warn({ status: response.status }, 'Failed to fetch tools from MCP Proxy');
      }
    } catch (error) {
      this.logger.warn({
        error: error.message,
        userId
      }, '⚠️ Failed to fetch tools from MCP Proxy');
    }

    return {
      tools: allTools,
      toolsByServer,
      functions: allTools
    };
  }

  /**
   * Health check for MCP service
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic MCP service functionality
      const servers = await this.listServers();
      return true; // Service is available even if no servers configured
      
    } catch (error) {
      this.logger.error({ 
        error: error.message 
      }, 'MCP service health check failed');
      
      return false;
    }
  }
}