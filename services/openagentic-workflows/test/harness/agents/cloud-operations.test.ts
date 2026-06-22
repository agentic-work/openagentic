/**
 * cloud-operations agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='cloud-operations' investigates resources across Azure, AWS,
 *     GCP, and Kubernetes. Its tool allowlist is the wildcard set
 *     `azure_* / aws_* / gcp_* / k8s_* / kubectl_*` plus `file_read`.
 *   - The agent returns tri-cloud-partitioned findings (per-cloud
 *     blocks + cross-cloud roll-up). The flow surfaces this through
 *     agent_spawn's `{ source: 'agent_spawn', content, output, ... }`
 *     envelope.
 *
 * openagentic-proxy is mocked via MSW.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('cloud-operations agent — tri-cloud audit', () => {
  it('dispatches via agent_spawn and returns per-cloud findings', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        azure: {
          subscriptions_audited: 3,
          total_cost_usd: 12450.22,
          top_service: 'log-analytics',
        },
        aws: {
          accounts_audited: 2,
          total_cost_usd: 18901.04,
          top_service: 'ec2',
        },
        gcp: {
          projects_audited: 1,
          total_cost_usd: 4302.11,
          top_service: 'gke',
        },
        cross_cloud_total_usd: 35653.37,
        recommendations: [
          'Right-size 4 idle EC2 instances (estimated $1.8k/mo savings).',
          'Tier-shift Azure log analytics to 30d retention.',
        ],
      }),
      results: [
        {
          agentId: 'cloud-operations',
          role: 'cloud-operations',
          status: 'completed',
          content: 'Tri-cloud audit complete: $35,653 total spend, 2 recommendations.',
        },
      ],
      metrics: { totalTokens: 1820, costUsd: 0.012 },
      extra: { executionId: 'exec-test-cloud-ops' },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'cloud',
            type: 'agent_spawn',
            data: {
              agentType: 'cloud-operations',
              task: 'Audit our tri-cloud spend for the last 30 days.',
              tools: ['azure_*', 'aws_*', 'gcp_*', 'k8s_*', 'kubectl_*', 'file_read'],
              maxTurns: 10,
              costBudget: 200,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'cloud' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('cloud-operations');
    // Tool allowlist must contain the documented wildcard set.
    expect(captured.tools).toEqual(
      expect.arrayContaining(['azure_*', 'aws_*', 'gcp_*', 'k8s_*', 'kubectl_*']),
    );

    const out = result.outputs.cloud as {
      source: string;
      agentType: string;
      status: string;
      content: string;
      output: string;
    };
    expect(out.source).toBe('agent_spawn');
    expect(out.agentType).toBe('cloud-operations');
    expect(out.status).toBe('completed');

    const findings = JSON.parse(out.output) as {
      azure: Record<string, unknown>;
      aws: Record<string, unknown>;
      gcp: Record<string, unknown>;
      cross_cloud_total_usd: number;
      recommendations: string[];
    };
    expect(findings.azure).toBeDefined();
    expect(findings.aws).toBeDefined();
    expect(findings.gcp).toBeDefined();
    expect(findings.cross_cloud_total_usd).toBeGreaterThan(0);
    expect(findings.recommendations.length).toBeGreaterThan(0);
  });
});
