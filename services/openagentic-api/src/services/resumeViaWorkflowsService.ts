/**
 * resumeViaWorkflowsService — proxy wrapper that replaces the in-process
 * api WorkflowExecutionEngine.resumeExecution() in workflow-approvals.ts.
 *
 * Last Phase B blocker for the api-side engine class: HITL approval
 * re-entry was the only call site that needed an in-process engine
 * (the rest are wrapped by executeViaWorkflowsService). With this
 * proxy, workflow-approvals.ts can swap one call and the api stops
 * carrying the 4000-LOC engine class.
 *
 * Auth: same internal-key bearer pattern as executeViaWorkflowsService.
 *
 * Streaming: the workflows-svc /resume-execution endpoint emits events
 * over SSE. This wrapper currently uses the buffered JSON shape (axios
 * default) and replays events[] through the supplied onEvent callback —
 * good enough for HITL resume where the consumer (workflow-approvals)
 * doesn't subscribe to true-stream events anyway.
 */

import axios from 'axios';
import { loggers } from '../utils/logger.js';
import { getInternalKey } from '../utils/internalKeyReader.js';
import type { WorkflowDefinition, ExecutionEvent } from '@openagentic/workflow-engine';

const logger = loggers.services;

export interface ResumeViaWorkflowsServiceInput {
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

export interface ResumeViaWorkflowsServiceResult {
  success: boolean;
  output: any;
  error?: string;
}

export async function resumeViaWorkflowsService(
  payload: ResumeViaWorkflowsServiceInput,
  onEvent?: (event: ExecutionEvent) => void,
): Promise<ResumeViaWorkflowsServiceResult> {
  // Task 1.3 (V3 Enterprise Chatmode substrate fix S5): fail-CLOSED on missing
  // tenantId. Same contract as executeViaWorkflowsService — the api caller is
  // the JWT-trusted boundary; passing null/empty here would let the workflows-
  // side Prisma extension fail-open and serve cross-tenant data on resume.
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId.trim() : '';
  if (!tenantId) {
    throw new Error(
      'resumeViaWorkflowsService: tenantId is required (V3 Enterprise Chatmode S5). ' +
        'Caller must derive it from request.tenantId (azure_tenant_id JWT claim) ' +
        'or the workflow row\'s tenant_id — fail-CLOSED rather than ship null on the wire.',
    );
  }

  const baseUrl = process.env.WORKFLOW_SERVICE_URL;
  if (!baseUrl || !baseUrl.trim()) {
    throw new Error(
      'resumeViaWorkflowsService: WORKFLOW_SERVICE_URL is not set. The dedicated workflows-svc is the supported execution path; the api in-process engine is being decoupled (Phase B).',
    );
  }

  const internalKey = getInternalKey();
  const headers: Record<string, string> = {};
  if (internalKey) headers['Authorization'] = `Bearer ${internalKey}`;

  // Normalize the on-the-wire payload so tenantId is the validated value
  // (post-trim) — defends against callers passing whitespace-padded ids.
  const wirePayload = { ...payload, tenantId };

  let response: any;
  try {
    response = await axios.post(`${baseUrl}/resume-execution`, wirePayload, {
      headers,
      timeout: 300_000,
      validateStatus: () => true,
    });
  } catch (err: any) {
    const status = err.response?.status;
    const upstreamMsg = err.response?.data?.error;
    const msg = upstreamMsg || err.message || 'workflows-svc resume request failed';
    logger.error(
      { err: err.message, status, executionId: payload.executionId, fromNodeId: payload.fromNodeId },
      '[resumeViaWorkflowsService] axios error',
    );
    throw new Error(`workflows-svc resume-execution failed${status ? ` (${status})` : ''}: ${msg}`);
  }

  if (response.status >= 400) {
    const upstreamMsg = response.data?.error || `HTTP ${response.status}`;
    logger.error(
      { status: response.status, body: response.data, executionId: payload.executionId },
      '[resumeViaWorkflowsService] non-2xx',
    );
    throw new Error(`workflows-svc resume-execution failed (${response.status}): ${upstreamMsg}`);
  }

  const events: ExecutionEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
  if (onEvent) {
    for (const ev of events) {
      try {
        onEvent(ev);
      } catch (cbErr: any) {
        logger.warn({ err: cbErr.message }, '[resumeViaWorkflowsService] onEvent callback threw');
      }
    }
  }

  return {
    success: !!response.data?.success,
    output: response.data?.output ?? null,
    error: response.data?.error,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// HITL human_input / request_data SUBMIT proxy.
//
// The flows "human_input"/"request_data" node pauses a run and persists a
// WorkflowDataRequest row + emits a `needs_input` frame. This is the SUBMIT
// half: the user (proxied by the api route) supplies their typed `values`; we
// POST a data-request submission to the SAME workflows-svc /resume-execution
// endpoint, which discriminates on `kind:'data_request'`, looks up + validates
// the row against its stored fields[], marks it provided, and re-enters the
// engine from the request's node. No definition/state/fromNodeId is sent — the
// workflows-svc owns the lookup so the api never has to hydrate the engine.
//
// Auth + tenant contract is identical to resumeViaWorkflowsService: fail-CLOSED
// on missing tenantId, internal-key bearer, buffered events[] replay.
// ───────────────────────────────────────────────────────────────────────────

export interface SubmitDataRequestViaWorkflowsInput {
  executionId: string;
  requestId: string;
  values: Record<string, unknown>;
  /** The submitting user's id, threaded as `provided_by`. */
  providedBy?: string;
  /** ISO timestamp; stamped server-side if omitted. */
  providedAt?: string;
  tenantId?: string | null;
}

export async function submitDataRequestViaWorkflowsService(
  input: SubmitDataRequestViaWorkflowsInput,
  onEvent?: (event: ExecutionEvent) => void,
): Promise<ResumeViaWorkflowsServiceResult> {
  // Fail-CLOSED on tenantId (same contract as resumeViaWorkflowsService).
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : '';
  if (!tenantId) {
    throw new Error(
      'submitDataRequestViaWorkflowsService: tenantId is required. ' +
        "Caller must derive it from request.tenantId (azure_tenant_id JWT claim) " +
        "or the WorkflowDataRequest row's tenant_id — fail-CLOSED rather than ship null.",
    );
  }

  if (!input.requestId || !input.requestId.trim()) {
    throw new Error('submitDataRequestViaWorkflowsService: requestId is required');
  }

  const baseUrl = process.env.WORKFLOW_SERVICE_URL;
  if (!baseUrl || !baseUrl.trim()) {
    throw new Error(
      'submitDataRequestViaWorkflowsService: WORKFLOW_SERVICE_URL is not set. The dedicated workflows-svc is the supported execution path.',
    );
  }

  const internalKey = getInternalKey();
  const headers: Record<string, string> = {};
  if (internalKey) headers['Authorization'] = `Bearer ${internalKey}`;

  const wirePayload = {
    kind: 'data_request' as const,
    executionId: input.executionId,
    requestId: input.requestId,
    values: input.values ?? {},
    providedBy: input.providedBy,
    providedAt: input.providedAt ?? new Date().toISOString(),
    tenantId,
  };

  let response: any;
  try {
    response = await axios.post(`${baseUrl}/resume-execution`, wirePayload, {
      headers,
      timeout: 300_000,
      validateStatus: () => true,
    });
  } catch (err: any) {
    const status = err.response?.status;
    const upstreamMsg = err.response?.data?.error;
    const msg = upstreamMsg || err.message || 'workflows-svc data-request submit failed';
    logger.error(
      { err: err.message, status, executionId: input.executionId, requestId: input.requestId },
      '[submitDataRequestViaWorkflowsService] axios error',
    );
    throw new Error(`workflows-svc resume-execution (data_request) failed${status ? ` (${status})` : ''}: ${msg}`);
  }

  if (response.status >= 400) {
    const upstreamMsg = response.data?.error || `HTTP ${response.status}`;
    logger.error(
      { status: response.status, body: response.data, requestId: input.requestId },
      '[submitDataRequestViaWorkflowsService] non-2xx',
    );
    throw new Error(`workflows-svc resume-execution (data_request) failed (${response.status}): ${upstreamMsg}`);
  }

  const events: ExecutionEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
  if (onEvent) {
    for (const ev of events) {
      try {
        onEvent(ev);
      } catch (cbErr: any) {
        logger.warn({ err: cbErr.message }, '[submitDataRequestViaWorkflowsService] onEvent callback threw');
      }
    }
  }

  return {
    success: !!response.data?.success,
    output: response.data?.output ?? null,
    error: response.data?.error,
  };
}
