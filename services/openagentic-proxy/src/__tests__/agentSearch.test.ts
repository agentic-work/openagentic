/**
 * openagentic-proxy: agent_search synthetic meta-tool + GET /api/agents/search
 * proxy route.
 *
 * Contract:
 *  1. AGENT_SEARCH_TOOL_DEF exposes the synthetic tool definition the
 *     api-side chat tool array can include verbatim. Name = "agent_search".
 *     Description must mention "agent catalog", "Task" and "parallel" so
 *     the model learns the parallel-spawn pattern from the description
 *     alone.
 *  2. GET /api/agents/search?q=<query>&k=<k> forwards to the api at
 *     POST /api/internal/agent-search with `x-internal-secret` header
 *     and JSON body `{query, k}`. Response shape is `{agents: [...],
 *     count: N}`.
 *  3. On api error or timeout (5s) the route degrades gracefully:
 *     200 with `{agents: [], count: 0, error: "..."}`. NEVER fails the
 *     model's tool_result.
 *  4. Missing/empty `q` returns 400.
 *
 * Runner: Node 24's built-in `node:test` + `--experimental-strip-types`,
 * matching progressCallback.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { AGENT_SEARCH_TOOL_DEF } from '../tools/agentSearchToolDef.ts';
import { searchRoutes } from '../routes/search.ts';

// ─── Tool def shape ────────────────────────────────────────────────────────

test('AGENT_SEARCH_TOOL_DEF — name, description keywords, parameters shape', () => {
  const def = AGENT_SEARCH_TOOL_DEF as any;

  assert.strictEqual(def.type, 'function');
  assert.strictEqual(def.function.name, 'agent_search');

  const desc: string = def.function.description;
  assert.ok(desc.toLowerCase().includes('agent catalog'),
    'description should mention "agent catalog"');
  assert.ok(desc.includes('Task'),
    'description should mention the Task meta-tool by name so the model knows how to dispatch what it discovers');
  assert.ok(desc.toLowerCase().includes('parallel'),
    'description should mention "parallel" — emergent parallelism via multiple Task blocks in one turn');

  const params = def.function.parameters;
  assert.strictEqual(params.type, 'object');
  assert.deepStrictEqual(params.required, ['query']);

  assert.strictEqual(params.properties.query.type, 'string');
  assert.strictEqual(params.properties.k.type, 'integer');
  assert.strictEqual(params.properties.k.default, 5);
  assert.strictEqual(params.properties.k.minimum, 1);
  assert.strictEqual(params.properties.k.maximum, 10);
});

// ─── Helpers for route tests ──────────────────────────────────────────────

function buildAppWithFakeFetch(opts: {
  apiUrl: string;
  internalSecret?: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
}) {
  const app = Fastify({ logger: false });
  // Tests go straight at the route — bypass auth by using x-openagentic-proxy
  // internal-key path (the existing convention in middleware/auth.ts).
  // We just register the search route directly without authMiddleware.
  app.register(searchRoutes, {
    apiUrl: opts.apiUrl,
    internalSecret: opts.internalSecret,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    skipAuth: true,
  });
  return app;
}

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function makeFakeFetch(
  responder: (call: CapturedCall) => Promise<Response> | Response,
): { fetchImpl: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input);
    const bodyStr = init?.body;
    const call: CapturedCall = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr,
    };
    calls.push(call);
    // Honor abort signal to model timeout behavior.
    if (init?.signal && (init.signal as AbortSignal).aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return await responder(call);
  };
  return { fetchImpl, calls };
}

// ─── Route specs ───────────────────────────────────────────────────────────

test('GET /api/agents/search forwards to api with x-internal-secret + JSON body', async () => {
  const fakeAgents = [
    { id: 'code-reviewer', name: 'Code Reviewer', description: 'Reviews code for bugs', role: 'reviewer', tools: ['Read', 'Grep'] },
  ];
  const { fetchImpl, calls } = makeFakeFetch(() => {
    return new Response(JSON.stringify({ agents: fakeAgents, count: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const app = buildAppWithFakeFetch({
    apiUrl: 'http://api.local',
    internalSecret: 'super-secret',
    fetchImpl,
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/agents/search?q=code+review&k=3',
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.count, 1);
  assert.deepStrictEqual(body.agents, fakeAgents);

  // Assert exactly one downstream call with the right shape.
  assert.strictEqual(calls.length, 1);
  const call = calls[0];
  assert.strictEqual(call.url, 'http://api.local/api/internal/agent-search');
  assert.strictEqual(call.method, 'POST');
  const secretHeader = call.headers['x-internal-secret']
    ?? (call.headers as any)['X-Internal-Secret'];
  assert.strictEqual(secretHeader, 'super-secret');
  assert.deepStrictEqual(call.body, { query: 'code review', k: 3 });

  await app.close();
});

test('GET /api/agents/search degrades gracefully on api 503', async () => {
  const { fetchImpl } = makeFakeFetch(() => {
    return new Response('upstream broken', { status: 503 });
  });

  const app = buildAppWithFakeFetch({
    apiUrl: 'http://api.local',
    internalSecret: 'x',
    fetchImpl,
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/agents/search?q=anything',
  });

  // Critical contract: degraded response, NOT a 5xx that the model has
  // to figure out how to recover from.
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.deepStrictEqual(body.agents, []);
  assert.strictEqual(body.count, 0);
  assert.ok(typeof body.error === 'string' && body.error.length > 0,
    'degraded response must include an `error` string for diagnostics');

  await app.close();
});

test('GET /api/agents/search degrades gracefully on timeout', async () => {
  // Simulate an api that never responds within the timeout. We use the
  // signal injected by the route itself; `fetch` should reject with an
  // AbortError when the abort fires.
  const { fetchImpl } = makeFakeFetch((call) => {
    // Wait until the signal-driven abort kills us.
    return new Promise<Response>((_resolve, reject) => {
      // The fake fetch above already throws synchronously if signal
      // already aborted; here the signal hasn't aborted yet, so we
      // simulate a slow upstream by just hanging until the signal
      // fires. We can't access init.signal here but the route applies
      // AbortController(timeout) → fetch sees signal abort → throws.
      // For test simplicity, reject after a short delay so we don't
      // hang the test runner; this still asserts the degraded path.
      setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 20);
    });
  });

  const app = buildAppWithFakeFetch({
    apiUrl: 'http://api.local',
    internalSecret: 'x',
    fetchImpl,
    timeoutMs: 10,
  });

  const res = await app.inject({
    method: 'GET',
    url: '/api/agents/search?q=slow',
  });

  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.deepStrictEqual(body.agents, []);
  assert.strictEqual(body.count, 0);
  assert.ok(typeof body.error === 'string' && body.error.length > 0);

  await app.close();
});

test('GET /api/agents/search returns 400 when q is missing', async () => {
  const { fetchImpl, calls } = makeFakeFetch(() => new Response('{}', { status: 200 }));

  const app = buildAppWithFakeFetch({
    apiUrl: 'http://api.local',
    fetchImpl,
  });

  const res = await app.inject({ method: 'GET', url: '/api/agents/search' });
  assert.strictEqual(res.statusCode, 400);
  // Must NOT have hit the upstream when validation fails.
  assert.strictEqual(calls.length, 0);

  await app.close();
});

test('GET /api/agents/health/search is 200 when probe succeeds', async () => {
  const { fetchImpl } = makeFakeFetch(() => {
    return new Response(JSON.stringify({ agents: [], count: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const app = buildAppWithFakeFetch({
    apiUrl: 'http://api.local',
    internalSecret: 'x',
    fetchImpl,
  });

  const res = await app.inject({ method: 'GET', url: '/api/agents/health/search' });
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body.ok, true);
  await app.close();
});
