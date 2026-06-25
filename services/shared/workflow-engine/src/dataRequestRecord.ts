/**
 * dataRequestRecord — fail-closed DB helper for human_input / request_data nodes.
 *
 * Sister of approvalRecord.ts. Calls prisma.workflowDataRequest.create and
 * returns the persisted row. Any DB error propagates to the caller as-is —
 * there is NO catch/swallow and no silent fallback: if we cannot persist the
 * request we cannot safely suspend+resume, so the engine's error boundary
 * marks the execution failed and emits node_error.
 *
 * The persisted row is what POST /resume-execution looks up to validate the
 * user's submitted values and re-enter the engine from the checkpoint.
 */

// TODO(S0-11 / engine-dedup): Until services/openagentic-workflows and
// services/openagentic-api consolidate their WorkflowExecutionEngine, this
// file (like approvalRecord.ts) is duplicated. Keep both copies identical.

export interface DataRequestField {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
  placeholder?: string;
  validation?: unknown;
}

export interface DataRequestRecordPayload {
  executionId: string;
  nodeId: string;
  fields: DataRequestField[];
  title: string;
  description: string;
  timeoutSeconds: number;
  timeoutAction: string;
  assignTo: string[];
  channel: string;
  contextData: Record<string, unknown>;
  tenantId?: string | null;
}

export interface PrismaDataRequestClient {
  workflowDataRequest: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface DataRequestRow {
  id: string;
  status: string;
  timeout_at: Date | string;
  [key: string]: unknown;
}

export async function createDataRequestRecord(
  prismaClient: PrismaDataRequestClient,
  payload: DataRequestRecordPayload,
): Promise<DataRequestRow> {
  if (!Number.isFinite(payload.timeoutSeconds) || payload.timeoutSeconds < 0) {
    throw new RangeError(
      `timeoutSeconds must be a finite non-negative number, got: ${payload.timeoutSeconds}`,
    );
  }
  if (!Array.isArray(payload.fields) || payload.fields.length === 0) {
    throw new RangeError('human_input requires at least one field');
  }

  return prismaClient.workflowDataRequest.create({
    data: {
      execution_id: payload.executionId,
      node_id: payload.nodeId,
      fields: payload.fields as unknown,
      title: payload.title,
      description: payload.description,
      timeout_seconds: payload.timeoutSeconds,
      timeout_action: payload.timeoutAction,
      assign_to: payload.assignTo,
      channel: payload.channel,
      status: 'pending',
      context_data: payload.contextData,
      tenant_id: payload.tenantId ?? null,
      timeout_at: new Date(Date.now() + payload.timeoutSeconds * 1000),
    },
  }) as Promise<DataRequestRow>;
}
