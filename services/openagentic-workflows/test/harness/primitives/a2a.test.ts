/**
 * a2a node — Phase E1 primitive contract.
 *
 * Public contract: a2a is an alias of agent_spawn that normalizes
 * `prompt` -> `task`. Posts to openagentic-proxy `/api/agents/execute-sync`
 * and returns `{ source: 'a2a', status, content, output, agentId, ... }`.
 */

import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('a2a node — agent-to-agent dispatch', () => {
  it('routes prompt -> task and stamps source:a2a on output', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: 'Handshake acknowledged.',
      results: [
        { agentId: 'responder', role: 'reasoning', status: 'completed', content: 'Handshake acknowledged.' },
      ],
      metrics: { totalTokens: 24 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'a2a',
            type: 'a2a',
            data: {
              agentRole: 'general',
              prompt: 'Echo handshake to peer-bot.',
              maxTurns: 1,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'a2a' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.a2a as { source: string; status: string; content: string };
    expect(out.source).toBe('a2a');
    expect(out.status).toBe('completed');
    expect(out.content).toContain('Handshake');
    // prompt was promoted into task on the wire
    expect(captured.task).toContain('Echo handshake');
  });
});
