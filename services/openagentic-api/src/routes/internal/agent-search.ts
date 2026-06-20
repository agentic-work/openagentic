/**
 * 2026-05-02 — Internal agent-search route used by openagentic-proxy to power
 * the Milvus-backed `agent_search` synthetic meta-tool.
 *
 * Route: POST /api/internal/agent-search
 *   headers  x-internal-secret: <INTERNAL_SERVICE_SECRET>
 *   body     { query: string, k?: number }
 *   200      { agents: AgentDefinition[], count: number }
 *   400      query missing / invalid body
 *   401      missing / wrong x-internal-secret (fail-closed when env empty)
 *   500      scrubbed error (no DB / stack leakage)
 *   503      AgentSemanticSearchService not initialized
 *
 * Why this exists:
 *   The openagentic-proxy is the model-facing surface for sub-agent dispatch
 *   + discovery. It cannot hold the Milvus client + embedding service
 *   directly (that's an api-side singleton). This route forwards a
 *   plain-language query into AgentSemanticSearchService.search() and
 *   returns the AgentDefinition rows the model can pick from when it
 *   composes its next Task() call.
 *
 * Auth contract matches the sibling tool-search route — `x-internal-secret`
 * header validated against the INTERNAL_SERVICE_SECRET env var. Empty
 * server-side secret is fail-closed.
 *
 * the design notes
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal contract the route depends on. Lets us inject a mock without
 * pulling in AgentSemanticSearchService's full Milvus surface.
 */
export interface AgentSearchService {
  search(query: string, k?: number): Promise<unknown[]>;
}

export interface InternalAgentSearchRouteDeps {
  /** Server-side shared secret. Empty = fail-closed (rejects all). */
  internalSecret: string;
  /**
   * Resolves the singleton AgentSemanticSearchService. Returns null when
   * the service is uninitialized — route returns 503 in that case.
   */
  getSearchService: () => AgentSearchService | null | undefined;
}

interface AgentSearchBody {
  query?: string;
  k?: number;
}

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    k: { type: 'integer', minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
};

const DEFAULT_K = 5;

/**
 * Register the route on the given Fastify instance. Intentionally NOT a
 * plugin (no `fp()` wrap) so the registration is locally scoped — matches
 * the pattern used by registerInternalToolSearchRoute /
 * registerInternalCodemodeModelRoute / registerHitlPolicyRoutes.
 */
export function registerInternalAgentSearchRoute(
  fastify: FastifyInstance,
  deps: InternalAgentSearchRouteDeps,
): void {
  const { internalSecret, getSearchService } = deps;

  fastify.post(
    '/api/internal/agent-search',
    {
      schema: { body: REQUEST_SCHEMA },
      attachValidation: true,
    },
    async (
      request: FastifyRequest<{ Body: AgentSearchBody }>,
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
      const k = typeof body.k === 'number' && Number.isFinite(body.k) ? body.k : DEFAULT_K;

      const svc = getSearchService();
      if (!svc) {
        return reply
          .code(503)
          .send({ error: 'agent semantic search not initialized' });
      }

      try {
        const agents = await svc.search(query, k);
        const list = Array.isArray(agents) ? agents : [];
        return reply.code(200).send({ agents: list, count: list.length });
      } catch (err) {
        // Never leak Milvus / Prisma / stack frames to the proxy. Log
        // server-side; respond with a generic, scrubbed error code.
        request.log.error(
          { err: (err as Error).message },
          'agent-search resolution failed',
        );
        return reply.code(500).send({ error: 'agent_search_failed' });
      }
    },
  );
}
