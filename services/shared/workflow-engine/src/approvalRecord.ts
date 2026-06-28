/**
 * approvalRecord — fail-closed DB helper for approval nodes.
 *
 * Calls prisma.workflowApproval.create and returns the persisted row.
 * Any DB error propagates to the caller as-is — there is NO catch/swallow
 * and no fallback to auto-approval. The engine's error boundary then marks
 * the execution as failed and emits node_error.
 */

// TODO(S0-11 / engine-dedup): Until services/openagentic-workflows and
// services/openagentic-api consolidate their WorkflowExecutionEngine,
// this file is duplicated. Keep both copies byte-for-byte identical.
// the design notes

export interface ApprovalRecordPayload {
  executionId: string;
  nodeId: string;
  approvers: string[];
  requiredCount: number;
  timeoutSeconds: number;
  timeoutAction: string;
  message: string;
  contextData: Record<string, unknown>;
  notificationChannels: string[];
}

export interface PrismaApprovalClient {
  workflowApproval: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ApprovalRow {
  id: string;
  status: string;
  [key: string]: unknown;
}

export async function createApprovalRecord(
  prismaClient: PrismaApprovalClient,
  payload: ApprovalRecordPayload
): Promise<ApprovalRow> {
  if (!Number.isFinite(payload.timeoutSeconds) || payload.timeoutSeconds < 0) {
    throw new RangeError(
      `timeoutSeconds must be a finite non-negative number, got: ${payload.timeoutSeconds}`
    );
  }

  return prismaClient.workflowApproval.create({
    data: {
      execution_id: payload.executionId,
      node_id: payload.nodeId,
      required_approvers: payload.approvers,
      required_count: payload.requiredCount,
      timeout_seconds: payload.timeoutSeconds,
      timeout_action: payload.timeoutAction,
      status: 'pending',
      message: payload.message,
      context_data: payload.contextData,
      notification_channels: payload.notificationChannels,
      timeout_at: new Date(Date.now() + payload.timeoutSeconds * 1000)
    }
  }) as Promise<ApprovalRow>;
}
