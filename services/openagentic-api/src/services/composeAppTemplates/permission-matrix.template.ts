/**
 * permission-matrix — principals × actions grid with allow/deny/conditional
 * cells.
 *
 * Phase 6 mocks-parity work. Audit slug: `permission_matrix`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const CellSchema = z.object({
  principal: z.string(),
  action: z.string(),
  effect: z.enum(['allow', 'deny', 'conditional']),
  condition: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  principals: z.array(z.string()).min(1),
  actions: z.array(z.string()).min(1),
  cells: z.array(CellSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'IAM permissions — chat-pipeline service accounts',
  subtitle: 'production · 2026-05-13',
  principals: [
    'sa:chat-api',
    'sa:workflows-engine',
    'sa:admin-portal',
    'user:on-call',
  ],
  actions: [
    's3:GetObject',
    's3:PutObject',
    'secretsmanager:GetSecretValue',
    'kms:Decrypt',
    'bedrock:InvokeModel',
    'iam:PassRole',
  ],
  cells: [
    { principal: 'sa:chat-api',        action: 's3:GetObject',                effect: 'allow' },
    { principal: 'sa:chat-api',        action: 's3:PutObject',                effect: 'conditional', condition: 'aws:RequestTag/tenant=${aws:PrincipalTag/tenant}' },
    { principal: 'sa:chat-api',        action: 'secretsmanager:GetSecretValue', effect: 'allow' },
    { principal: 'sa:chat-api',        action: 'kms:Decrypt',                 effect: 'allow' },
    { principal: 'sa:chat-api',        action: 'bedrock:InvokeModel',         effect: 'allow' },
    { principal: 'sa:chat-api',        action: 'iam:PassRole',                effect: 'deny' },
    { principal: 'sa:workflows-engine', action: 's3:GetObject',                effect: 'allow' },
    { principal: 'sa:workflows-engine', action: 's3:PutObject',                effect: 'allow' },
    { principal: 'sa:workflows-engine', action: 'secretsmanager:GetSecretValue', effect: 'conditional', condition: 'name matches workflows/*' },
    { principal: 'sa:workflows-engine', action: 'kms:Decrypt',                 effect: 'allow' },
    { principal: 'sa:workflows-engine', action: 'bedrock:InvokeModel',         effect: 'deny' },
    { principal: 'sa:workflows-engine', action: 'iam:PassRole',                effect: 'deny' },
    { principal: 'sa:admin-portal',    action: 's3:GetObject',                effect: 'allow' },
    { principal: 'sa:admin-portal',    action: 's3:PutObject',                effect: 'deny' },
    { principal: 'sa:admin-portal',    action: 'secretsmanager:GetSecretValue', effect: 'deny' },
    { principal: 'sa:admin-portal',    action: 'kms:Decrypt',                 effect: 'deny' },
    { principal: 'sa:admin-portal',    action: 'bedrock:InvokeModel',         effect: 'deny' },
    { principal: 'sa:admin-portal',    action: 'iam:PassRole',                effect: 'deny' },
    { principal: 'user:on-call',       action: 's3:GetObject',                effect: 'allow' },
    { principal: 'user:on-call',       action: 's3:PutObject',                effect: 'conditional', condition: 'MFA required' },
    { principal: 'user:on-call',       action: 'secretsmanager:GetSecretValue', effect: 'conditional', condition: 'break-glass approval' },
    { principal: 'user:on-call',       action: 'kms:Decrypt',                 effect: 'conditional', condition: 'break-glass approval' },
    { principal: 'user:on-call',       action: 'bedrock:InvokeModel',         effect: 'allow' },
    { principal: 'user:on-call',       action: 'iam:PassRole',                effect: 'deny' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  // Build lookup map for O(1) cell rendering.
  const map = new Map<string, { effect: string; condition?: string }>();
  for (const c of params.cells) {
    map.set(c.principal + '' + c.action, { effect: c.effect, condition: c.condition });
  }

  const css = `
.pm-host { overflow-x: auto; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
table.pm { border-collapse: collapse; font-size: 12px; min-width: 100%; }
table.pm th, table.pm td { padding: 8px 10px; border-bottom: 1px solid var(--cm-border); border-right: 1px solid var(--cm-border); }
table.pm th { background: var(--cm-bg-3); color: var(--cm-fg-dim); font-weight: 600; text-align: left; font-family: var(--cm-mono); position: sticky; top: 0; }
table.pm th.pm-principal-col { position: sticky; left: 0; z-index: 2; background: var(--cm-bg-3); }
table.pm td.pm-principal { font-family: var(--cm-mono); color: var(--cm-fg); background: var(--cm-bg-2); position: sticky; left: 0; z-index: 1; }
.pm-cell { display: inline-flex; align-items: center; justify-content: center; min-width: 56px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); }
.pm-cell.allow       { background: color-mix(in srgb, var(--cm-success) 15%, transparent);  color: var(--cm-success); }
.pm-cell.deny        { background: color-mix(in srgb, var(--cm-error) 15%, transparent);  color: var(--cm-error); }
.pm-cell.conditional { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn); }
.pm-cell.missing     { color: var(--cm-fg-muted); }
.pm-cond-tip { display: block; font-size: 10px; color: var(--cm-fg-muted); margin-top: 2px; font-family: var(--cm-mono); }
.pm-legend { display: flex; gap: 12px; padding: 10px 14px; font-size: 11px; font-family: var(--cm-mono); color: var(--cm-fg-dim); border-top: 1px solid var(--cm-border); }
`;

  const headRow = ['<th class="pm-principal-col">principal \\ action</th>']
    .concat(params.actions.map((a) => `<th>${escHtml(a)}</th>`))
    .join('');

  const bodyRows = params.principals.map((p) => {
    const cells = params.actions.map((a) => {
      const c = map.get(p + '' + a);
      if (!c) return `<td><span class="pm-cell missing">—</span></td>`;
      return `<td>
        <span class="pm-cell ${escHtml(c.effect)}">${escHtml(c.effect)}</span>
        ${c.condition ? `<span class="pm-cond-tip">${escHtml(c.condition)}</span>` : ''}
      </td>`;
    }).join('');
    return `<tr><td class="pm-principal">${escHtml(p)}</td>${cells}</tr>`;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="pm-host">
  <table class="pm">
    <thead><tr>${headRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="pm-legend">
    <span><span class="pm-cell allow">allow</span></span>
    <span><span class="pm-cell deny">deny</span></span>
    <span><span class="pm-cell conditional">conditional</span></span>
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'pm-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const PERMISSION_MATRIX_TEMPLATE: ComposeAppTemplate = {
  slug: 'permission-matrix',
  title: 'Permission matrix (principals × actions)',
  description:
    'Permission matrix — principals (rows) × actions (columns) with allow/deny/conditional cells. Supply { principals[], actions[], cells[{principal, action, effect, condition?}] }. Sticky header + first-column for big matrices. Use for IAM permission visualizations, RBAC reviews, capability matrices. Also accepts the alias slug "permission_matrix".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
