/**
 * First-run Setup Plugin
 *
 * Hosts the three unauthenticated /api/setup/* endpoints used by the
 * in-UI Setup wizard. Lives in its own plugin (not auth.plugin.ts) so
 * the auth plugin can stay focused on real auth flows and so the SSO
 * skip-list there doesn't accidentally hide /api/setup from a stack
 * that's still uninitialized.
 */
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { setupRoutes } from '../routes/setup.js';

const setupPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  try {
    await fastify.register(setupRoutes, { prefix: '/api/setup' });
    loggers.routes.info('Setup wizard routes registered at /api/setup/*');
  } catch (err) {
    loggers.routes.error({ err }, 'Failed to register /api/setup routes');
  }
};

export default fp(setupPlugin, { name: 'setup-routes', dependencies: [] });
