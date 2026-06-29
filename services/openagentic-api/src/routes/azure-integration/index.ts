/**
 * Azure Integration Services Routes
 * 
 * Provides Azure authentication, user metrics, and real-time event streaming.
 * Uses real Prisma queries for user cost/usage data.
 * 
 * @see {@link https://docs.openagentic.io/api/azure-integration}
 */

import { FastifyPluginAsync } from 'fastify';
import { azureAdminRoutes } from './admin.js';
import { azureMetricsRoutes } from './metrics.js';
import { azureEventsRoutes } from './events.js';

export const azureIntegrationPlugin: FastifyPluginAsync = async (fastify) => {
  // Register Azure admin routes (resource info stub)
  await fastify.register(azureAdminRoutes, { prefix: '/admin/azure' });
  
  // Register Azure user metrics routes
  await fastify.register(azureMetricsRoutes, { prefix: '/azure' });
  
  // Register Azure real-time events (SSE)
  await fastify.register(azureEventsRoutes, { prefix: '/events' });
  
  fastify.log.info('Azure Integration Services routes registered - Real metrics, event stubs');
};