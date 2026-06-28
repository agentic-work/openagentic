/**
 * splunk_search node — Phase E1 primitive contract.
 *
 * Public contract (operation='search'):
 *   - POST /services/search/jobs   -> { sid }
 *   - poll GET /services/search/jobs/:sid until dispatchState=DONE
 *   - GET /services/search/jobs/:sid/results -> { results[] }
 *   - Returns `{ jobId, events, eventCount, earliestTime, latestTime }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('splunk_search node — search operation', () => {
  it('creates job, polls until DONE, returns events list', async () => {
    let pollCount = 0;
    let receivedSearch: string | undefined;
    harnessServer.use(
      http.post('https://splunk.test:8089/services/search/jobs', async ({ request }) => {
        const body = (await request.json().catch(() => null)) as any;
        receivedSearch = body?.search;
        return HttpResponse.json({ sid: 'job-harness-1' }, { status: 201 });
      }),
      http.get('https://splunk.test:8089/services/search/jobs/job-harness-1', () => {
        // First poll returns RUNNING, second returns DONE
        pollCount++;
        const state = pollCount >= 2 ? 'DONE' : 'RUNNING';
        return HttpResponse.json({
          entry: [{ content: { dispatchState: state } }],
        });
      }),
      http.get('https://splunk.test:8089/services/search/jobs/job-harness-1/results', () =>
        HttpResponse.json({
          results: [
            { _time: '2026-05-13T00:00:00Z', host: 'k8d', count: 12 },
            { _time: '2026-05-13T00:05:00Z', host: 'hal', count: 7 },
          ],
        }),
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sp',
            type: 'splunk_search',
            data: {
              operation: 'search',
              host: 'https://splunk.test:8089',
              token: 'Bearer harness-token',
              spl: 'index=main sourcetype=app',
              earliestTime: '-15m',
              latestTime: 'now',
              maxResults: 10,
              timeout: 10000,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'sp' }],
      },
      input: {},
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.sp as {
      jobId: string;
      events: unknown[];
      eventCount: number;
      earliestTime: string;
      latestTime: string;
    };
    expect(out.jobId).toBe('job-harness-1');
    expect(out.eventCount).toBe(2);
    expect(out.events).toHaveLength(2);
    expect(out.earliestTime).toBe('-15m');
    expect(out.latestTime).toBe('now');
    expect(receivedSearch).toContain('index=main');
  });
});
