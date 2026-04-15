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

  loggers.routes.info('📌 Legacy /mcp/* redirects configured -> /api/v1/mcp/*');
  loggers.routes.info('✅ Legacy redirect routes plugin registered successfully');
};

export default fp(legacyRedirectsPlugin, {
  name: 'legacy-redirects',
  dependencies: []
});
