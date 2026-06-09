/**
 * Cluster topology plugin — exposes live k8s deployment + pod inventory
 * for the docs "Deployed Services" page.
 *
 * Registered with prefix /api/cluster in server.ts registerAllRoutes()
 * (same encapsulated dynamic-import pattern as docs.plugin.ts).
 *
 * Routes:
 *   GET /services — list deployments/statefulsets + pod imageIDs (any auth user)
 *                   → served at GET /api/cluster/services
 *
 * No fastify-plugin wrapper — encapsulation lets the prefix apply cleanly
 * (same pattern as docs.plugin.ts).
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { clusterServicesHandler } from '../routes/cluster/services.handler.js';

const clusterPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  loggers.routes.info('Registering cluster topology plugin...');

  try {
    fastify.get('/services', { onRequest: authMiddleware }, clusterServicesHandler);
    loggers.routes.info('Cluster services route registered at /api/cluster/services');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register cluster.services route');
  }
};

export default clusterPlugin;
