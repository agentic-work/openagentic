/**
 * agent_supervisor node — Phase E1 primitive contract.
 *
 * Public contract: routes through openagentic-proxy with orchestration='supervisor'.
 * First agent in the wire payload is the supervisor (carries the goal),
 * remaining agents are worker specs with task='{{delegated}}' placeholder.
 * Returns `{ source: 'agent_supervisor', orchestration:'supervisor', ... }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('agent_supervisor node — supervisor + workers', () => {
  it('routes through openagentic-proxy in supervisor mode with worker fan-out', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: 'Supervised plan executed by 2 workers.',
      results: [
        { role: 'supervisor', status: 'completed', content: 'Plan complete.' },
        { agentId: 'w1', role: 'researcher', status: 'completed', content: 'w1 done' },
        { agentId: 'w2', role: 'coder', status: 'completed', content: 'w2 done' },
      ],
      metrics: { totalTokens: 480 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sup',
            type: 'agent_supervisor',
            data: {
              supervisorPrompt: 'Coordinate research + code-fix for incident {{input.id}}.',
              agents: [
                { agentId: 'w1', role: 'researcher' },
                { agentId: 'w2', role: 'coder' },
              ],
              maxTurns: 5,
              concurrency: 2,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'sup' }],
      },
      input: { id: 'INC-42' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.sup as {
      source: string;
      orchestration: string;
      agentCount: number;
      content: string;
    };
    expect(out.source).toBe('agent_supervisor');
    expect(out.orchestration).toBe('supervisor');
    expect(out.agentCount).toBe(3);
    expect(captured.orchestration).toBe('supervisor');
    // First wire-agent is the supervisor, followed by worker specs
    expect(captured.agents?.[0]?.role).toBe('supervisor');
    expect(captured.agents?.[0]?.task).toContain('INC-42');
    expect(captured.agents).toHaveLength(3);
  });
});
