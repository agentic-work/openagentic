/**
 * 2026-05-22 — #1060: Internal embed route used by mcp-proxy to power the
 * mcp_tools indexer (and any other internal service that needs embeddings
 * without owning a provider client).
 *
 * Route: POST /api/internal/embed
 *   headers  x-internal-secret: <INTERNAL_SERVICE_SECRET>
 *   body     { texts: string[] }
 *   200      { embeddings: number[][], model: string, dimensions: number, provider: string }
 *   400      texts missing / empty / invalid body
 *   401      missing / wrong x-internal-secret (fail-closed when env empty)
 *   500      scrubbed error (no provider / stack leakage)
 *   503      UniversalEmbeddingService not initialized
 *
 * Why this exists:
 *   #1059 moved the mcp_tools indexer from api → mcp-proxy. The proxy is
 *   Python and we don't want to re-implement provider routing (Bedrock /
 *   AIF / Vertex / Ollama) on that side — UniversalEmbeddingService is the
 *   SoT. This route is the thin shim: proxy POSTs texts, api routes via the
 *   embedding-role-assigned provider, embeddings come back.
 *
 * Auth contract mirrors `tool-search.ts` — `x-internal-secret` header
 * validated against the INTERNAL_SERVICE_SECRET env var. Empty server-side
 * secret is fail-closed.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Minimal contract for the embedding service this route depends on. Lets us
 * inject a mock without pulling in UniversalEmbeddingService's full type
 * surface (which carries provider-SDK deps).
 */
export interface EmbedService {
  generateBatchEmbeddings(texts: string[]): Promise<{
    embeddings: number[][];
    model?: string;
    dimensions?: number;
    provider?: string;
    [key: string]: unknown;
  }>;
}

export interface InternalEmbedRouteDeps {
  /** Server-side shared secret. Empty = fail-closed (rejects all). */
  internalSecret: string;
  /**
   * Resolves the singleton UniversalEmbeddingService. Returns null when
   * uninitialized (no embedding provider configured, registry empty) —
   * route returns 503 in that case.
   */
  getEmbedService: () => EmbedService | null | undefined;
}

interface EmbedBody {
  texts?: string[];
}

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['texts'],
  properties: {
    texts: {
      type: 'array',
      minItems: 1,
      maxItems: 512,
      items: { type: 'string', minLength: 1 },
    },
  },
  additionalProperties: false,
};

/**
 * Register the route on the given Fastify instance. Intentionally NOT a
 * plugin (no `fp()` wrap) — matches registerInternalToolSearchRoute pattern.
 */
export function registerInternalEmbedRoute(
  fastify: FastifyInstance,
  deps: InternalEmbedRouteDeps,
): void {
  const { internalSecret, getEmbedService } = deps;

  fastify.post(
    '/api/internal/embed',
    {
      schema: { body: REQUEST_SCHEMA },
      attachValidation: true,
    },
    async (
      request: FastifyRequest<{ Body: EmbedBody }>,
      reply: FastifyReply,
    ) => {
      if (!internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const provided =
        (request.headers['x-internal-secret'] as string | undefined) ?? '';
      if (provided !== internalSecret) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (request.validationError) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', detail: request.validationError.message });
      }

      const body = request.body ?? {};
      const texts = Array.isArray(body.texts) ? body.texts : [];
      if (texts.length === 0) {
        return reply.code(400).send({ error: 'invalid_request', detail: 'texts must be non-empty array' });
      }

      const svc = getEmbedService();
      if (!svc) {
        return reply
          .code(503)
          .send({ error: 'embedding service not initialized' });
      }

      try {
        const result = await svc.generateBatchEmbeddings(texts);
        return reply.code(200).send({
          embeddings: Array.isArray(result.embeddings) ? result.embeddings : [],
          model: result.model ?? '',
          dimensions: result.dimensions ?? 0,
          provider: result.provider ?? '',
        });
      } catch (err) {
        request.log.error(
          { err: (err as Error).message },
          'embed resolution failed',
        );
        return reply.code(500).send({ error: 'embed_failed' });
      }
    },
  );
}
