/**
 * Agent Catalog Semantic Search Route — openagentic-proxy proxy.
 *
 * Forwards `GET /api/agents/search?q=...&k=...` to the api at
 * `POST /api/internal/agent-search` (which holds the Milvus client +
 * embedding service). Service-to-service auth via `x-internal-secret`.
 *
 * Degraded contract: any failure (5xx, parse, timeout) returns 200 with
 * `{agents: [], count: 0, error}`. The model's tool_result must NEVER
 * be a fastify-formatted 5xx — the LLM has no recourse against that
 * shape, but a structured zero-result it can recover from cleanly.
 *
 * Plan: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export interface SearchRoutesOptions {
  /** API base url to forward to. Defaults to env API_URL/OPENAGENTIC_API_URL/`openagentic-api:8000`. */
  apiUrl?: string;
  /** Service-to-service shared secret. Defaults to env INTERNAL_SERVICE_SECRET. */
  internalSecret?: string;
  /** Test override for fetch. */
  fetchImpl?: typeof fetch;
  /** Timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Skip authMiddleware on the search route (used by unit tests). */
  skipAuth?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_K = 5;
const MAX_K = 10;
const MIN_K = 1;

interface MinimalLogger {
  warn: (...args: unknown[]) => void;
}

function defaultLogger(): MinimalLogger {
  // Lazy require so unit tests under node:test (ESM strip-types mode)
  // don't have to resolve pino transitively. In production the real
  // logger is loaded; in tests we never hit this path.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../utils/logger');
    return mod.logger as MinimalLogger;
  } catch {
    return { warn: () => {} };
  }
}

export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (
  app: FastifyInstance,
  opts: SearchRoutesOptions = {},
): Promise<void> => {
  const apiUrl =
    opts.apiUrl
    ?? process.env.API_URL
    ?? process.env.OPENAGENTIC_API_URL
    ?? 'http://openagentic-api:8000';
  const internalSecret = opts.internalSecret ?? process.env.INTERNAL_SERVICE_SECRET ?? '';
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = defaultLogger();

  const handler = async (
    request: any,
    reply: any,
  ) => {
    const q = (request.query?.q ?? '').toString().trim();
    let k = parseInt(String(request.query?.k ?? DEFAULT_K), 10);
    if (!Number.isFinite(k)) k = DEFAULT_K;
    if (k < MIN_K) k = MIN_K;
    if (k > MAX_K) k = MAX_K;

    if (!q) {
      return reply.code(400).send({ error: 'Missing required query parameter: q' });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-request-from': 'openagentic-proxy',
      };
      if (internalSecret) headers['x-internal-secret'] = internalSecret;

      const res = await fetchImpl(`${apiUrl}/api/internal/agent-search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: q, k }),
        signal: ac.signal,
      });

      if (!res.ok) {
        log.warn(
          { status: res.status, q, k },
          '[agent-search] upstream non-2xx — returning degraded result',
        );
        return reply.code(200).send({
          agents: [],
          count: 0,
          error: `upstream returned ${res.status}`,
        });
      }

      const data: any = await res.json();
      const agents = Array.isArray(data?.agents) ? data.agents : [];
      return reply.code(200).send({
        agents,
        count: typeof data?.count === 'number' ? data.count : agents.length,
      });
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError' || /aborted/i.test(err?.message ?? '');
      log.warn(
        { err: err?.message, q, k, abort: isAbort },
        '[agent-search] request failed — returning degraded result',
      );
      return reply.code(200).send({
        agents: [],
        count: 0,
        error: isAbort ? `timed out after ${timeoutMs}ms` : (err?.message ?? 'unknown error'),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // In production we wrap with authMiddleware (loaded lazily so tests
  // under node:test/strip-types don't have to resolve all transitive
  // deps of the auth chain). Tests pass `skipAuth: true` and exercise
  // the handler directly.
  if (opts.skipAuth) {
    app.get('/api/agents/search', handler);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { authMiddleware } = require('../middleware/auth');
    app.get('/api/agents/search', { preHandler: authMiddleware }, handler);
  }

  // Health probe — returns ok:true if the upstream agent-search responds
  // (200 or any 4xx is fine; only network/abort is "down").
  const healthHandler = async (_request: any, reply: any) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-request-from': 'openagentic-proxy',
      };
      if (internalSecret) headers['x-internal-secret'] = internalSecret;
      const res = await fetchImpl(`${apiUrl}/api/internal/agent-search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: 'healthprobe', k: 1 }),
        signal: ac.signal,
      });
      // Any non-network response counts as "agent-search is alive".
      return reply.code(200).send({ ok: res.status < 500 });
    } catch (err: any) {
      return reply.code(200).send({ ok: false, error: err?.message ?? 'probe failed' });
    } finally {
      clearTimeout(timer);
    }
  };

  app.get('/api/agents/health/search', healthHandler);
};

export default searchRoutes;
