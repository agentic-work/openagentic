/**
 * executeViaWorkflowsService — proxy wrapper that replaces the in-process
 * api WorkflowExecutionEngine.executeWorkflow() with a single axios POST
 * to the dedicated workflows-svc /execute-sync endpoint.
 *
 * Same signature as the legacy executeWorkflow() so each of the 5
 * production importers (WorkflowScheduler, WorkflowTestRunner,
 * routes/workflows, routes/v1/webhooks, routes/workflow-approvals) can
 * swap one import line and the api stops carrying the 4000-LOC engine
 * class.
 *
 * Phase A (already shipped) added reportLocalEngineFallback() at every
 * legacy call-site so the workflow_local_engine_fallback_total counter
 * proves zero traffic before this proxy lands. Once those counters
 * read zero on the dashboard, swap imports and delete the engine.
 *
 * Auth: sends Authorization: Bearer <internal-key> via getInternalKey().
 * Workflows-svc requireInternalKey() middleware (P0a) enforces it.
 *
 * Streaming: workflows-svc /execute-sync collects events into the
 * response body. We replay them through the supplied onEvent callback
 * so consumers that subscribed to streaming events still get them — at
 * the same fidelity, just buffered instead of true-stream. Consumers
 * that need true streaming should call the SSE /execute endpoint
 * directly (already supported).
 */

import axios from 'axios';
import { loggers } from '../utils/logger.js';
import { getInternalKey } from '../utils/internalKeyReader.js';
import type { WorkflowDefinition, ExecutionEvent, TestMocks } from '@openagentic/workflow-engine';

const logger = loggers.services;

export interface ExecuteViaWorkflowsServiceResult {
  success: boolean;
  output: any;
  error?: string;
}

export interface ExecuteViaWorkflowsServiceOpts {
  userEmail?: string;
  idToken?: string;
  triggerType?: string;
  userPermissions?: readonly string[];
  /** Group IDs the caller belongs to. Used for WorkflowSecret allowed_groups ACL checks. S0-9/B5. */
  userGroups?: readonly string[];
  /**
   * Caller's tenant id (Theme A / Task 1.3 — V3 Enterprise Chatmode substrate fix S5).
   * REQUIRED — must be a non-empty string. The api caller is the JWT-trusted boundary
   * for tenant resolution; if it can't derive a tenant from `request.tenantId`
   * (populated by tenantContextPlugin from the `azure_tenant_id`/`tid` JWT claim
   * or the user row), we fail-CLOSED here rather than silently shipping null
   * and letting the workflows-side Prisma extension fail-open downstream.
   *
   * Optional in TS (so `?` syntax works at call-sites that build opts incrementally),
   * but the runtime guard rejects undefined/null/empty/whitespace-only values.
   */
  tenantId?: string | null;
  /** Phase B #17: test-mode mocks forwarded to workflows-svc engine. */
  mocks?: TestMocks;
}

export async function executeViaWorkflowsService(
  workflowId: string,
  executionId: string,
  definition: WorkflowDefinition,
  input: Record<string, any>,
  userId: string,
  authToken?: string,
  onEvent?: (event: ExecutionEvent) => void,
  opts?: ExecuteViaWorkflowsServiceOpts,
): Promise<ExecuteViaWorkflowsServiceResult> {
  // Task 1.3 (V3 Enterprise Chatmode substrate fix S5): fail-CLOSED on missing
  // tenantId. The api caller is the JWT-trusted boundary; passing through with
  // a null tenantId would let the workflows-side Prisma extension fail-open
  // and serve cross-tenant data. Validated BEFORE the URL check so a config
  // misalignment never masks a tenant-resolution bug.
  const tenantId = typeof opts?.tenantId === 'string' ? opts.tenantId.trim() : '';
  if (!tenantId) {
    throw new Error(
      'executeViaWorkflowsService: tenantId is required (V3 Enterprise Chatmode S5). ' +
        'Caller must derive it from request.tenantId (azure_tenant_id JWT claim) ' +
        'or the workflow row\'s tenant_id — fail-CLOSED rather than ship null on the wire.',
    );
  }

  const baseUrl = process.env.WORKFLOW_SERVICE_URL;
  if (!baseUrl || !baseUrl.trim()) {
    throw new Error(
      'executeViaWorkflowsService: WORKFLOW_SERVICE_URL is not set. The dedicated workflows-svc pod is the supported execution path; the api in-process engine is being decoupled (Phase B).',
    );
  }

  const internalKey = getInternalKey();
  const headers: Record<string, string> = {};
  if (internalKey) headers['Authorization'] = `Bearer ${internalKey}`;

  const body = {
    workflowId,
    executionId,
    definition,
    input,
    userId,
    authToken,
    idToken: opts?.idToken,
    userEmail: opts?.userEmail,
    triggerType: opts?.triggerType,
    userPermissions: opts?.userPermissions,
    userGroups: opts?.userGroups,
    tenantId, // validated non-empty above
    mocks: opts?.mocks,
  };

  let response: any;
  try {
    response = await axios.post(`${baseUrl}/execute-sync`, body, {
      headers,
      timeout: 300_000, // 5 min — same as the SSE proxy budget
      validateStatus: () => true, // surface non-2xx as data so we can format the error
    });
  } catch (err: any) {
    const status = err.response?.status;
    const upstreamMsg = err.response?.data?.error;
    const msg = upstreamMsg || err.message || 'workflows-svc request failed';
    logger.error({ err: err.message, status, workflowId, executionId }, '[executeViaWorkflowsService] axios error');
    throw new Error(`workflows-svc execute-sync failed${status ? ` (${status})` : ''}: ${msg}`);
  }

  if (response.status >= 400) {
    const upstreamMsg = response.data?.error || `HTTP ${response.status}`;
    logger.error({ status: response.status, body: response.data, workflowId }, '[executeViaWorkflowsService] non-2xx');
    throw new Error(`workflows-svc execute-sync failed (${response.status}): ${upstreamMsg}`);
  }

  // Replay events[] so streaming consumers still see node_start /
  // node_complete / etc. Buffered fidelity — same shape, just delivered
  // after /execute-sync returns. True-stream consumers continue using
  // the SSE proxy in routes/workflows.ts.
  const events: ExecutionEvent[] = Array.isArray(response.data?.events) ? response.data.events : [];
  if (onEvent) {
    for (const ev of events) {
      try {
        onEvent(ev);
      } catch (cbErr: any) {
        logger.warn({ err: cbErr.message }, '[executeViaWorkflowsService] onEvent callback threw');
      }
    }
  }

  return {
    success: !!response.data?.success,
    output: response.data?.output ?? null,
    error: response.data?.error,
  };
}
