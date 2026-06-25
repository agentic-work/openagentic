/**
 * synthesis agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='synthesis' merges multiple intermediate findings into a
 *     single, well-organised answer.
 *   - The agent returns prose + a sources list with attributed weight
 *     and a confidence score; the flow surfaces that through the
 *     `agent_single` envelope.
 *
 * openagentic-proxy is mocked via MSW.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('synthesis agent — multi-source merge', () => {
  it('produces prose + sources[] + confidence via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        synthesis:
          'Tri-cloud spend grew 18% MoM, driven primarily by AWS data-egress and Azure log retention. GCP held flat.',
        sources: [
          { id: 'aws-cost-report', content: 'AWS spend up 22% MoM', weight: 0.5 },
          { id: 'azure-cost-report', content: 'Azure spend up 14% MoM', weight: 0.3 },
          { id: 'gcp-cost-report', content: 'GCP spend flat', weight: 0.2 },
        ],
        confidence: 0.82,
      }),
      results: [
        {
          agentId: 'synthesis',
          role: 'synthesis',
          status: 'completed',
          content: 'Synthesised cross-cloud spend trend.',
        },
      ],
      metrics: { totalTokens: 410 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'synth',
            type: 'agent_single',
            data: {
              role: 'synthesis',
              prompt: 'Given the three cost reports, write a 200-word executive summary.',
              maxTurns: 3,
              tools: [],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'synth' }],
      },
      input: { message: 'merge cost reports' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('synthesis');
    const out = result.outputs.synth as {
      source: string;
      content: string;
      status: string;
      agents: Array<{ role?: string }>;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');
    expect(out.agents[0].role).toBe('synthesis');

    const payload = JSON.parse(out.content) as {
      synthesis: string;
      sources: Array<{ id: string; content: string; weight: number }>;
      confidence: number;
    };
    expect(typeof payload.synthesis).toBe('string');
    expect(payload.synthesis.length).toBeGreaterThan(0);
    expect(payload.sources.length).toBeGreaterThan(0);
    expect(payload.sources[0]).toMatchObject({
      id: expect.any(String),
      content: expect.any(String),
      weight: expect.any(Number),
    });
    expect(payload.confidence).toBeGreaterThan(0);
    expect(payload.confidence).toBeLessThanOrEqual(1);
  });
});
