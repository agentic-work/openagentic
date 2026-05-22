/**
 * MCP Sync Service
 *
 * Synchronizes MCP server configurations between the database and MCP Proxy.
 * This is a stub implementation that handles basic synchronization operations.
 */

import type { Logger } from 'pino';

export class MCPSyncService {
  private logger: Logger;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Starts the sync service
   */
  async startSync(): Promise<void> {
    this.logger.info('MCP Sync Service started');
    // Perform initial sync
    await this.syncMCPServers();

    // Set up periodic sync (every 5 minutes)
    this.syncInterval = setInterval(() => {
      this.syncMCPServers().catch(err => {
        this.logger.error({ error: err }, 'Periodic MCP sync failed');
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Stops the sync service
   */
  stopSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.logger.info('MCP Sync Service stopped');
  }

  /**
   * Syncs all MCP servers from database to MCP Proxy
   */
  async syncMCPServers(): Promise<void> {
    try {
      this.logger.debug('Syncing MCP servers');
      // Stub implementation - actual sync logic would go here
      this.logger.info('MCP servers sync completed');
    } catch (error) {
      this.logger.error({ error }, 'Failed to sync MCP servers');
      throw error;
    }
  }

  /**
   * Gets the list of MCP servers actually loaded by mcp-proxy.
   * Fetches GET ${MCP_PROXY_URL}/servers — same endpoint ChatMCPService
   * uses (see routes/chat/services/ChatMCPService.ts:74).
   *
   * Returns whatever mcp-proxy reports — internal pod-hosted servers
   * (kubernetes-mcp, github-mcp, etc) plus any user-connected remotes.
   * Empty array on failure (caller falls back to DB list).
   */
  async getMCPProxyServers(): Promise<any[]> {
    try {
      const url = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
      const r = await fetch(`${url}/servers`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        this.logger.warn({ status: r.status, url }, 'mcp-proxy /servers returned non-OK');
        return [];
      }
      const data: any = await r.json();
      // mcp-proxy actually returns an OBJECT keyed by server name, not an
      // array — e.g. { openagentic_admin: {status, transport, pid, …}, openagentic_kubernetes: {…} }.
      // Normalize all three shapes (object / wrapped array / bare array).
      let servers: any[] = []
      if (Array.isArray(data?.servers)) servers = data.servers
      else if (Array.isArray(data)) servers = data
      else if (data && typeof data === 'object') {
        servers = Object.entries(data).map(([name, cfg]: [string, any]) => ({
          name,
          ...cfg,
        }))
      }
      return servers;
    } catch (error) {
      this.logger.error({ error: (error as Error)?.message }, 'Failed to get MCP Proxy servers');
      return [];
    }
  }

  /**
   * Registers a single MCP server with MCP Proxy
   */
  async registerMCPServerWithProxy(server: any): Promise<void> {
    try {
      this.logger.info({ serverId: server.id, serverName: server.name }, 'Registering MCP server with MCP Proxy');
      // Stub implementation - would register with MCP Proxy
    } catch (error) {
      this.logger.error({ error, serverId: server.id }, 'Failed to register MCP server with MCP Proxy');
      throw error;
    }
  }

  /**
   * Unregisters an MCP server from MCP Proxy
   */
  async unregisterMCPServer(serverId: string): Promise<void> {
    try {
      this.logger.info({ serverId }, 'Unregistering MCP server from MCP Proxy');
      // Stub implementation - would unregister from MCP Proxy
    } catch (error) {
      this.logger.error({ error, serverId }, 'Failed to unregister MCP server from MCP Proxy');
      throw error;
    }
  }
}
