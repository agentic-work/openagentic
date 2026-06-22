/**
 * AgentProgressContext — TDD spec for Phase A of the subagent architecture
 * cleanup (the design notes §4).
 *
 * Mirrors Inngest AgentKit's `StreamingContext`
 * (packages/agent-kit/src/streaming.ts:359-412): a single injected
 * `publish` callback, a monotonic `seq` counter SHARED across the
 * (runId, parentRunId) tree, and a `createChild(childRunId)` method
 * that preserves `turnId` + `publish` + sequence counter.
 *
 * This context is the dependency-injection seam that lets in-process
 * and out-of-process publishers share the same envelope shape under
 * one conversation-level `turnId`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AgentProgressContext,
  type AgentProgressEnvelope,
} from '../AgentProgressContext.js';

describe('AgentProgressContext', () => {
  it('constructor stores turnId + runId + publish; parentRunId defaults to null', () => {
    const publish = vi.fn();
    const ctx = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'R1',
    });
    expect(ctx.turnId).toBe('T1');
    expect(ctx.runId).toBe('R1');
    expect(ctx.parentRunId).toBeNull();
  });

  it('emit() calls publish with a full envelope {turnId, runId, parentRunId, event, payload, seq, ts}', () => {
    const publish = vi.fn();
    const t0 = Date.now();
    const ctx = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'R1',
    });

    ctx.emit({ event: 'agent_start', payload: { task: 'kickoff' } });

    expect(publish).toHaveBeenCalledOnce();
    const env = publish.mock.calls[0][0] as AgentProgressEnvelope;
    expect(env.turnId).toBe('T1');
    expect(env.runId).toBe('R1');
    expect(env.parentRunId).toBeNull();
    expect(env.event).toBe('agent_start');
    expect(env.payload).toEqual({ task: 'kickoff' });
    expect(env.seq).toBe(0);
    expect(typeof env.ts).toBe('number');
    expect(env.ts).toBeGreaterThanOrEqual(t0);
  });

  it('emit() twice → seq increments 0 → 1 (monotonic)', () => {
    const publish = vi.fn();
    const ctx = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'R1',
    });

    ctx.emit({ event: 'agent_start', payload: {} });
    ctx.emit({ event: 'tool_executing', payload: { name: 't1' } });

    expect(publish).toHaveBeenCalledTimes(2);
    const first = publish.mock.calls[0][0] as AgentProgressEnvelope;
    const second = publish.mock.calls[1][0] as AgentProgressEnvelope;
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
  });

  it('createChild() returns a new ctx with parentRunId=this.runId, same turnId + publish, SHARED seq counter', () => {
    const publish = vi.fn();
    const parent = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'R1',
    });

    // Parent emits first → seq=0
    parent.emit({ event: 'agent_start', payload: {} });

    const child = parent.createChild('R2');
    expect(child).toBeInstanceOf(AgentProgressContext);
    expect(child.turnId).toBe('T1');
    expect(child.runId).toBe('R2');
    expect(child.parentRunId).toBe('R1');

    // Child emits AFTER parent → seq should be 1 (NOT reset to 0).
    child.emit({ event: 'agent_start', payload: {} });

    expect(publish).toHaveBeenCalledTimes(2);
    const parentEnv = publish.mock.calls[0][0] as AgentProgressEnvelope;
    const childEnv = publish.mock.calls[1][0] as AgentProgressEnvelope;
    expect(parentEnv.seq).toBe(0);
    expect(childEnv.seq).toBe(1);

    // Publish ref is the SAME object (not a wrapper) — proves injection.
    // (We assert via behaviour: both emits landed on the same spy.)
    // And further parent emits interleave correctly with child emits.
    parent.emit({ event: 'tool_executing', payload: {} });
    const thirdEnv = publish.mock.calls[2][0] as AgentProgressEnvelope;
    expect(thirdEnv.seq).toBe(2);
    expect(thirdEnv.runId).toBe('R1');
  });

  it('two sibling contexts on same turn each have their own seq counter unless explicitly shared', () => {
    // Independent siblings: caller constructs two contexts separately,
    // each with its own implicit seq counter. Each starts at 0.
    const publish = vi.fn();

    const ctxA = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'Ra',
    });
    const ctxB = new AgentProgressContext({
      publish,
      turnId: 'T1',
      runId: 'Rb',
    });

    ctxA.emit({ event: 'agent_start', payload: {} });
    ctxB.emit({ event: 'agent_start', payload: {} });
    ctxA.emit({ event: 'tool_executing', payload: {} });

    const calls = publish.mock.calls.map((c) => c[0] as AgentProgressEnvelope);
    expect(calls[0].runId).toBe('Ra');
    expect(calls[0].seq).toBe(0);
    expect(calls[1].runId).toBe('Rb');
    expect(calls[1].seq).toBe(0); // independent counter → starts at 0
    expect(calls[2].runId).toBe('Ra');
    expect(calls[2].seq).toBe(1);
  });
});
