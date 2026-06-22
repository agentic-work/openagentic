/**
 * 2026-05-02 — Internal tool-search route used by mcp-proxy to power the
 * Milvus-backed `tool_search` synthetic MCP tool.
 *
 * Route: POST /api/internal/tool-search
 *   headers  x-internal-secret: <INTERNAL_SERVICE_SECRET>
 *   body     { query: string, k?: number, serverFilter?: string }
 *   200      { tools: OpenAIFunction[] }
 *   400      query missing / invalid body
 *   401      missing / wrong x-internal-secret (fail-closed when env empty)
 *   500      scrubbed error (no DB / stack leakage)
 *   503      ToolSemanticCacheService not initialized
 *
 * Why this exists:
 *   The mcp-proxy is the model-facing surface for tool discovery (the
 *   synthetic `tool_search` MCP tool — see services/openagentic-mcp-proxy/
 *   src/tool_search.py). The proxy is Python and we don't want to
 *   duplicate the Milvus / embedding client there. This route forwards a
 *   plain-language query into ToolSemanticCacheService.searchToolsAsOpenAI
 *   Functions and returns the OpenAI-shape tool defs the model can call
 *   on its next turn.
 *
 * Auth contract is NOT the same as the cm↔api `X-Internal-API-Key` /
 * `internalKey` pattern — this route uses the agent-persistence sibling
 * pattern: `x-internal-secret` header validated against the
 * INTERNAL_SERVICE_SECRET env var. Empty server-side secret is fail-closed.
 *
 * the design notes
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal contract for the search service this route depends on. Lets us
 * inject a mock without pulling in ToolSemanticCacheService's full type
 * surface (which carries Milvus client deps).
 */
export interface ToolSearchService {
  searchToolsAsOpenAIFunctions(
    query: string,
    topK?: number,
    serverFilter?: string,
    userPromptHint?: string,
  ): Promise<unknown[]>;
}

export interface InternalToolSearchRouteDeps {
  /** Server-side shared secret. Empty = fail-closed (rejects all). */
  internalSecret: string;
  /**
   * Resolves the singleton ToolSemanticCacheService. Returns null when
   * the service is uninitialized (RAG not yet ready, SKIP_TOOL_SEMANTIC
   * _CACHE=true, etc.) — route returns 503 in that case.
   */
  getSearchService: () => ToolSearchService | null | undefined;
  /**
   * #51 (2026-06-01) — live connected MCP servers (the set that returned
   * tools from the proxy this session, e.g. ['openagentic_web',
   * 'aws_knowledge'] on openagentic). When wired, the 200 body carries
   * `connectedServers` so the T1 `tool_search` tool can render an honest
   * "no connected tool matches X — connected: …" message on an empty
   * result, instead of the old false-positive "call any of them". Optional
   * + best-effort: any throw/absence simply omits the field (T1 falls back
   * to a generic-but-honest message).
   */
  getConnectedServers?: () => Promise<string[]> | string[];
}

interface ToolSearchBody {
  query?: string;
  k?: number;
  serverFilter?: string;
  /**
   * Q1-fix-2 (2026-05-12) — optional recent user-turn text. When the
   * model emits a single-cloud `tool_search` query like "Azure cost
   * query tool" after a tri-cloud user prompt, this hint lets the service
   * union cloud-detection across both strings and fire the multi-cloud
   * diversity path. Truncated to 2048 chars to bound payload size.
   */
  userPromptHint?: string;
}

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    k: { type: 'integer', minimum: 1, maximum: 50 },
    serverFilter: { type: 'string' },
    userPromptHint: { type: 'string', maxLength: 2048 },
  },
  additionalProperties: false,
};

/**
 * Register the route on the given Fastify instance. Intentionally NOT a
 * plugin (no `fp()` wrap) so the registration is locally scoped — matches
 * the pattern used by registerInternalCodemodeModelRoute /
 * registerHitlPolicyRoutes / registerAgentPersistenceRoutes.
 */
export function registerInternalToolSearchRoute(
  fastify: FastifyInstance,
  deps: InternalToolSearchRouteDeps,
): void {
  const { internalSecret, getSearchService, getConnectedServers } = deps;

  fastify.post(
    '/api/internal/tool-search',
    {
      schema: { body: REQUEST_SCHEMA },
      attachValidation: true,
    },
    async (
      request: FastifyRequest<{ Body: ToolSearchBody }>,
      reply: FastifyReply,
    ) => {
      // Fail-closed auth: empty server-side secret rejects everything.
      if (!internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const provided =
        (request.headers['x-internal-secret'] as string | undefined) ?? '';
      if (provided !== internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Schema validation outcome (because attachValidation defers it to us).
      if (request.validationError) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', detail: request.validationError.message });
      }

      const body = request.body ?? {};
      const query = (body.query ?? '').toString();
      if (!query) {
        return reply.code(400).send({ error: 'invalid_request', detail: 'query is required' });
      }
      const k = typeof body.k === 'number' && Number.isFinite(body.k) ? body.k : 8;
      const serverFilter =
        typeof body.serverFilter === 'string' && body.serverFilter.length > 0
          ? body.serverFilter
          : undefined;
      const userPromptHint =
        typeof body.userPromptHint === 'string' && body.userPromptHint.length > 0
          ? body.userPromptHint
          : undefined;

      const svc = getSearchService();
      if (!svc) {
        return reply
          .code(503)
          .send({ error: 'tool semantic cache not initialized' });
      }

      try {
        const tools = await svc.searchToolsAsOpenAIFunctions(
          query,
          k,
          serverFilter,
          userPromptHint,
        );
        // #51 — best-effort connected-server list for the honest no-match
        // message. Never let a proxy hiccup turn a 200 into a 500: resolve
        // it defensively and just omit the field on any failure/absence.
        let connectedServers: string[] | undefined;
        if (getConnectedServers) {
          try {
            const resolved = await Promise.resolve(getConnectedServers());
            if (Array.isArray(resolved)) {
              connectedServers = resolved.filter(
                (s): s is string => typeof s === 'string' && s.length > 0,
              );
            }
          } catch (connErr) {
            request.log.warn(
              { err: (connErr as Error).message },
              'tool-search: getConnectedServers failed (omitting connectedServers)',
            );
          }
        }
        return reply.code(200).send({
          tools: Array.isArray(tools) ? tools : [],
          ...(connectedServers ? { connectedServers } : {}),
        });
      } catch (err) {
        // Never leak Milvus / Prisma / stack frames to the proxy. Log
        // server-side; respond with a generic, scrubbed error code.
        request.log.error(
          { err: (err as Error).message },
          'tool-search resolution failed',
        );
        return reply.code(500).send({ error: 'tool_search_failed' });
      }
    },
  );
}
