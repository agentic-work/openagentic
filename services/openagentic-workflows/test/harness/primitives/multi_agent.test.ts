/**
 * multi_agent node — Phase E1 primitive contract.
 *
 * Public contract: routes through openagentic-proxy /api/agents/execute-sync
 * with orchestration mode derived from `pattern`. Emits subagent.start
 * BEFORE the call and subagent.complete per result on the way out.
 * Returns `{ source: 'multi_agent', content, output, agents[], agentCount,
 * strategy, metrics }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('multi_agent node — ensemble fan-out', () => {
  it('dispatches the agent list and emits subagent.start/complete frames', async () => {
    // Output content needs to be >100 chars to satisfy
    // multi_agent_substantive_output assertion in schema.json.
    const mergedOutput =
      'Pro side argued for flexibility and productivity benefits of remote work. ' +
      'Con side cited collaboration gaps. Judge ruled hybrid model best.';
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: mergedOutput,
      results: [
        { agentId: 'a', role: 'pro', status: 'completed', content: 'pro-says-flexibility-and-remote-productivity-with-multi-line-evidence' },
        { agentId: 'b', role: 'con', status: 'completed', content: 'con-says-collaboration-gaps-and-team-cohesion-concerns-in-depth' },
        { agentId: 'c', role: 'judge', status: 'completed', content: 'judge-says-hybrid-balances-both-positions-and-recommends-policy' },
      ],
      metrics: { totalTokens: 333 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ma',
            type: 'multi_agent',
            data: {
              agents: [
                { agentId: 'a', role: 'pro', task: 'Argue for {{input.topic}}.' },
                { agentId: 'b', role: 'con', task: 'Argue against {{input.topic}}.' },
                { agentId: 'c', role: 'judge', task: 'Judge.' },
              ],
              pattern: 'parallel',
              aggregationStrategy: 'merge',
              maxConcurrency: 3,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ma' }],
      },
      input: { topic: 'remote work' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ma as {
      source: string;
      agents: unknown[];
      agentCount: number;
      strategy: string;
    };
    expect(out.source).toBe('multi_agent');
    expect(out.agents).toHaveLength(3);
    expect(out.agentCount).toBe(3);
    expect(out.strategy).toBe('merge');
    expect(captured.agents).toHaveLength(3);
    expect(captured.agents?.[0]?.task).toContain('remote work');
  });
});
