/**
 * Admin Audit Routes Sub-Plugin — Phase 3.7 of server.ts decomposition.
 *
 * Registers all audit-domain admin routes:
 *  1. adminAuditRoutes          — Comprehensive user activity audit   → /api/admin/audit/*
 *  2. adminAuditLogsRoutes      — Session logs, stats, export (SOC2)  → /api/admin/audit-logs/* (adminMiddleware)
 *  3. adminCredentialAuditRoutes — Credential change audit trail      → /api/admin/audit/credentials/*
 *  4. adminDashboardMetricsRoutes — Grafana-style time-series metrics → /api/admin/dashboard/*
 *
 * Design notes:
 *  - Each sub-registration is wrapped in an independent try/catch (lesson 4).
 *  - No AppContext decoration required here — route modules resolve their
 *    own dependencies via module-level imports.
 *  - No hardcoded model literals (CLAUDE.md rule 7).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import adminKpisRoutes from '../routes/admin-kpis.js';

export interface AdminAuditRoutesPluginOptions {
  _reserved?: never;
}

const adminAuditRoutesPluginImpl: FastifyPluginAsync<AdminAuditRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: AdminAuditRoutesPluginOptions,
) => {
  loggers.routes.info('Registering admin-audit routes sub-plugin...');

  // ── Admin KPI routes ──────────────────────────────────────────────────────
  // Execution KPI aggregation for flow dashboard (Task #33).
  try {
    await fastify.register(adminKpisRoutes);
    loggers.routes.info('Admin KPI routes registered at /api/admin/flows/kpis');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin KPI routes');
  }

  // ── Tool-call audit log (append-only) ─────────────────────────────────────
  // GET /api/admin/audit-log — paged, filterable read of tool_call_audit_log.
  try {
    const { default: adminAuditLogRoutes } = await import('../routes/admin-audit-log.js');
    await fastify.register(adminAuditLogRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin audit-log route registered at /api/admin/audit-log');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit-log route');
  }

  loggers.routes.info('admin-audit routes sub-plugin registered successfully');
};

export const adminAuditRoutesPlugin = fp(adminAuditRoutesPluginImpl, {
  name: 'admin-audit-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
