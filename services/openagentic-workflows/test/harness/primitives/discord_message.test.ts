/**
 * discord_message node — Phase E1 primitive contract.
 *
 * Public contract: POSTs `{ content, username, embeds? }` to the Discord
 * webhook URL. Returns `{ status, sent }` where sent is true iff status is
 * 200 or 204.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('discord_message node — webhook POST', () => {
  it('POSTs the resolved content + username to the webhook URL', async () => {
    let receivedBody: any;
    harnessServer.use(
      http.post('https://discord.com/api/webhooks/123/abc', async ({ request }) => {
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'dc',
            type: 'discord_message',
            data: {
              webhookUrl: 'https://discord.com/api/webhooks/123/abc',
              content: 'Build {{input.runId}} status: {{input.status}}',
              username: 'openagentic-ci',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'dc' }],
      },
      input: { runId: 'wf-99', status: 'green' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.dc as { status: number; sent: boolean };
    expect(out.sent).toBe(true);
    expect(out.status).toBe(204);
    expect(receivedBody?.content).toBe('Build wf-99 status: green');
    expect(receivedBody?.username).toBe('openagentic-ci');
  });
});
