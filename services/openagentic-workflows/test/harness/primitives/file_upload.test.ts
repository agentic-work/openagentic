/**
 * file_upload node — Phase E1 primitive contract.
 *
 * Public contract: POSTs `{ collection, content, fileName, chunkSize,
 * chunkOverlap, metadata }` to `${apiUrl}/api/files/embed`. Returns
 * `{ collection, fileName, chunkCount, status:'embedded', ...api }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('file_upload node — content embedding', () => {
  it('forwards content + chunk params to /api/files/embed and returns chunkCount', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('http://openagentic-api:8000/api/files/embed', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true, chunkCount: 4, collection: receivedBody.collection });
      }),
    );

    const longContent =
      'OpenAgentic Flows is a workflow engine. '.repeat(40);

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'fu',
            type: 'file_upload',
            data: {
              collection: 'kb-docs',
              fileName: 'engine-notes.txt',
              chunkSize: 256,
              chunkOverlap: 30,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'fu' }],
      },
      input: { content: longContent },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.fu as {
      collection: string;
      fileName: string;
      chunkCount: number;
      status: string;
    };
    expect(out.collection).toBe('kb-docs');
    expect(out.fileName).toBe('engine-notes.txt');
    expect(out.chunkCount).toBe(4);
    expect(out.status).toBe('embedded');
    expect(receivedBody?.chunkSize).toBe(256);
    expect(receivedBody?.collection).toBe('kb-docs');
  });
});
