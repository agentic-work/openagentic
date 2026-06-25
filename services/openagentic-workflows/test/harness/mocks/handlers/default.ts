/**
 * Default MSW handlers for the Flows test harness.
 *
 * These are the baseline mocks that EVERY harness test starts with —
 * httpbin-style endpoints used as smoke / canary targets so that any
 * node test which sends an HTTP request without setting up its own
 * mock still resolves deterministically.
 *
 * Per-test overrides go through `harnessServer.use(...)` and are reset
 * via the `afterEach` hook in msw-setup.ts.
 */

import { http, HttpResponse } from 'msw';

export const defaultHandlers = [
  // GitHub Zen — a stable, well-known canary endpoint we mock to avoid
  // accidental real network hits during template-rendering smoke tests.
  http.get('https://api.github.com/zen', () =>
    HttpResponse.text('Test response.'),
  ),

  // Generic httpbin-style GET — returns the URL + a deterministic body.
  http.get('https://httpbin.test.local/get', ({ request }) =>
    HttpResponse.json({
      url: request.url,
      args: Object.fromEntries(new URL(request.url).searchParams),
      headers: Object.fromEntries(request.headers.entries()),
    }),
  ),

  // Generic httpbin-style POST — echoes the body.
  http.post('https://httpbin.test.local/post', async ({ request }) => {
    const body = await request.clone().text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* keep string */ }
    return HttpResponse.json({
      url: request.url,
      json: parsed,
      headers: Object.fromEntries(request.headers.entries()),
    });
  }),

  // 500 generator for error_handler / retry-path tests.
  http.get('https://httpbin.test.local/status/500', () =>
    new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' }),
  ),

  // Engine ambient side-effects we don't want to assert on in primitive
  // tests. The engine fires a user-memory ingest after every flow run;
  // we stub it so the test log stays clean.
  http.post('http://openagentic-api:8000/api/user-memory/ingest', () =>
    HttpResponse.json({ ok: true, stubbed: true }),
  ),
];
