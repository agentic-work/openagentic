/**
 * MCP Proxy Client
 *
 * Provides a clean interface for calling MCP tools via the MCP Proxy service.
 * Used by the legacy sub-agent orchestrator for concurrent tool execution.
 *
 * Performance optimizations:
 * - HTTP Keep-Alive for connection reuse
 * - Connection pooling with configurable limits
 * - Batch tool execution support
 */

import axios, { type AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

// Structural interface the legacy sub-agent orchestrator originally
// declared. Inlined here Phase E.8.a (2026-05-11) so MCPProxyClient.ts
// no longer imports from the orchestrator file. The class below
// declares `implements IMCPProxyClient` for explicit shape pinning.
interface IMCPProxyClient {
  callTool(server: string, tool: string, args: Record<string, any>): Promise<any>;
  getAvailableTools(server?: string): Promise<string[]>;
}

/**
 * Phase F-tel (2026-05-07): record every callTool invocation to MCPUsage so
 * the admin dashboard ring (`mcpToolUsage`) and any future analytics have a
 * source of truth that's actually populated. Fire-and-forget to keep the
 * caller path latency-equivalent.
 */
async function recordMcpUsage(
  server: string,
  tool: string,
  args: Record<string, any>,
  result: { success: boolean; error?: string; executionTimeMs: number; userId?: string },
): Promise<void> {
  try {
    await prisma.mCPUsage.create({
      data: {
        user_id: result.userId ?? 'system',
        server_name: server,
        tool_name: tool,
        method: 'tools/call',
        execution_time_ms: result.executionTimeMs,
        success: result.success,
        error_message: result.error ?? null,
        request_metadata: args ?? {},
      },
    });
  } catch {
    // best-effort — we never want telemetry to fail a tool call
  }
}

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

// HTTP Agent with keep-alive for connection reuse
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,      // Max concurrent connections per host
  maxFreeSockets: 10,  // Max idle connections to keep
  timeout: 120000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 120000
});

export interface MCPToolCallResult {
  success: boolean;
  result?: any;
  error?: string;
  executionTimeMs: number;
  serverName?: string;
}

export interface MCPServer {
  name: string;
  status: string;
  tools: string[];
  description?: string;
}

export interface MCPProxyClientOptions {
  userToken?: string;
  idToken?: string;  // ID token for OBO (audience = app's client ID)
}

export class MCPProxyClient implements IMCPProxyClient {
  private client: AxiosInstance;
  private logger: Logger;
  private cachedTools: Map<string, string[]> = new Map();
  private toolsCacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 60000; // 1 minute

  constructor(logger: Logger, options?: string | MCPProxyClientOptions) {
    this.logger = logger.child({ service: 'MCPProxyClient' });

    // Handle backwards compatibility - options can be a string (userToken) or object
    const opts: MCPProxyClientOptions = typeof options === 'string'
      ? { userToken: options }
      : options || {};

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add authentication if token provided
    if (opts.userToken) {
      headers['Authorization'] = `Bearer ${opts.userToken}`;
    } else {
      // Use internal API key for service-to-service auth
      const apiInternalKey = process.env.API_INTERNAL_KEY || '';  // MUST be set in env
      headers['Authorization'] = `Bearer ${apiInternalKey}`;
    }

    // CRITICAL: Pass ID token for OBO (On-Behalf-Of) authentication
    // OBO requires a token with audience = app's client ID, not the resource URL
    // The MCP proxy uses this to call Azure/AWS APIs on behalf of the user
    if (opts.idToken) {
      headers['X-Azure-ID-Token'] = opts.idToken;
    }

    this.client = axios.create({
      baseURL: MCP_PROXY_URL,
      timeout: 120000, // 2 minute default timeout
      headers,
      httpAgent,   // Connection pooling for HTTP
      httpsAgent   // Connection pooling for HTTPS
    });
  }

