/**
 * Workflow Schedule CRUD Routes (#122 — autonomous agent runtime, API half)
 *
 * The durable cron scheduler (src/services/WorkflowScheduler.ts) is a READER:
 * it polls workflow_schedules every 30s and runs due flows, but nothing wrote
 * those rows. This is the WRITER — schedule CRUD scoped to the parent workflow
 * the caller owns. The scheduler picks the new/updated rows up on its next
 * poll cycle (it (re)computes next_run_at itself for rows missing one, but we
 * compute it on create/update so the schedule is "armed" immediately).
 *
 * Endpoints (registered under the /api/workflows prefix):
 *   POST   /:workflowId/schedules                 -> 201 { schedule }
 *   GET    /:workflowId/schedules                 -> 200 { schedules }
 *   PATCH  /:workflowId/schedules/:scheduleId     -> 200 { schedule }
 *   DELETE /:workflowId/schedules/:scheduleId     -> 200 { success:true }
 *
 * Ownership: the parent workflow's created_by must equal the authed userId.
 *   workflow not found -> 404; not owner -> 403; invalid cron -> 400;
 *   schedule not found / not under the workflow -> 404.
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
// Cron helpers exported by the scheduler — reused here so the schedule a user
// creates validates against, and arms with, the SAME cron math the poller runs.
import { parseCronExpression, getNextCronTime } from '../services/WorkflowScheduler.js';

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------
interface WorkflowSchedulesParams {
  workflowId: string;
}

interface ScheduleDetailParams {
  workflowId: string;
  scheduleId: string;
}

interface CreateScheduleBody {
  cron_expression: string;
  name?: string;
  timezone?: string;
  input_template?: Prisma.InputJsonValue;
  is_active?: boolean;
}

interface UpdateScheduleBody {
  is_active?: boolean;
  cron_expression?: string;
  timezone?: string;
  input_template?: Prisma.InputJsonValue;
  name?: string;
}

interface AuthedUser {
  userId?: string;
  id?: string;
}

/** Resolve the authed userId the same way workflows.ts does (userId || id). */
function getUserId(request: FastifyRequest): string | undefined {
  const user = (request as unknown as { user?: AuthedUser }).user;
  return user?.userId ?? user?.id;
}

