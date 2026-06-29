/**
 * Phase C.2 — generalize `/api/chat/agent-event` for non-chat callers.
 *
 * The route handler at `src/routes/chat/agent-event.route.ts` is
 * namespace-agnostic by design: it reads `turnId` (opaque string) from
 * the body and publishes to `getAgentEventStore()`. Non-chat callers
 * (e.g. flows engine) need to POST progress envelopes too — but
 * conceptually those aren't "chat" turns, they're workflow executions.
 *
 * Contract:
 *   - The same route is mountable at a second prefix (`/api` →
 *     `/api/agent-event`) and behaves identically: same auth, same
 *     body validation, same dedupe, same subscriber delivery.
 *   - No shared mutable state leaks between prefixes — dedupe is global
 *     but the test only sends distinct tuples so we don't rely on cross-
 *     prefix isolation.
 *
 * Runs purely via fastify.inject(); no socket + no network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  agentEventRoute,
  __resetAgentEventDedupeForTests,
} from '../chat/agent-event.route.js';
import {
  getAgentEventStore,
  type AgentEventStore,
  type AgentProgressEvent,
} from '../../services/AgentEventStore.js';

const INTERNAL_SECRET = 'test-internal-secret-c2';

describe('POST /api/agent-event — Phase C.2 generalized alias', () => {
  let app: FastifyInstance;
  let store: AgentEventStore;
  const previousSecret = process.env.INTERNAL_API_KEY;

  beforeEach(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_SECRET;
    __resetAgentEventDedupeForTests();

    app = Fastify({ logger: false });
    // Phase C.2: mount the same handler under the generalized `/api`
    // prefix so flows callers don't have to POST to a chat-prefixed URL.
    await app.register(agentEventRoute, { prefix: '/api' });
    // Existing chat-prefix mount stays (back-compat for openagentic-proxy).
    await app.register(agentEventRoute, { prefix: '/api/chat' });
    await app.ready();

    store = getAgentEventStore();
    store.__clear();
  });

  afterEach(async () => {
    await app.close();
    store.__clear();
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousSecret;
    }
    vi.restoreAllMocks();
  });

  it('generalized path: POST /api/agent-event delivers to subscriber keyed on turnId', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('workflow-exec-42', (e) => received.push(e));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'workflow-exec-42',
        runId: 'node-R1',
        parentRunId: null,
        event: 'agent_start',
        payload: { nodeType: 'openagentic_proxy' },
        seq: 0,
        ts: 1_712_000_000_000,
      },
    });

    unsubscribe();

    expect(resp.statusCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].turnId).toBe('workflow-exec-42');
    expect(received[0].event).toBe('agent_start');
  });

  it('chat-prefix and generalized-prefix reach the same store (subscriber sees both)', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('T-both', (e) => received.push(e));

    // First envelope via the chat-prefixed path (openagentic-proxy callback).
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'T-both',
        runId: 'R-chat',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: 1_712_100_000_000,
      },
    });

    // Second envelope via the generalized path (flows caller).
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'T-both',
        runId: 'R-flow',
        event: 'tool_executing',
        payload: { tool: 'deploy' },
        seq: 1,
        ts: 1_712_100_001_000,
      },
    });

    unsubscribe();

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(received).toHaveLength(2);
    expect(received.map((e) => e.runId)).toEqual(['R-chat', 'R-flow']);
  });

  it('auth rejection on generalized path: missing X-Internal-Secret returns 401', async () => {
    const resp = await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: { 'content-type': 'application/json' },
      payload: {
        turnId: 'T-no-auth',
        runId: 'R',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
      },
    });
    expect(resp.statusCode).toBe(401);
  });
});
