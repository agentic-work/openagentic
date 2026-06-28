/**
 * data_query node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeDataQueryNode (legacy switch
 * case 'data_query' around line 1193 / 5013).
 *
 * Posts to {apiUrl}/api/v1/vector/search with the resolved collection,
 * query, topK, and optional filters; returns a normalised
 * { collection, results, resultCount } shape so downstream nodes don't
 * have to inspect axios envelopes.
 *
 * Behavior preserved from the legacy method:
 *   - 'collection' or 'collectionName' both accepted; 'default' fallback.
 *   - query may be templated; when blank, fall back to input.query /
 *     input.message / serialised input.
 *   - filters may be a plain object OR a JSON string with template vars.
 *   - HTTP non-2xx throws — closes the "fake success" gap on transport
 *     errors. The schema-level `non_empty_content` assertion catches the
 *     "zero results" gap on top of that.
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
  const { collection, collectionName, query, filters, limit: queryLimit } = data;

  const resolvedCollection = ctx.interpolateTemplate(
    collection || collectionName || 'default',
    input,
  );
  const resolvedQuery = query
    ? ctx.interpolateTemplate(query, input)
    : undefined;

  // Fallback query resolution mirrors the legacy executor: explicit setting,
  // then input.query, then input.message, then the raw stringified input.
  const fallbackQuery =
    typeof input === 'string'
      ? input
      : (input as any)?.message || (input as any)?.query || JSON.stringify(input);

  let resolvedFilters: unknown = undefined;
  if (filters !== undefined && filters !== null) {
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

  ctx.logger.info(
    { nodeId: node.id, collection: resolvedCollection, topK: queryLimit || 10 },
    '[data_query] Executing data query node',
  );

  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    `${ctx.apiUrl}/api/v1/vector/search`,
    {
      collection: resolvedCollection,
      query: resolvedQuery || fallbackQuery,
      topK: queryLimit || 10,
      filters: resolvedFilters,
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
    const apiErr = (response.data && (response.data as any).error) || response.statusText;
    throw new Error(`Data query failed: ${apiErr}`);
  }

  const results = (response.data as any)?.results ?? response.data ?? [];
  const resultsArr = Array.isArray(results) ? results : [];
  return {
    collection: resolvedCollection,
    results: resultsArr,
    resultCount: resultsArr.length,
  };
}
