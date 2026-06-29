/**
 * Workflow CRUD routes.
 *
 *   GET    /internal/node-schemas
 *   GET    /
 *   POST   /
 *   GET    /:id
 *   GET    /:id/as-tool-schema
 *   GET    /agent-tools
 *   PUT    /:id
 *   DELETE /:id
 *   POST   /recompute-tags
 *
 * Registered as a sub-plugin of workflowRoutes; the parent applies
 * authMiddleware via a preHandler hook, so this plugin must NOT re-add it.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { deriveFlowToolSchema } from '@openagentic/workflow-engine';
import { getNodeSchemasProxyService } from '../../services/NodeSchemasProxyService.js';
import {
  asJson,
  computeAutoTags,
  getReqUser,
  transformWorkflow,
} from './shared.js';
import type {
  CreateWorkflowRequest,
  FlowDefinition,
  ListWorkflowsQuery,
  UpdateWorkflowRequest,
  WorkflowIdParams,
} from './types.js';

export const crudRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/workflows/internal/node-schemas
   *
   * Proxy to the openagentic-workflows service GET /node-schemas endpoint.
   * Returns the schema-driven node registry: { schemas, aiPromptFragment }.
   * Response is cached in-memory for 60 s (registry is static at boot).
   * Falls back to { schemas: [], aiPromptFragment: '' } when the workflows
   * service is unreachable or WORKFLOW_SERVICE_URL is unset.
   *
   * Auth: any logged-in user (auth guard applied via preHandler hook above).
   */
  fastify.get('/internal/node-schemas', async (request, reply) => {
    try {
      const svc = getNodeSchemasProxyService();
      const payload = await svc.getNodeSchemas();
      return reply.send(payload);
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({ error: error.message }, '[Workflows] /internal/node-schemas handler threw unexpectedly');
      return reply.code(500).send({ error: 'Failed to fetch node schemas', message: error.message });
    }
  });

  /**
   * GET /api/workflows
   * List user's workflows
   */
  fastify.get<{ Querystring: ListWorkflowsQuery }>(
    '/',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { limit = 50, offset = 0, category, tags, is_active, is_template, search } = request.query;

        // User-isolated workspace: each user sees ONLY their own flows.
        // Shared/team flows will be added later via explicit sharing UI.
        const where: Prisma.WorkflowWhereInput = {
          deleted_at: null,
          created_by: userId,
        };

        if (category) where.category = category;
        // Query params may come as strings from URL — coerce to boolean for Prisma
        if (is_active !== undefined) where.is_active = String(is_active) === 'true';
        if (is_template !== undefined) where.is_template = String(is_template) === 'true';
        if (tags) {
          where.tags = { hasSome: tags.split(',') };
        }
        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ];
        }

        const [dbWorkflows, total] = await Promise.all([
          prisma.workflow.findMany({
            where,
            orderBy: { updated_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              name: true,
              description: true,
              definition: true,
              settings: true,
              is_active: true,
              is_template: true,
              is_public: true,
              tags: true,
              category: true,
              icon: true,
              color: true,
              total_executions: true,
              successful_executions: true,
              failed_executions: true,
              created_by: true,
              created_at: true,
              updated_at: true
            }
          }),
          prisma.workflow.count({ where })
        ]);

        // Transform to match UI expected format
        const workflows = dbWorkflows.map(transformWorkflow);

        return reply.send({
          workflows,
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error) {
        // If table doesn't exist (P2021), return empty list instead of 500
        if (error.code === 'P2021' || error.code === 'P2010' || error.message?.includes('does not exist')) {
          logger.warn({ error: error.code }, '[Workflows] Tables not yet created, returning empty list. Run: prisma db push');
          return reply.send({ workflows: [], total: 0, limit: 50, offset: 0 });
        }
        logger.error({ error }, '[Workflows] Failed to list workflows');
        return reply.code(500).send({
          error: 'Failed to list workflows',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows
   * Create new workflow
   */
  fastify.post<{ Body: CreateWorkflowRequest }>(
    '/',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const {
          name,
          description,
          definition,
          triggers = [],
          settings = {},
          variables = {},
          tags = [],
          category,
          icon,
          color,
          is_template = false,
          is_public = false,
          group_id
        } = request.body;

        if (!name || !definition) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'name and definition are required'
          });
        }

        // Merge user-supplied tags with auto-derived tags
        const autoTags = computeAutoTags(definition);
        const mergedTags = [...new Set([...(tags || []), ...autoTags])];

        // SEV-0 Flows-fix-A1: persist tenant_id on creation so the execute
        // path's defense-in-depth fallback (request.tenantId → row tenant_id)
        // actually has a row tenant to fall back to. Pre-fix every Workflow
        // row had tenant_id:null, which made the fallback chain dead-end at
        // null and shipped tenantId:null to workflows-svc.
        const creatorTenantId = request.tenantId
          ?? user?.tenantId
          ?? null;

        const workflow = await prisma.workflow.create({
          data: {
            name,
            description,
            definition: asJson(definition),
            triggers: asJson(triggers),
            settings: asJson(settings),
            variables: asJson(variables),
            tags: mergedTags,
            category,
            icon,
            color,
            is_template,
            is_public,
            created_by: userId,
            group_id,
            tenant_id: creatorTenantId,
          }
        });

        // Create initial version
        await prisma.workflowVersion.create({
          data: {
            workflow_id: workflow.id,
            version: 1,
            definition: asJson(definition),
            triggers: asJson(triggers),
            settings: asJson(settings),
            changelog: 'Initial version',
            is_active: true,
            created_by: userId
          }
        });

        logger.info({ workflowId: workflow.id, name }, '[Workflows] Workflow created');

        return reply.code(201).send({
          success: true,
          workflow: transformWorkflow(workflow)
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to create workflow');
        return reply.code(500).send({
          error: 'Failed to create workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id
   * Get workflow by ID
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },        // Allow reading public workflows/templates
              { is_template: true },       // Allow reading templates
            ],
          },
          include: {
            creator: {
              select: { id: true, email: true, name: true }
            },
            group: {
              select: { id: true, name: true, display_name: true }
            },
            versions: {
              orderBy: { version: 'desc' },
              take: 5,
              select: {
                id: true,
                version: true,
                is_active: true,
                changelog: true,
                created_at: true
              }
            }
          }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found`
          });
        }

        return reply.send({ workflow: transformWorkflow(workflow) });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to get workflow');
        return reply.code(500).send({
          error: 'Failed to get workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id/as-tool-schema
   * V1.1 flow_tool: project a saved Workflow into the agent-tool catalog
   * shape `{ flowId, name, description, input_schema }`. Used by openagentic-proxy
   * to inject the user's saved flows as dynamic tools per turn.
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/as-tool-schema',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              { is_template: true },
            ],
          },
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found`,
          });
        }

        const schema = deriveFlowToolSchema({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          definition: workflow.definition,
          settings: workflow.settings as Record<string, unknown> | null | undefined,
        });

        return reply.send({ tool: schema });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to derive tool schema');
        return reply.code(500).send({
          error: 'Failed to derive tool schema',
          message: error.message,
        });
      }
    },
  );

  /**
   * GET /api/workflows/agent-tools
   * V1.1 flow_tool: return every workflow the caller owns that is tagged
   * `agent-tool`, projected into the agent-tool catalog shape. Bulk endpoint
   * so openagentic-proxy can populate its per-turn tools[] in one round-trip.
   */
  fastify.get(
    '/agent-tools',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        const workflows = await prisma.workflow.findMany({
          where: {
            created_by: userId,
            deleted_at: null,
            is_active: true,
            tags: { has: 'agent-tool' },
          },
          orderBy: { updated_at: 'desc' },
          take: 50,
        });

        const tools = workflows.map((wf) =>
          deriveFlowToolSchema({
            id: wf.id,
            name: wf.name,
            description: wf.description,
            definition: wf.definition,
            settings: wf.settings as Record<string, unknown> | null | undefined,
          }),
        );

        return reply.send({ tools });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list agent-tools');
        return reply.code(500).send({
          error: 'Failed to list agent-tools',
          message: error.message,
        });
      }
    },
  );

  /**
   * PUT /api/workflows/:id
   * Update workflow
   */
  fastify.put<{ Params: WorkflowIdParams; Body: UpdateWorkflowRequest }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const updates = request.body;

        // Check ownership
        const existing = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Handle visibility shorthand
        const { visibility, ...rawUpdates } = updates;
        const data: Record<string, unknown> = { ...rawUpdates };

        // Recompute auto-tags when definition changes
        if (data.definition) {
          const autoTags = computeAutoTags(data.definition as FlowDefinition);
          const userTags = (data.tags as string[]) || [];
          data.tags = [...new Set([...userTags, ...autoTags])];
        }

        if (visibility === 'private') {
          data.is_public = false;
          data.group_id = null;
        } else if (visibility === 'team' && updates.group_id) {
          data.is_public = false;
          data.group_id = updates.group_id;
        } else if (visibility === 'public') {
          data.is_public = true;
          data.group_id = null;
        }

        const workflow = await prisma.workflow.update({
          where: { id },
          data: data as unknown as Prisma.WorkflowUpdateInput,
        });

        // Create version snapshot on save — deactivate prior versions, insert new active one
        try {
          const definition = data.definition || existing.definition;
          const settings = data.settings || existing.settings || {};
          const changelog = (updates as { changelog?: string }).changelog || 'Auto-saved';

          // Deactivate all existing versions for this workflow
          await prisma.workflowVersion.updateMany({
            where: { workflow_id: id },
            data: { is_active: false }
          });

          const versionCount = await prisma.workflowVersion.count({ where: { workflow_id: id } });
          const nextVersion = versionCount + 1;

          await prisma.workflowVersion.create({
            data: {
              workflow_id: id,
              version: nextVersion,
              definition: asJson(definition),
              triggers: asJson([]),
              settings: asJson(settings),
              changelog,
              is_active: true,
              created_by: userId
            }
          });
          logger.debug({ workflowId: id, version: nextVersion }, '[Workflows] Version snapshot created');
        } catch (err) {
          // Version creation is non-critical — log but don't fail the save
          logger.warn({ err, workflowId: id }, '[Workflows] Failed to create version snapshot');
        }

        logger.info({ workflowId: id }, '[Workflows] Workflow updated');

        return reply.send({
          success: true,
          workflow: transformWorkflow(workflow)
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to update workflow');
        return reply.code(500).send({
          error: 'Failed to update workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * DELETE /api/workflows/:id
   * Soft delete workflow
   */
  fastify.delete<{ Params: WorkflowIdParams }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Check ownership
        const existing = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!existing) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Soft delete
        await prisma.workflow.update({
          where: { id },
          data: { deleted_at: new Date(), is_active: false }
        });

        logger.info({ workflowId: id }, '[Workflows] Workflow deleted');

        return reply.send({
          success: true,
          message: `Workflow '${id}' deleted`
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to delete workflow');
        return reply.code(500).send({
          error: 'Failed to delete workflow',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/recompute-tags
   * Recompute auto-tags for all existing workflows (admin utility)
   */
  fastify.post(
    '/recompute-tags',
    async (request, reply) => {
      try {
        const workflows = await prisma.workflow.findMany({
          where: { deleted_at: null },
          select: { id: true, definition: true, tags: true }
        });

        let updated = 0;
        for (const wf of workflows) {
          const def: FlowDefinition = (wf.definition as FlowDefinition | null) || {};
          const autoTags = computeAutoTags(def);
          const existingTags = (wf.tags as string[]) || [];
          const merged = [...new Set([...existingTags, ...autoTags])];

          if (merged.length !== existingTags.length || merged.some(t => !existingTags.includes(t))) {
            await prisma.workflow.update({
              where: { id: wf.id },
              data: { tags: merged }
            });
            updated++;
          }
        }

        logger.info({ total: workflows.length, updated }, '[Workflows] Recomputed tags');
        return reply.send({ success: true, total: workflows.length, updated });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to recompute tags');
        return reply.code(500).send({ error: 'Failed to recompute tags', message: error.message });
      }
    }
  );
};

export default crudRoutes;
