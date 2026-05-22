/**
 * AgentEventStore — TDD spec for task #84 (Phase A rename).
 *
 * In-process pub/sub keyed by turnId. openagentic-proxy POSTs events to
 * /api/chat/agent-event; the chat stream subscribed to that turn gets
 * each event delivered and re-emits it as an `agent_progress` NDJSON
 * frame. Mirrors SandboxResultStore semantics.
 *
 * Phase A renames `parentTurnId` → `turnId` to align with the
 * conversation-level identifier pattern used by Inngest AgentKit's
 * `StreamingContext` (streaming.ts:359-412). Within-turn nesting is
 * now expressed via `(runId, parentRunId)`, matching AgentKit's
 * `RunStartedEvent` payload (streaming.ts:46-57).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AgentEventStore,
  type AgentProgressEvent,
} from '../AgentEventStore.js';

function evt(partial: Partial<AgentProgressEvent> = {}): AgentProgressEvent {
  return {
    turnId: 'turn-abc',
    roundId: 'round-xyz',
    agentId: 'agent-1',
    agentRole: 'research',
    event: 'tool_executing',
    payload: { name: 'azure_list_vms' },
    timestamp: Date.now(),
    ...partial,
  };
}

describe('AgentEventStore', () => {
  let store: AgentEventStore;

  beforeEach(() => {
    store = new AgentEventStore();
  });

  it('publish with no subscriber is a no-op (returns false)', () => {
    const delivered = store.publish(evt());
    expect(delivered).toBe(false);
  });

  it('subscribe + publish delivers to the callback', () => {
    const cb = vi.fn();
    store.subscribe('turn-abc', cb);
    const e = evt();
    const delivered = store.publish(e);
    expect(delivered).toBe(true);
    expect(cb).toHaveBeenCalledWith(e);
  });

  it('unsubscribe stops delivery', () => {
    const cb = vi.fn();
    const unsub = store.subscribe('turn-abc', cb);
    unsub();
    store.publish(evt());
    expect(cb).not.toHaveBeenCalled();
  });

  it('events for other turns do not cross-deliver', () => {
    const cbA = vi.fn();
    const cbB = vi.fn();
    store.subscribe('turn-A', cbA);
    store.subscribe('turn-B', cbB);
    store.publish(evt({ turnId: 'turn-A' }));
    expect(cbA).toHaveBeenCalledOnce();
    expect(cbB).not.toHaveBeenCalled();
  });

  it('multiple subscribers for one turn all receive the event (fan-out)', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe('turn-A', cb1);
    store.subscribe('turn-A', cb2);
    store.publish(evt({ turnId: 'turn-A' }));
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('buffers up to N events pre-subscribe, drains to first subscriber', () => {
    // openagentic-proxy might fire events before the parent chat handler has
    // subscribed (especially for fast subagents). Short-lived buffer
    // (default 32 events per turn) smooths that race.
    store.publish(evt({ agentId: 'a-0' }));
    store.publish(evt({ agentId: 'a-1' }));
    store.publish(evt({ agentId: 'a-2' }));

    const cb = vi.fn();
    store.subscribe('turn-abc', cb);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(cb.mock.calls[0][0].agentId).toBe('a-0');
    expect(cb.mock.calls[2][0].agentId).toBe('a-2');
  });

  it('caps the pre-subscribe buffer at 32 events (drop oldest)', () => {
    for (let i = 0; i < 40; i++) {
      store.publish(evt({ agentId: `a-${i}` }));
    }
    const cb = vi.fn();
    store.subscribe('turn-abc', cb);
    expect(cb).toHaveBeenCalledTimes(32);
    // Oldest (a-0..a-7) dropped; a-8 is the first delivered
    expect(cb.mock.calls[0][0].agentId).toBe('a-8');
  });

  it('drops the buffer after a subscriber connects (no double-delivery)', () => {
    store.publish(evt({ agentId: 'x' }));
    const cb1 = vi.fn();
    store.subscribe('turn-abc', cb1);
    expect(cb1).toHaveBeenCalledTimes(1);

    const cb2 = vi.fn();
    store.subscribe('turn-abc', cb2);
    // cb2 does NOT receive the replay; it only gets fresh events
    expect(cb2).not.toHaveBeenCalled();
  });

  // ── Phase A new specs: (runId, parentRunId) tree under one turnId ──

  it('publish with (turnId, runId, parentRunId:null) delivers to the turn subscriber', () => {
    const cb = vi.fn();
    store.subscribe('T1', cb);
    const e: AgentProgressEvent = {
      turnId: 'T1',
      runId: 'R1',
      parentRunId: null,
      agentId: 'agent-root',
      event: 'agent_start',
      payload: { task: 'kickoff' },
      timestamp: Date.now(),
    };
    const delivered = store.publish(e);
    expect(delivered).toBe(true);
    expect(cb).toHaveBeenCalledOnce();
    const received = cb.mock.calls[0][0] as AgentProgressEvent;
    expect(received.turnId).toBe('T1');
    expect(received.runId).toBe('R1');
    expect(received.parentRunId).toBeNull();
  });

  it('publish with child run (runId=R2, parentRunId=R1) arrives on the same turn after R1 (FIFO)', () => {
    const received: AgentProgressEvent[] = [];
    store.subscribe('T1', (ev) => received.push(ev));

    const ts = Date.now();
    const parent: AgentProgressEvent = {
      turnId: 'T1',
      runId: 'R1',
      parentRunId: null,
      agentId: 'agent-root',
      event: 'agent_start',
      payload: {},
      timestamp: ts,
    };
    const child: AgentProgressEvent = {
      turnId: 'T1',
      runId: 'R2',
      parentRunId: 'R1',
      agentId: 'agent-child',
      event: 'agent_start',
      payload: {},
      timestamp: ts + 1,
    };

    store.publish(parent);
    store.publish(child);

    expect(received).toHaveLength(2);
    expect(received[0].runId).toBe('R1');
    expect(received[0].parentRunId).toBeNull();
    expect(received[1].runId).toBe('R2');
    expect(received[1].parentRunId).toBe('R1');
  });
});
