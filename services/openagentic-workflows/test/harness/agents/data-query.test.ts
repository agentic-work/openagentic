/**
 * data-query agent — Phase E2 built-in-agent contract.
 *
 * Public contract under test:
 *   - role='data-query' translates a question into a SELECT-shaped read
 *     against Postgres / Milvus / Athena / BigQuery and returns rows.
 *   - The agent's tool allowlist is `postgres_query`, `milvus_search`,
 *     `milvus_list_collections`, `athena_query`, `bigquery_query`. The
 *     flow surfaces the rows + a one-sentence interpretation via the
 *     `agent_single` envelope.
 */
import { describe, it, expect } from 'vitest';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';
import { mockOpenAgenticProxyExecuteSync } from '../mocks/handlers/openagenticProxy.js';

describe('data-query agent — read-only data retrieval', () => {
  it('returns query + rows + total_results via agent_single', async () => {
    const { handler, captured } = mockOpenAgenticProxyExecuteSync({
      output: JSON.stringify({
        query:
          'SELECT service, SUM(cost_usd) AS total FROM azure_costs WHERE window = $1 GROUP BY service ORDER BY total DESC LIMIT 10',
        parameters: ['90d'],
        rows: [
          { service: 'log-analytics', total: 4302.11 },
          { service: 'sql-managed-instance', total: 3811.04 },
          { service: 'storage', total: 1290.55 },
        ],
        total_results: 3,
        interpretation:
          'log-analytics is the highest-cost Azure service in the last 90 days, ~$4.3k.',
      }),
      results: [
        {
          agentId: 'data-query',
          role: 'data-query',
          status: 'completed',
          content: 'Top-3 azure services returned.',
        },
      ],
      metrics: { totalTokens: 340 },
    });
    harnessServer.use(handler);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'query',
            type: 'agent_single',
            data: {
              role: 'data-query',
              prompt:
                'Show me the top-10 highest-cost services across all Azure subs for the last 90 days.',
              maxTurns: 3,
              tools: [
                'postgres_query',
                'milvus_search',
                'milvus_list_collections',
                'athena_query',
                'bigquery_query',
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'query' }],
      },
      input: { message: 'top azure services' },
    });

    expect(result.status).toBe('completed');
    expect(captured.role).toBe('data-query');
    expect(captured.tools).toEqual(
      expect.arrayContaining([
        'postgres_query',
        'milvus_search',
        'athena_query',
        'bigquery_query',
      ]),
    );
    // Read-only allowlist — no write/insert/update tools.
    for (const t of captured.tools ?? []) {
      expect(t).not.toMatch(/insert|update|delete|drop|truncate|write/i);
    }

    const out = result.outputs.query as {
      source: string;
      content: string;
      status: string;
    };
    expect(out.source).toBe('agent_single');
    expect(out.status).toBe('completed');

    const payload = JSON.parse(out.content) as {
      query: string;
      rows: Array<Record<string, unknown>>;
      total_results: number;
      interpretation: string;
    };
    // Documented contract: read-only SELECT shape.
    expect(payload.query).toMatch(/^\s*SELECT/i);
    expect(Array.isArray(payload.rows)).toBe(true);
    expect(payload.rows.length).toBe(payload.total_results);
    expect(typeof payload.interpretation).toBe('string');
    expect(payload.interpretation.length).toBeGreaterThan(0);
  });
});
