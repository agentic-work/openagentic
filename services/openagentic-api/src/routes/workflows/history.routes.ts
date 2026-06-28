/**
 * Workflow execution history (read) routes.
 *
 *   GET /executions/mine
 *   GET /:id/executions
 *   GET /:id/executions/:execId
 *
 * Sub-plugin of workflowRoutes; auth applied by the parent preHandler hook.
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { loggers } from '../../utils/logger.js';
import { prisma } from '../../utils/prisma.js';
import { getReqUser } from './shared.js';
import type { ExecutionDetailParams, ListExecutionsQuery, WorkflowIdParams } from './types.js';

export const historyRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const logger = loggers.routes;

  /**
   * GET /api/workflows/executions/mine
   * Get current user's executions across ALL workflows
   */
  fastify.get<{ Querystring: { limit?: number; offset?: number; status?: string } }>(
    '/executions/mine',
    async (request, reply) => {
      try {
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { limit = 20, offset = 0, status } = request.query;

        const where: Prisma.WorkflowExecutionWhereInput = { started_by: userId, workflow: { deleted_at: null } };
        if (status) where.status = status;

        const [executions, total] = await Promise.all([
          prisma.workflowExecution.findMany({
            where,
            orderBy: { started_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              workflow_id: true,
              status: true,
              trigger_type: true,
              total_nodes: true,
              completed_nodes: true,
              started_at: true,
              completed_at: true,
              workflow: {
                select: { name: true, icon: true, color: true },
              },
            },
          }),
          prisma.workflowExecution.count({ where }),
        ]);

        return reply.send({ executions, total, limit: Number(limit), offset: Number(offset) });
      } catch (error) {
        logger.error({ error: error.message }, 'Failed to list user executions');
        return reply.code(500).send({ error: 'Failed to list executions', message: error.message });
      }
    }
  );

  /**
   * GET /api/workflows/:id/executions
   * Get workflow executions
   */
  fastify.get<{ Params: WorkflowIdParams; Querystring: ListExecutionsQuery }>(
    '/:id/executions',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;
        const { limit = 20, offset = 0, status } = request.query;

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

        const where: Prisma.WorkflowExecutionWhereInput = { workflow_id: id };
        if (status) where.status = status;

        const [executions, total] = await Promise.all([
          prisma.workflowExecution.findMany({
            where,
            orderBy: { started_at: 'desc' },
            take: Number(limit),
            skip: Number(offset),
            select: {
              id: true,
              status: true,
              trigger_type: true,
              total_nodes: true,
              completed_nodes: true,
              execution_time_ms: true,
              cost: true,
              started_at: true,
              completed_at: true,
              error: true,
              node_outputs: true,
              logs: {
                where: { node_id: { not: null } },
                select: { node_id: true, data: true },
                orderBy: { timestamp: 'asc' },
              }
            }
          }),
          prisma.workflowExecution.count({ where })
        ]);

        return reply.send({
          executions: executions.map(e => {
            // Build node_outputs from logs if the JSON merge field is empty
            let nodeOutputs: unknown = (e.node_outputs && typeof e.node_outputs === 'object' && Object.keys(e.node_outputs as unknown as Record<string, unknown>).length > 0)
              ? e.node_outputs
              : undefined;

            if (!nodeOutputs && e.logs && e.logs.length > 0) {
              const built: Record<string, unknown> = {};
              for (const log of e.logs) {
                if (log.node_id && log.data && typeof log.data === 'object') {
                  const d = log.data as unknown as Record<string, unknown>;
                  built[log.node_id] = {
                    status: d.status || 'completed',
                    nodeType: d.node_type,
                    duration: d.execution_time_ms,
                    error: d.error || null,
                  };
                }
              }
              if (Object.keys(built).length > 0) nodeOutputs = built;
            }

            const { logs: _logs, ...rest } = e;
            return {
              ...rest,
              cost: e.cost ? Number(e.cost) : null,
              node_outputs: nodeOutputs || {},
            };
          }),
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to list executions');
        return reply.code(500).send({
          error: 'Failed to list executions',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/:id/executions/:execId
   * Get detailed execution info including logs and per-node summary
   */
  fastify.get<{ Params: ExecutionDetailParams }>(
    '/:id/executions/:execId',
    async (request, reply) => {
      try {
        const { id, execId } = request.params;
        const user = getReqUser(request);
        const userId = user?.userId || user?.id;

        // Verify user has access to this workflow
        const userGroups = await prisma.userGroupMembership.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        }).catch(() => [] as { group_id: string }[]);
        const userGroupIds = userGroups.map(g => g.group_id);

        // First check if user started this execution (allows access even if workflow was created by someone else)
        const execution = await prisma.workflowExecution.findFirst({
          where: { id: execId, workflow_id: id },
        });

        if (!execution) {
          return reply.code(404).send({ error: 'Not found', message: 'Execution not found' });
        }

        // Allow access if user started the execution OR has access to the workflow
        const userStartedExecution = execution.started_by === userId;
        if (!userStartedExecution) {
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
        }

        // Fetch all logs for this execution
        const logs = await prisma.workflowExecutionLog.findMany({
          where: { execution_id: execId },
          orderBy: { timestamp: 'asc' },
        });

        // Build per-node summary from node_outputs and logs
        const nodeOutputs = (execution.node_outputs as unknown as Record<string, unknown>) || {};
        const nodeSummary: Record<string, { status: unknown; input: unknown; output: unknown; duration: unknown; error: unknown; logs: unknown[] }> = {};

        // Initialize from node_outputs
        for (const [nodeId, nodeData] of Object.entries(nodeOutputs)) {
          const data = nodeData as Record<string, unknown>;
          nodeSummary[nodeId] = {
            status: data?.status || (data?.error ? 'failed' : 'completed'),
            input: data?.input ?? null,
            output: data?.output ?? data?.result ?? null,
            duration: data?.duration ?? data?.execution_time_ms ?? null,
            error: data?.error ?? null,
            logs: [],
          };
        }

        // Attach logs to their respective nodes
        for (const log of logs) {
          if (log.node_id) {
            if (!nodeSummary[log.node_id]) {
              nodeSummary[log.node_id] = {
                status: 'unknown',
                input: null,
                output: null,
                duration: null,
                error: null,
                logs: [],
              };
            }
            nodeSummary[log.node_id].logs.push({
              id: log.id,
              level: log.level,
              message: log.message,
              data: log.data,
              timestamp: log.timestamp,
            });
          }
        }

        return reply.send({
          execution: {
            id: execution.id,
            workflow_id: execution.workflow_id,
            version_id: execution.version_id,
            trigger_type: execution.trigger_type,
            trigger_data: execution.trigger_data,
            status: execution.status,
            current_node_id: execution.current_node_id,
            state: execution.state,
            node_outputs: execution.node_outputs,
            checkpoints: execution.checkpoints,
            input: execution.input,
            output: execution.output,
            error: execution.error,
            error_node_id: execution.error_node_id,
            total_nodes: execution.total_nodes,
            completed_nodes: execution.completed_nodes,
            execution_time_ms: execution.execution_time_ms,
            cost: execution.cost ? Number(execution.cost) : null,
            started_at: execution.started_at,
            completed_at: execution.completed_at,
          },
          logs: logs.map(l => ({
            id: l.id,
            execution_id: l.execution_id,
            node_id: l.node_id,
            level: l.level,
            message: l.message,
            data: l.data,
            trace_id: l.trace_id,
            span_id: l.span_id,
            timestamp: l.timestamp,
          })),
          nodeSummary,
        });
      } catch (error) {
        logger.error({ error }, '[Workflows] Failed to get execution detail');
        return reply.code(500).send({
          error: 'Failed to get execution detail',
          message: error.message,
        });
      }
    }
  );
};

export default historyRoutes;
