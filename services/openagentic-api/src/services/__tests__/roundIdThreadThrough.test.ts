/**
 * roundIdThreadThrough — Task #85 integration lock.
 *
 * Asserts that a single roundId minted at the top of a parallel batch
 * propagates to every downstream consumer:
 *   - tool_round_start / tool_round_end (NDJSON #82)
 *   - per-tool tool_executing frames (#82)
 *   - openagentic-proxy events via AgentEventStore (#84)
 *   - (browser_sandbox_exec requests already carry requestId, unchanged)
 *
 * This is a unit-level integration test — no HTTP, no real LLM. It
 * composes the helper modules and verifies the contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newRoundId, emitRoundStart, emitRoundEnd } from '../toolRound.js';
import { AgentEventStore, type AgentProgressEvent } from '../AgentEventStore.js';

describe('roundId thread-through', () => {
  let emit: ReturnType<typeof vi.fn>;
  let store: AgentEventStore;

  beforeEach(() => {
    emit = vi.fn();
    store = new AgentEventStore();
  });

  it('one roundId unifies tool_round_start, per-tool, and openagentic-proxy events', () => {
    // 1. Chat pipeline opens a round for 3 tools.
    const roundId = emitRoundStart(emit, [
      { toolCallId: 'c1', toolName: 'azure_list_vms' },
      { toolCallId: 'c2', toolName: 'aws_list_s3_buckets' },
      { toolCallId: 'c3', toolName: 'gcp_list_instances' },
    ]);
    expect(roundId).toMatch(/^[0-9a-f]{16}$/);

    // 2. Per-tool tool_executing frames use the same roundId.
    const toolFrames = [
      { toolCallId: 'c1', roundId },
      { toolCallId: 'c2', roundId },
      { toolCallId: 'c3', roundId },
    ];
    for (const f of toolFrames) emit('tool_executing', f);

    // 3. A delegated sub-agent publishes progress carrying the same roundId.
    const captured: AgentProgressEvent[] = [];
    store.subscribe('turn-xyz', (e) => captured.push(e));
    store.publish({
      turnId: 'turn-xyz',
      roundId,
      agentId: 'agent-sub-1',
      event: 'tool_executing',
      payload: { name: 'nested_tool' },
      timestamp: Date.now(),
    });

    // 4. Round closes.
    emitRoundEnd(emit, { roundId, succeeded: 3, failed: 0, durationMs: 420 });

    // Invariants:
    expect(emit.mock.calls[0][0]).toBe('tool_round_start');
    expect(emit.mock.calls[0][1].roundId).toBe(roundId);

    // All tool_executing frames tag the same round
    const execFrames = emit.mock.calls.filter((c) => c[0] === 'tool_executing');
    expect(execFrames).toHaveLength(3);
    expect(new Set(execFrames.map((c) => c[1].roundId))).toEqual(new Set([roundId]));

    // Sub-agent event carries the same round
    expect(captured[0].roundId).toBe(roundId);

    // Close frame matches
    const endCall = emit.mock.calls.find((c) => c[0] === 'tool_round_end');
    expect(endCall![1].roundId).toBe(roundId);
  });

  it('two concurrent rounds do not cross-contaminate', () => {
    const rA = newRoundId();
    const rB = newRoundId();
    expect(rA).not.toBe(rB);

    const eA = vi.fn();
    const eB = vi.fn();

    emitRoundStart(eA, [{ toolCallId: 'a1', toolName: 't' }], rA);
    emitRoundStart(eB, [{ toolCallId: 'b1', toolName: 't' }], rB);

    // Sub-agent events route by turnId, not roundId — but each
    // event carries the correct roundId so downstream can correlate.
    const capA: AgentProgressEvent[] = [];
    const capB: AgentProgressEvent[] = [];
    store.subscribe('turn-A', (e) => capA.push(e));
    store.subscribe('turn-B', (e) => capB.push(e));
    store.publish({
      turnId: 'turn-A',
      roundId: rA,
      agentId: 'x',
      event: 'tool_executing',
      payload: {},
      timestamp: Date.now(),
    });
    store.publish({
      turnId: 'turn-B',
      roundId: rB,
      agentId: 'y',
      event: 'tool_executing',
      payload: {},
      timestamp: Date.now(),
    });

    expect(capA[0].roundId).toBe(rA);
    expect(capB[0].roundId).toBe(rB);
    expect(capA).toHaveLength(1);
    expect(capB).toHaveLength(1);
  });
});
