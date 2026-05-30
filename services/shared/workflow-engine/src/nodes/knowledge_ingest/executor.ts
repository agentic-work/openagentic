/**
 * knowledge_ingest node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeKnowledgeIngestNode.
 * POSTs content to the platform's /api/chat/knowledge/ingest endpoint
 * (which writes to Milvus via the API service).
 *
 * Behavioral preservation:
 *   - returns { success: false, chunksIngested: 0 } if content is < 10 chars
 *   - swallows network errors (returns success: false instead of throwing)
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { collection = 'shared', source = 'workflow' } = (node.data || {}) as Record<
    string,
    any
  >;

  const inputObj = (input || {}) as any;
  const content =
    inputObj?.output?.content ||
    inputObj?.output ||
    inputObj?.content ||
    (node.data as any)?.content ||
    '';

  if (!content || typeof content !== 'string' || content.length < 10) {
    return {
      success: false,
      error: 'No content to ingest (need at least 10 chars)',
      chunksIngested: 0,
    };
  }

  ctx.logger.info(
    { nodeId: node.id, collection, contentLength: content.length },
    '[knowledge_ingest] Executing',
  );

  try {
    const response = await abortableAxiosPost(
      { signal: ctx.signal },
      `${ctx.apiUrl}/api/chat/knowledge/ingest`,
      {
        content,
        collection,
        metadata: {
          source,
          workflow_node: node.id,
          ingested_by: 'workflow_engine',
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...ctx.getInternalAuthHeaders(),
          'X-Request-From': 'internal',
        },
        timeout: 60000,
        validateStatus: () => true,
      },
    );

    return response.data;
  } catch (error: any) {
    ctx.logger.error(
      { nodeId: node.id, error: error?.message },
      '[knowledge_ingest] Failed',
    );
    return {
      success: false,
      error: error?.message || 'Unknown ingestion error',
      chunksIngested: 0,
    };
  }
}
