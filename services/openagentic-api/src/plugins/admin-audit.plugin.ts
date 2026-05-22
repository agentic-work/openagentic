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
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import adminAuditRoutes from '../routes/admin-audit.js';
import adminAuditLogsRoutes from '../routes/admin-audit-logs.js';
import adminCredentialAuditRoutes from '../routes/admin-credential-audit.js';
import adminDashboardMetricsRoutes from '../routes/admin-dashboard-metrics.js';
import adminFlowAuditRoutes from '../routes/admin-flow-audit.js';
import adminKpisRoutes from '../routes/admin-kpis.js';

export interface AdminAuditRoutesPluginOptions {
  _reserved?: never;
}

const adminAuditRoutesPluginImpl: FastifyPluginAsync<AdminAuditRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: AdminAuditRoutesPluginOptions,
) => {
  loggers.routes.info('Registering admin-audit routes sub-plugin...');

  // ── 1. Admin Audit routes ────────────────────────────────────────────────
  // Comprehensive user activity monitoring. Internal auth controlled by route file.
  try {
    await fastify.register(adminAuditRoutes);
    loggers.routes.info('Admin Audit routes registered at /api/admin/audit/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit routes');
  }

  // ── 2. Admin Audit Logs routes ───────────────────────────────────────────
  // Session logs, stats, export — SOC2 compliance. Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminAuditLogsRoutes);
    });
    loggers.routes.info('Admin Audit Logs routes registered at /api/admin/audit-logs/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin audit logs routes');
  }

  // ── 3. Admin Credential Audit routes ────────────────────────────────────
  // Bolt 03 — credential change audit trail. Internal auth in route file.
  try {
    await fastify.register(adminCredentialAuditRoutes);
    loggers.routes.info('Admin Credential Audit routes registered at /api/admin/audit/credentials/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin credential audit routes');
  }

  // ── 4. Admin Dashboard Metrics routes ───────────────────────────────────
  // Grafana-style time-series metrics. Internal auth in route file.
  try {
    await fastify.register(adminDashboardMetricsRoutes);
    loggers.routes.info('Admin Dashboard Metrics routes registered at /api/admin/dashboard/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin dashboard metrics routes');
  }

  // ── 5. Flow Audit Log routes ─────────────────────────────────────────────
  // SOC 2 CC6/CC7 append-only governance event trail (Tasks #32+#33).
  try {
    await fastify.register(adminFlowAuditRoutes);
    loggers.routes.info('Admin Flow Audit routes registered at /api/admin/flows/audit-logs');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin flow audit routes');
  }

  // ── 6. Admin KPI routes ───────────────────────────────────────────────────
  // Execution KPI aggregation for flow dashboard (Task #33).
  try {
    await fastify.register(adminKpisRoutes);
    loggers.routes.info('Admin KPI routes registered at /api/admin/flows/kpis');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin KPI routes');
  }

  loggers.routes.info('admin-audit routes sub-plugin registered successfully');
};

export const adminAuditRoutesPlugin = fp(adminAuditRoutesPluginImpl, {
  name: 'admin-audit-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
