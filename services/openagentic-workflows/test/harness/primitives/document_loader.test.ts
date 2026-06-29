/**
 * document_loader node — Phase E1 primitive contract.
 *
 * Public contract: GETs the configured URL with `responseType:'text'`,
 * optionally strips HTML when `parseMode='text'` or content is HTML in
 * `parseMode='auto'`. Returns `{ content, source, sourceType, contentLength,
 * mimeType }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('document_loader node — URL fetch + HTML strip', () => {
  it('fetches HTML, strips tags, exposes content + mimeType', async () => {
    harnessServer.use(
      http.get('https://docs.test/page', () =>
        new HttpResponse(
          '<html><head><style>.x{}</style></head>' +
            '<body><h1>Title</h1><p>Hello <b>world</b>.</p>' +
            '<script>evil()</script></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        ),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'doc',
            type: 'document_loader',
            data: { sourceType: 'url', url: 'https://docs.test/page', parseMode: 'auto' },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'doc' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.doc as {
      content: string;
      source: string;
      sourceType: string;
      contentLength: number;
      mimeType: string;
    };
    expect(out.source).toBe('https://docs.test/page');
    expect(out.sourceType).toBe('url');
    // Tags stripped + script removed
    expect(out.content).not.toMatch(/<script>/);
    expect(out.content).not.toMatch(/<\/?[a-z]+/i);
    expect(out.content).toContain('Title');
    expect(out.content).toContain('Hello');
    expect(out.contentLength).toBeGreaterThan(0);
    expect(out.mimeType).toContain('text/html');
  });
});
