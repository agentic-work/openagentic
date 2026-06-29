/**
 * Workflow version + duplicate routes.
 *
 *   POST /:id/versions
 *   GET  /:id/versions
 *   PUT  /:id/versions/:versionId/activate
 *   POST /:id/versions/:versionId/restore
 *   POST /:id/duplicate
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { asJson, getReqUser, transformWorkflow } from './shared.js';
import type { CreateVersionRequest, VersionIdParams, WorkflowIdParams } from './types.js';

export const versionsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * POST /api/workflows/:id/versions
   * Create new version
   */
  fastify.post<{ Params: WorkflowIdParams; Body: CreateVersionRequest }>(
    '/:id/versions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { changelog, activate = false } = request.body;

        // Get workflow and latest version
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null },
          include: {
            versions: {
              orderBy: { version: 'desc' },
              take: 1
            }
          }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        const latestVersion = workflow.versions[0];
        const newVersionNum = latestVersion ? latestVersion.version + 1 : 1;

        // If activating, deactivate all other versions
        if (activate) {
          await prisma.workflowVersion.updateMany({
            where: { workflow_id: id },
            data: { is_active: false }
          });
        }

        const version = await prisma.workflowVersion.create({
          data: {
            workflow_id: id,
            version: newVersionNum,
            definition: workflow.definition,
            triggers: workflow.triggers,
            settings: workflow.settings,
            changelog,
            is_active: activate,
            created_by: userId
          }
        });

        logger.info({
          workflowId: id,
          version: newVersionNum,
          activated: activate
        }, '[Workflows] Version created');

        return reply.code(201).send({
          success: true,
          version
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to create version');
        return reply.code(500).send({
          error: 'Failed to create version',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id/versions
   * List versions
   */
  fastify.get<{ Params: WorkflowIdParams }>(
    '/:id/versions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Verify user has access to this workflow
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        const workflow = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              ...(userGroupIds.length > 0 ? [{ group_id: { in: userGroupIds } }] : []),
            ],
          },
          select: { id: true },
        });
        if (!workflow) {
          return reply.code(404).send({ error: 'Not found', message: 'Workflow not found or access denied' });
        }

        const versions = await prisma.workflowVersion.findMany({
          where: { workflow_id: id },
          orderBy: { version: 'desc' },
          include: {
            creator: {
              select: { id: true, email: true, name: true }
            }
          }
        });

        return reply.send({
          versions,
          total: versions.length
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list versions');
        return reply.code(500).send({
          error: 'Failed to list versions',
          message: error.message
        });
      }
    }
  );

  /**
   * PUT /api/workflows/:id/versions/:versionId/activate
   * Activate a specific version
   */
  fastify.put<{ Params: VersionIdParams }>(
    '/:id/versions/:versionId/activate',
    async (request, reply) => {
      try {
        const { id, versionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Check ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Deactivate all versions
        await prisma.workflowVersion.updateMany({
          where: { workflow_id: id },
          data: { is_active: false }
        });

        // Activate specified version
        const version = await prisma.workflowVersion.update({
          where: { id: versionId },
          data: { is_active: true }
        });

        // Update workflow definition from activated version
        await prisma.workflow.update({
          where: { id },
          data: {
            definition: version.definition,
            triggers: version.triggers,
            settings: version.settings
          }
        });

        logger.info({
          workflowId: id,
          versionId,
          version: version.version
        }, '[Workflows] Version activated');

        return reply.send({
          success: true,
          version
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to activate version');
        return reply.code(500).send({
          error: 'Failed to activate version',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/versions/:versionId/restore
   * Restore a workflow to a specific version
   */
  fastify.post<{ Params: VersionIdParams }>(
    '/:id/versions/:versionId/restore',
    async (request, reply) => {
      try {
        const { id, versionId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Check ownership
        const workflow = await prisma.workflow.findFirst({
          where: { id, created_by: userId, deleted_at: null }
        });

        if (!workflow) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        const version = await prisma.workflowVersion.findUnique({
          where: { id: versionId },
        });
        if (!version || version.workflow_id !== id) {
          return reply.code(404).send({ error: 'Version not found' });
        }

        // Create a new version snapshot of current state before restoring
        const latestVersion = await prisma.workflowVersion.findFirst({
          where: { workflow_id: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const nextVersionNum = (latestVersion?.version || 0) + 1;

        await prisma.workflowVersion.create({
          data: {
            workflow_id: id,
            version: nextVersionNum,
            definition: workflow.definition,
            triggers: workflow.triggers,
            settings: workflow.settings,
            changelog: `Auto-snapshot before restoring to version ${version.version}`,
            is_active: false,
            created_by: userId,
          },
        });

        // Update workflow with the version's definition
        await prisma.workflow.update({
          where: { id },
          data: {
            definition: asJson(version.definition),
            settings: asJson(version.settings) || undefined,
            triggers: asJson(version.triggers) || undefined,
            updated_at: new Date(),
          },
        });

        logger.info({
          workflowId: id,
          versionId,
          restoredToVersion: version.version,
          snapshotVersion: nextVersionNum,
        }, '[Workflows] Version restored');

        return reply.send({ success: true, message: `Restored to version ${version.version}` });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to restore version');
        return reply.code(500).send({
          error: 'Failed to restore version',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/:id/duplicate
   * Duplicate a workflow
   */
  fastify.post<{ Params: WorkflowIdParams }>(
    '/:id/duplicate',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Get original workflow
        const original = await prisma.workflow.findFirst({
          where: {
            id,
            deleted_at: null,
            OR: [
              { created_by: userId },
              { is_public: true },
              { is_template: true }
            ]
          }
        });

        if (!original) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Workflow with ID '${id}' not found or you don't have permission`
          });
        }

        // Create duplicate
        const duplicate = await prisma.workflow.create({
          data: {
            name: `${original.name} (Copy)`,
            description: original.description,
            definition: original.definition,
            triggers: original.triggers,
            settings: original.settings,
            variables: original.variables,
            tags: original.tags,
            category: original.category,
            icon: original.icon,
            color: original.color,
            is_template: false,
            is_public: false,
            created_by: userId
          }
        });

        // Create initial version
        await prisma.workflowVersion.create({
          data: {
            workflow_id: duplicate.id,
            version: 1,
            definition: original.definition,
            triggers: original.triggers,
            settings: original.settings,
            changelog: `Duplicated from ${original.name}`,
            is_active: true,
            created_by: userId
          }
        });

        logger.info({
          originalId: id,
          duplicateId: duplicate.id
        }, '[Workflows] Workflow duplicated');

        return reply.code(201).send({
          success: true,
          workflow: transformWorkflow(duplicate)
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to duplicate workflow');
        return reply.code(500).send({
          error: 'Failed to duplicate workflow',
          message: error.message
        });
      }
    }
  );
};

export default versionsRoutes;
