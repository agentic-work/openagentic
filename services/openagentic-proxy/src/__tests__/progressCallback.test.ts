/**
 * Phase C3 — openagentic-proxy progress callback publisher.
 *
 * Contract (when execute-sync is invoked with a `turnId`):
 *  1. openagentic-proxy constructs an `AgentProgressContext` bound to that turnId.
 *  2. The context's `publish` callback POSTs envelopes to
 *     `${OPENAGENTIC_API_CALLBACK_URL}/api/chat/agent-event` with an
 *     `x-internal-secret` header whose value is the service token
 *     (`OPENAGENTIC_PROXY_SERVICE_TOKEN`, falling back to
 *     `INTERNAL_SERVICE_SECRET` for existing openagentic-proxy deployments).
 *  3. When the agent's run emits a tool-use, the POST body contains the
 *     full envelope: `{turnId, runId, parentRunId, event, payload, seq, ts}`.
 *  4. When `OPENAGENTIC_API_CALLBACK_URL` is unset (local dev), the
 *     publisher is a no-op — `fetch` is NEVER called.
 *
 * We test the contract surface in isolation (unit-ish) — no real server,
 * no real fetch. `fetchImpl` is injected so we capture every call.
 *
 * Runner: Node 24's built-in `node:test` + `--experimental-strip-types`
 * (openagentic-proxy has no vitest; adding one is out of scope for Phase C).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentProgressContext,
  createHttpPublisher,
  type AgentProgressEnvelope,
} from '../services/AgentProgressContext.ts';

// ─── Helpers ───────────────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function makeFakeFetch(): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : String(input);
    const bodyStr = init?.body;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr,
    });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

// ─── Specs ────────────────────────────────────────────────────────────────

test('execute-sync with turnId → AgentProgressContext is bound to that turnId', () => {
  // Simulate openagentic-proxy's execute-sync handler receiving `turnId` in the
  // body and constructing a context. This is the minimum contract — we
  // don't need to exercise the real route, just the construction call.
  const { fetchImpl, calls } = makeFakeFetch();
  const publish = createHttpPublisher({
    callbackUrl: 'http://api.local',
    serviceToken: 'svc-token-1',
    fetchImpl,
  });

  const ctx = new AgentProgressContext({
    publish,
    turnId: 'T1',
    runId: 'exec-run-1',
    parentRunId: null,
  });

  assert.strictEqual(ctx.turnId, 'T1');
  assert.strictEqual(ctx.runId, 'exec-run-1');
  assert.strictEqual(ctx.parentRunId, null);

  // Sanity: nothing posted yet.
  assert.strictEqual(calls.length, 0);
});

test('publish callback POSTs to OPENAGENTIC_API_CALLBACK_URL + /api/chat/agent-event with service-token header', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const publish = createHttpPublisher({
    callbackUrl: 'http://api.local',
    serviceToken: 'svc-token-42',
    fetchImpl,
  });

  const ctx = new AgentProgressContext({
    publish,
    turnId: 'T2',
    runId: 'run-a',
    parentRunId: null,
  });

  ctx.emit({ event: 'agent_start', payload: { role: 'research' } });

  // emit() is fire-and-forget but the fetch is queued synchronously
  // inside the publish callable. Yield a microtask so the async POST
  // resolves before we assert.
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(calls.length, 1, 'exactly one POST should have been made');
  const call = calls[0];
  assert.strictEqual(call.url, 'http://api.local/api/chat/agent-event');
  assert.strictEqual(call.method, 'POST');
  const authHeader = call.headers['x-internal-secret'] ?? (call.headers as any)['X-Internal-Secret'];
  assert.strictEqual(authHeader, 'svc-token-42');
});

test('tool-use emit → envelope body carries {turnId, runId, parentRunId: null, event: "tool_executing", ...}', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const publish = createHttpPublisher({
    callbackUrl: 'http://api.local',
    serviceToken: 'svc-token',
    fetchImpl,
  });

  const ctx = new AgentProgressContext({
    publish,
    turnId: 'T3',
    runId: 'run-tool',
    parentRunId: null,
  });

  ctx.emit({ event: 'tool_executing', payload: { tool: 'azure_vm_list', args: { rg: 'rg-1' } } });
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(calls.length, 1);
  const env = calls[0].body as AgentProgressEnvelope;
  assert.strictEqual(env.turnId, 'T3');
  assert.strictEqual(env.runId, 'run-tool');
  assert.strictEqual(env.parentRunId, null);
  assert.strictEqual(env.event, 'tool_executing');
  assert.deepStrictEqual(env.payload, { tool: 'azure_vm_list', args: { rg: 'rg-1' } });
  assert.strictEqual(typeof env.seq, 'number');
  assert.strictEqual(typeof env.ts, 'number');
});

test('OPENAGENTIC_API_CALLBACK_URL unset → publisher is a no-op (fetch NEVER called)', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  // Explicitly pass undefined (simulating env var unset). createHttpPublisher
  // reads process.env when callbackUrl is omitted; we want to lock the
  // undefined-url path regardless of host env, so use `undefined` on opts.
  const previousUrl = process.env.OPENAGENTIC_API_CALLBACK_URL;
  delete process.env.OPENAGENTIC_API_CALLBACK_URL;

  try {
    const publish = createHttpPublisher({ fetchImpl });
    const ctx = new AgentProgressContext({
      publish,
      turnId: 'T-none',
      runId: 'run-x',
    });

    ctx.emit({ event: 'agent_start', payload: {} });
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(calls.length, 0, 'no HTTP call should happen when callback URL is unset');
  } finally {
    if (previousUrl !== undefined) process.env.OPENAGENTIC_API_CALLBACK_URL = previousUrl;
  }
});

test('createChild shares seq counter with parent (monotonic across the tree)', async () => {
  const { fetchImpl, calls } = makeFakeFetch();
  const publish = createHttpPublisher({
    callbackUrl: 'http://api.local',
    serviceToken: 't',
    fetchImpl,
  });

  const parent = new AgentProgressContext({
    publish,
    turnId: 'T-tree',
    runId: 'parent',
  });
  const child = parent.createChild('child-1');

  parent.emit({ event: 'agent_start', payload: {} });      // seq 0
  child.emit({ event: 'tool_executing', payload: {} });    // seq 1
  parent.emit({ event: 'agent_complete', payload: {} });   // seq 2

  await new Promise((r) => setImmediate(r));

  assert.strictEqual(calls.length, 3);
  const seqs = calls.map((c) => (c.body as AgentProgressEnvelope).seq);
  assert.deepStrictEqual(seqs, [0, 1, 2]);
  // Child's parentRunId is parent's runId.
  assert.strictEqual((calls[1].body as AgentProgressEnvelope).parentRunId, 'parent');
});
