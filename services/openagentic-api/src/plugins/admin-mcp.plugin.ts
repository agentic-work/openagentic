/**
 * Admin MCP Routes Sub-Plugin — Phase 3.7 of server.ts decomposition.
 *
 * Registers all MCP-management admin routes:
 *  1. adminMCPInspectorRoutes — Secure access to MCP Inspector UI  → /api/admin (prefix)
 *  2. adminToolsRoutes        — Tool execution mode/kill-switch     → /api/admin (adminMiddleware)
 *  3. adminMCPAccessRoutes    — Group/MCP access control            → /api/admin/mcp (adminMiddleware)
 *  4. mcpManagementRoutes     — MCP server management               → /api/admin/mcp/*
 *
 * Design notes:
 *  - Items 2+3 share one try/catch in server.ts; split here for lesson 4.
 *  - adminToolsRoutes and adminMCPAccessRoutes are protected by adminMiddleware.
 *  - adminMCPInspectorRoutes and mcpManagementRoutes carry internal auth in their
 *    route files.
 *  - No hardcoded model literals (CLAUDE.md rule 7).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import adminMCPInspectorRoutes from '../routes/admin-mcp-inspector.js';
import adminToolsRoutes from '../routes/admin-tools.js';
import adminMCPAccessRoutes from '../routes/admin-mcp-access.js';
import mcpManagementRoutes from '../routes/admin/mcp-management.js';

export interface AdminMcpRoutesPluginOptions {
  _reserved?: never;
}

const adminMcpRoutesPluginImpl: FastifyPluginAsync<AdminMcpRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: AdminMcpRoutesPluginOptions,
) => {
  loggers.routes.info('Registering admin-mcp routes sub-plugin...');

  // ── 1. Admin MCP Inspector Proxy ─────────────────────────────────────────
  // Secure access to MCP Inspector UI. Internal auth handled in route file.
  try {
    await fastify.register(adminMCPInspectorRoutes, { prefix: '/api/admin' });
    loggers.routes.info('Admin MCP Inspector proxy routes registered at /api/admin/mcp-inspector');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP inspector routes');
  }

  // ── 2. Admin Tools routes (tool execution mode / read-only kill switch) ──
  // SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminToolsRoutes);
    }, { prefix: '/api/admin' });
    loggers.routes.info('Admin Tools routes registered at /api/admin/tools/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin tools routes');
  }

  // ── 3. Admin MCP Access Control routes ───────────────────────────────────
  // Manage which groups can access which MCPs. SECURITY: Protected by adminMiddleware.
  try {
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', adminMiddleware);
      await instance.register(adminMCPAccessRoutes);
    }, { prefix: '/api/admin/mcp' });
    loggers.routes.info('Admin MCP Access Control routes registered at /api/admin/mcp with admin middleware');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register admin MCP access control routes');
  }

  // ── 4. MCP Management routes ─────────────────────────────────────────────
  // MCP server management. Internal auth handled in route file.
  try {
    await fastify.register(mcpManagementRoutes);
    loggers.routes.info('MCP Management routes registered at /api/admin/mcp/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register MCP management routes');
  }

  loggers.routes.info('admin-mcp routes sub-plugin registered successfully');
};

export const adminMcpRoutesPlugin = fp(adminMcpRoutesPluginImpl, {
  name: 'admin-mcp-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
