/**
 * rag_query node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeRagQueryNode.
 * Calls the platform's /api/v1/vector/search endpoint to perform a
 * semantic search against a Milvus collection.
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
  const collection = data.collection || 'default';
  const query = data.query;
  const topK = data.topK ?? 5;
  const filters = data.filters;
  const scoreThreshold = data.scoreThreshold ?? 0.5;

  const resolvedQuery = ctx.interpolateTemplate(query || '', input);
  const resolvedCollection = ctx.interpolateTemplate(collection, input);

  if (!resolvedQuery) {
    throw new Error('RAG query node requires a query');
  }

  ctx.logger.info(
    { nodeId: node.id, collection: resolvedCollection, topK },
    '[rag_query] Executing',
  );

  let resolvedFilters: unknown = undefined;
  if (filters !== undefined && filters !== null && filters !== '') {
    if (typeof filters === 'string') {
      try {
        resolvedFilters = JSON.parse(ctx.interpolateTemplate(filters, input));
      } catch {
        resolvedFilters = undefined;
      }
    } else {
      resolvedFilters = filters;
    }
  }

  // rag_query embeds the query then performs a vector search. OTel GenAI
  // v1.37 maps the embedding portion to operation=embeddings; the search
  // itself is not a GenAI op (it's a DB read). Wrap the whole call as
  // embeddings since the model-touching work is the embed step.
  return withGenAISpan(
    {
      operation: 'embeddings',
      system: 'openagentic.platform',
      requestModel: 'auto',
    },
    async () => {
      const response = await abortableAxiosPost(
        { signal: ctx.signal },
        `${ctx.apiUrl}/api/v1/vector/search`,
        {
          collection: resolvedCollection,
          query: resolvedQuery,
          topK,
          filters: resolvedFilters,
          scoreThreshold,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...ctx.getInternalAuthHeaders(),
          },
          timeout: 30000,
          validateStatus: () => true,
        },
      );

      if (response.status >= 400) {
        const errData: any = response.data;
        throw new Error(`RAG query failed: ${errData?.error || response.statusText}`);
      }

      const respData: any = response.data;
      const results = respData?.results || respData || [];
      const out = {
        query: resolvedQuery,
        collection: resolvedCollection,
        resultCount: Array.isArray(results) ? results.length : 0,
        results,
      };
      return {
        result: out,
        meta: {
          responseModel: respData?.embeddingModel as string | undefined,
          // /api/v1/vector/search does not return token counts.
          inputTokens: 0,
          outputTokens: 0,
        },
      };
    },
  );
}
