/**
 * vector_store node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeVectorStoreNode.
 * Upserts/deletes vectors via the platform's /api/v1/vector/store
 * endpoint. Falls back to /api/files/embed for legacy compatibility.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const operation = data.operation || 'upsert';
  const collection = ctx.interpolateTemplate(data.collection || 'default', input);
  const createIfMissing = data.createIfMissing !== false;

  const inputObj = (input || {}) as any;
  const vectors = inputObj?.vectors || [];
  const texts = inputObj?.texts || [];
  const metadata = data.metadata || inputObj?.metadata || {};

  ctx.logger.info(
    {
      nodeId: node.id,
      operation,
      collection,
      vectorCount: Array.isArray(vectors) ? vectors.length : 0,
    },
    '[vector_store] Operation',
  );

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${ctx.apiUrl}/api/v1/vector/store`,
    { collection, operation, vectors, texts, metadata, createIfMissing },
    {
      headers: ctx.getInternalAuthHeaders(),
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  if (response.status >= 400) {
    // Fallback: use the files/embed endpoint
    const content = (texts as string[]).join('\n\n');
    const fallback = await abortableAxiosPost(
      { signal: ctx.signal },
      `${ctx.apiUrl}/api/files/embed`,
      {
        content,
        collection,
        fileName: `flow-${ctx.executionId}`,
        chunkSize: 0,
      },
      {
        headers: ctx.getInternalAuthHeaders(),
        timeout: 120000,
        validateStatus: () => true,
      },
    );
    const fbData: any = fallback.data || {};
    return {
      collection,
      operation,
      stored: fbData.chunks || (texts as string[]).length,
      ...fbData,
    };
  }

  const respData: any = response.data || {};
  return {
    collection,
    operation,
    stored: respData.count || (Array.isArray(vectors) ? vectors.length : 0),
    ...respData,
  };
}
