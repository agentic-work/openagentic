/**
 * Phase C1 — openagentic-proxy → openagentic-api callback bridge.
 *
 * Contract (POST /api/chat/agent-event):
 *  - Happy path: auth + valid envelope → the in-proc getAgentEventStore()
 *    subscriber keyed on `turnId` receives the event verbatim. Response
 *    is `{ received: true, seq }` (or `{ ok: true, ... }` — the route
 *    returns both for compat).
 *  - Auth rejection: missing/incorrect X-Internal-Secret header → 401
 *    and NO publish to the store.
 *  - Bad payload: missing `turnId` → 400 and NO publish.
 *  - Seq-dedupe: posting the same (turnId, runId, seq) tuple twice
 *    results in a single publish. The duplicate POST returns 200 with
 *    `duplicate: true` (idempotent accept-but-no-double-publish). See
 *    Phase C spec in the design notes.
 *
 * Uses `fastify.inject()` (not a real socket) because this route is a
 * small JSON POST — no streaming involved, unlike stream-tail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  agentEventRoute,
  __resetAgentEventDedupeForTests,
} from '../agent-event.route.js';
import {
  getAgentEventStore,
  type AgentEventStore,
  type AgentProgressEvent,
} from '../../../services/AgentEventStore.js';

const INTERNAL_SECRET = 'test-internal-secret-c1';

describe('POST /api/chat/agent-event — Phase C1 callback integration', () => {
  let app: FastifyInstance;
  let store: AgentEventStore;
  const previousSecret = process.env.INTERNAL_API_KEY;

  beforeEach(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_SECRET;
    __resetAgentEventDedupeForTests();

    app = Fastify({ logger: false });
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

  it('happy path: forwards a valid envelope to the AgentEventStore subscriber keyed on turnId', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('T1', (e) => received.push(e));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'T1',
        runId: 'R1',
        parentRunId: null,
        event: 'agent_start',
        payload: { task: 'research' },
        seq: 0,
        ts: 1_711_000_000_000,
        agentId: 'sub-agent-1',
        agentRole: 'research',
      },
    });

    unsubscribe();

    expect(resp.statusCode).toBe(200);

    // Response body confirms the event was accepted and carries `seq`.
    const body = resp.json();
    expect(body.received ?? body.ok).toBeTruthy();
    expect(body.seq).toBe(0);

    // Subscriber must have received the event with all fields preserved.
    expect(received).toHaveLength(1);
    const delivered = received[0];
    expect(delivered.turnId).toBe('T1');
    expect(delivered.runId).toBe('R1');
    expect(delivered.parentRunId).toBeNull();
    expect(delivered.event).toBe('agent_start');
    expect(delivered.payload).toEqual({ task: 'research' });
    expect(delivered.agentId).toBe('sub-agent-1');
    expect(delivered.agentRole).toBe('research');
    expect(delivered.timestamp).toBe(1_711_000_000_000);
  });

  it('auth rejection: missing X-Internal-Secret returns 401 and does NOT publish', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('T-auth', (e) => received.push(e));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: { 'content-type': 'application/json' },
      payload: {
        turnId: 'T-auth',
        runId: 'R1',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
        agentId: 'sub-agent',
      },
    });

    unsubscribe();

    expect(resp.statusCode).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('bad payload: missing turnId returns 400 and does NOT publish', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('T-bad', (e) => received.push(e));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        // no turnId
        runId: 'R1',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
        agentId: 'sub-agent',
      },
    });

    unsubscribe();

    expect(resp.statusCode).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('seq-dedupe: posting the same (turnId, runId, seq) twice publishes once', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = store.subscribe('T-dedupe', (e) => received.push(e));

    const envelope = {
      turnId: 'T-dedupe',
      runId: 'R-dedupe',
      parentRunId: null,
      event: 'tool_executing',
      payload: { tool: 'azure_vm_list' },
      seq: 7,
      ts: 1_711_000_000_000,
      agentId: 'sub-agent-dedupe',
    };

    const resp1 = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: envelope,
    });
    expect(resp1.statusCode).toBe(200);
    const body1 = resp1.json();
    expect(body1.duplicate).not.toBe(true);

    // Second POST with the same tuple
    const resp2 = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: envelope,
    });

    unsubscribe();

    // Accepts the retry but flags it as a duplicate and does NOT re-publish.
    expect(resp2.statusCode).toBe(200);
    const body2 = resp2.json();
    expect(body2.duplicate).toBe(true);

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ tool: 'azure_vm_list' });
  });
});
