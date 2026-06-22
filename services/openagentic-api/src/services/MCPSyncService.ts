/**
 * MCP Sync Service
 *
 * Synchronizes MCP server configurations between the database and MCP Proxy.
 * This is a stub implementation that handles basic synchronization operations.
 */

import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

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
   * Syncs all MCP servers from database to MCP Proxy.
   *
   * Algorithm:
   *  1. Read all enabled=true rows from prisma.mCPServerConfig.
   *  2. Fetch the proxy's current /servers list (short timeout, fail-open).
   *     If the proxy is unreachable we cannot tell what it is already running,
   *     so we log + return rather than blindly re-registering everything (that
   *     could spawn duplicate subprocesses inside mcp-proxy).
   *  3. Diff by name: for each DB server NOT present on the proxy, call
   *     registerMCPServerWithProxy (best-effort, per-server try/catch).
   */
  async syncMCPServers(): Promise<void> {
    this.logger.debug('Syncing MCP servers');

    // Step 1: fetch enabled DB servers
    const dbServers = await prisma.mCPServerConfig.findMany({
      where: { enabled: true },
    });

    if (dbServers.length === 0) {
      this.logger.info('syncMCPServers: no enabled DB servers, nothing to sync');
      return;
    }

    // Step 2: fetch what the proxy already has running.
    // Fail-open: if we can't reach the proxy, don't blindly re-register —
    // we don't know what is already running and could cause duplicates.
    let proxyServers: any[];
    try {
      proxyServers = await this.getMCPProxyServers();
    } catch (err) {
      this.logger.warn(
        { error: (err as Error)?.message },
        'syncMCPServers: proxy unreachable — skipping sync to avoid duplicate spawns',
      );
      return;
    }

    // Build a set of names already present on the proxy for O(1) lookup.
    const proxyNames = new Set(
      proxyServers.map((s: any) => String(s.name ?? s.alias ?? s.id ?? '').trim()).filter(Boolean),
    );

    // Step 3: register missing servers (best-effort per server).
    let registered = 0;
    let failed = 0;
    for (const server of dbServers) {
      const key = String(server.id ?? server.name ?? '').trim();
      if (proxyNames.has(key)) continue;

      try {
        await this.registerMCPServerWithProxy(server);
        registered++;
      } catch (err) {
        failed++;
        this.logger.warn(
          { error: (err as Error)?.message, serverId: server.id },
          'syncMCPServers: failed to register server with proxy (non-fatal)',
        );
      }
    }

    this.logger.info(
      { total: dbServers.length, proxyKnown: proxyNames.size, registered, failed },
      'MCP servers sync completed',
    );
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
   * Registers a single MCP server with MCP Proxy by POSTing to its
   * /servers endpoint. Accepts the flat format the proxy expects:
   *   { name, command, args, env, transport }
   * The proxy spawns the subprocess and reports it under GET /servers.
   */
  async registerMCPServerWithProxy(server: any): Promise<void> {
    const url = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
    const meta = server.metadata || {};
    const transport = meta.transport || (server.command ? 'stdio' : 'http');
    const payload: any = {
      name: server.id || server.name,
      transport,
    };
    if (transport === 'stdio') {
      payload.command = server.command;
      payload.args = server.args || [];
      if (server.env && Object.keys(server.env).length) payload.env = server.env;
    } else {
      payload.url = meta.server_url;
      if (meta.headers && Object.keys(meta.headers).length) payload.headers = meta.headers;
    }
    try {
      this.logger.info({ serverId: server.id, serverName: server.name, transport }, 'Registering MCP server with MCP Proxy');
      const r = await fetch(`${url}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        const body = await r.text();
        this.logger.error({ status: r.status, body, serverId: server.id }, 'mcp-proxy POST /servers failed');
        throw new Error(`mcp-proxy returned ${r.status}: ${body}`);
      }
      this.logger.info({ serverId: server.id }, 'MCP server registered with mcp-proxy');
    } catch (error) {
      this.logger.error({ error: (error as Error)?.message, serverId: server.id }, 'Failed to register MCP server with MCP Proxy');
      throw error;
    }
  }

  /**
   * Unregisters an MCP server from MCP Proxy by stopping it.
   */
  async unregisterMCPServer(serverId: string): Promise<void> {
    const url = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
    try {
      this.logger.info({ serverId }, 'Stopping MCP server in MCP Proxy');
      const r = await fetch(`${url}/servers/${encodeURIComponent(serverId)}/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok && r.status !== 404) {
        const body = await r.text();
        this.logger.warn({ status: r.status, body, serverId }, 'mcp-proxy stop returned non-OK');
      }
    } catch (error) {
      this.logger.error({ error: (error as Error)?.message, serverId }, 'Failed to stop MCP server in MCP Proxy');
      // Don't throw — unregister is best-effort.
    }
  }
}
