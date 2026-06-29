/**
 * human_approval node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeApprovalNode (legacy switch
 * cases 'approval' and 'human_approval' around line 1159 / 3154 in
 * services/openagentic-workflows and 889 / 2437 in services/openagentic-api).
 *
 * The same plugin is registered under both type names — see registry.ts
 * where `human_approval` is the canonical form and `approval` is wired via
 * registerAlias().
 *
 * The executor delegates the heavy work to the optional ctx.pauseForApproval
 * hook (engine wires it to: createApprovalRecord → workflowExecution.update
 * → emitEvent('approval_required') → sendApprovalNotifications), then
 * returns `{ status: 'awaiting_approval', approvalId, message, approvers,
 * expiresAt }`. The engine's existing pause logic (executeNodeWithRecovery
 * around line 920) recognises that status and emits `execution_paused` to
 * stop downstream execution. The auto-approve gate (canAutoApprove) also
 * runs there.
 *
 * The schema-level outputAssertion only checks `non_empty_message` because
 * `awaiting_approval` is a legitimate paused state — asserting on
 * `result.status === 'approved'` would treat every paused approval as a
 * fake-success failure.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) {
    throw new Error('aborted');
  }

  const data = (node.data || {}) as Record<string, any>;
  const configuredApprovers: string[] = Array.isArray(data.approvers)
    ? data.approvers.filter((a): a is string => typeof a === 'string' && a.length > 0)
    : [];
  // Default-approver guard (live defect 2026-06-02): a human_approval node with
  // no approvers persists `required_approvers: []`, and
  // routes/workflow-approvals.ts gates the decide endpoint on
  // `required_approvers.includes(userId)` — so an empty list means NO user can
  // approve/reject and the gate dead-ends. When no approvers are configured,
  // fall back to the run-trigger user (ctx.userId) so the person who ran the
  // flow can act on their own gate. When the engine is not user-scoped
  // (ctx.userId unset, e.g. system/cron runs), preserve the empty list so the
  // schema-level config validators still surface the misconfiguration.
  const approvers: string[] =
    configuredApprovers.length > 0
      ? configuredApprovers
      : typeof ctx.userId === 'string' && ctx.userId.length > 0
        ? [ctx.userId]
        : [];
  const requiredCount: number = Number.isFinite(data.requiredCount)
    ? Number(data.requiredCount)
    : 1;
  const timeoutSeconds: number = Number.isFinite(data.timeout)
    ? Number(data.timeout)
    : 86400;
  const timeoutAction: string =
    typeof data.timeoutAction === 'string' && data.timeoutAction.length > 0
      ? data.timeoutAction
      : 'reject';
  const notificationChannels: string[] = Array.isArray(data.notificationChannels)
    ? data.notificationChannels
    : ['in_app'];

  // Message is templatable; fall back to a self-describing default that
  // references the node id so the reviewer has at least some context. The
  // empty string is preserved verbatim so the schema-level non_empty_message
  // assertion can flag misconfigured flows.
  let message: string;
  if (typeof data.message === 'string') {
    message = ctx.interpolateTemplate(data.message, input);
  } else {
    message = `Approval required for workflow step: ${node.id}`;
  }

  if (!ctx.pauseForApproval) {
    throw new Error(
      'Human-approval node requires ctx.pauseForApproval hook — engine is not wired correctly',
    );
  }

  ctx.logger.info(
    { nodeId: node.id, approvers, requiredCount, timeoutSeconds },
    '[human_approval] Pausing workflow for human approval',
  );

  const approval = await ctx.pauseForApproval({
    nodeId: node.id,
    approvers,
    requiredCount,
    timeoutSeconds,
    timeoutAction,
    message,
    notificationChannels,
    input,
  });

  return {
    status: 'awaiting_approval',
    approvalId: approval.id,
    // Pass through whatever message the executor sent in — the engine
    // hook may rewrite it (e.g. to apply default phrasing) but here we
    // preserve the configured value so the assertion is meaningful.
    message,
    approvers,
    expiresAt: approval.timeout_at,
  };
}
