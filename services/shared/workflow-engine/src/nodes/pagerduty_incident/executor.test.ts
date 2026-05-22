/**
 * pagerduty_incident node — executor tests.
 *
 * Covers:
 *   1. happy path — trigger event POSTs to Events API v2 + status 202
 *   2. missing routingKey + no env → throws
 *   3. PAGERDUTY_ROUTING_KEY env fallback
 *   4. acknowledge/resolve actions: payload omits .payload object
 *   5. severity passed through
 *   6. dedupKey templated against input
 *   7. custom_details passed through
 *   8. client + client_url passed through
 *   9. summary templated
 *   10. abort signal forwarded
 *   11. outputAssertion: status === 202 passes; 400 fails
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { execute } from './executor.js';
import { runWithAssertions } from '../registry.js';
import { OutputAssertionError } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import schema from './schema.json' with { type: 'json' };

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-pd-1',
    apiUrl: 'http://test-api',
    interpolateTemplate: (t: string, input: any) =>
      typeof t === 'string'
        ? t.replace(/\{\{([^}]+)\}\}/g, (_, k) => String(input?.[k.trim()] ?? ''))
        : t,
    getInternalAuthHeaders: () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

const pdNode = (data: Record<string, unknown>) => ({
  id: 'n_pd',
  type: 'pagerduty_incident',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.PAGERDUTY_ROUTING_KEY;
});

afterEach(() => {
  delete process.env.PAGERDUTY_ROUTING_KEY;
});

describe('pagerduty_incident/executor', () => {
  it('trigger — POSTs Events API v2 envelope and returns status 202', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: { dedup_key: 'dk-123' },
    } as any);

    const out: any = await execute(
      pdNode({
        action: 'trigger',
        routingKey: 'rk-1',
        summary: 'Database CPU high',
        severity: 'error',
      }),
      null,
      makeCtx(),
    );

    expect(out.status).toBe(202);
    expect(out.sent).toBe(true);
    expect(out.dedupKey).toBe('dk-123');
    expect(out.action).toBe('trigger');

    expect(postSpy.mock.calls[0][0]).toBe('https://events.pagerduty.com/v2/enqueue');
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.routing_key).toBe('rk-1');
    expect(sent.event_action).toBe('trigger');
    expect(sent.payload.summary).toBe('Database CPU high');
    expect(sent.payload.severity).toBe('error');
  });

  it('throws when routingKey missing and no PAGERDUTY_ROUTING_KEY env', async () => {
    await expect(
      execute(pdNode({ action: 'trigger', summary: 'hi' }), null, makeCtx()),
    ).rejects.toThrow(/routing key/i);
  });

  it('PAGERDUTY_ROUTING_KEY env fallback', async () => {
    process.env.PAGERDUTY_ROUTING_KEY = 'env-key';
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(pdNode({ action: 'trigger', summary: 'hi' }), null, makeCtx());

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.routing_key).toBe('env-key');
  });

  it('acknowledge — payload omits .payload object', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({ action: 'acknowledge', routingKey: 'rk', dedupKey: 'dk-1' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.event_action).toBe('acknowledge');
    expect(sent.dedup_key).toBe('dk-1');
    expect(sent.payload).toBeUndefined();
  });

  it('resolve — payload omits .payload object', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({ action: 'resolve', routingKey: 'rk', dedupKey: 'dk-1' }),
      null,
      makeCtx(),
    );

    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.event_action).toBe('resolve');
    expect(sent.payload).toBeUndefined();
  });

  it('severity is passed through (info / warning / error / critical)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({ action: 'trigger', routingKey: 'rk', summary: 'hi', severity: 'critical' }),
      null,
      makeCtx(),
    );
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.payload.severity).toBe('critical');
  });

  it('dedupKey templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({
        action: 'trigger',
        routingKey: 'rk',
        summary: 'hi',
        dedupKey: 'svc-{{name}}',
      }),
      { name: 'api' },
      makeCtx(),
    );
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.dedup_key).toBe('svc-api');
  });

  it('custom_details passed through (Task #26 extension)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({
        action: 'trigger',
        routingKey: 'rk',
        summary: 'hi',
        customDetails: { region: 'us-east-1', deploy: 'v42' },
      }),
      null,
      makeCtx(),
    );
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.payload.custom_details).toEqual({ region: 'us-east-1', deploy: 'v42' });
  });

  it('client + client_url passed through (Task #26 extension)', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({
        action: 'trigger',
        routingKey: 'rk',
        summary: 'hi',
        client: 'OpenAgentic',
        clientUrl: 'http://localhost:8080/x',
      }),
      null,
      makeCtx(),
    );
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.client).toBe('OpenAgentic');
    expect(sent.client_url).toBe('http://localhost:8080/x');
  });

  it('summary is templated against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({
        action: 'trigger',
        routingKey: 'rk',
        summary: 'Alert: {{svc}}',
      }),
      { svc: 'api' },
      makeCtx(),
    );
    const sent = postSpy.mock.calls[0][1] as any;
    expect(sent.payload.summary).toBe('Alert: api');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: {},
    } as any);

    await execute(
      pdNode({ action: 'trigger', routingKey: 'rk', summary: 'hi' }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('runWithAssertions: 202 passes status_202', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 202,
      data: { dedup_key: 'd' },
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = pdNode({ action: 'trigger', routingKey: 'rk', summary: 'hi' });
    const out: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(out.status).toBe(202);
  });

  it('runWithAssertions: 400 fails status_202', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 400,
      data: { error: 'bad' },
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = pdNode({ action: 'trigger', routingKey: 'rk', summary: 'hi' });
    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
