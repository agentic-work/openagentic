/**
 * slack_message node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - POSTs `{ text, channel?, blocks? }` to the configured webhook URL.
 *   - Returns `{ status, sent, channel }` where `sent` is true iff the
 *     webhook returned 200.
 *   - Templated message strings are interpolated against the input.
 *
 * Slack webhook mocked via MSW (a canonical hooks.slack.com URL is used
 * as the fixture target).
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';

import { runFlow } from '../runFlow.js';
import { harnessServer } from '../mocks/msw-setup.js';

describe('slack_message node — webhook posting', () => {
  it('POSTs the resolved text + channel to the slack webhook and reports sent:true', async () => {
    let receivedBody: Record<string, unknown> | null = null;
    harnessServer.use(
      http.post(
        'https://hooks.slack.com/services/T000/B000/harness',
        async ({ request }) => {
          receivedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.text('ok');
        },
      ),
    );

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'slack',
            type: 'slack_message',
            data: {
              webhookUrl: 'https://hooks.slack.com/services/T000/B000/harness',
              channel: '#devops',
              message: 'Build status: {{input.status}}',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'slack' }],
      },
      input: { status: 'green' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.slack as { status: number; sent: boolean; channel: string };
    expect(out.sent).toBe(true);
    expect(out.status).toBe(200);
    expect(out.channel).toBe('#devops');
    expect(receivedBody).not.toBeNull();
    expect(receivedBody).toMatchObject({ text: 'Build status: green', channel: '#devops' });
  });
});
