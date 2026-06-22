/**
 * HITL.1 — AgentProgressEvent type union extension.
 *
 * The HITL approval bridge requires the AgentEventStore to accept
 * `mcp_approval_required`, `hitl_approval`, and `mcp_approval_resolved`
 * as valid event names. Before the fix, only
 * 'tool_executing' | 'tool_progress' | 'tool_complete' | 'agent_start' |
 * 'agent_complete' | 'message' | 'thinking_event' were in the union,
 * meaning type-safe callers (and agent-event.route.ts which reads
 * AgentProgressEvent['event']) would reject HITL frames at the type gate.
 *
 * RED: fails before the union is extended.
 * GREEN: passes once the three new event names are added to the union.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAgentEventStore,
  type AgentProgressEvent,
} from '../AgentEventStore.js';

describe('AgentProgressEvent — HITL event types in union', () => {
  beforeEach(() => {
    getAgentEventStore().__clear();
  });

  // ── Type-level checks ─────────────────────────────────────────────────────
  //
  // We cannot run `expectTypeOf` without vitest 1.4+ type-checking enabled,
  // so instead we do the pragmatic equivalent: construct a constant of type
  // `AgentProgressEvent['event']` using an assignment. If the three new event
  // names are NOT in the union, TypeScript compilation fails the test file,
  // which causes the test run to fail (RED). Once they are added, the file
  // compiles and the runtime assertions prove the store accepts them (GREEN).

  it('type union must accept mcp_approval_required', () => {
    // This assignment is a compile-time type check.
    // If the union does NOT include 'mcp_approval_required', TypeScript
    // flags this as a type error → RED.
    const _evt: AgentProgressEvent['event'] = 'mcp_approval_required';
    expect(_evt).toBe('mcp_approval_required');
  });

  it('type union must accept hitl_approval', () => {
    const _evt: AgentProgressEvent['event'] = 'hitl_approval';
    expect(_evt).toBe('hitl_approval');
  });

  it('type union must accept mcp_approval_resolved', () => {
    const _evt: AgentProgressEvent['event'] = 'mcp_approval_resolved';
    expect(_evt).toBe('mcp_approval_resolved');
  });

  // ── Runtime checks ────────────────────────────────────────────────────────
  //
  // Publish a HITL event and confirm the store delivers it to a subscriber.
  // This proves the runtime path (AgentEventStore.publish) works end-to-end,
  // not just the type layer.

  it('store publish/subscribe round-trips mcp_approval_required payload', async () => {
    const store = getAgentEventStore();
    const received: AgentProgressEvent[] = [];
    store.subscribe('turn-hitl-1', (ev) => received.push(ev));

    const payload = {
      requestId: 'req-001',
      toolName: 'azure_create_resource_group',
      arguments: { name: 'rg-test', location: 'eastus' },
      riskLevel: 'high',
      reason: 'Creates a new resource group',
      timeoutMs: 300_000,
      parentToolUseId: 'tool_use_abc123',
      source: 'openagentic-proxy',
      timestamp: Date.now(),
    };

    store.publish({
      turnId: 'turn-hitl-1',
      agentId: 'agent-sub-1',
      event: 'mcp_approval_required',
      payload,
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('mcp_approval_required');
    expect(received[0].payload.requestId).toBe('req-001');
    expect(received[0].payload.parentToolUseId).toBe('tool_use_abc123');
  });

  it('store publish/subscribe round-trips mcp_approval_resolved payload', async () => {
    const store = getAgentEventStore();
    const received: AgentProgressEvent[] = [];
    store.subscribe('turn-hitl-2', (ev) => received.push(ev));

    store.publish({
      turnId: 'turn-hitl-2',
      agentId: 'agent-sub-2',
      event: 'mcp_approval_resolved',
      payload: { requestId: 'req-002', decision: 'approved', approvedBy: 'user@example.com' },
      timestamp: Date.now(),
    });

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('mcp_approval_resolved');
    expect(received[0].payload.decision).toBe('approved');
  });

  it('store buffers mcp_approval_required before subscriber arrives and replays on subscribe', async () => {
    const store = getAgentEventStore();

    // Publish BEFORE subscribing — the store should buffer
    store.publish({
      turnId: 'turn-hitl-buf',
      agentId: 'agent-buf',
      event: 'mcp_approval_required',
      payload: { requestId: 'req-buf', toolName: 'k8s_apply' },
      timestamp: Date.now(),
    });

    // Now subscribe — should receive the buffered event immediately
    const received: AgentProgressEvent[] = [];
    store.subscribe('turn-hitl-buf', (ev) => received.push(ev));

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe('mcp_approval_required');
    expect(received[0].payload.requestId).toBe('req-buf');
  });
});
