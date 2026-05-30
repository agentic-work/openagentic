/**
 * http_request — proof-of-life test for the Flows harness scaffold.
 *
 * Two assertions:
 *   1. A 200 response with a JSON body round-trips through the executor
 *      and shows up in `outputs[nodeId]` with `{ status, data }`.
 *   2. A non-2xx status code (404) is preserved on the output envelope
 *      when `acceptAllStatuses: true` — the assertion path that's about to
 *      get exercised by every downstream node test that touches a network
 *      boundary.
 *
 * If either of these regresses, the harness is broken before Phase B/C
 * can land a single primitive test on top of it.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('http_request node — harness proof of life', () => {
  it('GETs a URL and returns the response body in outputs[nodeId]', async () => {
    harnessServer.use(
      http.get('https://api.test.example/data', () =>
        HttpResponse.json({ greeting: 'hello' }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { trigger_type: 'manual' } },
          {
            id: 'http',
            type: 'http_request',
            data: {
              url: 'https://api.test.example/data',
              method: 'GET',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'http' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    expect(result.outputs.http).toMatchObject({
      status: 200,
      data: { greeting: 'hello' },
    });
  });

  it('captures real http status code (404) in output when acceptAllStatuses', async () => {
    harnessServer.use(
      http.get(
        'https://api.test.example/notfound',
        () => new HttpResponse(JSON.stringify({ err: 'gone' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { trigger_type: 'manual' } },
          {
            id: 'http',
            type: 'http_request',
            data: {
              url: 'https://api.test.example/notfound',
              method: 'GET',
              acceptAllStatuses: true,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'http' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const httpOut = result.outputs.http as { status: number; data: unknown };
    expect(httpOut.status).toBe(404);
  });
});
