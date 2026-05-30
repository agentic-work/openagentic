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

/**
 * Build the Authorization header value sent to the MCP proxy from this
 * service. Mirrors the shape that `buildMcpProxyHeaders` in
 * services/buildChatV2Deps.ts produces for `/mcp/tool` POSTs — the
 * MCP proxy validates either bearer (user JWT or internal-signed JWT).
 *
 * Precedence:
 *  1. Inbound `authHeader` from the request (already a `Bearer <token>` string)
 *  2. Internal HS256 JWT signed with `JWT_SECRET` / `SIGNING_SECRET`
 *     (used for system / startup calls when no inbound bearer exists)
 *  3. Service-to-service `Bearer ${API_INTERNAL_KEY}` (last-ditch)
 *
 * Returns `null` only when none of the above are available, in which case
 * the caller may choose to still attempt the request (it'll 401) or
 * short-circuit. The contract: the function NEVER omits an Authorization
 * header when ANY credential source is configured.
 */
function buildMcpProxyAuthHeader(
  authHeader: string | undefined,
  userId: string | undefined,
): string | null {
  if (authHeader && authHeader.length > 0) return authHeader;
  const jwtSecret = process.env.JWT_SECRET || process.env.SIGNING_SECRET;
  if (jwtSecret && userId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const jwt = require('jsonwebtoken');
      const internalToken = jwt.sign(
        { userId, source: 'chatmcpservice-internal' },
        jwtSecret,
        { expiresIn: '5m' },
      );
      return `Bearer ${internalToken}`;
    } catch {
      /* fall through */
    }
  }
  const apiInternalKey = process.env.API_INTERNAL_KEY;
  if (apiInternalKey) return `Bearer ${apiInternalKey}`;
  return null;
}

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
   *
   * SEV-0 (2026-05-12): the MCP proxy `/tools` endpoint requires auth. The
   * Authorization header builder mirrors `buildMcpProxyHeaders` in
   * services/buildChatV2Deps.ts — the same proxy validates both routes.
   * Without this, every listTools call returns 401 and the T2 catalog is
   * empty → tool_search has no substrate → "tools don't work".
   * Regression pinned by ChatMCPService.listToolsAuth.test.ts.
   */
  async listTools(authHeader?: string, userId?: string): Promise<any> {
    this.logger.info({ userId }, 'listTools called - fetching tools from MCP Proxy');

    const toolsByServer: Record<string, any[]> = {};
    const allTools: any[] = [];

    // Fetch all tools from MCP Proxy
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
      const headers: Record<string, string> = {
        'content-type': 'application/json',
      };
      const proxyAuth = buildMcpProxyAuthHeader(authHeader, userId);
      if (!proxyAuth) {
        // Defensive short-circuit — no inbound bearer, no JWT_SECRET, and
        // no API_INTERNAL_KEY means the MCP proxy will 401 every request.
        // Logging once + returning empty tools beats an in-flight 401 that
        // shows up as a confusing "tools loaded: 0" downstream.
        this.logger.warn(
          { userId },
          'listTools: no MCP-proxy credential available (authHeader/JWT_SECRET/API_INTERNAL_KEY all unset) — skipping fetch',
        );
        return { tools: allTools, toolsByServer, functions: allTools };
      }
      headers['Authorization'] = proxyAuth;
      const response = await fetch(`${mcpProxyUrl}/tools`, { headers });

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