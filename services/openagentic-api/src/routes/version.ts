/**
 * Version API Endpoint
 * Returns platform version info including all component versions
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import axios from 'axios';

// Try to load version.json from various locations
function loadVersionJson(): any {
  const possiblePaths = [
    join(__dirname, '../../../../version.json'),     // Development
    join(__dirname, '../../../version.json'),        // Built
    '/app/version.json',                              // Container
    join(process.cwd(), 'version.json'),             // CWD
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf-8'));
      } catch (e) {
        console.warn(`Failed to parse version.json at ${path}:`, e);
      }
    }
  }

  // Fallback version info
  return {
    version: process.env.PLATFORM_VERSION || '0.5.0',
    codename: process.env.PLATFORM_CODENAME || 'Hardened',
    releaseDate: process.env.PLATFORM_RELEASE_DATE || new Date().toISOString().split('T')[0],
    components: {},
    changelog: []
  };
}

// Load openagentic and SDK versions from their package.json if available
function getCliVersions(): { openagentic: string; sdk: string } {
  let openagentic = 'unknown';
  let sdk = 'unknown';

  // Try openagentic package.json
  const openagenticPaths = [
    '/app/openagentic/package.json',
    join(__dirname, '../../../../../openagentic/package.json'),
  ];
  for (const path of openagenticPaths) {
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf-8'));
        openagentic = pkg.version || 'unknown';
        break;
      } catch {}
    }
  }

  // Try SDK package.json
  const sdkPaths = [
    '/app/openagentic/node_modules/@agentic-work/sdk/package.json',
    join(__dirname, '../../../../../sdk/package.json'),
  ];
  for (const path of sdkPaths) {
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, 'utf-8'));
        sdk = pkg.version || 'unknown';
        break;
      } catch {}
    }
  }

  return { openagentic, sdk };
}

export async function versionRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/version
   * Returns complete version information for the platform
   * Public endpoint - no auth required
   */
  fastify.get('/version', async (_request: FastifyRequest, reply: FastifyReply) => {
    const versionJson = loadVersionJson();
    const cliVersions = getCliVersions();

    const versionInfo = {
      // Platform version
      version: versionJson.version,
      codename: versionJson.codename,
      releaseDate: versionJson.releaseDate,

      // Component versions
      components: {
        platform: versionJson.version,
        api: process.env.API_VERSION || versionJson.components?.api || versionJson.version,
        ui: process.env.UI_VERSION || versionJson.components?.ui || versionJson.version,
        mcpProxy: versionJson.components?.mcpProxy || versionJson.version,
        codeManager: versionJson.components?.codeManager || versionJson.version,
        openagentic: cliVersions.openagentic,
        sdk: cliVersions.sdk,
      },

      // Build info
      build: {
        time: process.env.BUILD_TIME || new Date().toISOString(),
        commit: process.env.GIT_COMMIT || process.env.GIT_SHORT_COMMIT || 'unknown',
        branch: process.env.GIT_BRANCH || 'unknown',
        environment: process.env.NODE_ENV || 'development',
      },

      // Runtime info
      runtime: {
        nodeVersion: process.version,
        uptime: Math.floor(process.uptime()),
      }
    };

    return reply.send(versionInfo);
  });

  /**
   * GET /api/version/changelog
   * Returns the full changelog
   * Public endpoint - no auth required
   */
  fastify.get('/version/changelog', async (_request: FastifyRequest, reply: FastifyReply) => {
    const versionJson = loadVersionJson();

    return reply.send({
      currentVersion: versionJson.version,
      codename: versionJson.codename,
      changelog: versionJson.changelog || []
    });
  });

  /**
   * GET /api/version/latest
   * Returns just the latest version info (for update checks)
   * Public endpoint - no auth required
   */
  fastify.get('/version/latest', async (_request: FastifyRequest, reply: FastifyReply) => {
    const versionJson = loadVersionJson();
    const latestChangelog = versionJson.changelog?.[0] || {};

    return reply.send({
      version: versionJson.version,
      codename: versionJson.codename,
      releaseDate: versionJson.releaseDate,
      highlights: latestChangelog.highlights || [],
    });
  });

  /**
   * GET /api/version/badge
   * Lightweight version info for the sidebar badge
   * Public endpoint - no auth required
   */
  fastify.get('/version/badge', async (_request: FastifyRequest, reply: FastifyReply) => {
    const versionJson = loadVersionJson();

    return reply.send({
      version: versionJson.version,
      codename: versionJson.codename,
      environment: process.env.NODE_ENV || 'development',
      commit: process.env.GIT_COMMIT?.slice(0, 7) || process.env.GIT_SHORT_COMMIT || 'unknown',
      services: {
        api: { version: versionJson.version, status: 'online' as const },
      }
    });
  });

  /**
   * GET /api/version/all
   * Full version info with live service status probing
   * Public endpoint - no auth required
   */
  fastify.get('/version/all', async (_request: FastifyRequest, reply: FastifyReply) => {
    const versionJson = loadVersionJson();

    const probeService = async (name: string, url: string): Promise<{
      name: string;
      version: string;
      gitCommit: string;
      gitShortCommit: string;
      status: 'online' | 'offline' | 'unknown';
      endpoint: string;
      lastChecked: string;
    }> => {
      try {
        const res = await axios.get(url, { timeout: 3000 });
        const data = res.data;
        // Each service may return git info under various key names (commit,
        // gitCommit, git_commit, build.commit, etc.). Probe all of them and
        // fall back to "unknown" so the UI can render a clean SHA per-service.
        const fullCommit =
          data.gitCommit
          || data.git_commit
          || data.commit
          || data.build?.commit
          || data.build?.gitCommit
          || 'unknown';
        const shortCommit =
          data.gitShortCommit
          || data.git_short_commit
          || (typeof fullCommit === 'string' && fullCommit !== 'unknown' ? fullCommit.slice(0, 8) : 'unknown');
        return {
          name,
          version: data.version || data.components?.platform || versionJson.version,
          gitCommit: fullCommit,
          gitShortCommit: shortCommit,
          status: 'online',
          endpoint: url,
          lastChecked: new Date().toISOString(),
        };
      } catch {
        return {
          name,
          version: 'unknown',
          gitCommit: 'unknown',
          gitShortCommit: 'unknown',
          status: 'offline',
          endpoint: url,
          lastChecked: new Date().toISOString(),
        };
      }
    };

    const mcpProxyUrl = process.env.MCP_PROXY_URL || process.env.MCP_ORCHESTRATOR_URL || 'http://openagentic-mcp-proxy:8080';
    const codeManagerUrl = process.env.CODE_MANAGER_URL || 'http://openagentic-code-manager:3000';
    const openagenticProxyUrl = process.env.OPENAGENTIC_PROXY_URL || 'http://openagentic-openagentic-proxy:3300';
    const now = new Date().toISOString();

    // Derive infrastructure status from API health endpoint
    let dbStatus: 'online' | 'offline' = 'offline';
    let redisStatus: 'online' | 'offline' = 'offline';
    let milvusStatus: 'online' | 'offline' = 'offline';
    try {
      const port = process.env.PORT || '8000';
      const healthRes = await axios.get(`http://localhost:${port}/api/health`, { timeout: 3000 });
      const h = healthRes.data;
      dbStatus = h.database?.status === 'connected' ? 'online' : 'offline';
      redisStatus = h.redis?.status === 'connected' ? 'online' : 'offline';
      milvusStatus = h.milvus?.status === 'connected' ? 'online' : 'offline';
    } catch { /* keep offline defaults */ }

    // Probe live services in parallel
    const [mcpProxy, codeManager, openagenticProxy] = await Promise.all([
      probeService('MCP Proxy', `${mcpProxyUrl}/health`),
      probeService('Code Manager', `${codeManagerUrl}/health`),
      probeService('Agent Proxy', `${openagenticProxyUrl}/api/agents/health`),
    ]);

    // Derive MCP server count from proxy health
    let mcpServers = '';
    try {
      if (mcpProxy.status === 'online') {
        const mcpHealth = await axios.get(`${mcpProxyUrl}/health`, { timeout: 3000 });
        const s = mcpHealth.data?.servers;
        if (s) mcpServers = ` (${s.running}/${s.total} servers)`;
      }
    } catch { /* ignore */ }

    // API's own git info comes from build args (GIT_COMMIT / GIT_SHORT_COMMIT)
    const apiFullCommit = process.env.GIT_COMMIT || process.env.GIT_SHORT_COMMIT || 'unknown';
    const apiShortCommit =
      process.env.GIT_SHORT_COMMIT
      || (apiFullCommit !== 'unknown' ? apiFullCommit.slice(0, 8) : 'unknown');
    // UI git info — propagated into the API pod via VITE_GIT_COMMIT or
    // UI_GIT_COMMIT env if the chart passes them through. Otherwise falls
    // back to the API's own (same repo, same build).
    const uiFullCommit = process.env.UI_GIT_COMMIT || apiFullCommit;
    const uiShortCommit =
      process.env.UI_GIT_SHORT_COMMIT
      || (uiFullCommit !== 'unknown' ? uiFullCommit.slice(0, 8) : 'unknown');

    const services = [
      {
        name: 'API',
        version: versionJson.version,
        gitCommit: apiFullCommit,
        gitShortCommit: apiShortCommit,
        status: 'online' as const,
        endpoint: '/api/health',
        lastChecked: now,
      },
      {
        name: 'UI',
        version: versionJson.version,
        gitCommit: uiFullCommit,
        gitShortCommit: uiShortCommit,
        status: 'online' as const,
        endpoint: 'nginx',
        lastChecked: now,
      },
      { ...mcpProxy, name: `MCP Proxy${mcpServers}` },
      codeManager,
      openagenticProxy,
      { name: 'PostgreSQL', version: 'PostgreSQL 16', gitCommit: 'upstream', gitShortCommit: 'upstream', status: dbStatus, endpoint: 'internal', lastChecked: now },
      { name: 'Redis', version: 'Redis 7', gitCommit: 'upstream', gitShortCommit: 'upstream', status: redisStatus, endpoint: 'internal', lastChecked: now },
      { name: 'Milvus', version: 'Milvus 2.5', gitCommit: 'upstream', gitShortCommit: 'upstream', status: milvusStatus, endpoint: 'internal', lastChecked: now },
    ];

    return reply.send({
      platform: {
        name: 'OpenAgentic',
        version: versionJson.version,
        codename: versionJson.codename,
        environment: process.env.NODE_ENV || 'development',
        buildTime: process.env.BUILD_TIME || 'unknown',
        gitCommit: process.env.GIT_COMMIT || process.env.GIT_SHORT_COMMIT || 'unknown',
        gitBranch: process.env.GIT_BRANCH || 'unknown',
      },
      services,
      timestamp: new Date().toISOString(),
    });
  });
}
