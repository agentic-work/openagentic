/**
 * Auto-approval gate.
 *
 * Replaces the legacy `context.input.autoApprove` backdoor that silently
 * approved any approval/human_approval node when the execution input
 * carried `autoApprove: true`. The new gate requires three conditions:
 *
 *   1. `input.autoApprove` is truthy (legacy signal)
 *   2. `triggerType === 'test'` — only test executions can auto-approve
 *   3. The caller carries the `flows:test:auto-approve` permission
 *
 * If any condition fails, the approval node MUST pause and emit
 * `execution_paused`, exactly as a real approval would.
 */

export interface AutoApproveDecisionContext {
  input?: { autoApprove?: unknown };
  triggerType?: string;
  userPermissions?: readonly string[];
}

const REQUIRED_PERMISSION = 'flows:test:auto-approve';
const TEST_TRIGGER = 'test';

function isAutoApproveTruthy(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === 'string' && value.toLowerCase() === 'true') return true;
  return false;
}

export function canAutoApprove(ctx: AutoApproveDecisionContext | null | undefined): boolean {
  if (!ctx) return false;
  if (!isAutoApproveTruthy(ctx.input?.autoApprove)) return false;
  if (ctx.triggerType !== TEST_TRIGGER) return false;
  if (!ctx.userPermissions?.includes(REQUIRED_PERMISSION)) return false;
  return true;
}
