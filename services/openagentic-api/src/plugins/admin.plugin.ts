/**
 * Admin Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all admin-related route registrations into a single Fastify plugin.
 *
 * All routes require admin authentication via adminMiddleware.
 *
 * Includes:
 * - Admin core routes
 * - Admin portal enhanced routes
 * - Admin system monitoring routes
 * - Admin slider routes
 * - Admin rate limits routes
 * - Admin chargeback routes
 * - Admin tiered function calling routes
 * - Admin MCP routes
 * - Admin Ollama routes (conditional)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { featureFlags } from '../config/featureFlags.js';
import { adminRoutes } from '../routes/admin.js';
import { adminPortalEnhancedRoutes } from '../routes/admin-portal-enhanced.js';
import { adminMissingRoutes, capabilitiesRoutes } from '../routes/admin-missing-routes.js';
import { adminSystemRoutes } from '../routes/admin-system.js';
import dlpRoutes from '../routes/admin/dlp.js';
import adminDashboardCountsRoutes from '../routes/admin-dashboard-counts.js';
import adminMCPLogsRoutes from '../routes/admin-mcp-logs.js';
import adminContextMetricsRoutes from '../routes/admin-context-metrics.js';
import adminMCPToolsRoutes from '../routes/admin-mcp-tools.js';
// adminUsageAnalyticsRoutes removed; new analytics-monitoring plugin owns /api/admin/analytics/usage
import { adminNetworkRoutes } from '../routes/admin-network.js';
import { adminWorkflowSecretsRoutes } from '../routes/admin-workflow-secrets.js';
import adminUserContextRoutes from '../routes/admin-user-context.js';
import adminV3ExtrasRoutes from '../routes/admin/v3-extras.js';
import adminV3ExtrasMutationsRoutes from '../routes/admin/v3-extras-mutations.js';
import adminV3ExtrasMiscRoutes from '../routes/admin/v3-extras-misc.js';
import adminPermissionsRoutes from '../routes/admin/permissions.js';
import { sloRoutes } from '../routes/admin/slo.js';
// enrichedToolsRoutes is registered in routes/admin.ts (registering it here too
// dup-declared /api/admin/enriched-tools and crashlooped the api).
import complianceRecommendationsRoutes from '../routes/admin/compliance-recommendations.js';

interface AdminPluginOptions {
  ollamaEnabled?: boolean;
}

const adminPlugin: FastifyPluginAsync<AdminPluginOptions> = async (
  fastify: FastifyInstance,
  options: AdminPluginOptions
) => {
  const ollamaEnabled = options.ollamaEnabled ?? featureFlags.ollamaEnabled;

  // Track registration success/failure for summary
  let successCount = 0;
  let failCount = 0;

  loggers.routes.info('Registering admin routes plugin...');

  // Cache-Control for admin API responses
  // Analytics/metrics: 30s (not real-time critical)
  // Config endpoints: 10s (changes infrequently)
  // Audit/logs: no-cache (always fresh)
  fastify.addHook('onSend', async (request, reply) => {
    if (reply.statusCode >= 200 && reply.statusCode < 300 && request.method === 'GET') {
      const url = request.url;
      if (!reply.hasHeader('cache-control')) {
        if (url.includes('metrics') || url.includes('analytics') || url.includes('stats') || url.includes('dashboard')) {
          reply.header('cache-control', 'private, max-age=30');
        } else if (url.includes('audit') || url.includes('logs') || url.includes('executions')) {
          reply.header('cache-control', 'no-cache');
        } else {
          reply.header('cache-control', 'private, max-age=10');
        }
      }
    }
  });

  // Register Admin routes
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin routes registered at /api/admin with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin routes');
    failCount++;
  }

  // Register Admin Portal Enhanced routes
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminPortalEnhancedRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Enhanced admin portal routes registered at /api/admin with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register enhanced admin portal routes');
    failCount++;
  }

  // Register Admin Ollama routes UNCONDITIONALLY — admin must be able to view/manage
  // configured Ollama hosts even when the runtime feature flag is disabled (otherwise
  // the LLM Extras > Ollama Hosts pane fires "upstream endpoint failed" 404 banners).
  // Routes themselves return empty arrays when no ollama providers are configured.
  try {
    const { adminOllamaRoutes } = await import('../routes/admin-ollama.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminOllamaRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info({ ollamaEnabled }, 'Admin Ollama routes registered at /api/admin/ollama/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin Ollama routes');
  }

  // Register Admin Missing Routes (MCP health, tools status)
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMissingRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin missing routes registered at /api/admin/mcp/health, /api/admin/mcp-tools/status');

    // Register capabilities routes at /api/capabilities/*.
    // SECURITY: these disclose configured LLM providers (env-derived), MCP
    // server names, tool counts, and feature flags — admin-only, never public.
    // Wrap in an encapsulated child instance with adminMiddleware so the guard
    // actually applies (a bare sibling register inherits NO auth hook).
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(capabilitiesRoutes);
    }, { prefix: '/api/capabilities' });
    loggers.routes.info('Capabilities routes registered at /api/capabilities/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin missing routes');
    failCount++;
  }

  // Register Admin System routes for real-time system monitoring
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminSystemRoutes);
    }, { prefix: '/api/admin/system' });
    loggers.routes.info('Admin System monitoring routes registered at /api/admin/system/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin system routes');
    failCount++;
  }

  // Register Admin DLP routes for Data Loss Prevention rule management
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(dlpRoutes);
    }, { prefix: '/api/admin/dlp' });
    loggers.routes.info('Admin DLP routes registered at /api/admin/dlp/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin DLP routes');
    failCount++;
  }

  // Register Free Dashboard Counts route (GET /api/admin/dashboard/counts)
  try {
    await fastify.register(adminDashboardCountsRoutes, { prefix: '/api/admin/dashboard' });
    loggers.routes.info('Admin Dashboard Counts route registered at /api/admin/dashboard/counts (free)');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin dashboard counts route');
    failCount++;
  }

  // Register Admin MCP Logs routes for tracking tool executions
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPLogsRoutes);
    });
    loggers.routes.info('Admin MCP Logs routes registered at /api/admin/mcp-logs with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP logs routes');
    failCount++;
  }

  // Register Admin Context Window Metrics routes
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminContextMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Context Window Metrics routes registered at /api/admin/context-metrics with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin context window metrics routes');
    failCount++;
  }

  // Register Admin MCP Tools routes for tool cache management
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPToolsRoutes);
    }, { prefix: '/api/admin/mcp/tools' });
    loggers.routes.info('Admin MCP Tools routes registered at /api/admin/mcp/tools/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP tools routes');
    failCount++;
  }

  // (admin-usage-analytics removed) — bf17089a registered the new
  // analytics-monitoring plugin in server.ts at the same /api/admin/analytics
  // prefix without removing the legacy registration here, causing a
  // FST_ERR_DUPLICATED_ROUTE crash on /api/admin/analytics/usage that
  // killed the api on every boot. The new plugin owns this endpoint now.

  // Register Admin Network Security routes for K8s NetworkPolicy management
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminNetworkRoutes);
    }, { prefix: '/api/admin/network' });
    loggers.routes.info('Admin Network Security routes registered at /api/admin/network/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin network security routes');
    failCount++;
  }

  // Register Admin Workflow Secrets routes for encrypted secret management
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminWorkflowSecretsRoutes);
    }, { prefix: '/api/admin/workflow-secrets' });
    loggers.routes.info('Admin Workflow Secrets routes registered at /api/admin/workflow-secrets/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin workflow secrets routes');
    failCount++;
  }

  // Register Admin User Context (Memory) routes for adaptive memory admin view
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminUserContextRoutes);
    }, { prefix: '/api/admin/user-context' });
    loggers.routes.info('Admin User Context routes registered at /api/admin/user-context/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin user context routes');
    failCount++;
  }

  // Registry Tombstone routes (F2.6) — enterprise audit feature, not shipped in OSS.

  // Register Admin V3 Extras routes — 14 read-only endpoints the v3 admin
  // pages reference but which previously didn't exist (router decisions,
  // mcp/llm health histories, api-request analytics, openagentic api keys,
  // per-workflow cost, per-MCP permissions, audit log detail).
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminV3ExtrasRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin V3 Extras routes registered at /api/admin/* (14 endpoints) with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin v3 extras routes');
    failCount++;
  }

  // Register Admin V3 Extras Mutations — endpoints that close the
  // "wire-up pending" Banner gaps in the v3 admin UI:
  //   - POST  /integrations/:platform/oauth-start
  //   - PATCH /chargeback/reports/:id
  //   - POST  /llm-providers/registry/refresh-all
  //   - GET/PUT /workflow-settings
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminV3ExtrasMutationsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin V3 Extras Mutations registered at /api/admin/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin v3 extras mutations routes');
    failCount++;
  }

  // Register Admin V3 Extras Misc — 6 read-only endpoints DashboardV3
  // references but that previously had no server-side handler:
  //   - GET /cluster/health                   (Prometheus)
  //   - GET /storage                          (milvus + pgvector + redis)
  //   - GET /mcp-logs/histogram               (mcp_usage)
  //   - GET /api-requests/throttles           (rate_limit_violations + llm_request_logs)
  //   - GET /perf/throughput                  (llm_request_logs)
  //   - GET /router/escalation-triggers       (model_routing_decisions)
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminV3ExtrasMiscRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin V3 Extras Misc registered at /api/admin/* (6 endpoints) with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin v3 extras misc routes');
    failCount++;
  }

  // Register Admin Tool Permissions — Claude-Code-style allow/deny/ask glob
  // rule CRUD (replaces the old regex-tier tool_risk_overrides endpoint).
  // Mounted at /api/admin/tool-permissions to avoid collision with the legacy
  // user-permission CRUD at /api/admin/permissions/* in admin-misc.plugin.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminPermissionsRoutes, { prefix: '/tool-permissions' });
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Tool Permissions routes registered at /api/admin/tool-permissions with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin tool-permissions routes');
    failCount++;
  }

  // Register Admin SLO routes — Phase 12 CRUD on SLODefinition rows +
  // live status evaluation against the prom-client default registry.
  //   - GET    /api/admin/slo                  list
  //   - GET    /api/admin/slo/:metric          get one
  //   - POST   /api/admin/slo                  upsert
  //   - PATCH  /api/admin/slo/:metric/toggle   flip enabled
  //   - DELETE /api/admin/slo/:metric          remove
  //   - GET    /api/admin/slo/:metric/status   live evaluation
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(sloRoutes);
    }, { prefix: '/api/admin/slo' });
    loggers.routes.info('Admin SLO routes registered at /api/admin/slo/* with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin SLO routes');
    failCount++;
  }

  // NOTE: /api/admin/enriched-tools is ALREADY registered by routes/admin.ts.
  // A second registration here caused FST_ERR_DUPLICATED_ROUTE and crashlooped the
  // api on boot — so the enriched-tools mount lives solely in admin.ts.

  // Register Admin Compliance Findings + Recommendations routes — two HomePage
  // KPI feeds the v4 console calls that previously 404'd. OSS has no control-
  // evaluation / advisory engine yet, so both return an honest EMPTY shape that
  // matches useComplianceFindings / useRecommendations exactly.
  //   - GET /api/admin/compliance/findings  → { findings:[], summary:{...zeros} }
  //   - GET /api/admin/recommendations      → { success:true, recommendations:[], count:0 }
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(complianceRecommendationsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin compliance/recommendations routes registered at /api/admin/{compliance/findings,recommendations} with admin middleware');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin compliance/recommendations routes');
    failCount++;
  }

  // Sev-1 (2026-05-17) — global READ-ONLY mode UI calls
  // /api/admin/permissions/read-only-mode (the canonical path per
  // permissions.test.ts:208 + UI's SettingsPane.tsx + PermissionsPage.tsx).
  // Register ONLY the read-only-mode pair directly at /api/admin/permissions/
  // — registering the full adminPermissionsRoutes plugin a second time at
  // /permissions collides with v3-extras.ts's `GET /permissions` (FST_ERR_DUPLICATED_ROUTE).
  try {
    const { getPermissionService } = await import('../services/PermissionService.js');
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      instance.get('/api/admin/permissions/read-only-mode', async () => {
        const svc = getPermissionService(loggers.services as any);
        await svc.loadConfig();
        return { success: true, readOnlyMode: svc.getReadOnlyMode() };
      });
      instance.put('/api/admin/permissions/read-only-mode', async (request, reply) => {
        const body = request.body as { readOnlyMode?: unknown } | null;
        if (!body || typeof body.readOnlyMode !== 'boolean') {
          return reply.code(400).send({ success: false, error: 'readOnlyMode (boolean) required' });
        }
        const svc = getPermissionService(loggers.services as any);
        await svc.setReadOnlyMode(body.readOnlyMode);
        return { success: true, readOnlyMode: svc.getReadOnlyMode() };
      });
    });
    loggers.routes.info('Admin read-only-mode endpoints registered at /api/admin/permissions/read-only-mode');
    successCount++;
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin read-only-mode endpoints');
    failCount++;
  }

  loggers.routes.info({
    successCount,
    failCount,
    ollamaEnabled
  }, `Admin routes plugin registered: ${successCount} succeeded, ${failCount} failed`);
};

export default fp(adminPlugin, {
  name: 'admin-routes',
  dependencies: []
});