export const workflowScheduleRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  // Auth on every route (mirrors workflows.ts). The plugin wrapper also gates
  // the /api/workflows/* scope, so this is defense-in-depth.
  fastify.addHook('preHandler', authMiddleware);

  /**
   * Load the parent workflow and assert the caller owns it.
   * Returns the workflow on success, or sends the proper 404/403 and returns
   * null so the handler can `if (!wf) return;`.
   */
  async function loadOwnedWorkflow(
    request: FastifyRequest,
    reply: FastifyReply,
    workflowId: string,
  ): Promise<{ id: string; name: string; created_by: string | null } | null> {
    const userId = getUserId(request);
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, deleted_at: null },
      select: { id: true, name: true, created_by: true },
    });

    if (!workflow) {
      reply.code(404).send({ error: 'not_found', message: `Workflow '${workflowId}' not found` });
      return null;
    }
    if (workflow.created_by !== userId) {
      reply.code(403).send({ error: 'forbidden', message: 'You do not have permission to manage this workflow' });
      return null;
    }
    return workflow;
  }

  /**
   * POST /:workflowId/schedules
   * Create a cron schedule for an owned workflow.
   */
  fastify.post<{ Params: WorkflowSchedulesParams; Body: CreateScheduleBody }>(
    '/:workflowId/schedules',
    async (request, reply) => {
      try {
        const { workflowId } = request.params;
        const body = request.body || ({} as CreateScheduleBody);
        const { cron_expression, name, timezone, input_template, is_active } = body;

        const workflow = await loadOwnedWorkflow(request, reply, workflowId);
        if (!workflow) return reply;

        if (!cron_expression || typeof cron_expression !== 'string') {
          return reply.code(400).send({ error: 'invalid_cron', message: 'cron_expression is required' });
        }

        // Validate with the scheduler's own parser so an unparseable cron is
        // rejected here instead of silently never firing.
        try {
          parseCronExpression(cron_expression);
        } catch (err) {
          return reply.code(400).send({
            error: 'invalid_cron',
            message: err instanceof Error ? err.message : 'Invalid cron expression',
          });
        }

        const nextRun = getNextCronTime(cron_expression, new Date());

        const schedule = await prisma.workflowSchedule.create({
          data: {
            workflow_id: workflowId,
            name: name || `${workflow.name} schedule`,
            cron_expression,
            timezone: timezone || 'UTC',
            input_template: input_template ?? {},
            is_active: is_active ?? true,
            next_run_at: nextRun,
          },
        });

        logger.info({ workflowId, scheduleId: schedule.id, cron_expression }, '[WorkflowSchedules] Schedule created');
        return reply.code(201).send({ schedule });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        logger.error({ error: message }, '[WorkflowSchedules] Failed to create schedule');
        // Don't leak raw internal error text to the client — static code only.
        return reply.code(500).send({ error: 'create_failed' });
      }
    },
  );

  /**
   * GET /:workflowId/schedules
   * List schedules for an owned workflow.
   */
  fastify.get<{ Params: WorkflowSchedulesParams }>(
    '/:workflowId/schedules',
    async (request, reply) => {
      try {
        const { workflowId } = request.params;

        const workflow = await loadOwnedWorkflow(request, reply, workflowId);
        if (!workflow) return reply;

        const schedules = await prisma.workflowSchedule.findMany({
          where: { workflow_id: workflowId },
          orderBy: { created_at: 'desc' },
        });

        return reply.send({ schedules });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        logger.error({ error: message }, '[WorkflowSchedules] Failed to list schedules');
        // Don't leak raw internal error text to the client — static code only.
        return reply.code(500).send({ error: 'list_failed' });
      }
    },
  );

  /**
   * PATCH /:workflowId/schedules/:scheduleId
   * Update a schedule (pause/resume, re-arm cron, retarget input).
   */
  fastify.patch<{ Params: ScheduleDetailParams; Body: UpdateScheduleBody }>(
    '/:workflowId/schedules/:scheduleId',
    async (request, reply) => {
      try {
        const { workflowId, scheduleId } = request.params;
        const body = request.body || ({} as UpdateScheduleBody);
        const { is_active, cron_expression, timezone, input_template, name } = body;

        const workflow = await loadOwnedWorkflow(request, reply, workflowId);
        if (!workflow) return reply;

        const existing = await prisma.workflowSchedule.findUnique({ where: { id: scheduleId } });
        if (!existing || existing.workflow_id !== workflowId) {
          return reply.code(404).send({ error: 'not_found', message: `Schedule '${scheduleId}' not found` });
        }

        const data: Prisma.WorkflowScheduleUpdateInput = {};
        if (typeof is_active === 'boolean') data.is_active = is_active;
        if (typeof name === 'string') data.name = name;
        if (typeof timezone === 'string') data.timezone = timezone;
        if (input_template !== undefined) data.input_template = input_template;

        if (cron_expression !== undefined) {
          if (typeof cron_expression !== 'string') {
            return reply.code(400).send({ error: 'invalid_cron', message: 'cron_expression must be a string' });
          }
          try {
            parseCronExpression(cron_expression);
          } catch (err) {
            return reply.code(400).send({
              error: 'invalid_cron',
              message: err instanceof Error ? err.message : 'Invalid cron expression',
            });
          }
          data.cron_expression = cron_expression;
          data.next_run_at = getNextCronTime(cron_expression, new Date());
        }

        const schedule = await prisma.workflowSchedule.update({ where: { id: scheduleId }, data });

        logger.info({ workflowId, scheduleId }, '[WorkflowSchedules] Schedule updated');
        return reply.send({ schedule });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        logger.error({ error: message }, '[WorkflowSchedules] Failed to update schedule');
        // Don't leak raw internal error text to the client — static code only.
        return reply.code(500).send({ error: 'update_failed' });
      }
    },
  );

  /**
   * DELETE /:workflowId/schedules/:scheduleId
   * Remove a schedule.
   */
  fastify.delete<{ Params: ScheduleDetailParams }>(
    '/:workflowId/schedules/:scheduleId',
    async (request, reply) => {
      try {
        const { workflowId, scheduleId } = request.params;

        const workflow = await loadOwnedWorkflow(request, reply, workflowId);
        if (!workflow) return reply;

        const existing = await prisma.workflowSchedule.findUnique({ where: { id: scheduleId } });
        if (!existing || existing.workflow_id !== workflowId) {
          return reply.code(404).send({ error: 'not_found', message: `Schedule '${scheduleId}' not found` });
        }

        await prisma.workflowSchedule.delete({ where: { id: scheduleId } });

        logger.info({ workflowId, scheduleId }, '[WorkflowSchedules] Schedule deleted');
        return reply.send({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        logger.error({ error: message }, '[WorkflowSchedules] Failed to delete schedule');
        // Don't leak raw internal error text to the client — static code only.
        return reply.code(500).send({ error: 'delete_failed' });
      }
    },
  );
};
