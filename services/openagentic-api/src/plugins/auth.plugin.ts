/**
 * Authentication Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all authentication-related route registrations into a single Fastify plugin.
 *
 * Includes:
 * - Inter-service token verification routes (/api/auth/verify, /validate-token)
 * - Local username/password auth routes (/api/auth/local/*)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { authRoutes } from '../routes/auth.js';

interface AuthPluginOptions {
  authProvider?: string;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  _options: AuthPluginOptions
) => {
  loggers.routes.info('Registering authentication routes plugin...');

  // Register Auth routes (inter-service verify/validate-token + profile)
  try {
    await fastify.register(authRoutes);
    loggers.routes.info('Auth routes registered at /api/auth/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth routes');
  }

  // Register Local Authentication System — the OSS edition is local-auth-only,
  // so username/password login at /api/auth/local/* is ALWAYS registered.
  try {
    const { localAuthRoutes } = await import('../routes/local-auth.js');
    await fastify.register(localAuthRoutes, { prefix: '/api/auth/local' });
    loggers.routes.info('Local authentication system registered at /api/auth/local/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register local auth system');
  }

  loggers.routes.info('Authentication routes plugin registered successfully');
};

export default fp(authPlugin, {
  name: 'auth-routes',
  dependencies: []
});
