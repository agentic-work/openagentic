/**
 * send_email node executor.
 *
 * SMTP via nodemailer. Credentials MUST come from the node config —
 * either literal values or `{{secret:NAME}}` workflow-secret references.
 * Deployment-scoped env-var fallbacks (SMTP_HOST/PORT/USER/PASS) were
 * removed 2026-05-15 per platform directive: every flow that sends mail
 * carries its own credentials so credential rotation, multi-tenant
 * isolation, and audit trails work cleanly. There is no implicit
 * "default SMTP" — a node without explicit creds fails-CLOSED with a
 * clear error message.
 *
 * Recommended pattern (matches slack_message webhook):
 *   smtpHost: "{{secret:SMTP_HOST}}"
 *   smtpPort: "{{secret:SMTP_PORT}}"   // or a literal like 587
 *   smtpUser: "{{secret:SMTP_USER}}"
 *   smtpPasswordRef: "{{secret:SMTP_PASS}}"
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const {
    to,
    cc,
    subject,
    body,
    isHtml,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPasswordRef,
  } = node.data as Record<string, any>;

  const resolvedTo = ctx.interpolateTemplate(to || '', input);
  const resolvedSubject = ctx.interpolateTemplate(subject || '', input);
  const resolvedBody = ctx.interpolateTemplate(body || '', input);

  if (!resolvedTo) throw new Error('Email node requires a "to" address');
  if (!resolvedSubject) throw new Error('Email node requires a subject');

  if (ctx.signal.aborted) {
    throw new Error('Aborted before send');
  }

  // Interpolate SMTP fields so `{{secret:SMTP_HOST}}` etc. resolve to
  // workflow-secret values at runtime — matches the slack_message
  // `webhookUrl: "{{secret:SLACK_DEVOPS_WEBHOOK}}"` pattern. Credentials
  // are REQUIRED on the node — no env fallback.
  const host = smtpHost ? ctx.interpolateTemplate(String(smtpHost), input) : '';
  const portRaw = smtpPort ? ctx.interpolateTemplate(String(smtpPort), input) : '';
  const user = smtpUser ? ctx.interpolateTemplate(String(smtpUser), input) : '';
  const pass = smtpPasswordRef
    ? ctx.interpolateTemplate(String(smtpPasswordRef), input)
    : '';

  const missing: string[] = [];
  if (!host) missing.push('smtpHost');
  if (!user) missing.push('smtpUser');
  if (!pass) missing.push('smtpPasswordRef');
  if (missing.length > 0) {
    throw new Error(
      `send_email requires explicit SMTP credentials on the node — missing: ${missing.join(', ')}. ` +
        'Supply literal values OR reference workflow secrets via {{secret:NAME}} (e.g. {{secret:SMTP_HOST}}). ' +
        'Create the secrets at POST /api/admin/workflow-secrets. Deployment-scoped SMTP_* env vars are not honored.',
    );
  }

  const port = parseInt(portRaw || '587', 10);

  ctx.logger.info(
    { nodeId: node.id, to: resolvedTo, host, port, user },
    '[send_email] Executing',
  );

  const { createTransport } = await import('../_mailer.js');
  const transport = await createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const info = await transport.sendMail({
    from: user,
    to: resolvedTo,
    cc: cc ? ctx.interpolateTemplate(cc, input) : undefined,
    subject: resolvedSubject,
    [isHtml === false ? 'text' : 'html']: resolvedBody,
  });

  return { sent: true, messageId: info.messageId, to: resolvedTo };
}
