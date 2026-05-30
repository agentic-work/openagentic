/**
 * Admin Observability Routes Sub-Plugin — Phase 3.7 of server.ts decomposition.
 *
 * Registers all observability/monitoring admin routes:
 *  1.  adminAnalyticsRoutes      — Per-user cost & model usage      → /api/admin/analytics/* (adminMiddleware)
 *  2.  adminRolesRoutes          — RBAC role management             → /api/admin/roles/* (adminMiddleware)
 *  3.  adminMessagesRoutes       — Admin message management         → /api/admin/messages/* (adminMiddleware)
 *  4.  adminMetricsRoutes        — Prometheus/Redis/Milvus metrics  → /api/admin/metrics/* (adminMiddleware)
 *  5.  adminAIFMetricsRoutes     — Azure AI Foundry metrics         → /api/admin (adminMiddleware)
 *  6.  grafanaProxyRoutes        — Grafana dashboard proxy          → /api/admin
 *  7.  pipelineLogRoutes         — Pipeline log viewer              → /api/admin
 *  8.  pipelineControlRoutes     — Pipeline enable/disable          → /api/admin/pipeline (adminMiddleware)
 *  9.  pipelineStatusRoutes      — Pipeline summary/history         → /api/admin (adminMiddleware)
 *  10. monitoringWebSocketRoutes — Real-time monitoring WS          → /api/monitoring
 *
 * Design notes:
 *  - Each sub-registration is wrapped in an independent try/catch (lesson 4).
 *  - No hardcoded model literals (CLAUDE.md rule 7).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import adminAnalyticsRoutes from '../routes/admin-analytics.js';
import adminRolesRoutes from '../routes/admin-roles.js';
import adminMessagesRoutes from '../routes/admin-messages.js';
import adminAIFMetricsRoutes from '../routes/admin-aif-metrics.js';
import { grafanaProxyRoutes } from '../routes/admin/grafana-proxy.js';
import { promProxyRoutes } from '../routes/admin/prom-proxy.js';
import { pipelineLogRoutes } from '../routes/admin/pipeline-log.js';
import pipelineControlRoutes from '../routes/admin/pipeline-control.js';
import pipelineStatusRoutes from '../routes/admin/pipeline.js';
import { monitoringWebSocketRoutes } from '../routes/monitoring-websocket.js';

export interface AdminObservabilityRoutesPluginOptions {
  _reserved?: never;
}

const adminObservabilityRoutesPluginImpl: FastifyPluginAsync<AdminObservabilityRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: AdminObservabilityRoutesPluginOptions,
) => {
  loggers.routes.info('Registering admin-observability routes sub-plugin...');

  // ── 1. Admin Analytics routes ────────────────────────────────────────────
  // Per-user cost & model usage analytics. SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware); // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAnalyticsRoutes);
    }, { prefix: '/api/admin/analytics' });
    loggers.routes.info('Admin Analytics routes registered at /api/admin/analytics/* (per-user cost & model usage) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin analytics routes');
  }

  // ── 2. Admin Roles routes (RBAC) ─────────────────────────────────────────
  // SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminRolesRoutes);
    }, { prefix: '/api/admin/roles' });
    loggers.routes.info('Admin Roles routes registered at /api/admin/roles/* (RBAC) with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin roles routes');
  }

  // ── 3. Admin Messages routes ─────────────────────────────────────────────
  // SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMessagesRoutes);
    }, { prefix: '/api/admin/messages' });
    loggers.routes.info('Admin Messages routes registered at /api/admin/messages/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin messages routes');
  }

  // ── 4. Admin Azure AI Foundry Metrics routes ──────────────────────────────
  // SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware); // SECURITY: Use adminMiddleware for admin routes
      await instance.register(adminAIFMetricsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Azure AI Foundry Metrics routes registered at /api/admin/aif-metrics/* with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin AIF metrics routes');
  }

  // ── 6. Grafana Proxy routes ───────────────────────────────────────────────
  // Admin-only access to Grafana dashboards. Internal auth in route file.
  try {
    await fastify.register(grafanaProxyRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Grafana proxy routes registered at /api/admin/grafana/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Grafana proxy routes');
  }

  // ── 6b. Prometheus Proxy routes (admin-v2 Control Plane) ──────────────────
  // Admin-only PromQL proxy to the monitoring-stack Prometheus. Internal auth
  // in route file. Configurable via PROMETHEUS_HOST / PROMETHEUS_PORT.
  try {
    await fastify.register(promProxyRoutes, { prefix: '/api/admin/prom' });
    loggers.routes.info('Prometheus proxy routes registered at /api/admin/prom/* (query, query_range, labels)');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Prometheus proxy routes');
  }

  // ── 7. Pipeline Log routes ────────────────────────────────────────────────
  // Admin observability — pipeline log viewer. Internal auth in route file.
  try {
    await fastify.register(pipelineLogRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Pipeline Log routes registered at /api/admin/pipeline-log/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline log routes');
  }

  // ── 8. Pipeline Control routes ────────────────────────────────────────────
  // SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware); // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineControlRoutes);
    }, { prefix: '/api/admin/pipeline' });
    loggers.routes.info('Pipeline control routes registered at /api/admin/pipeline with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline control routes');
  }

  // ── 9. Pipeline Status (Summary) routes ──────────────────────────────────
  // Legacy endpoints for compatibility. SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware); // SECURITY: Use adminMiddleware for admin routes
      await instance.register(pipelineStatusRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Pipeline summary routes registered at /api/admin/pipeline/summary and /api/admin/pipeline/history with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register pipeline summary routes');
  }

  // ── 10. Monitoring WebSocket routes ──────────────────────────────────────
  // Real-time monitoring for UI admin panel. Auth handled in route file.
  try {
    await fastify.register(monitoringWebSocketRoutes, { prefix: '/api/monitoring' });
    loggers.routes.info('Monitoring WebSocket routes registered at /api/monitoring/ws');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register monitoring WebSocket routes');
  }

  loggers.routes.info('admin-observability routes sub-plugin registered successfully');
};

export const adminObservabilityRoutesPlugin = fp(adminObservabilityRoutesPluginImpl, {
  name: 'admin-observability-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
