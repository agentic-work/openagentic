/**
 * servicenow_ticket node — executor tests.
 *
 * Covers:
 *   1. happy path — POSTs to /api/now/table/incident, returns sysId/number on 201
 *   2. missing instanceUrl + no env → throws
 *   3. configurable table (e.g. 'change_request')
 *   4. fields templated against input
 *   5. SERVICENOW_USERNAME + SERVICENOW_PASSWORD → Basic Auth header
 *   6. SERVICENOW_AUTH_TOKEN (Bearer prefix) used as Authorization header
 *   7. abort signal forwarded
 *   8. outputAssertion: 201 passes; 500 fails
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
    executionId: 'exec-snow-1',
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

const snowNode = (data: Record<string, unknown>) => ({
  id: 'n_snow',
  type: 'servicenow_ticket',
  data,
});

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SERVICENOW_INSTANCE_URL;
  delete process.env.SERVICENOW_USERNAME;
  delete process.env.SERVICENOW_PASSWORD;
  delete process.env.SERVICENOW_AUTH_TOKEN;
});

afterEach(() => {
  delete process.env.SERVICENOW_INSTANCE_URL;
  delete process.env.SERVICENOW_USERNAME;
  delete process.env.SERVICENOW_PASSWORD;
  delete process.env.SERVICENOW_AUTH_TOKEN;
});

describe('servicenow_ticket/executor', () => {
  it('happy path — POSTs to /api/now/table/incident, returns sysId+number', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: { sys_id: 'sid-1', number: 'INC0001' } },
    } as any);

    const out: any = await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        fields: { short_description: 'hi', urgency: '2' },
      }),
      null,
      makeCtx(),
    );
    expect(out.status).toBe(201);
    expect(out.created).toBe(true);
    expect(out.sysId).toBe('sid-1');
    expect(out.number).toBe('INC0001');

    expect(postSpy.mock.calls[0][0]).toBe(
      'https://dev.service-now.com/api/now/table/incident',
    );
    expect(postSpy.mock.calls[0][1]).toEqual({
      short_description: 'hi',
      urgency: '2',
    });
  });

  it('throws when instanceUrl missing and no env', async () => {
    await expect(
      execute(snowNode({ fields: { x: 1 } }), null, makeCtx()),
    ).rejects.toThrow(/instance url/i);
  });

  it('configurable table — change_request', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: { sys_id: 'sid', number: 'CHG0001' } },
    } as any);

    await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        table: 'change_request',
        fields: { short_description: 'rollout' },
      }),
      null,
      makeCtx(),
    );

    expect(postSpy.mock.calls[0][0]).toBe(
      'https://dev.service-now.com/api/now/table/change_request',
    );
  });

  it('templates field values against input', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: { sys_id: 's', number: 'N' } },
    } as any);

    await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        fields: { short_description: 'Outage in {{region}}' },
      }),
      { region: 'us-east-1' },
      makeCtx(),
    );

    expect(postSpy.mock.calls[0][1]).toEqual({
      short_description: 'Outage in us-east-1',
    });
  });

  it('SERVICENOW_USERNAME + SERVICENOW_PASSWORD → Basic auth', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: {} },
    } as any);

    process.env.SERVICENOW_USERNAME = 'user';
    process.env.SERVICENOW_PASSWORD = 'pw';

    await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        fields: { x: 1 },
      }),
      null,
      makeCtx(),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    const expected = 'Basic ' + Buffer.from('user:pw').toString('base64');
    expect(cfg.headers.Authorization).toBe(expected);
  });

  it('SERVICENOW_AUTH_TOKEN (Bearer ...) used directly', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: {} },
    } as any);

    process.env.SERVICENOW_AUTH_TOKEN = 'Bearer abc.def';

    await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        fields: { x: 1 },
      }),
      null,
      makeCtx(),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.headers.Authorization).toBe('Bearer abc.def');
  });

  it('forwards the AbortSignal into the axios request', async () => {
    const ctrl = new AbortController();
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: {} },
    } as any);

    await execute(
      snowNode({
        instanceUrl: 'https://dev.service-now.com',
        fields: { x: 1 },
      }),
      null,
      makeCtx({ signal: ctrl.signal }),
    );

    const cfg = postSpy.mock.calls[0][2] as any;
    expect(cfg.signal).toBe(ctrl.signal);
  });

  it('runWithAssertions: 201 passes; 500 fails created_ok', async () => {
    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 201,
      data: { result: { sys_id: 's', number: 'N' } },
    } as any);

    const plugin = { schema: schema as any, execute };
    const node = snowNode({
      instanceUrl: 'https://dev.service-now.com',
      fields: { x: 1 },
    });
    const ok: any = await runWithAssertions(plugin, node as any, null, makeCtx());
    expect(ok.status).toBe(201);

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      status: 500,
      data: {},
    } as any);
    await expect(
      runWithAssertions(plugin, node as any, null, makeCtx()),
    ).rejects.toBeInstanceOf(OutputAssertionError);
  });
});
