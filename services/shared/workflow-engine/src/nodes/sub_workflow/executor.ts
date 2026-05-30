/**
 * sub_workflow node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeSubWorkflowNode (legacy switch
 * case 'sub_workflow' around line 1208 / 4613).
 *
 * Invokes another saved workflow by id via the optional
 * ctx.executeSubWorkflow hook. The engine wires the hook to a recursive
 * `executeWorkflow(...)` call that:
 *   - loads the target workflow definition from Prisma
 *   - derives a child execution id (`sub-<parentId>-<nodeId>`)
 *   - propagates the caller's user / authToken / userEmail / idToken
 *
 * Keeping the recursion behind a hook means the executor stays
 * independently testable (no Prisma, no engine import) and the schema-level
 * `subworkflow_completed_successfully` assertion can catch a child that
 * silently returns nothing.
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
  const { workflowId, passInput = true } = data;

  const resolvedWorkflowId = ctx.interpolateTemplate(workflowId || '', input);
  if (!resolvedWorkflowId) {
    throw new Error('Sub-workflow node requires a workflowId');
  }

  if (!ctx.executeSubWorkflow) {
    throw new Error(
      'Sub-workflow node requires ctx.executeSubWorkflow hook — engine is not wired correctly',
    );
  }

  const subInput: unknown = passInput
    ? typeof input === 'object' && input !== null
      ? input
      : { data: input }
    : {};

  ctx.logger.info(
    { nodeId: node.id, subWorkflowId: resolvedWorkflowId, passInput },
    '[sub_workflow] Executing sub-workflow node',
  );

  const result = await ctx.executeSubWorkflow(resolvedWorkflowId, subInput);

  if (!result.success) {
    throw new Error(`Sub-workflow failed: ${result.error || 'unknown error'}`);
  }

  ctx.logger.info(
    { nodeId: node.id, subWorkflowId: resolvedWorkflowId, success: true },
    '[sub_workflow] Sub-workflow completed',
  );

  return result.output;
}
