/**
 * reasoning agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='reasoning' performs slow, deliberate chain-of-thought
 *     analysis on hard problems. Tools: minimal (model's internal CoT).
 *   - Returns a `reasoning_chain[]` trace + a `final_answer` + a
 *     `confidence` level. The flow surfaces this via `agent_single`.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('reasoning agent — deep chain-of-thought analysis', () => {
  it('returns reasoning_chain[] + final_answer + confidence via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        reasoning_chain: [
          'Restate: identify why p95 latency spiked at 14:32.',
          'Enumerate hypotheses: (a) deploy at 14:30, (b) DB lock, (c) upstream provider degradation.',
          'Evidence: deploy log shows new image rolled out at 14:30; p95 spike correlates within 2 minutes.',
          'Rule out (b): no lock-wait spike in DB metrics window.',
          'Rule out (c): upstream provider status page shows green.',
          'Conclude: deploy is the most likely cause.',
        ],
        final_answer:
          'The 14:32 p95 spike was almost certainly caused by the 14:30 deploy. Recommend rollback while investigating the new image.',
        confidence: 'high',
      }),
      results: [
        {
          agentId: 'reasoning',
          role: 'reasoning',
          status: 'completed',
          content: 'p95 spike attributed to 14:30 deploy (high confidence).',
        },
      ],
      metrics: { totalTokens: 880 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'reason',
            type: 'agent_single',
            data: {
              role: 'reasoning',
              prompt: 'Trace why p95 spiked at 14:32 given these 5 metrics + the deploy log.',
              maxTurns: 1,
              tools: [],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'reason' }],
      },
      input: { message: 'p95 root cause' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('reasoning');
    expect(Array.isArray(captured.tools)).toBe(true);
    expect((captured.tools ?? []).length).toBe(0);

    const out = result.outputs.reason as {
      source: string;
      content: string;
      status: string;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');

    const payload = JSON.parse(out.content) as {
      reasoning_chain: string[];
      final_answer: string;
      confidence: string;
    };
    expect(payload.reasoning_chain.length).toBeGreaterThan(1);
    expect(typeof payload.final_answer).toBe('string');
    expect(payload.final_answer.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(payload.confidence);
  });
});
