/**
 * servicenow_ticket node — Phase E1 primitive contract.
 *
 * Public contract: POSTs the resolved fields to
 * `${instanceUrl}/api/now/table/${table}`. Auth via SERVICENOW_AUTH_TOKEN
 * or username/password Basic. Returns `{ status, created, sysId, number }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('servicenow_ticket node — Table API incident create', () => {
  it('creates an incident via /api/now/table/incident', async () => {
    process.env.SERVICENOW_AUTH_TOKEN = 'Bearer harness-sn-token';

    let receivedBody: any;
    let receivedAuth: string | null = null;
    harnessServer.use(
      http.post('https://acme.service-now.com/api/now/table/incident', async ({ request }) => {
        receivedBody = await request.json();
        receivedAuth = request.headers.get('authorization');
        return HttpResponse.json(
          { result: { sys_id: 'abcdef0123456789', number: 'INC0010042' } },
          { status: 201 },
        );
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'sn',
            type: 'servicenow_ticket',
            data: {
              action: 'create_incident',
              instanceUrl: 'https://acme.service-now.com',
              table: 'incident',
              fields: {
                short_description: 'Latency spike on {{input.svc}}',
                urgency: '2',
              },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'sn' }],
      },
      input: { svc: 'checkout-api' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.sn as {
      status: number;
      created: boolean;
      sysId: string;
      number: string;
    };
    expect(out.created).toBe(true);
    expect(out.status).toBe(201);
    expect(out.sysId).toBe('abcdef0123456789');
    expect(out.number).toBe('INC0010042');
    expect(receivedBody?.short_description).toBe('Latency spike on checkout-api');
    expect(receivedBody?.urgency).toBe('2');
    expect(receivedAuth).toBe('Bearer harness-sn-token');
  });
});
