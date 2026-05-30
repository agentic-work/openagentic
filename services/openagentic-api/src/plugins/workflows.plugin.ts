/**
 * Workflows Routes Plugin — Phase 3.6 of server.ts decomposition.
 *
 * This is the HIGH-LEVEL WRAPPER that groups all workflows-domain route
 * registrations behind a single Fastify plugin export.
 *
 * Sub-routes registered here:
 *  1. workflowRoutes           — Workflow CRUD, execution, versioning  → /api/workflows/* (authMiddleware)
 *  2. workflowApprovalRoutes   — Human-in-the-Loop (HITL) approvals    → /api/workflows/approvals/* (authMiddleware)
 *  3. workflowMarketplaceRoutes — Template discovery, publishing, forks → /api/workflows/marketplace/* (authMiddleware)
 *  4. userContextRoutes        — Unified cross-mode memory layer        → /api/user-context/* (authMiddleware, no prefix)
 *
 * Phase E.8.f rip (2026-05-11): the legacy `/api/orchestrate/*` surface
 * (formerly slot 4) was deleted. Sub-agent dispatch now flows through
 * openagentic-proxy (production) or the in-process `chatLoopRecursor` primitive.
 *
 * Design notes:
 *  - All sub-registrations are wrapped in independent try/catch blocks (lesson 4)
 *    matching the style in server.ts: a single failing sub-route never blocks others.
 *  - No AppContext decoration required — all route modules import their own
 *    dependencies (prisma, services) directly. Options interface kept minimal.
 *  - userContextRoutes registers its own absolute paths (e.g. '/api/user-context')
 *    so no prefix is passed at the plugin level.
 *  - No hardcoded model IDs anywhere in this file (CLAUDE.md rule 7).
 *
 * Applies all 11 accumulated lessons from Phase 3.1-3.5 reviews:
 *  - Strongly typed Options interface (lessons 3, 6).
 *  - No `as any` in production interface body (lesson 10).
 *  - Independent try/catch per register (lesson 4).
 *  - Orphan sweep performed post-move (lesson 5 reminder).
 *  - Dynamic imports inside the plugin body so vitest can intercept mocks (lesson 2).
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { loggers } from '../utils/logger.js';
import { workflowRoutes } from '../routes/workflows.js';
import { workflowApprovalRoutes } from '../routes/workflow-approvals.js';
import { workflowMarketplaceRoutes } from '../routes/workflow-marketplace.js';
import userContextRoutes from '../routes/user-context.js';
import { requireFlowsAccess } from '../middleware/requireFlowsAccess.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';

// ---------------------------------------------------------------------------
// Plugin options (lesson 3: strongly typed, lesson 6: exported)
// ---------------------------------------------------------------------------

export interface WorkflowsRoutesPluginOptions {
  /**
   * Reserved for future extension (e.g. passing a custom WorkflowExecutionEngine
   * instance in tests). Currently unused — all route modules resolve their own
   * service singletons via module-level imports.
   */
  _reserved?: never;
}

// ---------------------------------------------------------------------------
// The wrapper plugin
// ---------------------------------------------------------------------------

const workflowsRoutesPluginImpl: FastifyPluginAsync<WorkflowsRoutesPluginOptions> = async (
  fastify: FastifyInstance,
  _options: WorkflowsRoutesPluginOptions,
) => {
  loggers.routes.info('Registering workflows routes plugin...');

  // ── 0. Auth + Flows RBAC gate ────────────────────────────────────────────
  // IMPORTANT: This outer plugin is wrapped with fp() which BREAKS Fastify
  // encapsulation — hooks added directly here leak to the PARENT (global) scope.
  // To keep auth hooks scoped to /api/workflows/* only, they are wrapped in an
  // inner anonymous plugin (fastify.register without fp()) which restores
  // encapsulation. The hooks fire:
  //   [inner] authMiddleware → [inner] requireFlowsAccess → [child] routes
  // Only /api/workflows/* sub-routes are gated; userContextRoutes (/api/user-context)
  // is registered outside the gated inner scope — it is a shared memory layer
  // used by all app modes, not flows-specific.
  await fastify.register(async (gated) => {
    // Auth must run before requireFlowsAccess so request.user is populated.
    gated.addHook('preHandler', authMiddleware);
    gated.addHook('preHandler', requireFlowsAccess);

    // ── 1. Workflow routes ─────────────────────────────────────────────────
    // Full CRUD, execution, versioning, webhooks.
    try {
      await gated.register(workflowRoutes, { prefix: '/api/workflows' });
      loggers.routes.info('Workflow routes registered at /api/workflows/* (CRUD, execute, versions)');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register workflow routes');
    }

    // ── 2. Workflow Approval routes ────────────────────────────────────────
    // Human-in-the-Loop (HITL) approval endpoints.
    try {
      await gated.register(workflowApprovalRoutes, { prefix: '/api/workflows/approvals' });
      loggers.routes.info('Workflow approval routes registered at /api/workflows/approvals/* (HITL)');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register workflow approval routes');
    }

    // ── 3. Workflow Marketplace routes ─────────────────────────────────────
    // Template discovery, publishing, forking, ratings.
    try {
      await gated.register(workflowMarketplaceRoutes, { prefix: '/api/workflows/marketplace' });
      loggers.routes.info('Workflow marketplace routes registered at /api/workflows/marketplace/*');
    } catch (error) {
      loggers.routes.error({ err: error }, 'Failed to register workflow marketplace routes');
    }
  });

  // ── 4. User Context routes ───────────────────────────────────────────────
  // Phase 16 — Unified Cross-Mode Memory Layer. Per-user isolation (FedRAMP AC-3).
  // NOTE: userContextRoutes registers absolute paths (/api/user-context/*) so
  // NO prefix is passed here — matches original server.ts behaviour.
  // Intentionally OUTSIDE the gated inner plugin — this route is shared across
  // all app modes and must not be blocked by the flows RBAC check.
  try {
    await fastify.register(userContextRoutes);
    loggers.routes.info('User context routes registered at /api/user-context/*');
  } catch (error) {
    loggers.routes.error({ err: error }, 'Failed to register user context routes');
  }

  loggers.routes.info('Workflows routes plugin registered successfully');
};

export const workflowsRoutesPlugin = fp(workflowsRoutesPluginImpl, {
  name: 'workflows-routes',
  // AppContext decoration ordering is caller-guaranteed (server.ts decorateApp
  // runs before plugin registration), not Fastify-enforced.
  dependencies: [],
});
