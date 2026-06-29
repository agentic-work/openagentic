/**
 * rag_query node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ collection, query, topK, filters, scoreThreshold }` to
 *     `${apiUrl}/api/v1/vector/search`.
 *   - Returns `{ query, collection, resultCount, results: [...] }` with
 *     resultCount matching results.length.
 *
 * Vector backend mocked via MSW.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('rag_query node — vector search', () => {
  it('queries the vector backend and surfaces normalised results + resultCount', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/vector/search', async () =>
        HttpResponse.json({
          results: [
            { id: 'chunk-1', text: 'First chunk', score: 0.91, metadata: { source: 'doc-a' } },
            { id: 'chunk-2', text: 'Second chunk', score: 0.78, metadata: { source: 'doc-b' } },
            { id: 'chunk-3', text: 'Third chunk', score: 0.62, metadata: { source: 'doc-c' } },
          ],
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'rag',
            type: 'rag_query',
            data: {
              collection: 'shared',
              query: 'How do tenant overrides work?',
              topK: 3,
              scoreThreshold: 0.5,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'rag' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.rag as {
      collection: string;
      query: string;
      resultCount: number;
      results: Array<{ text: string; score: number }>;
    };
    expect(out.collection).toBe('shared');
    expect(out.resultCount).toBe(3);
    expect(out.results).toHaveLength(3);
    expect(out.results[0].score).toBeGreaterThan(0.9);
  });
});
