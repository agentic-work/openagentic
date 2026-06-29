/**
 * pagerduty_incident node — Phase E1 primitive contract.
 *
 * Public contract: POSTs Events API v2 payload to
 * `https://events.pagerduty.com/v2/enqueue`. For action=trigger, the
 * payload includes `routing_key`, `event_action`, `payload:{summary,severity,
 * source,timestamp, custom_details?}`. Returns `{ status, sent, dedupKey, action }`.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('pagerduty_incident node — Events API v2 trigger', () => {
  it('POSTs a trigger event with summary + severity + routing_key', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('https://events.pagerduty.com/v2/enqueue', async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { status: 'success', dedup_key: 'inc-harness-1', message: 'Event processed' },
          { status: 202 },
        );
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'pd',
            type: 'pagerduty_incident',
            data: {
              action: 'trigger',
              routingKey: 'pd-rk-test',
              severity: 'critical',
              summary: 'Disk full on {{input.host}}',
              source: 'openagentic-harness',
              customDetails: { disk: '/var', usagePct: 99 },
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'pd' }],
      },
      input: { host: 'k8d' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.pd as {
      status: number;
      sent: boolean;
      dedupKey: string;
      action: string;
    };
    expect(out.sent).toBe(true);
    expect(out.status).toBe(202);
    expect(out.dedupKey).toBe('inc-harness-1');
    expect(out.action).toBe('trigger');
    expect(receivedBody?.routing_key).toBe('pd-rk-test');
    expect(receivedBody?.event_action).toBe('trigger');
    expect(receivedBody?.payload?.severity).toBe('critical');
    expect(receivedBody?.payload?.summary).toBe('Disk full on k8d');
    expect(receivedBody?.payload?.custom_details).toMatchObject({ disk: '/var', usagePct: 99 });
  });
});
