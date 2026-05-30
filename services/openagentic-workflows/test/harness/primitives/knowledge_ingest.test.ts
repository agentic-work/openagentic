/**
 * knowledge_ingest node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ content, collection, metadata: { source, workflow_node, ingested_by } }`
 *     to `${apiUrl}/api/chat/knowledge/ingest`.
 *   - Returns the api response verbatim (must include success + chunksIngested).
 *   - Short content (< 10 chars) is rejected up-front without calling the api.
 *
 * Ingest backend mocked via MSW.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('knowledge_ingest node — content ingestion', () => {
  it('forwards content to /api/chat/knowledge/ingest and returns the api envelope', async () => {
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/chat/knowledge/ingest', async () =>
        HttpResponse.json({ success: true, chunksIngested: 3, collection: 'shared' }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'ki',
            type: 'knowledge_ingest',
            data: { collection: 'shared', source: 'harness-test' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ki' }],
      },
      input: {
        content:
          'OpenAgentic Flows is a workflow engine that runs deterministic node graphs ' +
          'against a registry-driven executor pool. Phase D adds harness coverage.',
      },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.ki as { success: boolean; chunksIngested: number };
    expect(out.success).toBe(true);
    expect(out.chunksIngested).toBe(3);
  });

  it('rejects short content (< 10 chars) without calling the api', async () => {
    let apiCalled = false;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/chat/knowledge/ingest', async () => {
        apiCalled = true;
        return HttpResponse.json({ success: true, chunksIngested: 999 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          { id: 'ki', type: 'knowledge_ingest', data: { collection: 'shared' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ki' }],
      },
      input: { content: 'short' },
    });

    expect(result.status).toBe('completed');
    expect(apiCalled).toBe(false);
    const out = result.outputs.ki as { success: boolean; chunksIngested: number };
    expect(out.success).toBe(false);
    expect(out.chunksIngested).toBe(0);
  });
});
