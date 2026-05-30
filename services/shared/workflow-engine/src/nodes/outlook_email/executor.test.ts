/**
 * outlook_email node — executor tests.
 *
 * Covers:
 *   1. happy path — sends via Office365 SMTP and returns sent: true
 *   2. missing 'to' → throws
 *   3. missing 'subject' → throws
 *   4. body templated against input
 *   5. abort signal honored (mailer call sees ctx.signal in closure)
 *   6. uses Office365 SMTP host (smtp.office365.com:587)
 *   7. respects isHtml=false → text body
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeExecutionContext } from '../types.js';

// Hoisted mock for nodemailer — captures createTransport calls + sendMail args.
const sendMailMock = vi.fn<(arg: any) => any>();
const createTransportMock = vi.fn<(arg: any) => any>(() => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

import { execute } from './executor.js';

function makeCtx(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    executionId: 'exec-outlook-1',
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

const outlookNode = (data: Record<string, unknown>) => ({
  id: 'n_outlook',
  type: 'outlook_email',
  data,
});

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.OUTLOOK_USER;
  delete process.env.OUTLOOK_PASSWORD;
});

describe('outlook_email/executor', () => {
  it('happy path — sends mail and returns { sent: true, messageId }', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'msg-1' });
    process.env.OUTLOOK_USER = 'sender@example.com';
    process.env.OUTLOOK_PASSWORD = 'pw';

    const out: any = await execute(
      outlookNode({ to: 'a@b.com', subject: 'hi', body: 'body' }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
    expect(out.messageId).toBe('msg-1');
    expect(out.to).toBe('a@b.com');
  });

  it('throws when "to" is missing', async () => {
    await expect(
      execute(outlookNode({ subject: 's' }), null, makeCtx()),
    ).rejects.toThrow(/to/i);
  });

  it('throws when subject is missing', async () => {
    await expect(
      execute(outlookNode({ to: 'a@b.com' }), null, makeCtx()),
    ).rejects.toThrow(/subject/i);
  });

  it('templates body, subject, to against input', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });
    process.env.OUTLOOK_USER = 's@e.com';
    process.env.OUTLOOK_PASSWORD = 'pw';

    await execute(
      outlookNode({
        to: '{{recipient}}',
        subject: 'Build {{id}}',
        body: 'status: {{status}}',
      }),
      { recipient: 'x@y.com', id: 42, status: 'green' },
      makeCtx(),
    );

    const callArgs = sendMailMock.mock.calls[0][0];
    expect(callArgs.to).toBe('x@y.com');
    expect(callArgs.subject).toBe('Build 42');
    expect(callArgs.html).toBe('status: green');
  });

  it('uses Office365 SMTP host by default', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });
    process.env.OUTLOOK_USER = 's@e.com';
    process.env.OUTLOOK_PASSWORD = 'pw';

    await execute(
      outlookNode({ to: 'a@b.com', subject: 'hi', body: 'b' }),
      null,
      makeCtx(),
    );

    const transportConfig = createTransportMock.mock.calls[0][0] as any;
    expect(transportConfig.host).toBe('smtp.office365.com');
    expect(transportConfig.port).toBe(587);
  });

  it('isHtml=false — sends as text', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });
    process.env.OUTLOOK_USER = 's@e.com';
    process.env.OUTLOOK_PASSWORD = 'pw';

    await execute(
      outlookNode({ to: 'a@b.com', subject: 'hi', body: 'plaintext', isHtml: false }),
      null,
      makeCtx(),
    );

    const callArgs = sendMailMock.mock.calls[0][0];
    expect(callArgs.text).toBe('plaintext');
    expect(callArgs.html).toBeUndefined();
  });

  it('aborts when signal aborts before send (rejects)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    process.env.OUTLOOK_USER = 's@e.com';
    process.env.OUTLOOK_PASSWORD = 'pw';

    await expect(
      execute(
        outlookNode({ to: 'a@b.com', subject: 'hi', body: 'b' }),
        null,
        makeCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow(/abort/i);
  });
});
