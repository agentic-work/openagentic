/**
 * send_email node — Phase D template-critical primitive contract.
 *
 * Public contract under test:
 *   - Returns `{ sent: true, messageId, to }` on a successful send.
 *   - The "to" + "subject" + "body" fields are templated against the input.
 *
 * SMTP is mocked via nodemailer's built-in JSON transport (no real SMTP
 * server required, no MSW interception needed). We override the transport
 * by mocking the nodemailer module's `createTransport` to return a stub
 * that records the mail it was asked to send.
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
      return { messageId: 'harness-msg-1' };
    },
  };
});
afterAll(() => {
  delete (globalThis as any).__openagenticMailerStub;
});

describe('send_email node — SMTP send', () => {
  it('renders subject/body/to from templates and reports sent:true', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mail',
            type: 'send_email',
            data: {
              to: '{{input.recipient}}',
              subject: 'Run {{input.runId}} completed',
              body: '<p>Status: {{input.status}}</p>',
              isHtml: true,
              smtpHost: 'smtp.harness.test',
              smtpPort: '587',
              smtpUser: 'noreply@openagentic.io',
              smtpPasswordRef: 'test-pass',
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mail' }],
      },
      input: { recipient: 'trent@openagentic.io', runId: 'wf-42', status: 'success' },
    });

    expect(result.status).toBe('completed');
    const out = result.outputs.mail as { sent: boolean; messageId: string; to: string };
    expect(out.sent).toBe(true);
    expect(out.messageId).toBe('harness-msg-1');
    expect(out.to).toBe('trent@openagentic.io');

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({
      to: 'trent@openagentic.io',
      subject: 'Run wf-42 completed',
    });
    expect(sentMails[0].html).toContain('Status: success');
  });

  it('fails-CLOSED when SMTP credentials are not supplied on the node', async () => {
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mail',
            type: 'send_email',
            data: {
              to: 'trent@openagentic.io',
              subject: 'no creds',
              body: 'should never send',
              // smtpHost / smtpUser / smtpPasswordRef intentionally missing
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mail' }],
      },
      input: {},
    });
    expect(result.status).toBe('failed');
    // Schema marks smtpHost/smtpUser/smtpPasswordRef required → the compiler
    // fails-CLOSED before the executor even runs. Either fail mode is fine
    // (compile-time is preferred; runtime is the defensive backstop).
    expect(result.error?.message ?? '').toMatch(
      /(MISSING_SMTPHOST|MISSING_SMTPUSER|MISSING_SMTPPASSWORDREF|requires explicit SMTP credentials)/i,
    );
  });

  it('resolves {{secret:NAME}} on smtpHost/smtpUser/smtpPasswordRef (workflow-secret path)', async () => {
    // Mirror the credential-integration test pattern — prisma row + service
    // mock so {{secret:...}} resolves to a fake value.
    const { prisma } = await import('../../../src/utils/prisma.js');
    const { vi } = await import('vitest');
    vi.mocked((prisma as any).workflowSecret.findFirst).mockImplementation(
      async (args: { where?: { name?: string } }) => {
        const known = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
        if (!known.includes(args?.where?.name as string)) return null;
        return {
          id: `sec-${args!.where!.name}`,
          name: args!.where!.name,
          scope: 'global',
          workflow_id: null,
          encrypted_value: null,
          allowed_node_types: [],
          allowed_users: [],
          allowed_groups: [],
          version: 1,
          access_count: 0,
        };
      },
    );
    vi.doMock('../../../src/services/WorkflowSecretService.js', async () => {
      const actual = await vi.importActual<any>(
        '../../../src/services/WorkflowSecretService.js',
      );
      return {
        ...actual,
        workflowSecretService: {
          ...actual.workflowSecretService,
          resolveSecretValue: async (name: string) => {
            if (name === 'SMTP_HOST') return 'smtp.fromsecret.test';
            if (name === 'SMTP_USER') return 'fromsecret@openagentic.io';
            if (name === 'SMTP_PASS') return 'secret-pass';
            return null;
          },
        },
      };
    });

    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trigger', type: 'trigger', data: { triggerType: 'manual' } },
          {
            id: 'mail',
            type: 'send_email',
            data: {
              to: 'trent@openagentic.io',
              subject: 'Secret-resolved SMTP',
              body: 'Body via secret-resolved SMTP',
              smtpHost: '{{secret:SMTP_HOST}}',
              smtpUser: '{{secret:SMTP_USER}}',
              smtpPasswordRef: '{{secret:SMTP_PASS}}',
              isHtml: false,
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'mail' }],
      },
      input: {},
    });
    expect(result.status).toBe('completed');
    const found = sentMails.find((m) => m.subject === 'Secret-resolved SMTP');
    expect(found).toBeDefined();
    expect(found!.from).toBe('fromsecret@openagentic.io');
  });
});
