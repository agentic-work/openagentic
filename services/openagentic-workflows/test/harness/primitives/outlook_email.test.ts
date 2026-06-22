/**
 * outlook_email node — Phase E1 primitive contract.
 *
 * Public contract: sends via nodemailer with smtp.office365.com:587, auth from
 * OUTLOOK_USER / OUTLOOK_PASSWORD (or SMTP_USER / SMTP_PASS fallback). Returns
 * `{ sent: true, messageId, to }`.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { runFlow } from '../runFlow.js';

const sentMails: Array<Record<string, unknown>> = [];

// Install the harness mailer stub via the _mailer.ts globalThis hook.
// _mailer.createTransport() short-circuits to this stub when present —
// reliable across Node versions, no vi.mock dynamic-import contortions.
beforeAll(() => {
  (globalThis as any).__openagenticMailerStub = {
    sendMail: async (mail: Record<string, unknown>) => {
      sentMails.push(mail);
      return { messageId: 'harness-outlook-1' };
    },
  };
});
afterAll(() => {
  delete (globalThis as any).__openagenticMailerStub;
});

describe('outlook_email node — O365 SMTP send', () => {
  it('renders templated to/subject/body and reports sent:true with messageId', async () => {
    process.env.OUTLOOK_USER = 'bot@openagentic.io';
    process.env.OUTLOOK_PASSWORD = 'pw';

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mail',
            type: 'outlook_email',
            data: {
              to: '{{input.recipient}}',
              subject: 'Standup digest {{input.date}}',
              body: '<p>Top item: {{input.topItem}}</p>',
              isHtml: true,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mail' }],
      },
      input: {
        recipient: 'alice@example.com',
        date: '2026-05-13',
        topItem: 'cluster upgrade',
      },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.mail as { sent: boolean; messageId: string; to: string };
    expect(out.sent).toBe(true);
    expect(out.messageId).toBe('harness-outlook-1');
    expect(out.to).toBe('alice@example.com');

    expect(sentMails.length).toBeGreaterThan(0);
    const sent = sentMails[sentMails.length - 1];
    expect(sent).toMatchObject({
      to: 'alice@example.com',
      subject: 'Standup digest 2026-05-13',
    });
    expect(String(sent.html)).toContain('cluster upgrade');
  });
});
