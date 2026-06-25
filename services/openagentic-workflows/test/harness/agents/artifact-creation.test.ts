/**
 * artifact-creation agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='artifact-creation' produces a single render_artifact tool
 *     call whose input is a discriminated-union payload
 *     (kind: html | svg | mermaid | react | python_plot).
 *   - The agent's tool allowlist is `render_artifact`, `generate_image`,
 *     `file_read`. The flow surfaces the artifact spec via the
 *     `agent_single` envelope.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('artifact-creation agent — visual artifact assembly', () => {
  it('returns a discriminated-union artifact spec via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        artifact: {
          kind: 'mermaid',
          title: 'Q1 spend by service (top 5)',
          group_id: 'q1-spend',
          content:
            'flowchart TD\n  total[Total $35,653]\n  total --> aws[AWS $18.9k]\n  total --> azure[Azure $12.5k]\n  total --> gcp[GCP $4.3k]',
        },
      }),
      results: [
        {
          agentId: 'artifact-creation',
          role: 'artifact-creation',
          status: 'completed',
          content: 'Rendered mermaid chart for tri-cloud spend.',
        },
      ],
      metrics: { totalTokens: 540 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'art',
            type: 'agent_single',
            data: {
              role: 'artifact-creation',
              prompt: 'Build a mermaid chart of Q1 tri-cloud spend by service.',
              maxTurns: 3,
              tools: ['render_artifact', 'generate_image', 'file_read'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'art' }],
      },
      input: { message: 'render q1 spend' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('artifact-creation');
    expect(captured.tools).toEqual(
      expect.arrayContaining(['render_artifact', 'generate_image', 'file_read']),
    );

    const out = result.outputs.art as {
      source: string;
      content: string;
      status: string;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');

    const payload = JSON.parse(out.content) as {
      artifact: { kind: string; title: string; content: string; group_id?: string };
    };
    expect(payload.artifact).toBeDefined();
    // Discriminated-union: kind must be one of the documented variants.
    expect(['html', 'svg', 'mermaid', 'react', 'python_plot']).toContain(
      payload.artifact.kind,
    );
    expect(typeof payload.artifact.title).toBe('string');
    expect(payload.artifact.title.length).toBeGreaterThan(0);
    expect(typeof payload.artifact.content).toBe('string');
    expect(payload.artifact.content.length).toBeGreaterThan(0);
  });
});
