/**
 * Phase D (2026-04-23) — end-to-end integration across the three
 * sub-agent paths. Proves the single-event-bus assumption that Phases
 * A–C.4 set up: every path publishes to `getAgentEventStore()` with an
 * opaque string key, and every subscriber (chat stream handler, flows
 * stream handler) gets the same wire shape.
 *
 * Paths under test:
 *
 *   1. Chat in-proc: SubagentOrchestrator driven by
 *      AgentProgressContext bound to the chat turn's `turnId`.
 *      (Phase B consolidation.)
 *
 *   2. Chat out-of-proc: openagentic-proxy HTTP callback → POST
 *      `/api/chat/agent-event` → route publishes to the store.
 *      (Phase C bridge.)
 *
 *   3. Flows: same POST but the `turnId` body field is the workflow's
 *      `executionId`. Route is namespace-agnostic and accepts the key.
 *      (Phase C.2 generalize + Phase C.3/C.4 flows wiring.)
 *
 * No real sub-agents, no real LLM. We only validate the transport
 * topology — subscribe on a key, publish via each path, assert
 * fan-out. The specific agent behaviour is already covered by each
 * path's own tests:
 *
 *   - SubagentOrchestrator.publish.test.ts
 *   - progressCallback.test.ts (openagentic-proxy)
 *   - agentEventCallback.integration.test.ts
 *   - workflowAgentProgressBridge.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  agentEventRoute,
  __resetAgentEventDedupeForTests,
} from '../routes/chat/agent-event.route.js';
import {
  getAgentEventStore,
  type AgentProgressEvent,
} from '../services/AgentEventStore.js';
import { AgentProgressContext } from '../services/AgentProgressContext.js';
import {
  subscribeAgentProgressForWorkflowNode,
  subscribeAgentProgressForFlowsStream,
} from '../services/workflowAgentProgressBridge.js';

const INTERNAL_SECRET = 'test-phase-d-secret';

describe('Phase D — sub-agent paths converge on AgentEventStore', () => {
  let app: FastifyInstance;
  const previousSecret = process.env.INTERNAL_API_KEY;

  beforeEach(async () => {
    process.env.INTERNAL_API_KEY = INTERNAL_SECRET;
    __resetAgentEventDedupeForTests();
    getAgentEventStore().__clear();

    app = Fastify({ logger: false });
    await app.register(agentEventRoute, { prefix: '/api/chat' });
    await app.register(agentEventRoute, { prefix: '/api' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    getAgentEventStore().__clear();
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = previousSecret;
    }
    vi.restoreAllMocks();
  });

  it('path 1 (in-proc): AgentProgressContext.emit publishes to the store and the chat subscriber receives it', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = getAgentEventStore().subscribe('turn-inproc', (e) => received.push(e));

    // Simulate the in-proc path — this is what SubagentOrchestrator does
    // internally when Phase B's `progressContext` session option is set.
    const progressContext = new AgentProgressContext({
      publish: (envelope) => {
        getAgentEventStore().publish({
          turnId: envelope.turnId,
          runId: envelope.runId,
          parentRunId: envelope.parentRunId,
          event: envelope.event as AgentProgressEvent['event'],
          payload: envelope.payload,
          agentId: (envelope.payload as any)?.agentId ?? envelope.runId,
          agentRole: (envelope.payload as any)?.agentRole ?? 'unknown',
          timestamp: envelope.ts,
        });
      },
      turnId: 'turn-inproc',
      runId: 'root-run',
    });

    progressContext.emit({
      event: 'agent_start',
      payload: { agentId: 'sub-A', agentRole: 'research', task: 'do the thing' },
    });
    progressContext.emit({
      event: 'agent_complete',
      payload: { agentId: 'sub-A', agentRole: 'research', result: 'done' },
    });

    unsubscribe();

    expect(received).toHaveLength(2);
    expect(received.map((e) => e.event)).toEqual(['agent_start', 'agent_complete']);
    expect(received[0].agentId).toBe('sub-A');
    expect(received[0].turnId).toBe('turn-inproc');
  });

  it('path 2 (chat out-of-proc): POST /api/chat/agent-event reaches the chat subscriber keyed on turnId', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = getAgentEventStore().subscribe('turn-chat-out', (e) => received.push(e));

    const resp = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'turn-chat-out',
        runId: 'openagentic-proxy-run-1',
        parentRunId: null,
        event: 'tool_executing',
        payload: { tool: 'aws_ec2_list' },
        seq: 0,
        ts: Date.now(),
      },
    });

    unsubscribe();

    expect(resp.statusCode).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('tool_executing');
    expect(received[0].payload).toEqual({ tool: 'aws_ec2_list' });
  });

  it('path 3 (flows): POST /api/agent-event reaches the flows per-node and flows-stream subscribers keyed on executionId', async () => {
    const perNodeReceived: unknown[] = [];
    const flowsStreamReceived: unknown[] = [];

    // Dual subscribers — same `executionId` key that Phase C.3/C.4 use.
    const unsubscribePerNode = subscribeAgentProgressForWorkflowNode(
      'exec-flow-42',
      'node-deploy',
      (e) => perNodeReceived.push(e),
    );
    const unsubscribeFlowsStream = subscribeAgentProgressForFlowsStream(
      'exec-flow-42',
      (f) => flowsStreamReceived.push(f),
    );

    const resp = await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'exec-flow-42', // executionId used as turnId
        runId: 'workflow-agent-1',
        parentRunId: null,
        event: 'thinking_event',
        payload: { thought: 'analyzing azure resources' },
        seq: 0,
        ts: Date.now(),
      },
    });

    unsubscribePerNode();
    unsubscribeFlowsStream();

    expect(resp.statusCode).toBe(200);

    // Both flows-side subscribers see the same event.
    expect(perNodeReceived).toHaveLength(1);
    expect(flowsStreamReceived).toHaveLength(1);

    expect((perNodeReceived[0] as any).nodeId).toBe('node-deploy');
    expect((perNodeReceived[0] as any).event).toBe('thinking_event');
    expect((flowsStreamReceived[0] as any).executionId).toBe('exec-flow-42');
    expect((flowsStreamReceived[0] as any).event).toBe('thinking_event');
  });

  it('cross-path tenancy: two concurrent keys are isolated (chat subscriber does not see flows events and vice versa)', async () => {
    const chatReceived: AgentProgressEvent[] = [];
    const flowsReceived: AgentProgressEvent[] = [];

    const unsubChat = getAgentEventStore().subscribe('turn-chat-iso', (e) => chatReceived.push(e));
    const unsubFlows = getAgentEventStore().subscribe('exec-flow-iso', (e) => flowsReceived.push(e));

    // Chat event.
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'turn-chat-iso',
        runId: 'cr',
        event: 'agent_start',
        payload: {},
        seq: 0,
        ts: Date.now(),
      },
    });

    // Flows event.
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      payload: {
        turnId: 'exec-flow-iso',
        runId: 'fr',
        event: 'tool_executing',
        payload: { tool: 'deploy' },
        seq: 0,
        ts: Date.now(),
      },
    });

    unsubChat();
    unsubFlows();

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(chatReceived).toHaveLength(1);
    expect(flowsReceived).toHaveLength(1);
    expect(chatReceived[0].event).toBe('agent_start');
    expect(flowsReceived[0].event).toBe('tool_executing');
    // Critical: cross-contamination would be a tenancy bug.
    expect(chatReceived[0].turnId).toBe('turn-chat-iso');
    expect(flowsReceived[0].turnId).toBe('exec-flow-iso');
  });

  it('all three paths fan out to the same turnId subscriber in order', async () => {
    const received: AgentProgressEvent[] = [];
    const unsubscribe = getAgentEventStore().subscribe('turn-converge', (e) => received.push(e));

    // Path 1 — in-proc AgentProgressContext.
    const ctx = new AgentProgressContext({
      publish: (envelope) => {
        getAgentEventStore().publish({
          turnId: envelope.turnId,
          runId: envelope.runId,
          parentRunId: envelope.parentRunId,
          event: envelope.event as AgentProgressEvent['event'],
          payload: envelope.payload,
          agentId: (envelope.payload as any)?.agentId ?? envelope.runId,
          agentRole: (envelope.payload as any)?.agentRole ?? 'unknown',
          timestamp: envelope.ts,
        });
      },
      turnId: 'turn-converge',
      runId: 'inproc-run',
    });
    ctx.emit({ event: 'agent_start', payload: { agentId: 'inproc', agentRole: 'research' } });

    // Path 2 — chat-prefix HTTP.
    await app.inject({
      method: 'POST',
      url: '/api/chat/agent-event',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      payload: {
        turnId: 'turn-converge',
        runId: 'chat-proxy-run',
        event: 'tool_executing',
        payload: { tool: 'azure_vm_list' },
        seq: 0,
        ts: Date.now(),
      },
    });

    // Path 3 — generalized (flows-style) HTTP. Different runId/seq so
    // dedupe doesn't reject it.
    await app.inject({
      method: 'POST',
      url: '/api/agent-event',
      headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      payload: {
        turnId: 'turn-converge',
        runId: 'flow-proxy-run',
        event: 'agent_complete',
        payload: { result: 'done' },
        seq: 1,
        ts: Date.now(),
      },
    });

    unsubscribe();

    expect(received.map((e) => e.event)).toEqual([
      'agent_start',
      'tool_executing',
      'agent_complete',
    ]);
    // All three events keyed on the same turnId — proves the single-bus
    // assumption Phases A-C.4 were designed around.
    expect(received.every((e) => e.turnId === 'turn-converge')).toBe(true);
  });
});
