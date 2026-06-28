/**
 * planning agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - A flow that dispatches role='planning' via agent_single posts to
 *     openagentic-proxy `POST /api/agents/execute-sync` with the planning task.
 *   - The agent returns an ordered, structured plan: numbered `steps[]`
 *     with `title` + estimated effort, plus a `total_estimated_minutes`
 *     roll-up. The flow surfaces that structure through the
 *     `agent_single` output envelope verbatim.
 *
 * openagentic-proxy is mocked via MSW so the test asserts wiring + the
 * planning agent's documented output contract, not openagentic-proxy internals.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('planning agent — task decomposition', () => {
  it('returns an ordered, estimable list of steps via agent_single', async () => {
    const planJson = JSON.stringify({
      steps: [
        { id: 1, title: 'Identify scope', estimated_minutes: 10, prerequisites: [] },
        { id: 2, title: 'Gather tri-cloud cost data', estimated_minutes: 30, prerequisites: [1] },
        { id: 3, title: 'Synthesize report', estimated_minutes: 20, prerequisites: [2] },
      ],
      total_estimated_minutes: 60,
    });
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: planJson,
      results: [
        {
          agentId: 'planning',
          role: 'planning',
          status: 'completed',
          content: 'Plan ready: 3 steps, ~60 minutes.',
        },
      ],
      metrics: { totalTokens: 320, costUsd: 0.002 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'plan',
            type: 'agent_single',
            data: {
              role: 'planning',
              prompt: 'Audit our tri-cloud cost for the last 30 days and recommend cuts.',
              maxTurns: 3,
              tools: [],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'plan' }],
      },
      input: { message: 'tri-cloud audit' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.plan as {
      source: string;
      content: string;
      status: string;
      agents: Array<{ role?: string; status?: string }>;
      metrics: Record<string, unknown>;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');
    expect(captured.role).toBe('planning');
    expect(captured.task).toContain('tri-cloud');
    expect(out.agents).toHaveLength(1);
    expect(out.agents[0].role).toBe('planning');
    expect(out.metrics).toMatchObject({ totalTokens: 320 });

    // The agent's structured plan is carried in `content` as JSON — assert
    // the documented output contract end-to-end.
    const plan = JSON.parse(out.content) as {
      steps: Array<{ id: number; title: string; estimated_minutes: number }>;
      total_estimated_minutes: number;
    };
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]).toMatchObject({
      id: expect.any(Number),
      title: expect.any(String),
      estimated_minutes: expect.any(Number),
    });
    expect(plan.total_estimated_minutes).toBeGreaterThan(0);
  });
});
