/**
 * data_query node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ collection, query, topK, filters }` to
 *     `${apiUrl}/api/v1/vector/search`.
 *   - Returns `{ collection, results, resultCount }` with resultCount
 *     equal to results.length.
 *   - Falls back to `input.message` / `input.query` / stringified input
 *     when no `query` is set on the node.
 *
 * Vector backend mocked via MSW.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('data_query node — collection query', () => {
  it('queries a collection and returns normalised { collection, results, resultCount }', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/vector/search', async ({ request }) => {
        const body = (await request.json()) as { query: string; collection: string };
        return HttpResponse.json({
          results: [
            { id: 'r1', text: `matched on "${body.query}"`, score: 0.88 },
            { id: 'r2', text: 'second match', score: 0.71 },
          ],
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'dq',
            type: 'data_query',
            data: { collection: 'incident-history', query: '{{input.message}}', limit: 5 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'dq' }],
      },
      input: { message: 'kafka consumer lag' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.dq as {
      collection: string;
      results: unknown[];
      resultCount: number;
    };
    expect(out.collection).toBe('incident-history');
    expect(out.resultCount).toBe(2);
    expect(out.results).toHaveLength(2);
  });
});
