/**
 * Admin MCP Access Control Routes
 * Manage which Azure AD groups can access which MCP servers
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes.child({ component: 'AdminMCPAccess' });

const adminMCPAccessRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Get all MCP access policies
   */
  fastify.get('/policies', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const policies = await prisma.mCPAccessPolicy.findMany({
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        },
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' }
        ]
      });

      return reply.code(200).send(policies);
    } catch (error) {
      logger.error('Error fetching MCP access policies:', error);
      return reply.code(500).send({ error: 'Failed to fetch MCP access policies' });
    }
  });

  /**
   * Get default policies
   */
  fastify.get('/default-policies', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const defaultPolicies = await prisma.mCPDefaultPolicy.findMany({
        orderBy: { policy_type: 'asc' }
      });

      return reply.code(200).send(defaultPolicies);
    } catch (error) {
      logger.error('Error fetching MCP default policies:', error);
      return reply.code(500).send({ error: 'Failed to fetch MCP default policies' });
    }
  });

  /**
   * Create a new MCP access policy
   */
  fastify.post('/policies', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const {
        azure_group_id,
        azure_group_name,
        server_id,
        access_type,
        priority = 1000,
        reason,
        is_enabled = true
      } = request.body as any;

      // Validate required fields
      if (!azure_group_id || !azure_group_name || !server_id || !access_type) {
        return reply.code(400).send({
          error: 'Missing required fields: azure_group_id, azure_group_name, server_id, access_type'
        });
      }

      if (!['allow', 'deny'].includes(access_type)) {
        return reply.code(400).send({
          error: 'access_type must be either "allow" or "deny"'
        });
      }

      // Verify the server exists
      const server = await prisma.mCPServerConfig.findUnique({
        where: { id: server_id }
      });

      if (!server) {
        return reply.code(404).send({ error: 'MCP server not found' });
      }

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPAccessPolicy.create({
        data: {
          azure_group_id,
          azure_group_name,
          server_id,
          access_type,
          priority: Number(priority),
          reason,
          is_enabled,
          created_by: userId,
          updated_by: userId
        },
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        }
      });

      return reply.code(201).send(policy);
    } catch (error: any) {
      logger.error('Error creating MCP access policy:', error);

      if (error.code === 'P2002') {
        return reply.code(409).send({
          error: 'Policy already exists for this Azure group and MCP server combination'
        });
      }

      return reply.code(500).send({ error: 'Failed to create MCP access policy' });
    }
  });

  /**
   * Update an MCP access policy
   */
  fastify.put('/policies/:id', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as any;
      const {
        azure_group_name,
        access_type,
        priority,
        reason,
        is_enabled
      } = request.body as any;

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPAccessPolicy.update({
        where: { id },
        data: {
          ...(azure_group_name && { azure_group_name }),
          ...(access_type && { access_type }),
          ...(priority !== undefined && { priority: Number(priority) }),
          ...(reason !== undefined && { reason }),
          ...(is_enabled !== undefined && { is_enabled }),
          updated_by: userId
        },
        include: {
          server: {
            select: {
              id: true,
              name: true,
              description: true,
              enabled: true
            }
          }
        }
      });

      return reply.code(200).send(policy);
    } catch (error: any) {
      logger.error('Error updating MCP access policy:', error);

      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'MCP access policy not found' });
      }

      return reply.code(500).send({ error: 'Failed to update MCP access policy' });
    }
  });

  /**
   * Delete an MCP access policy
   */
  fastify.delete('/policies/:id', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as any;

      await prisma.mCPAccessPolicy.delete({
        where: { id }
      });

      return reply.code(204).send();
    } catch (error: any) {
      logger.error('Error deleting MCP access policy:', error);

      if (error.code === 'P2025') {
        return reply.code(404).send({ error: 'MCP access policy not found' });
      }

      return reply.code(500).send({ error: 'Failed to delete MCP access policy' });
    }
  });

  /**
   * Update default policy
   */
  fastify.put('/default-policies/:policy_type', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { policy_type } = request.params as any;
      const { default_access, description } = request.body as any;

      if (!['user_default', 'admin_default'].includes(policy_type)) {
        return reply.code(400).send({
          error: 'policy_type must be either "user_default" or "admin_default"'
        });
      }

      if (!['allow', 'deny'].includes(default_access)) {
        return reply.code(400).send({
          error: 'default_access must be either "allow" or "deny"'
        });
      }

      const userId = (request as any).user?.userId;

      const policy = await prisma.mCPDefaultPolicy.upsert({
        where: { policy_type },
        update: {
          default_access,
          description,
          updated_by: userId
        },
        create: {
          policy_type,
          default_access,
          description,
          created_by: userId,
          updated_by: userId
        }
      });

      return reply.code(200).send(policy);
    } catch (error) {
      logger.error('Error updating MCP default policy:', error);
      return reply.code(500).send({ error: 'Failed to update MCP default policy' });
    }
  });

  /**
   * Get MCP servers — UNION of mcp-proxy live fleet + DB-registered configs.
   *
   * 2026-05-06: this endpoint at /api/admin/mcp/servers was the registered
   * winner for the URL (admin-mcp-access plugin mounts under /api/admin/mcp,
   * so its `/servers` resolves first; the parallel handler in
   * routes/admin/mcp-management.ts has no prefix and never matched).
   *
   * Now wraps the same proxy-union logic as the now-shadowed handler:
   * proxy entries (live truth) win for status/tier/health; DB entries
   * contribute access_policies + transport metadata.
   */
  fastify.get('/servers', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Source 1: DB-registered configs with access policies.
      const dbServers = await prisma.mCPServerConfig.findMany({
        include: {
          access_policies: {
            orderBy: { priority: 'asc' }
          }
        },
        orderBy: { name: 'asc' }
      });

      // Source 2: actually-loaded servers from mcp-proxy + per-server tool counts.
      let proxyServers: any[] = [];
      const toolCountByServer = new Map<string, number>();
      try {
        const url = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
        const [serversR, toolsR] = await Promise.all([
          fetch(`${url}/servers`, { signal: AbortSignal.timeout(5000) }),
          fetch(`${url}/tools`,   { signal: AbortSignal.timeout(5000) }).catch(() => null),
        ]);
        if (serversR.ok) {
          const data: any = await serversR.json();
          if (Array.isArray(data?.servers)) proxyServers = data.servers;
          else if (Array.isArray(data)) proxyServers = data;
          else if (data && typeof data === 'object') {
            proxyServers = Object.entries(data).map(([name, cfg]: [string, any]) => ({
              name,
              ...cfg,
            }));
          }
        }
        // /tools returns { by_server: { name: [tool, …] }, total_count, … }
        if (toolsR && toolsR.ok) {
          const td: any = await toolsR.json();
          if (td?.by_server && typeof td.by_server === 'object') {
            for (const [name, tools] of Object.entries(td.by_server)) {
              toolCountByServer.set(name, Array.isArray(tools) ? tools.length : 0);
            }
          }
        }
      } catch (err) {
        logger.warn('mcp-proxy /servers + /tools fetch failed, returning DB-only list', err);
      }

      // 2026-05-06 platform tool taxonomy:
      //
      //   T1 = the platform's 8 first-class meta-tools baked into every
      //        chat turn (Task, compose_visual, render_artifact,
      //        request_clarification, browser_sandbox_exec, memorize,
      //        tool_search, agent_search). NOT MCP servers — they don't
      //        appear on this page.
      //   T2 = the MCP catalog. The openagentic_* fleet (openagentic_admin, openagentic_aws,
      //        openagentic_azure, openagentic_gcp, openagentic_kubernetes, openagentic_prometheus,
      //        openagentic_loki, openagentic_web, …) all live here. `tool_search`
      //        expands T2 mid-turn so the model only sees the relevant
      //        tools instead of the full 297-tool catalog.
      //   T3 = user-attached / user-isolated MCPs (per-user personal
      //        tools, identified by user_isolated:true).
      //
      // Default = T2; flip to T3 only when the proxy reports the
      // server as user-isolated.
      const tierFor = (ps: any): 'T2' | 'T3' => {
        return ps.user_isolated === true || ps.userIsolated === true ? 'T3' : 'T2';
      };

      // Hide deprecated/unused servers that mcp-proxy still reports as
      // "running" but aren't in production use. Configurable via env var
      // MCP_FLEET_HIDE (comma-separated). Defaults from the 2026-05-06
      // user note: agentic-memory-mcp, sequential_thinking, openagentic_github
      // are configured DISABLED=false in the helm chart but not actually
      // used by the platform. Real fix is to flip *_MCP_DISABLED=true in
      // the openagentic-mcp-proxy Deployment env (the chart's source of
      // truth); this api-side filter is the bridge.
      const hideEnv = (process.env.MCP_FLEET_HIDE ?? 'agentic-memory-mcp,sequential_thinking,openagentic_github,memory,openagentic_memory');
      const hideSet = new Set(hideEnv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

      // Union by name/alias.
      const byKey = new Map<string, any>();

      for (const ps of proxyServers) {
        const key = String(ps.name ?? ps.alias ?? ps.id ?? '').trim();
        if (!key) continue;
        if (hideSet.has(key.toLowerCase())) continue;
        const tier = tierFor(ps);
        byKey.set(key, {
          name: key,
          status: ps.status === 'running' || ps.status === 'connected' ? 'healthy'
                : ps.status === 'degraded' ? 'degraded'
                : ps.status === 'down' || ps.status === 'failed' ? 'down'
                : 'unknown',
          tier,
          category: ps.category ?? ps.namespace ?? 'mcp',
          hosted: ps.transport === 'stdio' ? 'pod'
                : ps.transport === 'remote' ? 'remote'
                : ps.hosted ?? 'unknown',
          transport: ps.transport,
          pid: ps.pid,
          enabled: ps.enabled !== false,
          toolCount: toolCountByServer.get(key) ?? ps.tool_count ?? ps.toolCount ?? (Array.isArray(ps.tools) ? ps.tools.length : 0),
          callsLastMinute: ps.calls_last_minute ?? ps.callsLastMinute,
          lastCallAt: ps.last_call_at ?? ps.lastCallAt,
          last_error: ps.last_error,
          source: 'mcp-proxy',
          synced_to_proxy: true,
        });
      }

      for (const db of dbServers) {
        const key = String(db.name ?? db.id ?? '').trim();
        if (!key) continue;
        const existing = byKey.get(key);
        if (existing) {
          existing.id = db.id;
          existing.description = db.description ?? existing.description;
          existing.access_policies = (db as any).access_policies;
          existing.user_isolated = (db as any).user_isolated;
          existing.db_registered = true;
          continue;
        }
        // Orphan rule: DB-only `command='builtin'` rows are stale seeds.
        // The platform's actual tool fleet is what mcp-proxy loads — a
        // builtin-command row that isn't in the proxy is a leftover from
        // an earlier code revision (e.g. agentic-memory-mcp) and should
        // not appear in the fleet view.
        if ((db as any).command === 'builtin') continue;

        // Other DB-only rows (admin-added but proxy didn't pick up yet)
        // are legitimate — surface as orphan/pending.
        byKey.set(key, {
          ...db,
          name: db.name ?? db.id,
          status: 'pending',
          tier: undefined,
          synced_to_proxy: false,
          source: 'db',
          db_registered: true,
        });
      }

      const merged = Array.from(byKey.values());

      // Backwards-compatible response shape: bare array (existing callers
      // do `data.map(...)`). Adds the new `source` / `tier` / `synced_to_proxy`
      // fields per row that the MCPFleet UI uses.
      return reply.code(200).send(merged);
    } catch (error) {
      logger.error('Error fetching MCP servers with policies:', error);
      return reply.code(500).send({ error: 'Failed to fetch MCP servers' });
    }
  });

  /**
   * Get access summary for a specific Azure group
   */
  fastify.get('/access-summary/:azure_group_id', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { azure_group_id } = request.params as any;

      // Get all policies for this group
      const policies = await prisma.mCPAccessPolicy.findMany({
        where: {
          azure_group_id,
          is_enabled: true
        },
        include: {
          server: true
        },
        orderBy: { priority: 'asc' }
      });

      // Get all servers
      const allServers = await prisma.mCPServerConfig.findMany({
        where: { enabled: true },
        orderBy: { name: 'asc' }
      });

      // Get default policies
      const defaultPolicies = await prisma.mCPDefaultPolicy.findMany();
      const userDefault = defaultPolicies.find(p => p.policy_type === 'user_default');

      // Calculate effective access for each server
      const accessSummary = allServers.map(server => {
        const policy = policies.find(p => p.server_id === server.id);

        return {
          server: {
            id: server.id,
            name: server.name,
            description: server.description
          },
          access: policy ? policy.access_type : (userDefault?.default_access || 'deny'),
          hasExplicitPolicy: !!policy,
          policy: policy || null
        };
      });

      return reply.code(200).send({
        azure_group_id,
        access_summary: accessSummary
      });
    } catch (error) {
      logger.error('Error fetching access summary:', error);
      return reply.code(500).send({ error: 'Failed to fetch access summary' });
    }
  });

  /**
   * Test access for a user (for debugging/admin testing)
   */
  fastify.post('/test-access', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id, server_id } = request.body as any;

      if (!user_id || !server_id) {
        return reply.code(400).send({
          error: 'Missing required fields: user_id, server_id'
        });
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: {
          id: true,
          email: true,
          name: true,
          groups: true,
          is_admin: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Import and use the access control service
      const { mcpAccessControlService } = await import('../services/MCPAccessControlService.js');

      const accessResult = await mcpAccessControlService.checkAccess(
        user.id,
        server_id,
        user.groups || [],
        user.is_admin || false,
        logger
      );

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          groups: user.groups,
          is_admin: user.is_admin
        },
        server_id,
        access_result: accessResult
      });
    } catch (error) {
      logger.error('Error testing access:', error);
      return reply.code(500).send({ error: 'Failed to test access' });
    }
  });

  /**
   * Get all accessible servers for a user (for debugging/admin testing)
   */
  fastify.post('/accessible-servers', {
    onRequest: adminMiddleware
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { user_id } = request.body as any;

      if (!user_id) {
        return reply.code(400).send({
          error: 'Missing required field: user_id'
        });
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: {
          id: true,
          email: true,
          name: true,
          groups: true,
          is_admin: true
        }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Import and use the access control service
      const { mcpAccessControlService } = await import('../services/MCPAccessControlService.js');

      const accessibleServerIds = await mcpAccessControlService.getAccessibleServers(
        user.id,
        user.groups || [],
        user.is_admin || false,
        logger
      );

      // Get full server details
      const servers = await prisma.mCPServerConfig.findMany({
        where: {
          id: { in: accessibleServerIds }
        },
        select: {
          id: true,
          name: true,
          description: true,
          enabled: true
        }
      });

      return reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          groups: user.groups,
          is_admin: user.is_admin
        },
        accessible_servers: servers,
        total_count: servers.length
      });
    } catch (error) {
      logger.error('Error fetching accessible servers:', error);
      return reply.code(500).send({ error: 'Failed to fetch accessible servers' });
    }
  });
};

export default adminMCPAccessRoutes;