/**
 * Legacy Redirects Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Handles backward compatibility redirects from legacy routes to v1 API.
 *
 * These redirects will be removed after 90 days per API_ROUTING_STANDARDIZATION.md
 *
 * Redirects:
 * - /mcp/* -> /api/v1/mcp/*
 * - /api/mcp/* -> /api/v1/mcp/*
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';

interface LegacyRedirectsPluginOptions {
  // No options needed currently
}

const legacyRedirectsPlugin: FastifyPluginAsync<LegacyRedirectsPluginOptions> = async (
  fastify: FastifyInstance,
  _options: LegacyRedirectsPluginOptions
) => {
  loggers.routes.info('Registering legacy redirect routes plugin...');

  // ============================================================================
  // MCP BACKWARD COMPATIBILITY REDIRECTS
  // ============================================================================
  // These redirect legacy routes to the new v1 endpoints.
  // Will be removed after 90 days (see API_ROUTING_STANDARDIZATION.md)

  // Redirect /mcp/* to /api/v1/mcp/*
  fastify.get('/mcp/servers', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/servers');
  });

  // SDK compatibility: /api/mcp/* redirects to /api/v1/mcp/*
  fastify.get('/api/mcp/servers', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/servers');
  });

  fastify.get('/mcp/tools', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/tools');
  });

  fastify.get('/mcp/health', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/health');
  });

  fastify.get('/mcp/stats', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/stats');
  });

  fastify.get('/mcp/status', async (request, reply) => {
    return reply.redirect('/api/v1/mcp/status');
  });

  loggers.routes.info('Legacy /mcp/* redirects configured -> /api/v1/mcp/*');
  loggers.routes.info('Legacy redirect routes plugin registered successfully');
};

export default fp(legacyRedirectsPlugin, {
  name: 'legacy-redirects',
  dependencies: []
});
