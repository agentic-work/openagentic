/**
 * knowledge_search node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ query, topK }` to `${apiUrl}/api/chat/knowledge/search`.
 *   - Returns `{ query, resultCount, results: [...] }` normalised from the
 *     api envelope `{ success, results, searchTimeMs }`.
 *   - Templates the query string against the upstream input.
 *
 * Why this exists in addition to rag_query:
 *   - rag_query hits `/api/v1/vector/search` whose collection enum is
 *     `code|docs|memories` (→ Milvus `*_embeddings` collections).
 *   - knowledge_ingest writes to `shared_knowledge` (collection alias
 *     `shared`) or `user_<id>_private` (alias `private`).
 *   - So an ingest → rag_query round-trip silently lands on disjoint
 *     Milvus collections. knowledge_search bridges that gap by reading
 *     back from `shared_knowledge` + the user's private collection via
 *     the chat knowledge-base endpoint.
 *
 * Knowledge backend mocked via MSW.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('knowledge_search node — chat knowledge-base retrieval', () => {
  it('queries /api/chat/knowledge/search and surfaces results + resultCount', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/chat/knowledge/search', async () =>
        HttpResponse.json({
          success: true,
          results: [
            { id: 'c1', content: 'First chunk about flows', score: 0.92, source: 'shared:doc-a' },
            { id: 'c2', content: 'Second chunk on routing', score: 0.81, source: 'shared:doc-b' },
          ],
          searchTimeMs: 47,
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ks',
            type: 'knowledge_search',
            data: { query: 'How do flows route between nodes?', topK: 5 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ks' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ks as {
      query: string;
      resultCount: number;
      results: Array<{ content: string; score: number }>;
    };
    expect(out.query).toBe('How do flows route between nodes?');
    expect(out.resultCount).toBe(2);
    expect(out.results).toHaveLength(2);
    expect(out.results[0].score).toBeGreaterThan(0.9);
  });

  it('interpolates {{trigger.*}} templates in the query', async () => {
    let capturedBody: any = null;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/chat/knowledge/search', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, results: [], searchTimeMs: 5 });
      }),
    );

    await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ks',
            type: 'knowledge_search',
            data: { query: 'what does the doc say about {{trigger.topic}}?', topK: 3 },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ks' }],
      },
      input: { topic: 'lockstep scheduling' },
    });

    expect(capturedBody).toBeTruthy();
    expect(capturedBody.query).toBe('what does the doc say about lockstep scheduling?');
    expect(capturedBody.topK).toBe(3);
  });

  it('returns resultCount=0 when the api responds with empty results', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/chat/knowledge/search', async () =>
        HttpResponse.json({ success: true, results: [], searchTimeMs: 12 }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'ks', type: 'knowledge_search', data: { query: 'unrelated query' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ks' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ks as { resultCount: number; results: unknown[] };
    expect(out.resultCount).toBe(0);
    expect(out.results).toEqual([]);
  });

  it('throws when query is empty after interpolation', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'ks', type: 'knowledge_search', data: { query: '' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ks' }],
      },
      input: {},
    });

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).toMatch(/query/i);
  });
});
