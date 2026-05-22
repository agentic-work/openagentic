/**
 * validation agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='validation' performs a read-only audit of a draft and returns
 *     a structured verdict: `passed: boolean`, `issues: [...]`, and a
 *     `confidence` score.
 *   - The agent has a minimal, read-only tool allowlist (file_read,
 *     postgres_query, milvus_search). The flow surfaces the verdict via
 *     the `agent_single` envelope.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('validation agent — output correctness audit', () => {
  it('returns passed + issues[] + confidence via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        passed: false,
        issues: [
          {
            severity: 'high',
            message: 'AWS cost total disagrees with source by $543',
            location: 'aws.total',
          },
          {
            severity: 'low',
            message: 'Date window stated as 30d but query used 28d',
            location: 'meta.window',
          },
        ],
        confidence: 0.91,
        verdict: 'NEEDS-CHANGES',
      }),
      results: [
        {
          agentId: 'validation',
          role: 'validation',
          status: 'completed',
          content: 'Audit failed: 2 issues (1 high, 1 low).',
        },
      ],
      metrics: { totalTokens: 280 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'validate',
            type: 'agent_single',
            data: {
              role: 'validation',
              prompt: 'Validate the AWS cost summary against the source list.',
              maxTurns: 3,
              tools: ['file_read', 'postgres_query', 'milvus_search'],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'validate' }],
      },
      input: { message: 'audit cost summary' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('validation');
    // Tool allowlist must be strictly read-only.
    expect(captured.tools).toEqual(
      expect.arrayContaining(['file_read', 'postgres_query', 'milvus_search']),
    );
    for (const t of captured.tools ?? []) {
      expect(t).not.toMatch(/_write$|_delete$|_create$/);
    }

    const out = result.outputs.validate as {
      source: string;
      content: string;
      status: string;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');

    const payload = JSON.parse(out.content) as {
      passed: boolean;
      issues: Array<{ severity: string; message: string; location?: string }>;
      confidence: number;
    };
    expect(typeof payload.passed).toBe('boolean');
    expect(Array.isArray(payload.issues)).toBe(true);
    expect(payload.issues[0]).toMatchObject({
      severity: expect.any(String),
      message: expect.any(String),
    });
    expect(payload.confidence).toBeGreaterThan(0);
    expect(payload.confidence).toBeLessThanOrEqual(1);
  });
});
