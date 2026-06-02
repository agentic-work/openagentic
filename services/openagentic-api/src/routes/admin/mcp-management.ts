/**
 * MCP Management API
 * 
 * Unified endpoint for registering and managing MCP servers.
 * Handles both internal database and MCP Proxy synchronization.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { MCPSyncService } from '../../services/MCPSyncService.js';
import { MCPToolIndexingService } from '../../services/MCPToolIndexingService.js';
import { logger } from '../../utils/logger.js';
import { adminMiddleware } from '../../middleware/unifiedAuth.js';
import { credentialAuditService } from '../../services/CredentialAuditService.js';
import { normalizeMcpServerId, getDisabledBuiltinFleetRows } from '../../services/mcpBuiltinCatalog.js';

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

/**
 * Fire-and-forget reindex: creates a minimal indexing service instance and
 * calls indexAllMCPTools(forceReindex=true). Errors are non-fatal — we log
 * a warning and let the response succeed. The indexing service needs milvus +
 * redis + prisma; in tests these are mocked. In production they come from the
 * AppContext singleton attached by server.ts, but the route module doesn't
 * have that reference yet, so we instantiate a lightweight service without
 * redis/milvus (no-op for those paths) so the DB pgvector path still runs.
 */
async function fireAndForgetReindex(): Promise<void> {
  try {
    const indexingService = new MCPToolIndexingService(logger, null, null, prisma as any);
    await indexingService.indexAllMCPTools(true);
  } catch (err) {
    logger.warn(
      { error: (err as Error)?.message },
      '[mcp-management] post-add reindex failed (non-fatal)',
    );
  }
}

