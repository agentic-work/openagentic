/**
 * knowledge_search node executor.
 *
 * POSTs `{ query, topK }` to ${apiUrl}/api/chat/knowledge/search and returns
 * { query, resultCount, results }.
 *
 * Bridges the ingest/search-collection mismatch: knowledge_ingest writes to
 * shared_knowledge / user_<id>_private; this node reads back from the same
 * collections via ChatRAGService.getRAGContext. Use rag_query for the
 * code/docs/memories Milvus collections instead.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxiosPost } from '../../abortableAxios.js';
import { withGenAISpan } from '../../observability/GenAITracer.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const rawQuery = data.query || '';
  const topK = data.topK ?? 5;

  const resolvedQuery = ctx.interpolateTemplate(String(rawQuery), input).trim();
  if (!resolvedQuery) {
    throw new Error('knowledge_search requires a non-empty query');
  }

  ctx.logger.info(
    { nodeId: node.id, topK, queryLen: resolvedQuery.length },
    '[knowledge_search] Executing',
  );

  return withGenAISpan(
    {
      operation: 'embeddings',
      system: 'openagentic.platform',
      requestModel: 'auto',
    },
    async () => {
      const response = await abortableAxiosPost(
        { signal: ctx.signal },
        `${ctx.apiUrl}/api/chat/knowledge/search`,
        { query: resolvedQuery, topK },
        {
          headers: {
            'Content-Type': 'application/json',
            ...ctx.getInternalAuthHeaders(),
            'X-Request-From': 'internal',
          },
          timeout: 30000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 400) {
        const errData: any = response.data;
        throw new Error(
          `knowledge_search failed: ${errData?.error || errData?.message || response.statusText}`,
        );
      }

      const respData: any = response.data || {};
      const results = Array.isArray(respData.results) ? respData.results : [];

      const out = {
        query: resolvedQuery,
        resultCount: results.length,
        results,
      };

      return {
        result: out,
        meta: {
          // /api/chat/knowledge/search does not return embedding tokens.
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    },
  );
}
