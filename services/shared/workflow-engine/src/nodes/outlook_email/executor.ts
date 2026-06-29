/**
 * outlook_email node executor.
 *
 * Sends an email via Microsoft 365 / Outlook SMTP (smtp.office365.com:587).
 * Credentials are read from env: OUTLOOK_USER / OUTLOOK_PASSWORD, falling
 * back to SMTP_USER / SMTP_PASS for compatibility with the legacy node.
 *
 * Migrated (specialized) from WorkflowExecutionEngine.executeEmailNode.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { to, cc, subject, body, isHtml } = node.data as Record<string, any>;

  const resolvedTo = ctx.interpolateTemplate(to || '', input);
  const resolvedSubject = ctx.interpolateTemplate(subject || '', input);
  const resolvedBody = ctx.interpolateTemplate(body || '', input);

  if (!resolvedTo) throw new Error('Outlook email node requires a "to" address');
  if (!resolvedSubject) throw new Error('Outlook email node requires a subject');

  if (ctx.signal.aborted) {
    throw new Error('Aborted before send');
  }

  ctx.logger.info(
    { nodeId: node.id, to: resolvedTo },
    '[outlook_email] Executing',
  );

  // Use the shared _mailer helper so the harness can mock this module
  // directly (vi.mock can't reliably intercept `await import('nodemailer')`
  // across all Node versions — see send_email.test.ts + outlook_email.test.ts
  // pre-2026-05-14 failures).
  const user = process.env.OUTLOOK_USER || process.env.SMTP_USER;
  const pass = process.env.OUTLOOK_PASSWORD || process.env.SMTP_PASS;
  const { createTransport } = await import('../_mailer.js');
  const transport = await createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  const info = await transport.sendMail({
    from: user || 'noreply@openagentic.io',
    to: resolvedTo,
    cc: cc ? ctx.interpolateTemplate(cc, input) : undefined,
    subject: resolvedSubject,
    [isHtml === false ? 'text' : 'html']: resolvedBody,
  });

  return { sent: true, messageId: info.messageId, to: resolvedTo };
}
