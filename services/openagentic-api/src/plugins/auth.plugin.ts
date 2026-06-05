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
import { authSsoRoutes } from '../routes/auth-sso.js';
import { prisma } from '../utils/prisma.js';

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

  // Register the runtime SSO directory routes — public /api/auth/directories +
  // per-directory /api/auth/sso/:id/login|callback + legacy /microsoft|/google
  // aliases. These are DB-driven (one button per enabled identity_directories
  // row) and are registered UNCONDITIONALLY: with zero rows the directory list
  // is simply empty, so there is no attack surface and no need to gate.
  try {
    await fastify.register(authSsoRoutes);
    loggers.routes.info('SSO directory routes registered at /api/auth/directories + /api/auth/sso/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register SSO directory routes');
  }

  // Register Local Authentication System — SKIPPED when SSO is active.
  //
  // SSO is now DB-driven: `ssoActive` is true when ANY enabled, non-deleted
  // `identity_directories` row exists. Adding a directory live therefore
  // suppresses the /api/auth/local/* password-login surface WITHOUT an API
  // restart (the env AUTH_MODE/AUTH_PROVIDER is consulted ONLY as the first-boot
  // fallback when zero rows exist). When SSO is active, the username/password
  // login routes are intentionally NOT registered — no password-based login
  // surface exists for an attacker to probe. To force local login for a pure
  // local dev setup, set AUTH_MODE=local AND keep zero enabled directories.
  let directoryCount = 0;
  try {
    directoryCount = await prisma.identityDirectory.count({
      where: { enabled: true, deleted_at: null },
    });
  } catch (error) {
    // DB unreachable at registration time → fall back to env (first-boot safe).
    loggers.routes.warn(
      { err: error },
      'identityDirectory.count failed — falling back to AUTH_MODE/AUTH_PROVIDER env for ssoActive',
    );
  }
  const ssoActive =
    directoryCount > 0 ||
    ['azure-ad', 'azuread', 'google', 'hybrid', 'both', 'all'].includes(
      (process.env.AUTH_MODE || featureFlags.authProvider).toLowerCase(),
    );
  if (ssoActive) {
    loggers.routes.info(
      {
        directoryCount,
        source: directoryCount > 0 ? 'database' : 'env-fallback',
        authMode: process.env.AUTH_MODE,
        authProvider: process.env.AUTH_PROVIDER,
      },
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
