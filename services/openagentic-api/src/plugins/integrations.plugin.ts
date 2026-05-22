/**
 * Integrations Routes Plugin — Phase 3.2 of server.ts decomposition.
 *
 * Groups all integrations-domain route registrations behind a single Fastify
 * plugin export.  Three sub-routes are registered here:
 *
 *  1. azureADSyncRoutes      — Azure AD user sync to local DB (no prefix needed;
 *                               routes internally use /api/auth/azure/*)
 *  2. accountLinkingRoutes   — local ↔ Azure AD account linking (no prefix
 *                               needed; routes internally use absolute paths)
 *  3. azureIntegrationPlugin — Azure auth, metrics, admin, events
 *                               → prefix: /api/azure
 *
 * Each sub-registration is wrapped in an INDEPENDENT try/catch block so a
 * partial mount failure logs accurately instead of masking the others (Phase
 * 3.1 lesson #4: split into independent try/catch per mount).
 *
 * No constructor-time deps are required by any of the three routes — they each
 * pull Prisma, AzureOBOService, etc. via module-level singletons.  The
 * IntegrationsRoutesPluginOptions interface is therefore empty but exported (per
 * Phase 3.1 lesson #6) so callers can pass future overrides without a breaking
 * change.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { azureADSyncRoutes } from '../routes/azure-ad-sync.js';
import { accountLinkingRoutes } from '../routes/account-linking.js';
import { azureIntegrationPlugin } from '../routes/azure-integration/index.js';

/**
 * Options for the integrations routes plugin.
 *
 * Currently empty: all three sub-routes obtain their deps (Prisma, OBO service,
 * env vars) via module-level singletons, so no constructor injection is needed.
 * Exported for caller extensibility without a breaking API change.
 */
export interface IntegrationsRoutesPluginOptions {
  // Reserved for future dep overrides (e.g. stubbed Prisma in integration tests).
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const integrationsRoutesPluginImpl: FastifyPluginAsync<IntegrationsRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: IntegrationsRoutesPluginOptions,
) => {
  loggers.routes.info('Registering integrations routes plugin...');

  // ── 1. Azure AD Sync routes ──────────────────────────────────────────────
  // Registers at /api/auth/azure/sync and /api/auth/azure/user/:oid.
  // No prefix passed — the route module defines absolute paths internally.
  try {
    await fastify.register(azureADSyncRoutes);
    loggers.routes.info('Azure AD sync routes registered at /api/auth/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure AD sync routes');
  }

  // ── 2. Account Linking routes ────────────────────────────────────────────
  // Registers at /link-accounts, /linked-status/:userId, /unlink/:userId,
  // /accounts/linked-azure, /accounts/unlink-azure.
  // No prefix passed — the route module defines absolute paths internally.
  try {
    await fastify.register(accountLinkingRoutes);
    loggers.routes.info('Account linking routes registered at /api/accounts/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register account linking routes');
  }

  // ── 3. Azure Integration Services routes ────────────────────────────────
  // Registers Azure auth, metrics, admin, and SSE event sub-plugins under
  // the /api/azure prefix.
  try {
    await fastify.register(azureIntegrationPlugin, { prefix: '/api/azure' });
    loggers.routes.info('Azure Integration Services routes registered at /api/azure/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register Azure integration routes');
  }

  loggers.routes.info('Integrations routes plugin registered successfully');
};

export const integrationsRoutesPlugin = fp(integrationsRoutesPluginImpl, {
  name: 'integrations-routes',
  // AppContext decoration ordering is guaranteed by caller (server.ts decorateApp
  // runs before plugin registration), not by this field.
  dependencies: [],
});
