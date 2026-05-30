/**
 * teams_message node — Phase E1 primitive contract.
 *
 * Public contract: POSTs to a Microsoft Teams incoming webhook. When
 * `cardTitle` is set, an Adaptive Card payload is built; otherwise plain
 * `{ text }`. Returns `{ status, sent }` where sent is true iff 200/202.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('teams_message node — incoming webhook POST', () => {
  it('sends a plain text message when no cardTitle is set', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('https://acme.webhook.office.com/webhookb2/test', async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse('1', { status: 200 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'tm',
            type: 'teams_message',
            data: {
              webhookUrl: 'https://acme.webhook.office.com/webhookb2/test',
              message: 'Run {{input.runId}} OK',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'tm' }],
      },
      input: { runId: 'wf-77' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.tm as { status: number; sent: boolean };
    expect(out.sent).toBe(true);
    expect(out.status).toBe(200);
    expect(receivedBody).toMatchObject({ text: 'Run wf-77 OK' });
  });

  it('builds an adaptive card when cardTitle is set', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('https://acme.webhook.office.com/webhookb2/test', async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse('1', { status: 200 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'tm',
            type: 'teams_message',
            data: {
              webhookUrl: 'https://acme.webhook.office.com/webhookb2/test',
              cardTitle: 'Deployment {{input.env}}',
              cardBody: 'Status: {{input.status}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'tm' }],
      },
      input: { env: 'prod', status: 'green' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.tm as { sent: boolean };
    expect(out.sent).toBe(true);
    expect(receivedBody?.type).toBe('message');
    expect(receivedBody?.attachments?.[0]?.contentType).toContain('adaptive');
    const body = receivedBody?.attachments?.[0]?.content?.body;
    expect(JSON.stringify(body)).toContain('Deployment prod');
    expect(JSON.stringify(body)).toContain('Status: green');
  });
});
