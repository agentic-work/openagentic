/**
 * data_source_query node executor.
 *
 * Migrated from WorkflowExecutionEngine.executeDataSourceQueryNode (legacy
 * switch case 'data_source_query' around line 1191 / 4307).
 *
 * Distinct from `data_query` (which targets the vector-search endpoint).
 * This node POSTs to either:
 *   - {apiUrl}/api/data-sources/:id/query     (mode='raw',  body={query})
 *   - {apiUrl}/api/data-sources/:id/nl-query  (mode='nl',   body={question})
 *
 * The natural-language mode falls back to {{input.message}} when the
 * `question` setting is blank, mirroring the legacy behaviour. Both modes
 * return the same shape so downstream nodes don't have to branch.
 *
 * Schema-level outputAssertions (see schema.json) catch:
 *   - non-array `rows`     → query_returned_rows
 *   - any `error` field    → no_query_error
 * The empty-rows case is intentionally allowed because a user may legitimately
 * want a row-count check downstream.
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
  const { mode = 'raw', query, question } = data;

  const dataSourceId = ctx.interpolateTemplate(data.dataSourceId || '', input);
  if (!dataSourceId) {
    throw new Error('Data source query node requires a dataSourceId');
  }

  const queryText =
    mode === 'nl'
      ? ctx.interpolateTemplate(question || '{{input.message}}', input)
      : ctx.interpolateTemplate(query || '', input);

  if (!queryText) {
    throw new Error(
      `Data source query node requires a ${mode === 'nl' ? 'question' : 'query'}`,
    );
  }

  const endpoint =
    mode === 'nl'
      ? `${ctx.apiUrl}/api/data-sources/${dataSourceId}/nl-query`
      : `${ctx.apiUrl}/api/data-sources/${dataSourceId}/query`;

  const body = mode === 'nl' ? { question: queryText } : { query: queryText };

  ctx.logger.info(
    { nodeId: node.id, dataSourceId, mode, queryLength: queryText.length },
    '[data_source_query] Executing data source query',
  );

  // The api filters data sources by created_by via authMiddleware. Use the
  // engine's getInternalAuthHeaders() — it now forwards X-User-Id + X-User-Email
  // when the engine has a real user context (post 2026-05-14), so the api's
  // unifiedAuth resolves the real user under internal-secret-auth rather than
  // a synthetic service identity. System-fired schedule triggers fall back to
  // the service identity (no X-User-Id forwarded), which still authenticates
  // via the shared secret.
  const response = await abortableAxiosPost(
    { signal: ctx.signal },
    endpoint,
    body,
    {
      headers: {
        ...ctx.getInternalAuthHeaders(),
        'Content-Type': 'application/json',
      },
      timeout: 35000,
    },
  );

  const result = (response.data || {}) as Record<string, any>;
  if (result.success === false) {
    throw new Error(result.error || 'Data source query failed');
  }

  return {
    rows: result.rows,
    columns: result.columns,
    rowCount: result.rowCount,
    executionTimeMs: result.executionTimeMs,
    generatedQuery: result.generatedQuery,
    content: JSON.stringify(
      Array.isArray(result.rows) ? result.rows.slice(0, 50) : result.rows,
      null,
      2,
    ),
  };
}
