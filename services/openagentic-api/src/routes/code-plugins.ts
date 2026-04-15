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

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma.js';

// ---------------------------------------------------------------------------
// Config DB helpers — same pattern as admin/codemode.ts
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
// Constants
// ---------------------------------------------------------------------------

/** The official marketplace.json — verified at .claude-plugin/marketplace.json */
const MARKETPLACE_RAW_URL =
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json';

const MARKETPLACE_FALLBACK_URLS = [
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.openagentic-plugin/marketplace.json',
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/marketplace.json',
];

/** Install count stats from the stats branch */
const INSTALL_COUNTS_URL =
  'https://raw.githubusercontent.com/agentic-work/openagentic-plugins-official/refs/heads/stats/stats/plugin-installs.json';

/** Cache TTL: 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Marketplace fetcher
// ---------------------------------------------------------------------------

interface MarketplaceCache {
  fetchedAt: string;
  marketplace: any;
  installCounts: Record<string, number>;
}

async function fetchMarketplaceFromGitHub(logger: any): Promise<MarketplaceCache | null> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'OpenAgentic-CodeMode',
  };
  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    headers['Authorization'] = `Bearer ${ghToken}`;
  }

  // 1. Fetch marketplace.json — try primary URL, then fallbacks
  let marketplace: any = null;
  const allUrls = [MARKETPLACE_RAW_URL, ...MARKETPLACE_FALLBACK_URLS];

  for (const url of allUrls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        marketplace = await res.json();
        logger.info({ url }, 'Fetched marketplace.json from GitHub');
        break;
      }
      logger.debug({ url, status: res.status }, 'marketplace.json fetch attempt failed');
    } catch (err: any) {
      logger.debug({ url, error: err.message }, 'marketplace.json fetch attempt error');
    }
  }

  if (!marketplace) {
    logger.warn('Failed to fetch marketplace.json from all URLs');
    return null;
  }

  // 2. Fetch install counts (best-effort)
  const installCounts: Record<string, number> = {};
  try {
    const countsRes = await fetch(INSTALL_COUNTS_URL, {
      headers: { 'User-Agent': 'OpenAgentic-CodeMode' },
      signal: AbortSignal.timeout(10_000),
    });
    if (countsRes.ok) {
      const data: any = await countsRes.json();
      if (data?.plugins && Array.isArray(data.plugins)) {
        for (const entry of data.plugins) {
          if (entry.plugin && typeof entry.unique_installs === 'number') {
            installCounts[entry.plugin] = entry.unique_installs;
          }
        }
      }
      logger.info({ count: Object.keys(installCounts).length }, 'Fetched install counts');
    }
  } catch (err: any) {
    logger.debug({ error: err.message }, 'Install counts fetch failed (non-fatal)');
  }

  return {
    fetchedAt: new Date().toISOString(),
    marketplace,
    installCounts,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const codePluginsRoutes: FastifyPluginAsync = async (fastify) => {
  const logger = fastify.log;

  /**
   * GET /api/code/plugins/marketplace
   *
   * Returns the full marketplace plugin catalog with install counts.
   * Cached in DB for 24 hours; force refresh with ?refresh=1.
   */
  fastify.get<{ Querystring: { refresh?: string } }>(
    '/plugins/marketplace',
    async (request: FastifyRequest<{ Querystring: { refresh?: string } }>, reply: FastifyReply) => {
      try {
        const forceRefresh = request.query.refresh === '1';

        // Check cache
        if (!forceRefresh) {
          const cached: MarketplaceCache | null = await getCodemodeConfig('marketplace-cache');
          if (cached?.fetchedAt) {
            const age = Date.now() - new Date(cached.fetchedAt).getTime();
            if (age < CACHE_TTL_MS) {
              return reply.send({
                success: true,
                cached: true,
                fetchedAt: cached.fetchedAt,
                marketplace: cached.marketplace,
                installCounts: cached.installCounts,
              });
            }
          }
        }

        // Fetch fresh data
        const fresh = await fetchMarketplaceFromGitHub(logger);
        if (!fresh) {
          // Try to serve stale cache
          const stale: MarketplaceCache | null = await getCodemodeConfig('marketplace-cache');
          if (stale?.marketplace) {
            return reply.send({
              success: true,
              cached: true,
              stale: true,
              fetchedAt: stale.fetchedAt,
              marketplace: stale.marketplace,
              installCounts: stale.installCounts,
            });
          }
          return reply.code(502).send({
            success: false,
            error: 'Failed to fetch marketplace data from GitHub',
          });
        }

        // Cache in DB
        await setCodemodeConfig('marketplace-cache', fresh);

        return reply.send({
          success: true,
          cached: false,
          fetchedAt: fresh.fetchedAt,
          marketplace: fresh.marketplace,
          installCounts: fresh.installCounts,
        });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Plugin marketplace fetch failed');
        return reply.code(500).send({ success: false, error: error.message });
      }
    },
  );

  /**
   * GET /api/code/plugins/installed
   *
   * Returns the list of installed/enabled plugins from the admin config.
   * These are the plugins that get injected into runner pod sessions.
   */
  fastify.get('/plugins/installed', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const plugins: any[] = await getCodemodeConfig('plugins') ?? [];
      return reply.send({
        success: true,
        plugins,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list installed plugins');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/code/plugins/:pluginId/toggle
   *
   * Toggle a plugin's enabled state. If the plugin doesn't exist in the
   * installed list, create it from the marketplace entry.
   */
  fastify.post<{ Params: { pluginId: string }; Body: { enabled: boolean } }>(
    '/plugins/:pluginId/toggle',
    async (request: FastifyRequest<{ Params: { pluginId: string }; Body: { enabled: boolean } }>, reply: FastifyReply) => {
      try {
        const { pluginId } = request.params;
        const { enabled } = request.body;
        const plugins: any[] = await getCodemodeConfig('plugins') ?? [];

        const idx = plugins.findIndex((p: any) => p.id === pluginId || p.name === pluginId);
        if (idx >= 0) {
          plugins[idx].enabled = enabled;
        } else {
          // Add new plugin from marketplace data
          plugins.push({
            id: `plugin-${pluginId}`,
            name: pluginId,
            version: 'latest',
            description: '',
            provides: { skills: 0, mcpServers: 0, hooks: 0 },
            enabled,
            source: 'marketplace',
          });
        }

        await setCodemodeConfig('plugins', plugins);
        logger.info({ pluginId, enabled }, 'Plugin toggled');

        return reply.send({ success: true, plugins });
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to toggle plugin');
        return reply.code(500).send({ success: false, error: error.message });
      }
    },
  );

  /**
   * GET /api/code/plugins/marketplaces
   *
   * Returns the list of known marketplace sources.
   */
  fastify.get('/plugins/marketplaces', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const registries: any[] = await getCodemodeConfig('registries') ?? [];

      // Always include the official marketplace
      const marketplaces = [
        {
          name: 'claude-plugins-official',
          displayName: 'Community plugin marketplace',
          repo: 'anthropics/claude-plugins-official',
          official: true,
        },
        ...registries.map((r: any) => ({
          name: r.name,
          displayName: r.name,
          repo: r.url,
          official: r.official ?? false,
        })),
      ];

      return reply.send({ success: true, marketplaces });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list marketplaces');
      return reply.code(500).send({ success: false, error: error.message });
    }
  });
};

export default codePluginsRoutes;