  /**
   * Call a single MCP tool
   */
  async callTool(
    server: string,
    tool: string,
    args: Record<string, any>
  ): Promise<any> {
    const startTime = Date.now();

    this.logger.info({
      server,
      tool,
      hasArgs: Object.keys(args).length > 0
    }, '[MCPProxyClient] Calling tool');

    try {
      const response = await this.client.post('/mcp/tool', {
        server,
        tool,
        arguments: args,
        id: `subagent-${Date.now()}`
      });

      const executionTimeMs = Date.now() - startTime;

      if (response.data?.error) {
        throw new Error(response.data.error.message || 'MCP tool execution failed');
      }

      // Extract result, handling nested structures
      let result = response.data?.result;
      if (result && typeof result === 'object' && result.result) {
        result = result.result;
      }

      this.logger.info({
        server,
        tool,
        executionTimeMs,
        success: true
      }, '[MCPProxyClient] Tool call completed');

      void recordMcpUsage(server, tool, args, { success: true, executionTimeMs });
      return result;

    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;

      this.logger.error({
        server,
        tool,
        executionTimeMs,
        error: error.message
      }, '[MCPProxyClient] Tool call failed');

      void recordMcpUsage(server, tool, args, { success: false, error: error.message, executionTimeMs });
      throw error;
    }
  }

  /**
   * Call multiple tools in parallel on the same server
   */
  async callToolsParallel(
    server: string,
    calls: Array<{ tool: string; args: Record<string, any> }>
  ): Promise<MCPToolCallResult[]> {
    const promises = calls.map(async (call): Promise<MCPToolCallResult> => {
      const startTime = Date.now();
      try {
        const result = await this.callTool(server, call.tool, call.args);
        return {
          success: true,
          result,
          executionTimeMs: Date.now() - startTime,
          serverName: server
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          executionTimeMs: Date.now() - startTime,
          serverName: server
        };
      }
    });

    return Promise.all(promises);
  }

  /**
   * Get available tools, optionally filtered by server
   */
  async getAvailableTools(server?: string): Promise<string[]> {
    // Check cache
    const cacheKey = server || '__all__';
    if (this.cachedTools.has(cacheKey) && Date.now() < this.toolsCacheExpiry) {
      return this.cachedTools.get(cacheKey) || [];
    }

    try {
      const response = await this.client.get('/v1/mcp/tools', {
        params: server ? { server } : undefined
      });

      const tools: string[] = [];
      const toolsData = response.data?.tools || response.data || [];

      for (const tool of toolsData) {
        if (tool.name || tool.function?.name) {
          tools.push(tool.name || tool.function.name);
        }
      }

      // Cache the result
      this.cachedTools.set(cacheKey, tools);
      this.toolsCacheExpiry = Date.now() + this.CACHE_TTL_MS;

      return tools;

    } catch (error: any) {
      this.logger.warn({
        server,
        error: error.message
      }, '[MCPProxyClient] Failed to get available tools');
      return [];
    }
  }

  /**
   * Get list of available MCP servers
   */
  async getServers(): Promise<MCPServer[]> {
    try {
      const response = await this.client.get('/servers');
      return response.data?.servers || [];
    } catch (error: any) {
      this.logger.warn({
        error: error.message
      }, '[MCPProxyClient] Failed to get servers');
      return [];
    }
  }

  /**
   * Check if a specific server is available
   */
  async isServerAvailable(serverName: string): Promise<boolean> {
    try {
      const servers = await this.getServers();
      return servers.some(s =>
        s.name === serverName &&
        (s.status === 'running' || s.status === 'connected')
      );
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create MCPProxyClient
 * @param logger - Pino logger instance
 * @param options - Token options or legacy userToken string
 */
export function createMCPProxyClient(
  logger: Logger,
  options?: string | MCPProxyClientOptions
): MCPProxyClient {
  return new MCPProxyClient(logger, options);
}
