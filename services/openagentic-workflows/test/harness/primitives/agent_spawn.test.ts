/**
 * agent_spawn node — Phase E1 primitive contract.
 *
 * Public contract: posts a single-agent spec to openagentic-proxy
 * /api/agents/execute-sync with orchestration='parallel' (single agent).
 * Returns `{ source: 'agent_spawn', agentId, agentType, status, content,
 * output, executionId, metrics }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('agent_spawn node — single-agent dispatch', () => {
  it('posts the task to openagentic-proxy and unwraps results[0] into source:agent_spawn envelope', async () => {
    const { handler } = mockOpenAgenticProxyExecuteSync({
      output: 'Research summary: cloud cost spike isolated to us-east-1.',
      results: [
        {
          agentId: 'researcher',
          role: 'reasoning',
          status: 'completed',
          content: 'Research summary: cloud cost spike isolated to us-east-1.',
        },
      ],
      metrics: { totalTokens: 220, costUsd: 0.002 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agent',
            type: 'agent_spawn',
            data: {
              agentType: 'researcher',
              task: 'Research recent AWS spend anomalies.',
              maxTurns: 3,
              costBudget: 50,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agent' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agent as {
      source: string;
      agentType: string;
      status: string;
      content: string;
      metrics: Record<string, unknown>;
    };
    expect(out.source).toBe('agent_spawn');
    expect(out.agentType).toBe('researcher');
    expect(out.status).toBe('completed');
    expect(out.content).toContain('Research summary');
    expect(out.metrics).toMatchObject({ totalTokens: 220 });
  });
});
