/**
 * Phase C.3 — flows engine agent-progress bridge.
 *
 * The flows engine's `executeOpenAgenticProxyNode` calls openagentic-proxy's
 * `/api/agents/execute-sync` endpoint *synchronously* and awaits a full
 * response — no native streaming. When the POST is in flight, openagentic-proxy
 * (Phase C) POSTs progress envelopes back to
 * `/api/chat/agent-event` keyed on the `turnId` body field, which the
 * route handler publishes into `getAgentEventStore()`.
 *
 * For the flows SSE stream to show sub-agent progress live, the engine
 * must **pre-subscribe** to the store with `executionId` as the turnId,
 * then forward each received event as a `node_stream` `ExecutionEvent`
 * that the flows SSE handler (Phase C.4) re-emits as `agent_progress`
 * NDJSON frames.
 *
 * This helper encapsulates that subscribe-and-forward lifecycle so
 * `executeOpenAgenticProxyNode` stays readable and we can unit-test the wiring
 * without spinning up the whole engine (which has prisma + 20 other
 * deps). Returns an unsubscribe function; callers must invoke it in a
 * `finally` block.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  subscribeAgentProgressForWorkflowNode,
  subscribeAgentProgressForFlowsStream,
  type WorkflowNodeProgressEvent,
  type FlowsAgentProgressFrame,
} from '../workflowAgentProgressBridge.js';
import {
  getAgentEventStore,
  type AgentProgressEvent,
} from '../AgentEventStore.js';

describe('subscribeAgentProgressForWorkflowNode — Phase C.3 subscriber', () => {
  beforeEach(() => {
    getAgentEventStore().__clear();
  });

  afterEach(() => {
    getAgentEventStore().__clear();
  });

  it('forwards events published to AgentEventStore with matching executionId as WorkflowNodeProgressEvents', () => {
    const received: WorkflowNodeProgressEvent[] = [];
    const unsubscribe = subscribeAgentProgressForWorkflowNode(
      'exec-42',
      'node-A',
      (e) => received.push(e),
    );

    const envelope: AgentProgressEvent = {
      turnId: 'exec-42',
      runId: 'agent-run-1',
      parentRunId: null,
      event: 'tool_executing',
      payload: { tool: 'azure_vm_list' },
      agentId: 'sub-1',
      agentRole: 'research',
      timestamp: 1_712_000_000_000,
    };
    getAgentEventStore().publish(envelope);

    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      nodeId: 'node-A',
      executionId: 'exec-42',
      event: 'tool_executing',
      payload: { tool: 'azure_vm_list' },
      runId: 'agent-run-1',
      agentId: 'sub-1',
      agentRole: 'research',
    });
  });

  it('ignores events for a different executionId', () => {
    const received: WorkflowNodeProgressEvent[] = [];
    const unsubscribe = subscribeAgentProgressForWorkflowNode(
      'exec-42',
      'node-A',
      (e) => received.push(e),
    );

    getAgentEventStore().publish({
      turnId: 'exec-999', // different turnId
      runId: 'agent-run-2',
      parentRunId: null,
      event: 'agent_start',
      payload: {},
      agentId: 'x',
      agentRole: 'y',
      timestamp: Date.now(),
    });

    unsubscribe();
    expect(received).toHaveLength(0);
  });

  it('unsubscribe stops forwarding — subsequent publishes are not received', () => {
    const received: WorkflowNodeProgressEvent[] = [];
    const unsubscribe = subscribeAgentProgressForWorkflowNode(
      'exec-42',
      'node-A',
      (e) => received.push(e),
    );

    getAgentEventStore().publish({
      turnId: 'exec-42',
      runId: 'r1',
      parentRunId: null,
      event: 'agent_start',
      payload: {},
      agentId: 'a1',
      agentRole: 'r',
      timestamp: Date.now(),
    });

    unsubscribe();

    getAgentEventStore().publish({
      turnId: 'exec-42',
      runId: 'r2',
      parentRunId: null,
      event: 'agent_complete',
      payload: {},
      agentId: 'a1',
      agentRole: 'r',
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('agent_start');
  });

  it('subscribeAgentProgressForFlowsStream: writes flat agent_progress frames keyed on executionId (Phase C.4 parity)', () => {
    const frames: FlowsAgentProgressFrame[] = [];
    const unsubscribe = subscribeAgentProgressForFlowsStream(
      'exec-parity',
      (frame) => frames.push(frame),
    );

    getAgentEventStore().publish({
      turnId: 'exec-parity',
      runId: 'sub-run-1',
      parentRunId: null,
      event: 'tool_executing',
      payload: { tool: 'aws_ec2_list' },
      agentId: 'research-sub',
      agentRole: 'research',
      timestamp: 1_712_500_000_000,
    });

    // Ignore events for a different execution (cross-execution isolation).
    getAgentEventStore().publish({
      turnId: 'some-other-exec',
      runId: 'x',
      parentRunId: null,
      event: 'agent_start',
      payload: {},
      agentId: 'y',
      agentRole: 'z',
      timestamp: 2,
    });

    unsubscribe();

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      executionId: 'exec-parity',
      turnId: 'exec-parity',
      runId: 'sub-run-1',
      event: 'tool_executing',
      payload: { tool: 'aws_ec2_list' },
      agentId: 'research-sub',
      agentRole: 'research',
      timestamp: 1_712_500_000_000,
    });
  });

  it('forwards multiple sequential events in order', () => {
    const received: WorkflowNodeProgressEvent[] = [];
    const unsubscribe = subscribeAgentProgressForWorkflowNode(
      'exec-seq',
      'node-B',
      (e) => received.push(e),
    );

    const base = {
      turnId: 'exec-seq',
      runId: 'r',
      parentRunId: null,
      agentId: 'a',
      agentRole: 'r',
      payload: {},
    };
    getAgentEventStore().publish({ ...base, event: 'agent_start', timestamp: 1 });
    getAgentEventStore().publish({ ...base, event: 'tool_executing', timestamp: 2 });
    getAgentEventStore().publish({ ...base, event: 'tool_complete', timestamp: 3 });
    getAgentEventStore().publish({ ...base, event: 'agent_complete', timestamp: 4 });

    unsubscribe();

    expect(received.map((e) => e.event)).toEqual([
      'agent_start',
      'tool_executing',
      'tool_complete',
      'agent_complete',
    ]);
  });
});
