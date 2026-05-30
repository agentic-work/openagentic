/**
 * Admin Extras Routes Plugin — Phase 3.7 of server.ts decomposition.
 *
 * This is the HIGH-LEVEL WRAPPER that groups all remaining admin-domain route
 * registrations (not already covered by admin.plugin.ts, integrations.plugin.ts,
 * memory-ai.plugin.ts, or workflows.plugin.ts) behind a single Fastify plugin export.
 *
 * Sub-split decision: 32 registers exceed the 20-route threshold from the spec,
 * so this wrapper delegates to 4 focused sub-plugins:
 *
 *  1. adminAuditRoutesPlugin        — Audit, credential-audit, audit-logs, dashboard-metrics
 *     - adminAuditRoutes             → /api/admin/audit/*
 *     - adminAuditLogsRoutes         → /api/admin/audit-logs/* (adminMiddleware)
 *     - adminCredentialAuditRoutes   → /api/admin/audit/credentials/*
 *     - adminDashboardMetricsRoutes  → /api/admin/dashboard/*
 *
 *  2. adminMcpRoutesPlugin          — MCP inspector, management, tools, access control
 *     - adminMCPInspectorRoutes      → /api/admin/mcp-inspector
 *     - adminToolsRoutes             → /api/admin/tools/* (adminMiddleware)
 *     - adminMCPAccessRoutes         → /api/admin/mcp (adminMiddleware)
 *     - mcpManagementRoutes          → /api/admin/mcp/*
 *
 *  3. adminObservabilityRoutesPlugin — Analytics, roles, messages, metrics, grafana,
 *                                     pipeline observability, monitoring WS
 *     - adminAnalyticsRoutes         → /api/admin/analytics/* (adminMiddleware)
 *     - adminRolesRoutes             → /api/admin/roles/* (adminMiddleware)
 *     - adminMessagesRoutes          → /api/admin/messages/* (adminMiddleware)
 *     - adminMetricsRoutes           → /api/admin/metrics/* (adminMiddleware)
 *     - adminAIFMetricsRoutes        → /api/admin (adminMiddleware)
 *     - grafanaProxyRoutes           → /api/admin/grafana/*
 *     - pipelineLogRoutes            → /api/admin/pipeline-log/*
 *     - pipelineControlRoutes        → /api/admin/pipeline (adminMiddleware)
 *     - pipelineStatusRoutes         → /api/admin (adminMiddleware)
 *     - monitoringWebSocketRoutes    → /api/monitoring
 *
 *  4. adminMiscRoutesPlugin         — User-perms, auth-access, agenticode, health,
 *                                     system-config, internal routes, mcp-logs, awcode,
 *                                     docs, background-jobs, integrations, DLP
 *     - adminUserPermissionsRoutes   → /api/admin/user-management/*
 *     - authAccessRoutes             → /api/admin/auth/* (adminMiddleware)
 *     - agenticodeRoutes             → /api/agenticode/*
 *     - healthRoutes                 → /api/health/*
 *     - systemConfigRoutes           → /api/system/config
 *     - registerResultStorageRoutes  → /api/internal/result-storage/*
 *     - registerHitlPolicyRoutes     → /api/internal/hitl/policy
 *     - registerAgentPersistenceRoutes → /api/internal/agent-*
 *     - mcpLogsRoutes                → /api/mcp-logs/*
 *     - awcodeRoutes                 → /api/awcode/*
 *     - docsRoutes                   → /api/docs/*
 *     - backgroundJobsRoutes         → /api/background-jobs/* (authMiddleware)
 *     - adminIntegrationRoutes       → /api/admin/integrations/* (adminMiddleware)
 *     - dlpRoutes                    → /api/admin/dlp/*
 *
 * Design notes:
 *  - Each sub-plugin registration is wrapped in an independent try/catch (lesson 4)
 *    matching the style in server.ts: a single failing sub-plugin never blocks others.
 *  - providerManager flows from Options → AppContext decoration (lesson from models.plugin.ts).
 *  - No hardcoded model literals (CLAUDE.md rule 7).
 *
 * Applies all 12 accumulated lessons from Phase 3.1-3.6 reviews:
 *  - Strongly typed Options interface (lessons 3, 6).
 *  - No `as any` in production interface body (lesson 10).
 *  - Independent try/catch per register (lesson 4).
 *  - Orphan sweep performed post-move (lesson 7).
 *  - Dynamic imports inside plugin body so vitest can intercept mocks (lesson 2).
 *  - Logger inoculation mock in test files (lesson 12).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import { adminAuditRoutesPlugin } from './admin-audit.plugin.js';
import { adminMcpRoutesPlugin } from './admin-mcp.plugin.js';
import { adminObservabilityRoutesPlugin } from './admin-observability.plugin.js';

// OSS stub — admin-misc plugin not yet ported
const adminMiscRoutesPlugin: any = undefined;

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

export interface AdminExtrasRoutesPluginOptions {
  /**
   * Optional: override providerManager from AppContext.
   * Forwarded to adminMiscRoutesPlugin for agenticodeRoutes.
   * When undefined, sub-plugins read ctx.providerManager from the decorated
   * Fastify instance (fastify.app.providerManager).
   */
  providerManager?: ProviderManager;
}

