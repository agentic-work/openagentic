/**
 * Authentication Routes Plugin
 *
 * Modularized from server.ts (HIGH-001 refactoring)
 * Groups all authentication-related route registrations into a single Fastify plugin.
 *
 * Includes:
 * - Azure AD auth routes
 * - Local auth routes
 * - OBO (On-Behalf-Of) routes
 * - Google OAuth routes (conditional)
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { featureFlags } from '../config/featureFlags.js';
import { authRoutes } from '../routes/auth.js';
import { oboRoutes } from '../routes/obo.js';

interface AuthPluginOptions {
  authProvider?: string;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  options: AuthPluginOptions
) => {
  const authProvider = options.authProvider || featureFlags.authProvider;

  loggers.routes.info('Registering authentication routes plugin...');

  // Register Auth routes (Azure AD)
  try {
    await fastify.register(authRoutes);
    loggers.routes.info('Auth routes registered at /api/auth/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register auth routes');
  }

  // Register Local Authentication System — SKIPPED when SSO-only.
  //
  // When AUTH_MODE / AUTH_PROVIDER is any non-local SSO (azure-ad,
  // google, hybrid, both, all), the username/password login routes at
  // /api/auth/local/* are intentionally NOT registered. No password-based
  // login surface exists for an attacker to probe — even if someone had
  // leaked the seeded admin password, there's no endpoint accepting it.
  // To re-enable for a pure local dev setup, set AUTH_MODE=local.
  const ssoActive = ['azure-ad', 'azuread', 'google', 'hybrid', 'both', 'all'].includes(
    (process.env.AUTH_MODE || featureFlags.authProvider).toLowerCase(),
  );
  if (ssoActive) {
    loggers.routes.info(
      { authMode: process.env.AUTH_MODE, authProvider: process.env.AUTH_PROVIDER },
      'SSO active — SKIPPING local /api/auth/local/* route registration (password-login attack surface removed)',
    );
  } else {
    try {
      const { localAuthRoutes } = await import('../routes/local-auth.js');
      await fastify.register(localAuthRoutes, { prefix: '/api/auth/local' });
      loggers.routes.info('Local authentication system registered at /api/auth/local/*');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register local auth system');
    }
  }

  // Register OBO routes
  try {
    await fastify.register(oboRoutes);
    loggers.routes.info('OBO routes registered at /api/auth/obo/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register OBO routes');
  }

  // Register Google OAuth routes (conditionally based on AUTH_PROVIDER)
  if (['google', 'hybrid', 'both', 'all'].includes(authProvider)) {
    try {
      const { googleAuthRoutes } = await import('../routes/google-auth/index.js');
      await fastify.register(googleAuthRoutes, { prefix: '/api/auth/google' });
      loggers.routes.info(`Google OAuth routes registered at /api/auth/google/* (AUTH_PROVIDER=${authProvider})`);
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register Google OAuth routes');
    }
  } else {
    loggers.routes.info(`Google OAuth routes skipped (AUTH_PROVIDER=${authProvider})`);
  }

  loggers.routes.info('Authentication routes plugin registered successfully');
};

export default fp(authPlugin, {
  name: 'auth-routes',
  dependencies: []
});
