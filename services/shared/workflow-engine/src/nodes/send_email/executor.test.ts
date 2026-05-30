/**
 * send_email node — executor tests.
 *
 * Generic SMTP with per-node overrides for host/port/user/passwordRef.
 *
 * Covers:
 *   1. happy path — uses node SMTP overrides
 *   2. missing 'to' → throws
 *   3. missing 'subject' → throws
 *   4. missing SMTP config (no node + no env) → throws
 *   5. body templated against input
 *   6. SMTP_HOST env fallback
 *   7. isHtml=false → text
 *   8. abort signal honored
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeExecutionContext } from '../types.js';

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
    executionId: 'exec-email-1',
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

const emailNode = (data: Record<string, unknown>) => ({
  id: 'n_email',
  type: 'send_email',
  data,
});

beforeEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe('send_email/executor', () => {
  it('happy path — uses node SMTP overrides', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm1' });

    const out: any = await execute(
      emailNode({
        to: 'a@b.com',
        subject: 'hi',
        body: 'body',
        smtpHost: 'mail.example.com',
        smtpPort: 25,
        smtpUser: 'me',
        smtpPasswordRef: 'pw',
      }),
      null,
      makeCtx(),
    );
    expect(out.sent).toBe(true);
    expect(out.messageId).toBe('m1');

    const cfg = createTransportMock.mock.calls[0][0] as any;
    expect(cfg.host).toBe('mail.example.com');
    expect(cfg.port).toBe(25);
    expect(cfg.auth.user).toBe('me');
    expect(cfg.auth.pass).toBe('pw');
  });

  it('throws when "to" missing', async () => {
    process.env.SMTP_HOST = 'h';
    await expect(
      execute(emailNode({ subject: 's' }), null, makeCtx()),
    ).rejects.toThrow(/to/i);
  });

  it('throws when subject missing', async () => {
    process.env.SMTP_HOST = 'h';
    await expect(
      execute(emailNode({ to: 'a@b.com' }), null, makeCtx()),
    ).rejects.toThrow(/subject/i);
  });

  it('throws when no SMTP config available (no node overrides + no env)', async () => {
    await expect(
      execute(
        emailNode({ to: 'a@b.com', subject: 'hi', body: 'b' }),
        null,
        makeCtx(),
      ),
    ).rejects.toThrow(/smtp/i);
  });

  it('templates to/subject/body against input', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });

    await execute(
      emailNode({
        to: '{{r}}',
        subject: 'subj {{n}}',
        body: 'body {{n}}',
        smtpHost: 'h',
      }),
      { r: 'x@y.com', n: 7 },
      makeCtx(),
    );

    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toBe('x@y.com');
    expect(args.subject).toBe('subj 7');
    expect(args.html).toBe('body 7');
  });

  it('falls back to SMTP_HOST env when node has no smtpHost', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });
    process.env.SMTP_HOST = 'env-mail';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'env-user';
    process.env.SMTP_PASS = 'env-pw';

    await execute(
      emailNode({ to: 'a@b.com', subject: 'hi', body: 'b' }),
      null,
      makeCtx(),
    );

    const cfg = createTransportMock.mock.calls[0][0] as any;
    expect(cfg.host).toBe('env-mail');
    expect(cfg.port).toBe(465);
    // 465 is "secure" SMTPS
    expect(cfg.secure).toBe(true);
  });

  it('isHtml=false → text body', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'm' });

    await execute(
      emailNode({
        to: 'a@b.com',
        subject: 's',
        body: 'plaintext',
        isHtml: false,
        smtpHost: 'h',
      }),
      null,
      makeCtx(),
    );

    const args = sendMailMock.mock.calls[0][0];
    expect(args.text).toBe('plaintext');
    expect(args.html).toBeUndefined();
  });

  it('aborts when signal already aborted before send', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(
      execute(
        emailNode({ to: 'a@b.com', subject: 's', body: 'b', smtpHost: 'h' }),
        null,
        makeCtx({ signal: ctrl.signal }),
      ),
    ).rejects.toThrow(/abort/i);
  });
});
