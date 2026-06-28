/**
 * Workflow API Routes — thin registrar + public re-export barrel.
 *
 * The former 4 987-LOC monolith was decomposed (behaviour-preserving) into
 * per-domain sub-plugins under `routes/workflows/`. This file keeps the public
 * seam intact:
 *   - `workflowRoutes`           the Fastify plugin (registered at /api/workflows)
 *   - `autoSeedWorkflowTemplates` the startup seeder
 *   - `SEED_WORKFLOW_TEMPLATES`   the built-in template table
 *
 * The single `authMiddleware` preHandler hook is applied here on the parent
 * plugin instance and is inherited by every sub-plugin registered afterwards —
 * the sub-plugins therefore must NOT re-add it.
 *
 * Route surface (unchanged — every method + path is byte-identical to the
 * pre-split monolith):
 * - GET /api/workflows - List user's workflows
 * - POST /api/workflows - Create new workflow
 * - GET /api/workflows/templates - List public workflow templates
 * - POST /api/workflows/seed-templates - Seed built-in templates to DB
 * - GET /api/workflows/:id - Get workflow by ID
 * - PUT /api/workflows/:id - Update workflow
 * - DELETE /api/workflows/:id - Delete workflow (soft delete)
 * - POST /api/workflows/:id/execute - Execute workflow
 * - GET /api/workflows/:id/executions - Get workflow executions
 * - POST /api/workflows/:id/versions - Create new version
 * - GET /api/workflows/:id/versions - List versions
 * - PUT /api/workflows/:id/versions/:versionId/activate - Activate version
 * - POST /api/workflows/:id/duplicate - Duplicate a workflow
 * - GET /api/workflows/:id/snippets - Auto-generated API client code snippets
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { crudRoutes } from './workflows/crud.routes.js';
import { authoringRoutes } from './workflows/authoring.routes.js';
import { executionRoutes } from './workflows/execution.routes.js';
import { historyRoutes } from './workflows/history.routes.js';
import { versionsRoutes } from './workflows/versions.routes.js';
import { catalogRoutes } from './workflows/catalog.routes.js';
import { sharingRoutes } from './workflows/sharing.routes.js';
import { dataRoutes } from './workflows/data.routes.js';
import { seedTemplatesRoutes } from './workflows/seed-templates.js';

export const workflowRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Apply auth to all routes. Hooks added to this instance are inherited by
  // every plugin registered AFTER the hook, so each sub-plugin below is
  // auth-gated without re-adding the middleware.
  fastify.addHook('preHandler', authMiddleware);

  await fastify.register(crudRoutes);
  await fastify.register(authoringRoutes);
  await fastify.register(executionRoutes);
  await fastify.register(historyRoutes);
  await fastify.register(versionsRoutes);
  await fastify.register(catalogRoutes);
  await fastify.register(sharingRoutes);
  await fastify.register(dataRoutes);
  await fastify.register(seedTemplatesRoutes);

  logger.info('Workflow routes registered');
};

// ── Public seam — preserve every symbol other modules import from this path ──
export { autoSeedWorkflowTemplates, SEED_WORKFLOW_TEMPLATES } from './workflows/seed-templates.js';
export type { SeedTemplate } from './workflows/seed-templates.js';

export default workflowRoutes;
