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

// The /api/v1/vector/search route enforces a strict collection enum
// (services/openagentic-api/src/routes/v1/vector.ts — schema `enum:
// ['code','docs','memories']`). Any other value 400s at runtime. Keep this
// list in sync with that route.
const VALID_COLLECTIONS = ['code', 'docs', 'memories'] as const;

// The /api/v1/vector/search route caps `query` at 1000 chars
// (services/openagentic-api/src/routes/v1/vector.ts schema maxLength:1000).
const MAX_QUERY_CHARS = 1000;

/**
 * Coerce an upstream-produced value into a valid vector-search query.
 *
 * Upstream LLM nodes commonly emit a "generate N search queries → JSON array of
 * strings" output, and verbose models blow past the route's 1000-char cap. Left
 * raw, that 400s the whole flow ("body/query must NOT have more than 1000
 * characters"). This degrades it gracefully instead:
 *   1. If the value is a JSON array of strings, search with its first concrete
 *      query (embedding the literal array text would be meaningless anyway).
 *   2. Cap the result at MAX_QUERY_CHARS so an over-long query truncates rather
 *      than erroring.
 */
function coerceVectorQuery(raw: string): string {
  let q = raw;
  const t = q.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        const first = arr.find((x) => typeof x === 'string' && x.trim().length > 0);
        if (first) q = String(first).trim();
      }
    } catch {
      /* not JSON — use the string as-is */
    }
  }
  if (q.length > MAX_QUERY_CHARS) q = q.slice(0, MAX_QUERY_CHARS);
  return q;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;
  const collection = data.collection;
  const query = data.query;
  const topK = data.topK ?? 5;
  const filters = data.filters;
  const scoreThreshold = data.scoreThreshold ?? 0.5;

  // Required-input guard: query must be a non-empty string. A null/blank
  // query previously sailed through and Milvus returned zero rows — a
  // silent fake-success. Fail clearly instead.
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('rag_query requires a non-empty query');
  }
  const interpolatedQuery = ctx.interpolateTemplate(query, input).trim();
  if (!interpolatedQuery) {
    throw new Error('rag_query requires a non-empty query');
  }
  // Degrade a verbose / JSON-array upstream output to a valid query rather than
  // letting the route 400 on it (airtight node behavior).
  const resolvedQuery = coerceVectorQuery(interpolatedQuery);

  // Required-input guard: collection must be one of the route's enum values.
  // Defaulting to an invalid 'default' previously produced a 400 at runtime;
  // ask for a valid collection up front instead (input-asking philosophy).
  const resolvedCollection = ctx
    .interpolateTemplate(collection != null ? String(collection) : '', input)
    .trim();
  if (!resolvedCollection) {
    throw new Error(
      `rag_query requires a collection; one of ${VALID_COLLECTIONS.join('/')}`,
    );
  }
  if (!(VALID_COLLECTIONS as readonly string[]).includes(resolvedCollection)) {
    throw new Error(
      `rag_query collection '${resolvedCollection}' is invalid; one of ${VALID_COLLECTIONS.join('/')}`,
    );
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
