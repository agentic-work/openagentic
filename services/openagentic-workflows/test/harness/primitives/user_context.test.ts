/**
 * user_context node — Phase E1 primitive contract.
 *
 * Public contract: GETs `${apiUrl}/api/user-context` with
 * `?userId&sources&query&maxTokens`. Returns the API body verbatim. On error
 * degrades to `{ context: [], error }` (schema-level outputAssertion catches
 * that).
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('user_context node — context-service GET', () => {
  it('forwards query + sources and returns the api envelope verbatim', async () => {
    let receivedParams: URLSearchParams | null = null;
    harnessServer.use(
      http.get('http://openagentic-api:8000/api/user-context', ({ request }) => {
        receivedParams = new URL(request.url).searchParams;
        return HttpResponse.json({
          context: [
            { source: 'memory', content: 'User prefers concise summaries.' },
            { source: 'chat', content: 'Last asked about kafka.' },
          ],
          tokens: 18,
        });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'uc',
            type: 'user_context',
            data: {
              contextSources: ['memory', 'chat'],
              contextQuery: 'about kafka',
              contextMaxTokens: 500,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'uc' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.uc as { context: unknown[]; tokens: number };
    expect(out.context).toHaveLength(2);
    expect(out.tokens).toBe(18);
    expect(receivedParams?.get('sources')).toBe('memory,chat');
    expect(receivedParams?.get('query')).toBe('about kafka');
    expect(receivedParams?.get('maxTokens')).toBe('500');
  });
});
