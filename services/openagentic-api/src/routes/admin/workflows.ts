/**
 * Admin Workflow Routes
 *
 * Provides admin endpoints for workflow management across all users:
 * - GET /api/admin/workflows - List all workflows with user info
 * - GET /api/admin/workflows/:id - Get any workflow detail
 * - DELETE /api/admin/workflows/:id - Delete any workflow
 * - PATCH /api/admin/workflows/:id/visibility - Force visibility change
 * - GET /api/admin/workflows/executions - All executions across users
 * - GET /api/admin/workflows/stats - Aggregate stats
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';

function transformWorkflow(workflow: any) {
  const definition = workflow.definition as any || {};
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    user_id: workflow.created_by,
    user: workflow.creator ? {
      id: workflow.creator.id,
      email: workflow.creator.email,
      name: workflow.creator.name,
    } : null,
    nodeCount: (definition.nodes || []).length,
    edgeCount: (definition.edges || []).length,
    status: workflow.is_active ? 'active' : 'draft',
    visibility: workflow.is_public ? 'public' : workflow.group_id ? 'team' : 'private',
    is_template: workflow.is_template || false,
    tags: workflow.tags || [],
    category: workflow.category,
    totalExecutions: workflow.total_executions || 0,
    successfulExecutions: workflow.successful_executions || 0,
    failedExecutions: workflow.failed_executions || 0,
    lastExecutedAt: workflow.last_executed_at,
    created_at: workflow.created_at,
    updated_at: workflow.updated_at,
  };
}

export const adminWorkflowRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/admin/workflows/stats
   * Aggregate workflow stats (must be before /:id to avoid route conflict)
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const [
        totalWorkflows,
        activeWorkflows,
        publicWorkflows,
        totalExecutions,
        runningExecutions,
        failedExecutions,
        recentExecutions,
      ] = await Promise.all([
        prisma.workflow.count({ where: { deleted_at: null } }),
        prisma.workflow.count({ where: { deleted_at: null, is_active: true } }),
        prisma.workflow.count({ where: { deleted_at: null, is_public: true } }),
        prisma.workflowExecution.count(),
        prisma.workflowExecution.count({ where: { status: 'running' } }),
        prisma.workflowExecution.count({ where: { status: 'failed' } }),
        prisma.workflowExecution.findMany({
          orderBy: { started_at: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            execution_time_ms: true,
            started_at: true,
            workflow: {
              select: { name: true, created_by: true },
            },
          },
        }),
      ]);

      // Top users by workflow count
      const topUsers = await prisma.workflow.groupBy({
        by: ['created_by'],
        where: { deleted_at: null },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      });

      // Fetch user info for top users
      const topUserIds = topUsers.map(u => u.created_by);
      const users = await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      return reply.send({
        totalWorkflows,
        activeWorkflows,
        publicWorkflows,
        totalExecutions,
        runningExecutions,
        failedExecutions,
        recentExecutions: recentExecutions.map(e => ({
          ...e,
          execution_time_ms: e.execution_time_ms ? Number(e.execution_time_ms) : null,
        })),
        topUsers: topUsers.map(u => ({
          userId: u.created_by,
          user: userMap.get(u.created_by) || null,
          workflowCount: u._count.id,
        })),
      });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to get stats');
      return reply.code(500).send({ error: 'Failed to get stats', message: error.message });
    }
  });

  /**
   * GET /api/admin/workflows/executions
   * All executions across all users
   */
  fastify.get<{
    Querystring: { limit?: number; offset?: number; status?: string; user_id?: string };
  }>('/executions', async (request, reply) => {
    try {
      const { limit = 50, offset = 0, status, user_id } = request.query;

      const where: any = {};
      if (status) where.status = status;
      if (user_id) where.started_by = user_id;

      const [executions, total] = await Promise.all([
        prisma.workflowExecution.findMany({
          where,
          orderBy: { started_at: 'desc' },
          take: Number(limit),
          skip: Number(offset),
          include: {
            workflow: {
              select: { id: true, name: true, created_by: true },
            },
          },
        }),
        prisma.workflowExecution.count({ where }),
      ]);

      // Get unique user IDs for enrichment
      const userIds = [...new Set(executions.map(e => e.started_by).filter(Boolean))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIds as string[] } },
        select: { id: true, email: true, name: true },
      });
      const userMap = new Map(users.map(u => [u.id, u]));

      return reply.send({
        executions: executions.map(e => ({
          id: e.id,
          workflowId: e.workflow_id,
          workflowName: e.workflow?.name || 'Unknown',
          user: e.started_by ? userMap.get(e.started_by) || null : null,
          status: e.status,
          triggerType: e.trigger_type,
          totalNodes: e.total_nodes,
          completedNodes: e.completed_nodes,
          executionTimeMs: e.execution_time_ms ? Number(e.execution_time_ms) : null,
          cost: e.cost ? Number(e.cost) : null,
          startedAt: e.started_at,
          completedAt: e.completed_at,
          error: e.error,
        })),
        total,
        limit: Number(limit),
        offset: Number(offset),
      });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to list executions');
      return reply.code(500).send({ error: 'Failed to list executions', message: error.message });
    }
  });

  /**
   * GET /api/admin/workflows
   * List all workflows with user info
   */
  fastify.get<{
    Querystring: { limit?: number; offset?: number; search?: string; user_id?: string; visibility?: string };
  }>('/', async (request, reply) => {
    try {
      const { limit = 50, offset = 0, search, user_id, visibility } = request.query;

      const where: any = { deleted_at: null };
      if (user_id) where.created_by = user_id;
      if (visibility === 'public') where.is_public = true;
      if (visibility === 'private') { where.is_public = false; where.group_id = null; }
      if (visibility === 'team') { where.is_public = false; where.group_id = { not: null }; }
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [workflows, total] = await Promise.all([
        prisma.workflow.findMany({
          where,
          orderBy: { updated_at: 'desc' },
          take: Number(limit),
          skip: Number(offset),
          include: {
            creator: { select: { id: true, email: true, name: true } },
          },
        }),
        prisma.workflow.count({ where }),
      ]);

      return reply.send({
        workflows: workflows.map(transformWorkflow),
        total,
        limit: Number(limit),
        offset: Number(offset),
      });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to list workflows');
      return reply.code(500).send({ error: 'Failed to list workflows', message: error.message });
    }
  });

  /**
   * GET /api/admin/workflows/:id
   * Get any workflow detail
   */
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const workflow = await prisma.workflow.findFirst({
        where: { id, deleted_at: null },
        include: {
          creator: { select: { id: true, email: true, name: true } },
          group: { select: { id: true, name: true, display_name: true } },
          versions: {
            orderBy: { version: 'desc' },
            take: 10,
            select: { id: true, version: true, is_active: true, changelog: true, created_at: true },
          },
        },
      });

      if (!workflow) {
        return reply.code(404).send({ error: 'Not found' });
      }

      return reply.send({ workflow: transformWorkflow(workflow) });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to get workflow');
      return reply.code(500).send({ error: 'Failed to get workflow', message: error.message });
    }
  });

  /**
   * DELETE /api/admin/workflows/:id
   * Delete any workflow (soft delete)
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    try {
      const { id } = request.params;

      const workflow = await prisma.workflow.findFirst({
        where: { id, deleted_at: null },
        select: { id: true, name: true },
      });

      if (!workflow) {
        return reply.code(404).send({ error: 'Not found' });
      }

      await prisma.workflow.update({
        where: { id },
        data: { deleted_at: new Date(), is_active: false },
      });

      logger.info({ workflowId: id }, '[Admin Workflows] Workflow deleted by admin');
      return reply.send({ success: true, message: `Workflow '${workflow.name}' deleted` });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to delete workflow');
      return reply.code(500).send({ error: 'Failed to delete workflow', message: error.message });
    }
  });

  /**
   * PATCH /api/admin/workflows/:id/visibility
   * Force visibility change
   */
  fastify.patch<{
    Params: { id: string };
    Body: { visibility: 'private' | 'team' | 'public'; group_id?: string };
  }>('/:id/visibility', async (request, reply) => {
    try {
      const { id } = request.params;
      const { visibility, group_id } = request.body;

      const data: any = {};
      if (visibility === 'private') {
        data.is_public = false;
        data.group_id = null;
      } else if (visibility === 'team') {
        data.is_public = false;
        data.group_id = group_id || null;
      } else if (visibility === 'public') {
        data.is_public = true;
        data.group_id = null;
      }

      const workflow = await prisma.workflow.update({
        where: { id },
        data,
        include: { creator: { select: { id: true, email: true, name: true } } },
      });

      logger.info({ workflowId: id, visibility }, '[Admin Workflows] Visibility changed by admin');
      return reply.send({ success: true, workflow: transformWorkflow(workflow) });
    } catch (error: any) {
      logger.error({ error }, '[Admin Workflows] Failed to change visibility');
      return reply.code(500).send({ error: 'Failed to change visibility', message: error.message });
    }
  });

  /**
   * GET /api/admin/workflows/settings
   * Get admin workflow default settings
   */
  fastify.get('/settings', async (request, reply) => {
    try {
      const config = await prisma.systemConfiguration.findFirst({
        where: { key: 'workflow_defaults' }
      });
      return reply.send({ settings: config?.value || {} });
    } catch (err: any) {
      logger.error({ err }, '[Admin Workflows] Failed to load workflow settings');
      return reply.code(500).send({ error: 'Failed to load workflow settings' });
    }
  });

  /**
   * PUT /api/admin/workflows/settings
   * Update admin workflow default settings
   */
  fastify.put('/settings', async (request, reply) => {
    const user = (request as any).user;
    const { settings } = request.body as { settings: any };

    try {
      await prisma.systemConfiguration.upsert({
        where: { key: 'workflow_defaults' },
        create: { key: 'workflow_defaults', value: settings, description: 'Admin workflow default settings' },
        update: { value: settings },
      });

      logger.info({ userId: user?.id || user?.userId, action: 'update_workflow_settings' }, '[Admin Workflows] Workflow settings updated');

      return reply.send({ success: true, settings });
    } catch (err: any) {
      logger.error({ err }, '[Admin Workflows] Failed to save workflow settings');
      return reply.code(500).send({ error: 'Failed to save workflow settings' });
    }
  });

  logger.info('Admin workflow routes registered');
};

export default adminWorkflowRoutes;
