import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
import { prisma } from '../../utils/prisma.js';

// ---------------------------------------------------------------------------
// Helpers — read/write SystemConfiguration with 'codemode.' prefix
// ---------------------------------------------------------------------------

async function getCodemodeConfig(key: string): Promise<any> {
  const row = await prisma.systemConfiguration.findUnique({ where: { key: `codemode.${key}` } });
  if (!row) return null;
  try { return JSON.parse(row.value as string); } catch { return row.value; }
}

async function setCodemodeConfig(key: string, value: any): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await prisma.systemConfiguration.upsert({
    where: { key: `codemode.${key}` },
    update: { value: serialized, updated_at: new Date() },
    create: { key: `codemode.${key}`, value: serialized },
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const codemodeAdminRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log as Logger;

  // =========================================================================
  // Skills
  // =========================================================================

  /**
   * GET /api/admin/codemode/skills
   * List all skills from DB
   */
  fastify.get('/admin/codemode/skills', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const skills = await getCodemodeConfig('skills') ?? [];
      return reply.send({ success: true, skills });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list codemode skills');
      return reply.code(500).send({ success: false, error: 'Failed to fetch skills', message: error.message });
    }
  });

  /**
   * PUT /api/admin/codemode/skills/:id
   * Toggle enabled, update description/tags for a skill
   */
  fastify.put<{ Params: { id: string }; Body: { enabled?: boolean; description?: string; tags?: string[] } }>(
    '/admin/codemode/skills/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { enabled?: boolean; description?: string; tags?: string[] } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const updates = request.body;
        const skills: any[] = await getCodemodeConfig('skills') ?? [];

        const idx = skills.findIndex((s: any) => s.id === id);
        if (idx === -1) {
          return reply.code(404).send({ success: false, error: 'Skill not found', message: `No skill with id "${id}"` });
        }

        if (updates.enabled !== undefined) skills[idx].enabled = updates.enabled;
        if (updates.description !== undefined) skills[idx].description = updates.description;
        if (updates.tags !== undefined) skills[idx].tags = updates.tags;

        await setCodemodeConfig('skills', skills);
        logger.info({ skillId: id, updates }, 'Codemode skill updated');

        return reply.send({ success: true, skill: skills[idx] });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update codemode skill');
        return reply.code(400).send({ success: false, error: 'Failed to update skill', message: error.message });
      }
    },
  );

  // =========================================================================
  // Plugins
  // =========================================================================

  /**
   * GET /api/admin/codemode/plugins
   * List plugins + registries from DB
   */
  fastify.get('/admin/codemode/plugins', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [plugins, registries] = await Promise.all([
        getCodemodeConfig('plugins') ?? [],
        getCodemodeConfig('registries') ?? [],
      ]);
      return reply.send({ success: true, plugins: plugins ?? [], registries: registries ?? [] });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list codemode plugins');
      return reply.code(500).send({ success: false, error: 'Failed to fetch plugins', message: error.message });
    }
  });

  /**
   * PUT /api/admin/codemode/plugins/:id
   * Toggle enabled for a plugin
   */
  fastify.put<{ Params: { id: string }; Body: { enabled?: boolean } }>(
    '/admin/codemode/plugins/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: { enabled?: boolean } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const { enabled } = request.body;
        const plugins: any[] = await getCodemodeConfig('plugins') ?? [];

        const idx = plugins.findIndex((p: any) => p.id === id);
        if (idx === -1) {
          return reply.code(404).send({ success: false, error: 'Plugin not found', message: `No plugin with id "${id}"` });
        }

        if (enabled !== undefined) plugins[idx].enabled = enabled;

        await setCodemodeConfig('plugins', plugins);
        logger.info({ pluginId: id, enabled }, 'Codemode plugin updated');

        return reply.send({ success: true, plugin: plugins[idx] });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update codemode plugin');
        return reply.code(400).send({ success: false, error: 'Failed to update plugin', message: error.message });
      }
    },
  );

  // =========================================================================
  // MCP Servers
  // =========================================================================

  /**
   * GET /api/admin/codemode/mcp-servers
   * List MCP servers + policy from DB
   */
  fastify.get('/admin/codemode/mcp-servers', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [mcpServers, policy] = await Promise.all([
        getCodemodeConfig('mcp-servers') ?? [],
        getCodemodeConfig('mcp-policy') ?? { allowManagedOnly: true },
      ]);
      return reply.send({ success: true, mcpServers: mcpServers ?? [], policy: policy ?? { allowManagedOnly: true } });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list codemode MCP servers');
      return reply.code(500).send({ success: false, error: 'Failed to fetch MCP servers', message: error.message });
    }
  });

  /**
   * PUT /api/admin/codemode/mcp-servers/:id
   * Toggle/update MCP server
   */
  fastify.put<{ Params: { id: string }; Body: Record<string, any> }>(
    '/admin/codemode/mcp-servers/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const updates = request.body;
        const mcpServers: any[] = await getCodemodeConfig('mcp-servers') ?? [];

        const idx = mcpServers.findIndex((s: any) => s.id === id);
        if (idx === -1) {
          return reply.code(404).send({ success: false, error: 'MCP server not found', message: `No MCP server with id "${id}"` });
        }

        // Merge allowed fields
        const allowedFields = ['enabled', 'name', 'description', 'type', 'command', 'args', 'url', 'headers', 'env'];
        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            mcpServers[idx][field] = updates[field];
          }
        }

        await setCodemodeConfig('mcp-servers', mcpServers);
        logger.info({ mcpServerId: id }, 'Codemode MCP server updated');

        return reply.send({ success: true, mcpServer: mcpServers[idx] });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to update codemode MCP server');
        return reply.code(400).send({ success: false, error: 'Failed to update MCP server', message: error.message });
      }
    },
  );

  /**
   * POST /api/admin/codemode/mcp-servers
   * Add new MCP server
   */
  fastify.post<{ Body: Record<string, any> }>(
    '/admin/codemode/mcp-servers',
    async (request: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      try {
        const body = request.body;
        if (!body.name || !body.type) {
          return reply.code(400).send({ success: false, error: 'Missing required fields', message: 'name and type are required' });
        }

        const mcpServers: any[] = await getCodemodeConfig('mcp-servers') ?? [];

        const newServer = {
          id: `mcp-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: body.name,
          description: body.description || '',
          type: body.type,
          command: body.command,
          args: body.args,
          url: body.url,
          headers: body.headers,
          env: body.env,
          pluginSource: body.pluginSource || 'custom',
          enabled: body.enabled ?? true,
        };

        // Check for duplicate id
        if (mcpServers.some((s: any) => s.id === newServer.id)) {
          return reply.code(409).send({ success: false, error: 'Duplicate', message: `MCP server with id "${newServer.id}" already exists` });
        }

        mcpServers.push(newServer);
        await setCodemodeConfig('mcp-servers', mcpServers);
        logger.info({ mcpServer: newServer }, 'Codemode MCP server added');

        return reply.code(201).send({ success: true, mcpServer: newServer });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to add codemode MCP server');
        return reply.code(400).send({ success: false, error: 'Failed to add MCP server', message: error.message });
      }
    },
  );

  /**
   * DELETE /api/admin/codemode/mcp-servers/:id
   * Remove MCP server
   */
  fastify.delete<{ Params: { id: string } }>(
    '/admin/codemode/mcp-servers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const mcpServers: any[] = await getCodemodeConfig('mcp-servers') ?? [];

        const idx = mcpServers.findIndex((s: any) => s.id === id);
        if (idx === -1) {
          return reply.code(404).send({ success: false, error: 'MCP server not found', message: `No MCP server with id "${id}"` });
        }

        const removed = mcpServers.splice(idx, 1)[0];
        await setCodemodeConfig('mcp-servers', mcpServers);
        logger.info({ mcpServerId: id }, 'Codemode MCP server removed');

        return reply.send({ success: true, removed });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to remove codemode MCP server');
        return reply.code(400).send({ success: false, error: 'Failed to remove MCP server', message: error.message });
      }
    },
  );

  // =========================================================================
  // Sync
  // =========================================================================

  /**
   * POST /api/admin/codemode/sync
   * Trigger GitHub sync of plugin metadata
   */
  fastify.post('/admin/codemode/sync', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { syncFromGitHub } = await import('../../services/CodeModeSyncService.js');
      const result = await syncFromGitHub();

      // Store sync status
      await setCodemodeConfig('sync-status', {
        lastSync: new Date().toISOString(),
        ...result,
      });

      return reply.send({ success: true, ...result });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to trigger codemode sync');
      return reply.code(500).send({ success: false, error: 'Sync failed', message: error.message });
    }
  });

  /**
   * GET /api/admin/codemode/sync/status
   * Get last sync status
   */
  fastify.get('/admin/codemode/sync/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const status = await getCodemodeConfig('sync-status');
      return reply.send({ success: true, status: status ?? { lastSync: null, ok: false } });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get sync status');
      return reply.code(500).send({ success: false, error: 'Failed to get sync status', message: error.message });
    }
  });

  // =========================================================================
  // Settings (global toggles)
  // =========================================================================

  /**
   * GET /api/admin/codemode/settings
   * Get all CodeMode settings.
   */
  fastify.get('/admin/codemode/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send({
        success: true,
        settings: {},
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * PUT /api/admin/codemode/settings
   * Update CodeMode settings.
   */
  fastify.put('/admin/codemode/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      return reply.send({
        success: true,
        settings: {},
      });
    } catch (error: any) {
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // Config Bundle (for exec daemon injection)
  // =========================================================================

  /**
   * GET /api/admin/codemode/config-bundle
   * Return full managed config payload for exec daemon to write into user sessions.
   *
   * Response:
   * - managedSettings  → written as managed-settings.json
   * - managedMcp       → written as managed-mcp.json
   * - enabledSkills    → list of enabled skill definitions
   * - enabledPlugins   → list of enabled plugin names
   */
  fastify.get('/admin/codemode/config-bundle', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [skills, plugins, mcpServers, mcpPolicy] = await Promise.all([
        getCodemodeConfig('skills').then((v: any) => v ?? []),
        getCodemodeConfig('plugins').then((v: any) => v ?? []),
        getCodemodeConfig('mcp-servers').then((v: any) => v ?? []),
        getCodemodeConfig('mcp-policy').then((v: any) => v ?? { allowManagedOnly: true }),
      ]);

      const enabledSkills = skills.filter((s: any) => s.enabled);
      const enabledPlugins = plugins.filter((p: any) => p.enabled);
      const enabledMcpServers = mcpServers.filter((m: any) => m.enabled);

      // Build managed-settings.json content
      const pluginEnabledMap: Record<string, boolean> = {};
      for (const p of enabledPlugins) {
        // Format: "name@registry" or just "name"
        pluginEnabledMap[`${p.name}@openagentic-plugins-official`] = true;
      }

      const managedSettings: Record<string, any> = {
        // Allow ONLY the official Anthropic marketplace
        strictKnownMarketplaces: [
          { source: 'github', repo: 'anthropics/claude-code' },
        ],
        blockedMarketplaces: [],
        strictPluginOnlyCustomization: true,
        allowManagedMcpServersOnly: mcpPolicy.allowManagedOnly ?? true,
        allowManagedHooksOnly: false,
        enabledPlugins: pluginEnabledMap,
        allowedMcpServers: enabledMcpServers.map((m: any) => ({ serverName: m.name })),
      };

      // Build managed-mcp.json content
      const managedMcp: Record<string, any> = {};
      for (const server of enabledMcpServers) {
        const entry: Record<string, any> = { type: server.type };
        if (server.type === 'stdio') {
          entry.command = server.command;
          entry.args = server.args || [];
          if (server.env) entry.env = server.env;
        } else if (server.type === 'http') {
          entry.url = server.url;
          if (server.headers) entry.headers = server.headers;
        }
        managedMcp[server.name] = entry;
      }

      const bundle = await getCodemodeConfigBundle();
      return reply.send(bundle);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to build config bundle');
      return reply.code(500).send({ success: false, error: 'Failed to build config bundle', message: error.message });
    }
  });
};

/**
 * Build the full config bundle for exec daemon injection.
 * Exported separately so it can be called from internal (no-auth) endpoints.
 */
export async function getCodemodeConfigBundle(): Promise<Record<string, any>> {
  const [skills, plugins, mcpServers, mcpPolicy] = await Promise.all([
    getCodemodeConfig('skills').then((v: any) => v ?? []),
    getCodemodeConfig('plugins').then((v: any) => v ?? []),
    getCodemodeConfig('mcp-servers').then((v: any) => v ?? []),
    getCodemodeConfig('mcp-policy').then((v: any) => v ?? { allowManagedOnly: true }),
  ]);

  const enabledSkills = skills.filter((s: any) => s.enabled);
  const enabledPlugins = plugins.filter((p: any) => p.enabled);
  const enabledMcpServers = mcpServers.filter((m: any) => m.enabled);

  const pluginEnabledMap: Record<string, boolean> = {};
  for (const p of enabledPlugins) {
    pluginEnabledMap[`${p.name}@openagentic-plugins-official`] = true;
  }

  const managedSettings: Record<string, any> = {
    // Allow ONLY the official Anthropic marketplace — blocks all user-added sources
    strictKnownMarketplaces: [
      { source: 'github', repo: 'anthropics/claude-code' },
    ],
    // No wildcard block — strictKnownMarketplaces already restricts to allowlist only
    blockedMarketplaces: [],
    strictPluginOnlyCustomization: true,
    allowManagedMcpServersOnly: mcpPolicy.allowManagedOnly ?? true,
    allowManagedHooksOnly: false,
    enabledPlugins: pluginEnabledMap,
    allowedMcpServers: enabledMcpServers.map((m: any) => ({ serverName: m.name })),
  };

  const managedMcp: Record<string, any> = {};
  for (const server of enabledMcpServers) {
    const entry: Record<string, any> = { type: server.type };
    if (server.type === 'stdio') {
      entry.command = server.command;
      entry.args = server.args || [];
      if (server.env) entry.env = server.env;
    } else if (server.type === 'http') {
      entry.url = server.url;
      if (server.headers) entry.headers = server.headers;
    }
    managedMcp[server.name] = entry;
  }

  return {
    success: true,
    managedSettings,
    managedMcp,
    enabledSkills,
    enabledPlugins: enabledPlugins.map((p: any) => p.name),
  };
}

export default codemodeAdminRoutes;
