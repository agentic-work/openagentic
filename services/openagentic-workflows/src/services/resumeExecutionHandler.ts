/**
 * resumeExecutionHandler — pure handler for POST /resume-execution.
 *
 * Phase B blocker (#16): the api's workflow-approvals.ts currently does
 *
 *   const engine = new WorkflowExecutionEngine(definition, context);
 *   await engine.resumeExecution(approval.node_id, { approved: true, approvedBy });
 *
 * in-process, which is the last thing keeping the api-side engine class
 * alive. This handler exposes the same operation as a workflows-svc
 * endpoint so the api can proxy via executeViaWorkflowsService and the
 * 4000-LOC engine in api/src/services/WorkflowExecutionEngine.ts can go.
 *
 * Saved-state shape: the api persists `variables` and `nodeResults` as
 * plain JS objects (the engine's Maps are JSON-encoded), plus the input
 * snapshot and the original startTime ms. The handler hydrates those
 * back into Maps before constructing the engine.
 */

import { WorkflowExecutionEngine } from './WorkflowExecutionEngine.js';
import type { WorkflowDefinition, ExecutionContext, ExecutionEvent } from './WorkflowExecutionEngine.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.services;

export interface ResumeExecutionInput {
  workflowId: string;
  executionId: string;
  definition: WorkflowDefinition;
  fromNodeId: string;
  resumeInput?: unknown;
  state: {
    input: Record<string, any>;
    variables: Record<string, any>;
    nodeResults: Record<string, any>;
    startTimeMs: number;
  };
  userId: string;
  authToken?: string;
  idToken?: string;
  userEmail?: string;
  triggerType?: string;
  userPermissions?: readonly string[];
  userGroups?: readonly string[];
  tenantId?: string | null;
}

export interface ResumeExecutionResult {
  success: boolean;
  output: any;
  error?: string;
}

export async function resumeExecutionHandler(
  payload: ResumeExecutionInput,
  onEvent: (event: ExecutionEvent) => void,
): Promise<ResumeExecutionResult> {
  const ctx: ExecutionContext = {
    executionId: payload.executionId,
    workflowId: payload.workflowId,
    userId: payload.userId,
    tenantId: payload.tenantId ?? null,
    authToken: payload.authToken,
    idToken: payload.idToken,
    userEmail: payload.userEmail,
    triggerType: payload.triggerType,
    userPermissions: payload.userPermissions,
    userGroups: payload.userGroups,
    input: payload.state.input || {},
    variables: new Map(Object.entries(payload.state.variables || {})),
    nodeResults: new Map(Object.entries(payload.state.nodeResults || {})),
    startTime: payload.state.startTimeMs,
    sharedContext: new Map(),
  };

  const engine = new WorkflowExecutionEngine(payload.definition, ctx);

  if (onEvent) {
    engine.on('event', onEvent);
  }

  try {
    const result = await engine.resumeExecution(payload.fromNodeId, payload.resumeInput);
    return {
      success: !!result.success,
      output: result.output,
      error: result.error,
    };
  } catch (err: any) {
    logger.error(
      { err: err.message, executionId: payload.executionId, fromNodeId: payload.fromNodeId },
      '[resumeExecutionHandler] engine threw during resume',
    );
    return {
      success: false,
      output: null,
      error: err.message || 'engine threw during resume',
    };
  }
}
