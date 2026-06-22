/**
 * vector_store node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ collection, operation, vectors, texts, metadata, createIfMissing }`
 *     to `${apiUrl}/api/v1/vector/store`.
 *   - Returns `{ collection, operation, stored, ...respData }` with `stored`
 *     reflecting the persisted count.
 *
 * Vector backend mocked via MSW.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('vector_store node — upsert wiring', () => {
  it('upserts vectors via /api/v1/vector/store and surfaces the stored count', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/v1/vector/store', async ({ request }) => {
        const body = (await request.json()) as { vectors?: unknown[]; collection?: string };
        const count = Array.isArray(body.vectors) ? body.vectors.length : 0;
        return HttpResponse.json({ ok: true, count });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'vs',
            type: 'vector_store',
            data: { operation: 'upsert', collection: 'shared', createIfMissing: true },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'vs' }],
      },
      input: {
        vectors: [
          { id: 'v1', vector: [0.1, 0.2, 0.3], metadata: { src: 'doc-a' } },
          { id: 'v2', vector: [0.4, 0.5, 0.6], metadata: { src: 'doc-b' } },
        ],
        texts: ['first', 'second'],
      },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.vs as {
      collection: string;
      operation: string;
      stored: number;
    };
    expect(out.collection).toBe('shared');
    expect(out.operation).toBe('upsert');
    expect(out.stored).toBe(2);
  });
});
