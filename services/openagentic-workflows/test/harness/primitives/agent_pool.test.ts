/**
 * agent_pool node — Phase E1 primitive contract.
 *
 * Public contract: dispatches N agents in parallel via openagentic-proxy
 * /api/agents/execute-sync, returning aggregated
 * { source: 'agent_pool', content, output, agents[], agentCount,
 *   metrics, orchestration:'parallel', status, strategy }.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('agent_pool node — parallel N-agent dispatch', () => {
  it('dispatches the agent list in parallel and merges results', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: 'a-result\n\n---\n\nb-result',
      results: [
        { agentId: 'a', role: 'analyst', status: 'completed', content: 'a-result' },
        { agentId: 'b', role: 'analyst', status: 'completed', content: 'b-result' },
      ],
      metrics: { totalTokens: 100 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'pool',
            type: 'agent_pool',
            data: {
              agents: [
                { agentId: 'a', role: 'analyst', task: 'Analyze A.' },
                { agentId: 'b', role: 'analyst', task: 'Analyze B.' },
              ],
              concurrency: 2,
              aggregation: 'merge',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'pool' }],
      },
      input: { message: 'kickoff' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.pool as {
      source: string;
      agents: unknown[];
      agentCount: number;
      orchestration: string;
      status: string;
    };
    expect(out.source).toBe('agent_pool');
    expect(out.agents).toHaveLength(2);
    expect(out.agentCount).toBe(2);
    expect(out.orchestration).toBe('parallel');
    expect(out.status).toBe('completed');
    expect(captured.orchestration).toBe('parallel');
    expect(captured.agents).toHaveLength(2);
  });
});
