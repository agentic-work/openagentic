/**
 * Shared mailer helper for send_email + outlook_email.
 *
 * Centralizes the nodemailer dynamic import. Tests can override the
 * transport via `globalThis.__openagenticMailerStub` — a global hook
 * that is undefined in production. This is faster + more reliable than
 * trying to vi.mock('nodemailer') across the dynamic-import boundary
 * the executors used to take (which broke on some Node versions and
 * caused the pre-2026-05-14 harness failures for outlook_email +
 * send_email).
 *
 * Harness usage:
 *
 *   (globalThis as any).__openagenticMailerStub = {
 *     sendMail: async (mail) => { ... },
 *   };
 *
 * Production path: createTransport() imports nodemailer dynamically
 * and returns the real Transporter unchanged.
 */

export interface MailerTransportOptions {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user?: string; pass?: string };
}

export interface MailerTransport {
  sendMail(mail: Record<string, unknown>): Promise<{ messageId: string }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __openagenticMailerStub: MailerTransport | undefined;
}

export async function createTransport(opts: MailerTransportOptions): Promise<MailerTransport> {
  // Harness-stub hook: tests set globalThis.__openagenticMailerStub before
  // invoking runFlow() and assert on its captured calls afterward.
  if (typeof globalThis !== 'undefined' && (globalThis as any).__openagenticMailerStub) {
    return (globalThis as any).__openagenticMailerStub as MailerTransport;
  }
  const nodemailerMod: any = await import('nodemailer');
  const nodemailer = nodemailerMod.default || nodemailerMod;
  return nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure ?? opts.port === 465,
    auth: opts.auth ?? undefined,
  }) as MailerTransport;
}