export default async function mcpManagementRoutes(fastify: FastifyInstance) {
  const mcpSync = new MCPSyncService(logger);

  // Start sync service on startup
  await mcpSync.startSync();
  
  // List all registered MCP servers
  fastify.get('/api/admin/mcp/servers', {
    onRequest: adminMiddleware,
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
      // Source 1: DB-registered server configs (manually added by admins).
      const dbServers = await prisma.mCPServerConfig.findMany({
        include: {
          status: true,
          _count: { select: { instances: true } },
        },
      });

      // Source 2: actually-loaded servers from mcp-proxy (the live truth —
      // includes internal pod-hosted servers AND user-connected remotes).
      // Same endpoint ChatMCPService uses (chat UI's "11 internal · 318
      // connected" comes from this list).
      const proxyServers = await mcpSync.getMCPProxyServers();

      // Union: keyed by the canonical bare built-in id. proxy entry wins for
      // status/health (it knows what's actually running); db entry contributes
      // config details (transport, isolation flags, etc).
      //
      // The proxy reports built-ins under `openagentic_<id>` (e.g.
      // `openagentic_admin`) while the DB/wizard/UI use the bare id (`admin`).
      // We normalize both sides to the bare id so each built-in reconciles to
      // ONE fleet row instead of two.
      const byKey = new Map<string, any>();

      for (const ps of proxyServers) {
        const rawName = String(ps.name ?? ps.alias ?? ps.id ?? '').trim();
        if (!rawName) continue;
        const key = normalizeMcpServerId(rawName) || rawName.toLowerCase();
        byKey.set(key, {
          // Surface the canonical bare id as the display name so the UI shows a
          // single reconciled row (e.g. `admin`, not `openagentic_admin`).
          name: key,
          proxy_name: rawName,
          status: ps.status === 'running' || ps.status === 'connected' ? 'healthy'
                : ps.status === 'degraded' ? 'degraded'
                : ps.status === 'down' || ps.status === 'failed' ? 'down'
                : 'unknown',
          tier: ps.tier,
          category: ps.category ?? ps.namespace ?? 'mcp',
          hosted: ps.hosted ?? (ps.user_isolated || ps.userIsolated ? 'remote' : 'pod'),
          toolCount: ps.tool_count ?? ps.toolCount ?? (Array.isArray(ps.tools) ? ps.tools.length : 0),
          callsLastMinute: ps.calls_last_minute ?? ps.callsLastMinute,
          lastCallAt: ps.last_call_at ?? ps.lastCallAt,
          source: 'mcp-proxy',
          synced_to_proxy: true,
        });
      }

      for (const db of dbServers) {
        const rawKey = String(db.id ?? db.name ?? '').trim();
        if (!rawKey) continue;
        const key = normalizeMcpServerId(rawKey) || rawKey.toLowerCase();
        const existing = byKey.get(key);
        if (existing) {
          // proxy already has it — just mark that it's also DB-registered.
          existing.id = db.id;
          existing.transport = (db as any).transport ?? existing.transport;
          existing.user_isolated = (db as any).user_isolated;
          existing.instance_count = (db as any)._count?.instances;
          existing.db_registered = true;
        } else {
          byKey.set(key, {
            ...db,
            name: db.name ?? db.id,
            status: 'unknown',
            synced_to_proxy: false,
            instance_count: (db as any)._count?.instances ?? 0,
            source: 'db',
            db_registered: true,
          });
        }
      }

      // Surface env-DISABLED built-ins. The proxy only registers built-ins whose
      // `*_MCP_DISABLED` flag is unset, so disabled ones (commonly
      // aws/azure/gcp/loki/alertmanager/github on a creds-less deploy) are absent
      // from the proxy list and would silently vanish from the Fleet. Render them
      // from the known built-in catalog as `available` / `needs-config` (a
      // distinct state from the running ones) so the operator sees the full fleet
      // and what's left to enable. Running built-ins keep their real status.
      const runningIds = new Set<string>(byKey.keys());
      for (const row of getDisabledBuiltinFleetRows(runningIds)) {
        byKey.set(row.id, { ...row, name: row.id });
      }

      const servers = Array.from(byKey.values());

      return reply.send({
        servers,
        total: servers.length,
        synced_count: servers.filter(s => s.synced_to_proxy).length,
        proxy_count: proxyServers.length,
        db_count: dbServers.length,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to list MCP servers');
      return reply.code(500).send({ error: 'Failed to list MCP servers' });
    }
  });

  // List all available MCP tools from all servers (returns all tools from MCP proxy)
  fastify.get('/api/admin/mcp/tools-list', { onRequest: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Fetch tools directly from MCP Proxy
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';

      logger.info({ mcpProxyUrl }, 'Fetching tools from MCP Proxy');

      // Forward the user's bearer to mcp-proxy. Without this, mcp-proxy
      // refuses with 401 "missing Authorization header" → UI propagates the
      // 401 → global response interceptor signs the user out. Regression
      // pinned by mcp-tools-list-auth-forward.test.ts (LIVE 2026-05-11).
      const user = (request as any).user;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (user?.accessToken) {
        headers['Authorization'] = `Bearer ${user.accessToken}`;
      }

      const response = await fetch(`${mcpProxyUrl}/tools`, {
        method: 'GET',
        headers,
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
    onRequest: adminMiddleware,
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
  fastify.post('/api/admin/mcp/servers', { onRequest: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
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
        // Fire-and-forget reindex so the new server's tools become
        // discoverable immediately. Non-blocking — never fail the response.
        fireAndForgetReindex().catch((err) =>
          logger.warn({ error: (err as Error)?.message }, '[mcp-management] reindex promise rejected'),
        );
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
  fastify.patch('/api/admin/mcp/servers/:serverId', { onRequest: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
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
  fastify.delete('/api/admin/mcp/servers/:serverId', { onRequest: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
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
  fastify.post('/api/admin/mcp/sync', { onRequest: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
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
  fastify.post('/api/admin/mcp/servers/:serverId/test', { onRequest: adminMiddleware }, async (request: FastifyRequest<{ Params: { serverId: string } }>, reply: FastifyReply) => {
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

  /**
   * POST /api/admin/mcp/servers/manifest
   * Import MCP servers from a pasted JSON manifest.
   *
   * Accepts two formats:
   *   Claude Desktop: { "mcpServers": { "<name>": { command, args?, env?, transport?, server_url?, headers? } } }
   *   Array:          { "servers": [ { id?, name, transport, command?, args?, env?, server_url?, headers?, ... } ] }
   *
   * Each valid server entry is persisted to prisma.mCPServerConfig and
   * registered with the MCP Proxy (best-effort, try/catch per-server).
   * After a successful batch, a non-blocking reindex is fired so new
   * servers' tools become discoverable immediately.
   *
   * Response (HTTP 200 if ≥1 imported, 400 if none parseable):
   *   { success: true, imported: <n>, results: [{ id, name, status: 'registered'|'error', error?: string }] }
   */
  fastify.post('/api/admin/mcp/servers/manifest', { onRequest: adminMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifest = request.body as any;

      logger.info('[mcp-management] Processing MCP manifest upload');

      /** Normalised intermediate representation before DB write */
      interface ManifestEntry {
        id: string;
        name: string;
        transport: 'stdio' | 'http' | 'sse';
        command: string;
        args: string[];
        env: Record<string, string>;
        server_url?: string;
        headers?: Record<string, string>;
      }

      const entries: ManifestEntry[] = [];
      const earlyErrors: Array<{ name: string; status: 'error'; error: string }> = [];

      /** Derive a DB-safe id from a server name */
      function slugify(name: string): string {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        return safe || `mcp_${randomUUID().replace(/-/g, '').substring(0, 8)}`;
      }

      // ── Format 1: Claude Desktop { mcpServers: { name: config } } ──────────
      if (manifest.mcpServers && typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers)) {
        logger.info('[mcp-management] Detected Claude Desktop manifest format');

        for (const [serverName, raw] of Object.entries(manifest.mcpServers)) {
          const cfg = raw as any;
          // transport: honour explicit field, else infer from presence of command
          const transport: 'stdio' | 'http' | 'sse' =
            cfg.transport === 'http' ? 'http'
            : cfg.transport === 'sse' ? 'sse'
            : 'stdio';

          if (transport === 'stdio') {
            if (!cfg.command) {
              earlyErrors.push({ name: serverName, status: 'error', error: 'Missing required field: command' });
              continue;
            }
            entries.push({
              id: slugify(serverName),
              name: serverName,
              transport,
              command: typeof cfg.command === 'string' ? cfg.command : String(cfg.command),
              args: Array.isArray(cfg.args) ? cfg.args : [],
              env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
            });
          } else {
            if (!cfg.server_url) {
              earlyErrors.push({ name: serverName, status: 'error', error: 'Missing required field: server_url for http/sse transport' });
              continue;
            }
            entries.push({
              id: slugify(serverName),
              name: serverName,
              transport,
              command: '',
              args: [],
              env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
              server_url: cfg.server_url,
              headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : undefined,
            });
          }
        }
      }
      // ── Format 2: Array { servers: [...] } ──────────────────────────────────
      else if (Array.isArray(manifest.servers)) {
        logger.info('[mcp-management] Detected array manifest format');

        for (const cfg of manifest.servers) {
          const serverName: string = cfg.name || cfg.id || 'unknown';
          const transport: 'stdio' | 'http' | 'sse' =
            cfg.transport === 'http' ? 'http'
            : cfg.transport === 'sse' ? 'sse'
            : 'stdio';

          if (!cfg.name) {
            earlyErrors.push({ name: serverName, status: 'error', error: 'Missing required field: name' });
            continue;
          }
          if (transport === 'stdio' && !cfg.command) {
            earlyErrors.push({ name: serverName, status: 'error', error: 'Missing required field: command for stdio transport' });
            continue;
          }
          if (transport !== 'stdio' && !cfg.server_url) {
            earlyErrors.push({ name: serverName, status: 'error', error: 'Missing required field: server_url for http/sse transport' });
            continue;
          }

          entries.push({
            id: cfg.id ? slugify(cfg.id) : slugify(cfg.name),
            name: cfg.name,
            transport,
            command: cfg.command || '',
            args: Array.isArray(cfg.args) ? cfg.args : [],
            env: cfg.env && typeof cfg.env === 'object' ? cfg.env : {},
            server_url: cfg.server_url,
            headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : undefined,
          });
        }
      } else {
        return reply.code(400).send({
          success: false,
          error: 'Invalid manifest format',
          message: 'Manifest must contain either "mcpServers" object (Claude Desktop format) or "servers" array',
        });
      }

      if (entries.length === 0 && earlyErrors.length === 0) {
        return reply.code(400).send({
          success: false,
          error: 'No servers found',
          message: 'Manifest contained no valid server configurations',
        });
      }

      logger.info('[mcp-management] Importing servers from manifest', {
        toImport: entries.length,
        earlyErrors: earlyErrors.length,
        names: entries.map(e => e.name),
      });

      // ── Persist + register each entry ────────────────────────────────────
      const results: Array<{ id: string; name: string; status: 'registered' | 'error'; error?: string }> = [
        // include any early-parse errors verbatim
        ...earlyErrors.map(e => ({ id: e.name, name: e.name, status: e.status as 'error', error: e.error })),
      ];

      for (const entry of entries) {
        try {
          // Ensure unique id: if a conflict exists, append a short suffix
          let serverId = entry.id;
          const existing = await prisma.mCPServerConfig.findUnique({ where: { id: serverId } });
          if (existing) {
            serverId = `${serverId}_${randomUUID().replace(/-/g, '').substring(0, 6)}`;
          }

          const server = await prisma.mCPServerConfig.create({
            data: {
              id: serverId,
              name: entry.name,
              command: entry.command,
              args: entry.args,
              env: entry.env,
              capabilities: [],
              require_obo: false,
              user_isolated: false,
              enabled: true,
              metadata: {
                transport: entry.transport,
                ...(entry.server_url ? { server_url: entry.server_url } : {}),
                ...(entry.headers ? { headers: entry.headers } : {}),
                imported_from_manifest: true,
              },
            },
          });

          await prisma.mCPServerStatus.create({
            data: { server_id: server.id, status: 'registered' },
          });

          // Best-effort proxy registration — failure is reported but never
          // rolls back the DB write (same pattern as single-server add).
          try {
            await mcpSync.registerMCPServerWithProxy(server);
          } catch (proxyErr: any) {
            logger.warn(
              { serverId: server.id, error: proxyErr?.message },
              '[mcp-management] manifest: proxy registration failed for server (DB row persisted)',
            );
          }

          results.push({ id: server.id, name: server.name, status: 'registered' });
        } catch (err: any) {
          logger.error({ name: entry.name, error: err?.message }, '[mcp-management] manifest: failed to persist server');
          results.push({ id: entry.id, name: entry.name, status: 'error', error: err?.message || 'Unknown error' });
        }
      }

      const imported = results.filter(r => r.status === 'registered').length;

      logger.info('[mcp-management] Manifest import complete', {
        imported,
        total: results.length,
      });

      if (imported === 0) {
        return reply.code(400).send({
          success: false,
          imported: 0,
          results,
        });
      }

      // Fire-and-forget reindex so newly imported servers' tools are
      // discoverable immediately. Non-blocking — never fail the import response.
      fireAndForgetReindex().catch((err) =>
        logger.warn({ error: (err as Error)?.message }, '[mcp-management] manifest reindex promise rejected'),
      );

      return reply.send({
        success: true,
        imported,
        results,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, '[mcp-management] Failed to process manifest');
      return reply.code(500).send({
        success: false,
        error: 'Failed to process manifest',
        message: error.message,
      });
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