// ---------------------------------------------------------------------------
// The wrapper plugin
// ---------------------------------------------------------------------------

const adminExtrasRoutesPluginImpl: FastifyPluginAsync<AdminExtrasRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  options: AdminExtrasRoutesPluginOptions,
) => {
  loggers.routes.info('Registering admin-extras routes plugin (32 registers across 4 sub-plugins)...');

  // ── Sub-plugin 1: Admin Audit ─────────────────────────────────────────────
  // adminAuditRoutes, adminAuditLogsRoutes, adminCredentialAuditRoutes,
  // adminDashboardMetricsRoutes
  try {
    await fastify.register(adminAuditRoutesPlugin, {});
    loggers.routes.info('admin-audit sub-plugin registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin-audit sub-plugin');
  }

  // ── Sub-plugin 2: Admin MCP ───────────────────────────────────────────────
  // adminMCPInspectorRoutes, adminToolsRoutes, adminMCPAccessRoutes,
  // mcpManagementRoutes
  try {
    await fastify.register(adminMcpRoutesPlugin, {});
    loggers.routes.info('admin-mcp sub-plugin registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin-mcp sub-plugin');
  }

  // ── Sub-plugin 3: Admin Observability ────────────────────────────────────
  // adminAnalyticsRoutes, adminRolesRoutes, adminMessagesRoutes, adminMetricsRoutes,
  // adminAIFMetricsRoutes, grafanaProxyRoutes, pipelineLogRoutes,
  // pipelineControlRoutes, pipelineStatusRoutes, monitoringWebSocketRoutes
  try {
    await fastify.register(adminObservabilityRoutesPlugin, {});
    loggers.routes.info('admin-observability sub-plugin registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin-observability sub-plugin');
  }

  // ── Sub-plugin 4: Admin Misc ──────────────────────────────────────────────
  // adminUserPermissionsRoutes, authAccessRoutes, agenticodeRoutes, healthRoutes,
  // systemConfigRoutes, registerResultStorageRoutes, registerHitlPolicyRoutes,
  // registerAgentPersistenceRoutes, mcpLogsRoutes, awcodeRoutes, docsRoutes,
  // backgroundJobsRoutes, adminIntegrationRoutes, dlpRoutes
  try {
    await fastify.register(adminMiscRoutesPlugin, {
      providerManager: options.providerManager,
    });
    loggers.routes.info('admin-misc sub-plugin registered');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin-misc sub-plugin');
  }

  loggers.routes.info('Admin extras routes plugin registered successfully');
};

export const adminExtrasRoutesPlugin = fp(adminExtrasRoutesPluginImpl, {
  name: 'admin-extras-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
