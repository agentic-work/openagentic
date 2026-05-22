/**
 * Subagent event publishing — TDD spec for the #84 publisher side.
 *
 * Sub-agent dispatch is live; the receiver-side AgentEventStore is
 * live. This test locks the contract that when a
 * sub-agent emits progress (start, tool_executing, tool_complete,
 * message, complete), it calls `publishAgentEvent()` which writes to
 * the in-process store keyed by turnId (Phase A rename 2026-04-23).
 *
 * Once this wire is in, chat handler subscribes to the parent turn and
 * re-emits these as `agent_progress` NDJSON frames — the UI gets the
 * sub-agent-card data it needs to render .sa-head with turns/tokens/
 * time/cost per mockup 01-cloud-ops.html.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { publishAgentEvent, resetAgentEventCount } from '../subagentEventPublish.js';
import { AgentEventStore } from '../AgentEventStore.js';

describe('publishAgentEvent', () => {
  let store: AgentEventStore;
  let captured: any[];

  beforeEach(() => {
    store = new AgentEventStore();
    captured = [];
    store.subscribe('turn-abc', (e) => captured.push(e));
    resetAgentEventCount();
  });

  it('publishes to the shared store under turnId', () => {
    // Phase A: conversation-level key is `turnId` (was `parentTurnId`).
    publishAgentEvent(store, {
      turnId: 'turn-abc',
      agentId: 'agent-1',
      agentRole: 'research',
      event: 'agent_start',
      payload: { task: 'aws cost scan' },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].agentId).toBe('agent-1');
    expect(captured[0].agentRole).toBe('research');
    expect(captured[0].event).toBe('agent_start');
  });

  it('stamps a timestamp if caller omits one', () => {
    const t0 = Date.now();
    publishAgentEvent(store, {
      turnId: 'turn-abc',
      agentId: 'agent-1',
      event: 'tool_executing',
      payload: {},
    });
    expect(captured[0].timestamp).toBeGreaterThanOrEqual(t0);
  });

  it('includes roundId when caller provides one', () => {
    publishAgentEvent(store, {
      turnId: 'turn-abc',
      roundId: 'abc123',
      agentId: 'agent-1',
      event: 'tool_executing',
      payload: {},
    });
    expect(captured[0].roundId).toBe('abc123');
  });

  it('swallows errors from the store (non-blocking)', () => {
    const brokenStore = {
      publish: vi.fn(() => {
        throw new Error('store down');
      }),
    } as any;
    expect(() =>
      publishAgentEvent(brokenStore, {
        turnId: 'turn-abc',
        agentId: 'agent-1',
        event: 'agent_start',
        payload: {},
      }),
    ).not.toThrow();
  });

  it('missing turnId is a no-op (sub-agent with no parent context)', () => {
    publishAgentEvent(store, {
      turnId: '',
      agentId: 'agent-1',
      event: 'agent_start',
      payload: {},
    });
    expect(captured).toHaveLength(0);
  });

  it('fan-out: multiple events for same agent arrive in order', () => {
    publishAgentEvent(store, { turnId: 'turn-abc', agentId: 'a', event: 'agent_start', payload: {} });
    publishAgentEvent(store, { turnId: 'turn-abc', agentId: 'a', event: 'tool_executing', payload: { name: 't1' } });
    publishAgentEvent(store, { turnId: 'turn-abc', agentId: 'a', event: 'tool_complete', payload: { name: 't1' } });
    publishAgentEvent(store, { turnId: 'turn-abc', agentId: 'a', event: 'agent_complete', payload: {} });
    expect(captured.map((e) => e.event)).toEqual([
      'agent_start',
      'tool_executing',
      'tool_complete',
      'agent_complete',
    ]);
  });
});
