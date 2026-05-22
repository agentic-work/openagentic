/**
 * splunk_search node — executor tests.
 *
 * Covers:
 *   1.  search happy path — job created, polled to DONE, events returned
 *   2.  search with empty results — {eventCount:0} returned cleanly (not an error)
 *   3.  search with malformed SPL — Splunk returns 400 → throw with body excerpt
 *   4.  alert_ack happy path
 *   5.  alert_ack with unknown notableId — 404 → throw
 *   6.  notable_create happy path via HEC
 *   7.  notable_create with rejected event — 200 + {text:"Failure…"} → throw
 *   8.  abort signal honored — cancellation mid-call propagates
 *   9.  secret-token interpolation — {{secret:splunk_token}} resolves through ctx
 *   10. missing required field: spl missing for search → throw
 *   11. missing required field: notableId missing for alert_ack → throw
 *   12. missing required field: event missing for notable_create → throw
 *   13. unknown operation enum → throw
 *   14. search: timeout exceeded while polling → throw
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import type { NodeExecutionContext } from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-splunk-1',
    apiUrl: 'http://test-api',
    // Default templater: replace {{x}} with input.x or resolve secret pattern
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const key = k.trim();
            // Resolve {{secret:splunk_token}} → the test token value
            if (key === 'secret:splunk_token') return 'test-splunk-token';
            return String(input?.[key] ?? '');
          })
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

function makeCtxWithCtrl(overrides: Partial<NodeExecutionContext> = {}): {
  ctx: NodeExecutionContext;
  ctrl: AbortController;
} {
  const ctrl = new AbortController();
  const ctx: NodeExecutionContext = {
    signal: ctrl.signal,
    executionId: 'exec-splunk-abort',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, _input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
            const key = k.trim();
            if (key === 'secret:splunk_token') return 'test-token';
            return '';
          })
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
  return { ctx, ctrl };
}

const splunkNode = (data: Record<string, unknown>) => ({
  id: 'n_splunk',
  type: 'splunk_search',
  data,
});

const HOST = 'https://splunk.corp.example.com:8089';
const TOKEN = 'Bearer splunk-session-token-abc';

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('splunk_search/executor', () => {
  // 1. search happy path
  it('search — creates job, polls until DONE, returns events', async () => {
    const reqSpy = vi.spyOn(axios, 'request')
      // POST /services/search/jobs → job created with sid
      .mockResolvedValueOnce({
        status: 201,
        data: { sid: 'test-job-001' },
      } as any)
      // GET /services/search/jobs/test-job-001 → still RUNNING
      .mockResolvedValueOnce({
        status: 200,
        data: { entry: [{ content: { dispatchState: 'RUNNING' } }] },
      } as any)
      // GET /services/search/jobs/test-job-001 → DONE
      .mockResolvedValueOnce({
        status: 200,
        data: { entry: [{ content: { dispatchState: 'DONE' } }] },
      } as any)
      // GET /services/search/jobs/test-job-001/results?output_mode=json → events
      .mockResolvedValueOnce({
        status: 200,
        data: {
          results: [
            { host: 'web-01', count: '42' },
            { host: 'web-02', count: '17' },
          ],
        },
      } as any);

    const out: any = await execute(
      splunkNode({
        operation: 'search',
        host: HOST,
        token: TOKEN,
        spl: 'index=main sourcetype=access_combined status=500 | stats count by host',
        earliestTime: '-15m',
        latestTime: 'now',
        maxResults: 100,
        timeout: 10000,
      }),
      null,
      makeCtx(),
    );

    expect(out.jobId).toBe('test-job-001');
    expect(out.events).toHaveLength(2);
    expect(out.events[0]).toEqual({ host: 'web-01', count: '42' });
    expect(out.eventCount).toBe(2);
    expect(out.earliestTime).toBe('-15m');
    expect(out.latestTime).toBe('now');
    // Job creation call
    expect(reqSpy).toHaveBeenCalledTimes(4);
    const createCall = reqSpy.mock.calls[0][0] as any;
    expect(createCall.method).toBe('post');
    expect(createCall.url).toContain('/services/search/jobs');
    expect(createCall.headers['Authorization']).toBe(TOKEN);
  });

  // 2. search with empty results
  it('search — empty result set returns {eventCount:0} cleanly (not an error)', async () => {
    vi.spyOn(axios, 'request')
      .mockResolvedValueOnce({
        status: 201,
        data: { sid: 'empty-job' },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { entry: [{ content: { dispatchState: 'DONE' } }] },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [] },
      } as any);

    const out: any = await execute(
      splunkNode({
        operation: 'search',
        host: HOST,
        token: TOKEN,
        spl: 'index=main something_unlikely',
        timeout: 10000,
      }),
      null,
      makeCtx(),
    );

    expect(out.events).toEqual([]);
    expect(out.eventCount).toBe(0);
    expect(out.jobId).toBe('empty-job');
    // Empty results should NOT throw
  });

  // 3. search with malformed SPL (400 from Splunk)
  it('search — 400 from Splunk on job creation → throws with body excerpt', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 400,
      data: { messages: [{ type: 'FATAL', text: 'Unknown search command "badcmd"' }] },
    } as any);

    await expect(
      execute(
        splunkNode({
          operation: 'search',
          host: HOST,
          token: TOKEN,
          spl: 'index=main | badcmd',
          timeout: 10000,
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/400|badcmd|job creation failed/i);
  });

  // 4. alert_ack happy path
  it('alert_ack — posts to notable_update, returns {ok:true, notableId}', async () => {
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      data: { success: true },
    } as any);

    const out: any = await execute(
      splunkNode({
        operation: 'alert_ack',
        host: HOST,
        token: TOKEN,
        notableId: 'NID-001',
        comment: 'Auto-acked by workflow',
        assignee: 'soc-bot',
      }),
      null,
      makeCtx(),
    );

    expect(out.ok).toBe(true);
    expect(out.notableId).toBe('NID-001');

    const call = reqSpy.mock.calls[0][0] as any;
    expect(call.method).toBe('post');
    expect(call.url).toContain('/services/notable_update');
    expect(call.headers['Authorization']).toBe(TOKEN);
  });

  // 5. alert_ack with unknown notableId (404 → throw)
  it('alert_ack — 404 from Splunk → throws', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 404,
      data: { messages: [{ type: 'FATAL', text: 'Notable event not found' }] },
    } as any);

    await expect(
      execute(
        splunkNode({
          operation: 'alert_ack',
          host: HOST,
          token: TOKEN,
          notableId: 'DOES-NOT-EXIST',
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/404|not found/i);
  });

  // 6. notable_create happy path via HEC
  it('notable_create — posts to HEC endpoint, returns {ok:true, eventId}', async () => {
    const reqSpy = vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      data: { text: 'Success', code: 0, eventId: 'hec-evt-abc' },
    } as any);

    const out: any = await execute(
      splunkNode({
        operation: 'notable_create',
        host: HOST,
        token: TOKEN,
        event: { severity: 'high', src_host: 'app-01', description: 'Disk full' },
        index: 'notable',
        sourcetype: 'stash',
      }),
      null,
      makeCtx(),
    );

    expect(out.ok).toBe(true);
    expect(out.eventId).toBeDefined();

    const call = reqSpy.mock.calls[0][0] as any;
    // HEC uses port 8088
    expect(call.url).toContain('8088');
    expect(call.url).toContain('/services/collector/event');
    expect(call.headers['Authorization']).toContain(TOKEN);
    // Payload wraps the event with index + sourcetype
    expect(call.data.event).toEqual({ severity: 'high', src_host: 'app-01', description: 'Disk full' });
    expect(call.data.index).toBe('notable');
    expect(call.data.sourcetype).toBe('stash');
  });

  // 7. notable_create with rejected event (200 + failure text → throw)
  it('notable_create — 200 with failure text body → throws', async () => {
    vi.spyOn(axios, 'request').mockResolvedValueOnce({
      status: 200,
      data: { text: 'Invalid data format', code: 6 },
    } as any);

    await expect(
      execute(
        splunkNode({
          operation: 'notable_create',
          host: HOST,
          token: TOKEN,
          event: { bad_field_that_hec_rejects: true },
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/HEC.*failure|Invalid data|success/i);
  });

  // 8. abort signal honored
  it('abort signal — cancellation during job creation propagates as error', async () => {
    const { ctx, ctrl } = makeCtxWithCtrl();

    vi.spyOn(axios, 'request').mockImplementationOnce(async () => {
      ctrl.abort();
      const err: any = new Error('Request aborted');
      err.code = 'ERR_CANCELED';
      throw err;
    });

    await expect(
      execute(
        splunkNode({
          operation: 'search',
          host: HOST,
          token: 'tok',
          spl: 'index=main',
          timeout: 10000,
        }),
        null,
        ctx,
      ),
    ).rejects.toThrow(/aborted|cancel/i);
  });

  // 9. secret-token interpolation
  it('secret-token interpolation — {{secret:splunk_token}} resolved through ctx', async () => {
    const reqSpy = vi.spyOn(axios, 'request')
      .mockResolvedValueOnce({
        status: 201,
        data: { sid: 'tok-job' },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { entry: [{ content: { dispatchState: 'DONE' } }] },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ _raw: 'log line' }] },
      } as any);

    await execute(
      splunkNode({
        operation: 'search',
        host: HOST,
        token: '{{secret:splunk_token}}',
        spl: 'index=main',
        timeout: 10000,
      }),
      null,
      makeCtx(),
    );

    // The Authorization header should contain the resolved secret value
    const createCall = reqSpy.mock.calls[0][0] as any;
    expect(createCall.headers['Authorization']).toBe('test-splunk-token');
  });

  // 10. missing spl for search → throw
  it('search — missing spl → throws with descriptive error', async () => {
    await expect(
      execute(
        splunkNode({
          operation: 'search',
          host: HOST,
          token: TOKEN,
          // spl intentionally omitted
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/spl|query/i);
  });

  // 11. missing notableId for alert_ack → throw
  it('alert_ack — missing notableId → throws with descriptive error', async () => {
    await expect(
      execute(
        splunkNode({
          operation: 'alert_ack',
          host: HOST,
          token: TOKEN,
          // notableId intentionally omitted
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/notableId|notable.*id/i);
  });

  // 12. missing event for notable_create → throw
  it('notable_create — missing event payload → throws with descriptive error', async () => {
    await expect(
      execute(
        splunkNode({
          operation: 'notable_create',
          host: HOST,
          token: TOKEN,
          // event intentionally omitted
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/event/i);
  });

  // 13. unknown operation enum → throw
  it('throws on unknown operation enum value', async () => {
    await expect(
      execute(
        splunkNode({
          operation: 'unsupported_op',
          host: HOST,
          token: TOKEN,
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/operation/i);
  });

  // 14. search poll timeout
  it('search — poll timeout exceeded → throws', async () => {
    vi.spyOn(axios, 'request')
      // Job creation
      .mockResolvedValueOnce({
        status: 201,
        data: { sid: 'slow-job' },
      } as any)
      // All subsequent status polls return RUNNING (will never finish)
      .mockResolvedValue({
        status: 200,
        data: { entry: [{ content: { dispatchState: 'RUNNING' } }] },
      } as any);

    // Use a very short timeout so the test completes quickly
    await expect(
      execute(
        splunkNode({
          operation: 'search',
          host: HOST,
          token: TOKEN,
          spl: 'index=main | sleep 999',
          timeout: 100, // 100ms — will time out immediately
        }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/timeout|timed out/i);
  }, 10000);
});
