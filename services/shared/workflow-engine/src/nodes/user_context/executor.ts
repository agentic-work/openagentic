/**
 * user_context node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeUserContextNode (legacy switch
 * case 'user_context' around line 1188 / 2648).
 *
 * Calls GET {apiUrl}/api/user-context with userId/sources/query/maxTokens
 * and returns the response body. Failures degrade gracefully to a
 * { context: [], error } shape — the schema-level outputAssertion then
 * catches that error shape via `non_empty_content` so a transient
 * context-service hiccup surfaces as `output_failed_assertion` instead of
 * silently returning an empty array.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosGet } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const sources: string[] = Array.isArray(data.contextSources) && data.contextSources.length > 0
    ? data.contextSources
    : ['chat', 'workflow', 'memory'];
  const query = ctx.interpolateTemplate(data.contextQuery || '', input);
  const maxTokens = data.contextMaxTokens || 2000;

  ctx.logger.info(
    { nodeId: node.id, userId: ctx.userId, sources, maxTokens },
    '[user_context] Executing user context node',
  );

  try {
    const response = await abortableAxiosGet(
      { signal: ctx.signal },
      `${ctx.apiUrl}/api/user-context`,
      {
        params: {
          userId: ctx.userId,
          sources: sources.join(','),
          query,
          maxTokens,
        },
        headers: ctx.getInternalAuthHeaders(),
        timeout: 10000,
      },
    );
    return response.data;
  } catch (err: any) {
    ctx.logger.warn(
      { err, nodeId: node.id },
      '[user_context] Failed to load user context',
    );
    return { context: [], error: (err as Error).message };
  }
}
