/**
 * Workflow Approval API Routes
 *
 * Human-in-the-Loop (HITL) approval endpoints:
 * - GET /api/workflows/approvals - List pending approvals for user
 * - GET /api/workflows/approvals/:id - Get approval details
 * - POST /api/workflows/approvals/:id/approve - Approve request
 * - POST /api/workflows/approvals/:id/reject - Reject request
 * - POST /api/workflows/approvals/:id/escalate - Escalate to another approver
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loggers } from '../utils/logger.js';
import { authMiddleware } from '../middleware/unifiedAuth.js';
// Phase B (#15/#16): HITL approval re-entry now goes through the
// dedicated workflows-svc pod via resumeViaWorkflowsService instead of
// constructing the in-process api engine. ExecutionContext was an
// engine-internal type — Phase B's resume-proxy serializes the saved
// state into wire format so the engine's hydrate path runs in the
// dedicated pod, not here.
import type { WorkflowDefinition } from '@openagentic/workflow-engine';
import { resumeViaWorkflowsService } from '../services/resumeViaWorkflowsService.js';
import { getNotificationService } from '../services/NotificationService.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes;

// =============================================================================
// Request/Response Types
// =============================================================================

interface ApprovalIdParams {
  id: string;
}

interface ListApprovalsQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

interface ApproveRequest {
  comment?: string;
}

interface RejectRequest {
  reason: string;
}

interface EscalateRequest {
  escalateTo: string[];  // User IDs
  reason?: string;
}

// =============================================================================
// Routes
// =============================================================================

export const workflowApprovalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Apply auth to all routes
  fastify.addHook('preHandler', authMiddleware);

  /**
   * GET /api/workflows/approvals
   * List pending approvals for the current user
   */
  fastify.get<{ Querystring: ListApprovalsQuery }>(
    '/',
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const userId = user?.userId || user?.id;
        const { status = 'pending', limit = 20, offset = 0 } = request.query;

        // Find approvals where user is in required_approvers
        const approvals = await prisma.workflowApproval.findMany({
          where: {
            status,
            required_approvers: { has: userId },
            // Exclude already approved/rejected by this user
            NOT: {
              OR: [
                { approved_by: { has: userId } },
                { rejected_by: userId }
              ]
            }
          },
          orderBy: { created_at: 'desc' },
          take: Number(limit),
          skip: Number(offset),
          include: {
            execution: {
              include: {
                workflow: {
                  select: { id: true, name: true, description: true }
                }
              }
            }
          }
        });

        const total = await prisma.workflowApproval.count({
          where: {
            status,
            required_approvers: { has: userId },
            NOT: {
              OR: [
                { approved_by: { has: userId } },
                { rejected_by: userId }
              ]
            }
          }
        });

        // Transform for response
        const formattedApprovals = approvals.map(a => ({
          id: a.id,
          workflowId: a.execution?.workflow?.id,
          workflowName: a.execution?.workflow?.name,
          executionId: a.execution_id,
          nodeId: a.node_id,
          status: a.status,
          message: a.message,
          requiredApprovers: a.required_approvers,
          requiredCount: a.required_count,
          approvedBy: a.approved_by,
          approvalProgress: `${a.approved_by.length}/${a.required_count}`,
          expiresAt: a.timeout_at,
          timeoutAction: a.timeout_action,
          createdAt: a.created_at
        }));

        return reply.send({
          approvals: formattedApprovals,
          total,
          limit: Number(limit),
          offset: Number(offset)
        });
      } catch (error: any) {
        logger.error({ error }, '[WorkflowApprovals] Failed to list approvals');
        return reply.code(500).send({
          error: 'Failed to list approvals',
          message: error.message
        });
      }
    }
  );

  /**
   * GET /api/workflows/approvals/:id
   * Get approval details
   */
  fastify.get<{ Params: ApprovalIdParams }>(
    '/:id',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const approval = await prisma.workflowApproval.findUnique({
          where: { id },
          include: {
            execution: {
              include: {
                workflow: {
                  select: { id: true, name: true, description: true }
                },
                logs: {
                  orderBy: { timestamp: 'desc' },
                  take: 10
                }
              }
            }
          }
        }) as any; // Cast to any for nested relation access

        if (!approval) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Approval with ID '${id}' not found`
          });
        }

        // Check if user is authorized to view this approval
        const isApprover = approval.required_approvers.includes(userId);
        const isExecutionOwner = approval.execution?.started_by === userId;

        if (!isApprover && !isExecutionOwner) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You are not authorized to view this approval'
          });
        }

        // Get additional context from stored data
        const approvalData = approval.context_data as any;

        return reply.send({
          approval: {
            id: approval.id,
            workflowId: approval.execution?.workflow?.id,
            workflowName: approval.execution?.workflow?.name,
            workflowDescription: approval.execution?.workflow?.description,
            executionId: approval.execution_id,
            nodeId: approval.node_id,
            status: approval.status,
            message: approval.message,
            requiredApprovers: approval.required_approvers,
            requiredCount: approval.required_count,
            approvedBy: approval.approved_by,
            rejectedBy: approval.rejected_by,
            escalatedTo: approval.escalated_to,
            timeoutSeconds: approval.timeout_seconds,
            timeoutAction: approval.timeout_action,
            expiresAt: approval.timeout_at,
            createdAt: approval.created_at,
            decidedAt: approval.decided_at,
            // Context data for approver review
            executionInput: approvalData?.input,
            priorNodeResults: approvalData?.nodeResults,
            // Recent execution logs
            recentLogs: approval.execution?.logs?.map(l => ({
              nodeId: l.node_id,
              level: l.level,
              message: l.message,
              timestamp: l.created_at
            }))
          }
        });
      } catch (error: any) {
        logger.error({ error }, '[WorkflowApprovals] Failed to get approval');
        return reply.code(500).send({
          error: 'Failed to get approval',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/approvals/:id/approve
   * Approve the request
   */
  fastify.post<{ Params: ApprovalIdParams; Body: ApproveRequest }>(
    '/:id/approve',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { comment } = request.body;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        const approval = await prisma.workflowApproval.findUnique({
          where: { id },
          include: {
            execution: {
              include: {
                workflow: true,
                version: true
              }
            }
          }
        });

        if (!approval) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Approval with ID '${id}' not found`
          });
        }

        if (approval.status !== 'pending') {
          return reply.code(400).send({
            error: 'Invalid state',
            message: `Approval is already ${approval.status}`
          });
        }

        // Check if user is authorized to approve
        if (!approval.required_approvers.includes(userId)) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You are not authorized to approve this request'
          });
        }

        // Check if user already approved
        if (approval.approved_by.includes(userId)) {
          return reply.code(400).send({
            error: 'Already approved',
            message: 'You have already approved this request'
          });
        }

        // Add user to approved_by
        const updatedApprovedBy = [...approval.approved_by, userId];
        const isFullyApproved = updatedApprovedBy.length >= approval.required_count;

        // Update approval record
        const updatedApproval = await prisma.workflowApproval.update({
          where: { id },
          data: {
            approved_by: updatedApprovedBy,
            status: isFullyApproved ? 'approved' : 'pending',
            decided_at: isFullyApproved ? new Date() : null,
            // Store approval comment
            context_data: {
              ...(approval.context_data as any),
              approvalComments: [
                ...((approval.context_data as any)?.approvalComments || []),
                { userId, comment, timestamp: new Date().toISOString() }
              ]
            }
          }
        });

        logger.info({
          approvalId: id,
          userId,
          isFullyApproved,
          approvalProgress: `${updatedApprovedBy.length}/${approval.required_count}`
        }, '[WorkflowApprovals] Approval received');

        // If fully approved, resume the workflow
        if (isFullyApproved) {
          await resumeWorkflowAfterApproval(approval, 'approved');
        }

        return reply.send({
          success: true,
          approval: {
            id: updatedApproval.id,
            status: updatedApproval.status,
            approvedBy: updatedApproval.approved_by,
            approvalProgress: `${updatedApprovedBy.length}/${approval.required_count}`,
            isFullyApproved,
            message: isFullyApproved
              ? 'Approval complete - workflow will resume'
              : `Approval recorded - ${approval.required_count - updatedApprovedBy.length} more required`
          }
        });
      } catch (error: any) {
        logger.error({ error }, '[WorkflowApprovals] Failed to approve');
        return reply.code(500).send({
          error: 'Failed to approve',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/approvals/:id/reject
   * Reject the request
   */
  fastify.post<{ Params: ApprovalIdParams; Body: RejectRequest }>(
    '/:id/reject',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { reason } = request.body;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        if (!reason || reason.trim().length === 0) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'Rejection reason is required'
          });
        }

        const approval = await prisma.workflowApproval.findUnique({
          where: { id },
          include: {
            execution: {
              include: {
                workflow: true
              }
            }
          }
        });

        if (!approval) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Approval with ID '${id}' not found`
          });
        }

        if (approval.status !== 'pending') {
          return reply.code(400).send({
            error: 'Invalid state',
            message: `Approval is already ${approval.status}`
          });
        }

        // Check if user is authorized to reject
        if (!approval.required_approvers.includes(userId)) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You are not authorized to reject this request'
          });
        }

        // Update approval record
        const updatedApproval = await prisma.workflowApproval.update({
          where: { id },
          data: {
            status: 'rejected',
            rejected_by: userId,
            decided_at: new Date(),
            context_data: {
              ...(approval.context_data as any),
              rejectionReason: reason,
              rejectedAt: new Date().toISOString()
            }
          }
        });

        logger.info({
          approvalId: id,
          userId,
          reason
        }, '[WorkflowApprovals] Approval rejected');

        // Fail the workflow execution
        await resumeWorkflowAfterApproval(approval, 'rejected', reason);

        return reply.send({
          success: true,
          approval: {
            id: updatedApproval.id,
            status: 'rejected',
            rejectedBy: userId,
            reason,
            message: 'Approval rejected - workflow execution will be marked as failed'
          }
        });
      } catch (error: any) {
        logger.error({ error }, '[WorkflowApprovals] Failed to reject');
        return reply.code(500).send({
          error: 'Failed to reject',
          message: error.message
        });
      }
    }
  );

  /**
   * POST /api/workflows/approvals/:id/escalate
   * Escalate to additional approvers
   */
  fastify.post<{ Params: ApprovalIdParams; Body: EscalateRequest }>(
    '/:id/escalate',
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { escalateTo, reason } = request.body;
        const user = (request as any).user;
        const userId = user?.userId || user?.id;

        if (!escalateTo || escalateTo.length === 0) {
          return reply.code(400).send({
            error: 'Validation error',
            message: 'At least one user to escalate to is required'
          });
        }

        const approval = await prisma.workflowApproval.findUnique({
          where: { id },
          include: {
            execution: {
              include: { workflow: true }
            }
          }
        });

        if (!approval) {
          return reply.code(404).send({
            error: 'Not found',
            message: `Approval with ID '${id}' not found`
          });
        }

        if (approval.status !== 'pending') {
          return reply.code(400).send({
            error: 'Invalid state',
            message: `Approval is already ${approval.status}`
          });
        }

        // Check if user is authorized
        if (!approval.required_approvers.includes(userId)) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: 'You are not authorized to escalate this request'
          });
        }

        // Add escalation targets to required_approvers and escalated_to
        const newApprovers = [...new Set([...approval.required_approvers, ...escalateTo])];
        const newEscalatedTo = [...new Set([...approval.escalated_to, ...escalateTo])];

        const updatedApproval = await prisma.workflowApproval.update({
          where: { id },
          data: {
            required_approvers: newApprovers,
            escalated_to: newEscalatedTo,
            status: 'escalated',
            context_data: {
              ...(approval.context_data as any),
              escalations: [
                ...((approval.context_data as any)?.escalations || []),
                {
                  escalatedBy: userId,
                  escalatedTo: escalateTo,
                  reason,
                  timestamp: new Date().toISOString()
                }
              ]
            }
          }
        });

        // Send notifications to new approvers
        const notificationService = getNotificationService();
        await notificationService.sendApprovalRequest({
          approvalId: id,
          recipients: escalateTo,
          message: `Escalated approval request: ${approval.message}${reason ? `\n\nReason: ${reason}` : ''}`,
          channels: (approval.context_data as any)?.notificationChannels || ['in_app'],
          workflowId: approval.execution?.workflow_id || '',
          executionId: approval.execution_id,
          approvalUrl: `/workflows/approvals/${id}`
        });

        logger.info({
          approvalId: id,
          escalatedBy: userId,
          escalatedTo: escalateTo
        }, '[WorkflowApprovals] Approval escalated');

        return reply.send({
          success: true,
          approval: {
            id: updatedApproval.id,
            status: 'escalated',
            requiredApprovers: updatedApproval.required_approvers,
            escalatedTo: updatedApproval.escalated_to,
            message: `Escalated to ${escalateTo.length} additional approver(s)`
          }
        });
      } catch (error: any) {
        logger.error({ error }, '[WorkflowApprovals] Failed to escalate');
        return reply.code(500).send({
          error: 'Failed to escalate',
          message: error.message
        });
      }
    }
  );

  logger.info('Workflow approval routes registered');
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resume workflow execution after approval decision
 */
async function resumeWorkflowAfterApproval(
  approval: any,
  decision: 'approved' | 'rejected',
  reason?: string
): Promise<void> {
  const execution = approval.execution;
  if (!execution) {
    logger.warn({ approvalId: approval.id }, '[WorkflowApprovals] No execution found for approval');
    return;
  }

  logger.info({
    executionId: execution.id,
    nodeId: approval.node_id,
    decision
  }, '[WorkflowApprovals] Resuming workflow after approval decision');

  if (decision === 'rejected') {
    // Mark execution as failed
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        error: `Approval rejected: ${reason || 'No reason provided'}`,
        completed_at: new Date()
      }
    });

    // Update workflow stats
    await prisma.workflow.update({
      where: { id: execution.workflow_id },
      data: {
        failed_executions: { increment: 1 }
      }
    });

    return;
  }

  // For approved - resume the workflow execution
  try {
    // Get the saved state
    const state = execution.state as any;
    if (!state) {
      throw new Error('No execution state found');
    }

    // Get workflow definition
    const version = execution.version;
    if (!version) {
      throw new Error('No workflow version found');
    }

    const definition = version.definition as WorkflowDefinition;

    // Mark the approval node's result on the saved state so the resumed
    // engine sees it via context.nodeResults. The workflows-svc handler
    // hydrates Maps from these plain objects.
    const savedNodeResults = (state.nodeResults && typeof state.nodeResults === 'object')
      ? { ...state.nodeResults }
      : {};
    savedNodeResults[approval.node_id] = {
      status: 'approved',
      approvedBy: approval.approved_by,
      approvedAt: new Date().toISOString(),
    };

    // Update execution status to running
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'running',
        current_node_id: approval.node_id
      }
    });

    // Phase B (#16): proxy the resume to workflows-svc instead of
    // constructing the api-side engine in-process.
    //
    // Task 1.3 (V3 Enterprise Chatmode S5): tenantId is derived from the
    // execution row (no JWT context here — this is invoked from an approval
    // decision handler that operates on a previously-tenanted execution).
    // The wrapper fail-CLOSES if it's null/empty.
    const tenantId = (execution as any).tenant_id || (execution.workflow as any)?.tenant_id;
    const result = await resumeViaWorkflowsService({
      workflowId: execution.workflow_id,
      executionId: execution.id,
      definition,
      fromNodeId: approval.node_id,
      resumeInput: { approved: true, approvedBy: approval.approved_by },
      state: {
        input: state.input || {},
        variables: state.variables || {},
        nodeResults: savedNodeResults,
        startTimeMs: execution.started_at?.getTime() || Date.now(),
      },
      userId: execution.started_by || '',
      tenantId,
    });

    logger.info({
      executionId: execution.id,
      success: result.success
    }, '[WorkflowApprovals] Workflow resumed');

  } catch (error: any) {
    logger.error({
      executionId: execution.id,
      error: error.message
    }, '[WorkflowApprovals] Failed to resume workflow');

    // Mark execution as failed
    await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: {
        status: 'failed',
        error: `Failed to resume after approval: ${error.message}`,
        completed_at: new Date()
      }
    });
  }
}

export default workflowApprovalRoutes;
