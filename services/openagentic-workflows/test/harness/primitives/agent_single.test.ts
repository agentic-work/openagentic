/**
 * agent_single node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Posts a single-agent spec to `${openagenticProxyUrl}/api/agents/execute-sync`
 *     with orchestration='parallel'.
 *   - Unwraps `r.results[0]` (or top-level `r.output`) into a clean
 *     `{ source, content, output, status, agents, metrics, orchestration }`.
 *
 * openagentic-proxy is mocked via MSW — execute-sync returns a deterministic
 * single-agent result so the test asserts wiring, not openagentic-proxy internals.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('agent_single node — single-agent dispatch', () => {
  it('dispatches to openagentic-proxy and unwraps results[0] into output envelope', async () => {
    const { handler } = mockOpenAgenticProxyExecuteSync({
      output: 'Plan: 1) gather data 2) analyze 3) report.',
      results: [
        {
          agentId: 'planning',
          role: 'planning',
          status: 'completed',
          content: 'Plan: 1) gather data 2) analyze 3) report.',
        },
      ],
      metrics: { totalTokens: 142, costUsd: 0.001 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'agent',
            type: 'agent_single',
            data: {
              role: 'planning',
              prompt: 'Plan steps for a tri-cloud cost audit.',
              maxTurns: 3,
              tools: [],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'agent' }],
      },
      input: { message: 'audit our spend' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.agent as {
      source: string;
      content: string;
      output: string;
      status: string;
      agents: unknown[];
      metrics: Record<string, unknown>;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');
    expect(out.content).toContain('Plan');
    expect(out.agents).toHaveLength(1);
    expect(out.metrics).toMatchObject({ totalTokens: 142 });
  });
});
