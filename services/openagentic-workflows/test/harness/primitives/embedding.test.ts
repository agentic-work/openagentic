/**
 * embedding node — Phase E1 primitive contract.
 *
 * Public contract: POSTs `{ input: texts, model }` to
 * `${apiUrl}/api/v1/embeddings`. Returns `{ vectors, model, count, dimensions, texts }`.
 * On primary failure falls back to /api/v1/vector/embed.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('embedding node — text -> vectors', () => {
  it('round-trips a single text input through /api/v1/embeddings', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/embeddings', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }],
          model: receivedBody?.model || 'mock-embed',
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'em', type: 'embedding', data: { model: 'mock-embed' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'em' }],
      },
      input: 'The quick brown fox jumps over the lazy dog.',
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.em as {
      vectors: number[][];
      model: string;
      count: number;
      dimensions: number;
      texts: string[];
    };
    expect(out.vectors).toHaveLength(1);
    expect(out.vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(out.dimensions).toBe(4);
    expect(out.count).toBe(1);
    expect(out.texts[0]).toContain('quick brown fox');
    expect(receivedBody?.input).toEqual(['The quick brown fox jumps over the lazy dog.']);
  });
});
