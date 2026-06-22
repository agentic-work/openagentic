/**
 * data_source_query node — Phase E1 primitive contract.
 *
 * Public contract:
 *   - `mode='raw'` posts `{ query }` to `${apiUrl}/api/data-sources/:id/query`
 *   - `mode='nl'`  posts `{ question }` to `${apiUrl}/api/data-sources/:id/nl-query`
 *   - Returns `{ rows, columns, rowCount, executionTimeMs, generatedQuery, content }`.
 *
 * Distinct from `data_query` (vector search) — this node targets a registered
 * relational/NoSQL data source.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('data_source_query node — relational + nl mode', () => {
  it('mode=raw posts the SQL to /query and returns the rows envelope', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/data-sources/ds-1/query', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          rows: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          columns: ['id', 'name'],
          rowCount: 2,
          executionTimeMs: 12,
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ds',
            type: 'data_source_query',
            data: {
              mode: 'raw',
              dataSourceId: 'ds-1',
              query: 'SELECT id, name FROM users WHERE active = true LIMIT 2',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ds' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ds as {
      rows: unknown[];
      columns: string[];
      rowCount: number;
      content: string;
    };
    expect(out.rows).toHaveLength(2);
    expect(out.columns).toContain('name');
    expect(out.rowCount).toBe(2);
    expect(receivedBody?.query).toContain('SELECT id, name');
  });

  it('mode=nl posts the question to /nl-query and forwards generatedQuery back', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/data-sources/ds-2/nl-query', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          rows: [{ count: 17 }],
          columns: ['count'],
          rowCount: 1,
          generatedQuery: 'SELECT COUNT(*) AS count FROM orders',
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ds',
            type: 'data_source_query',
            data: { mode: 'nl', dataSourceId: 'ds-2', question: 'How many orders?' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ds' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ds as { rows: unknown[]; generatedQuery: string };
    expect(out.rows).toHaveLength(1);
    expect(out.generatedQuery).toContain('COUNT');
    expect(receivedBody?.question).toBe('How many orders?');
  });
});
