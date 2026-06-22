/**
 * multi_agent node — Tier A SDK-typed events (TDD).
 *
 * Contract under test: when the engine fans out sub-agents through the
 * multi_agent primitive, the per-spec lifecycle frames it emits on the
 * execution stream MUST be canonical AgenticEvent shapes from
 * `@agentic-work/llm-sdk` (Layer 4 — sub-agents):
 *
 *   - buildSubAgentStarted   → { type: 'sub_agent_started',   ... }
 *   - buildSubAgentCompleted → { type: 'sub_agent_completed', ... }
 *
 * Today the executor emits free-form `{ eventType: 'subagent.start' }`
 * strings via ctx.emitNodeProgress. This test pins the canonical-shape
 * upgrade so chatmode and Flows share one swarm-renderer contract.
 *
 * The engine wraps the canonical event in a `node_progress` frame and
 * surfaces the event on `frame.event` (canonical AgenticEvent), keeping
 * the SSE envelope ('node_progress') as the framing layer.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('multi_agent — SDK typed sub-agent lifecycle events (Tier A)', () => {
  it('emits canonical SubAgentStartedEvent shape (not free-form eventType string)', async () => {
    const longOutput =
      'A long, substantive aggregated answer that is well over one hundred characters in length ' +
      'to satisfy the substantive output assertion length check on the multi_agent path.';
    const { handler } = mockOpenAgenticProxyExecuteSync({
      output: longOutput,
      results: [
        { agentId: 'agent-A', role: 'planning', status: 'completed', content: 'plan ok with substantive content body' },
      ],
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'multi',
            type: 'multi_agent',
            data: {
              agents: [{ agentId: 'agent-A', role: 'planning', task: 'plan {{input.topic}}' }],
              pattern: 'parallel',
              aggregationStrategy: 'merge',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'multi' }],
      },
      input: { topic: 'a thing' },
    });

    expect(result.status).toBe('completed');

    // The progress frames must carry a canonical AgenticEvent under `event`.
    const startedFrames = result.frames.filter(
      (f) =>
        f.type === 'node_progress' &&
        (f as unknown as { event?: { type?: string } }).event?.type === 'sub_agent_started',
    );
    expect(startedFrames.length).toBeGreaterThan(0);

    const evt = (startedFrames[0] as unknown as { event: Record<string, unknown> }).event;
    expect(evt).toMatchObject({
      type: 'sub_agent_started',
      agent_role: 'planning',
    });
    expect(typeof evt.task_id).toBe('string');
    expect(typeof evt.ts).toBe('number');

    // NEGATIVE: legacy free-form eventType string must no longer ride at the
    // frame top level for canonical sub-agent lifecycle events.
    const legacyShape = result.frames.filter(
      (f) =>
        f.type === 'node_progress' &&
        (f as unknown as { eventType?: string }).eventType === 'subagent.start',
    );
    expect(legacyShape).toEqual([]);
  });

  it('emits canonical SubAgentCompletedEvent shape on completion (success + failure)', async () => {
    const longOutput =
      'Consolidated output that is comfortably longer than the substantive gate threshold ' +
      'so the multi_agent node passes its post-execution assertion.';
    const { handler } = mockOpenAgenticProxyExecuteSync({
      output: longOutput,
      results: [
        { agentId: 'agent-A', role: 'planning', status: 'completed', content: 'plan ok body content here' },
        { agentId: 'agent-B', role: 'critic', status: 'failed', error: 'boom' },
      ],
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'multi',
            type: 'multi_agent',
            data: {
              agents: [
                { agentId: 'agent-A', role: 'planning', task: 'plan' },
                { agentId: 'agent-B', role: 'critic', task: 'critique' },
              ],
              pattern: 'parallel',
              aggregationStrategy: 'merge',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'multi' }],
      },
      input: { topic: 'x' },
    });

    expect(result.status).toBe('completed');

    const completedFrames = result.frames.filter(
      (f) =>
        f.type === 'node_progress' &&
        (f as unknown as { event?: { type?: string } }).event?.type === 'sub_agent_completed',
    );
    expect(completedFrames.length).toBe(2);

    const evt0 = (completedFrames[0] as unknown as { event: Record<string, unknown> }).event;
    const evt1 = (completedFrames[1] as unknown as { event: Record<string, unknown> }).event;
    expect(evt0).toMatchObject({ type: 'sub_agent_completed', ok: true });
    expect(evt1).toMatchObject({ type: 'sub_agent_completed', ok: false });
    expect(typeof evt0.task_id).toBe('string');
    expect(typeof evt0.ts).toBe('number');

    // NEGATIVE: legacy completion shape must not appear for these slots.
    const legacyComplete = result.frames.filter(
      (f) =>
        f.type === 'node_progress' &&
        (f as unknown as { eventType?: string }).eventType === 'subagent.complete',
    );
    expect(legacyComplete).toEqual([]);
  });
});
