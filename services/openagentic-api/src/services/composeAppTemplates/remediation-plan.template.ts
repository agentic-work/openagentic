/**
 * remediation-plan — phased checklist with progress bar.
 *
 * Phase 6 mocks-parity work. Audit slug: `remediation_plan`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ActionSchema = z.object({
  action: z.string(),
  owner: z.string(),
  eta: z.string(),
  status: z.enum(['todo', 'in_progress', 'done', 'blocked']).default('todo'),
  notes: z.string().optional(),
});

const PhaseSchema = z.object({
  phase: z.string(),
  actions: z.array(ActionSchema).min(1),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  phases: z.array(PhaseSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Remediation plan — SC-13 FIPS gap',
  subtitle: 'target: green by 2026-06-15',
  phases: [
    {
      phase: 'Phase 1 — discovery',
      actions: [
        { action: 'Inventory all crypto modules in use', owner: 'sec-eng', eta: '2026-05-15', status: 'done' },
        { action: 'Identify non-FIPS-validated paths', owner: 'sec-eng', eta: '2026-05-17', status: 'done' },
      ],
    },
    {
      phase: 'Phase 2 — remediation',
      actions: [
        { action: 'Swap node-forge → @aws-crypto/sign-rsa-pkcs1', owner: 'platform', eta: '2026-05-22', status: 'in_progress' },
        { action: 'Enable kms-key FIPS endpoint enforcement', owner: 'platform', eta: '2026-05-24', status: 'todo' },
        { action: 'Update threat model + ATO package', owner: 'sec-eng', eta: '2026-05-28', status: 'blocked', notes: 'waiting on legal review' },
      ],
    },
    {
      phase: 'Phase 3 — verify',
      actions: [
        { action: 'Run NIST 800-53 scanner end-to-end', owner: 'sec-eng', eta: '2026-06-02', status: 'todo' },
        { action: 'Submit assessor package', owner: 'compliance', eta: '2026-06-15', status: 'todo' },
      ],
    },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const allActions = params.phases.flatMap((p) => p.actions);
  const done = allActions.filter((a) => a.status === 'done').length;
  const progressPct = allActions.length === 0 ? 0 : Math.round((done / allActions.length) * 100);

  const css = `
.rp-wrap { display: grid; gap: 12px; }
.rp-progress { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 14px 16px; }
.rp-progress-bar { height: 10px; background: var(--cm-bg-3); border-radius: 5px; overflow: hidden; margin: 8px 0 4px; }
.rp-progress-fill { height: 100%; background: linear-gradient(90deg, var(--cm-accent), var(--cm-success)); transition: width 0.4s ease; }
.rp-progress-meta { color: var(--cm-fg-dim); font-size: 12px; font-family: var(--cm-mono); }
.rp-phase { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
.rp-phase-head { padding: 10px 14px; background: var(--cm-bg-3); color: var(--cm-fg); font-weight: 600; font-size: 13px; }
.rp-action { display: grid; grid-template-columns: 24px 1fr 130px 100px auto; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--cm-border); align-items: center; }
.rp-check { width: 18px; height: 18px; border: 2px solid var(--cm-fg-muted); border-radius: 4px; display: inline-block; position: relative; }
.rp-check.done { background: var(--cm-success); border-color: var(--cm-success); }
.rp-check.done::after { content: '✓'; position: absolute; left: 2px; top: -3px; color: var(--cm-bg); font-size: 14px; font-weight: bold; }
.rp-check.in_progress { border-color: var(--cm-accent); background: color-mix(in srgb, var(--cm-accent) 15%, transparent); }
.rp-check.blocked     { border-color: var(--cm-error); background: color-mix(in srgb, var(--cm-error) 15%, transparent); }
.rp-action-text { color: var(--cm-fg); font-size: 13px; }
.rp-action-text.done { text-decoration: line-through; color: var(--cm-fg-muted); }
.rp-notes { font-size: 11px; color: var(--cm-fg-muted); margin-top: 2px; }
.rp-owner { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.rp-eta { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.rp-status { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); }
.rp-status.todo        { background: var(--cm-bg-3); color: var(--cm-fg-dim); }
.rp-status.in_progress { background: color-mix(in srgb, var(--cm-accent) 15%, transparent); color: var(--cm-accent); }
.rp-status.done        { background: color-mix(in srgb, var(--cm-success) 15%, transparent); color: var(--cm-success); }
.rp-status.blocked     { background: color-mix(in srgb, var(--cm-error) 15%, transparent); color: var(--cm-error); }
`;

  const phases = params.phases.map((p) => {
    const actions = p.actions.map((a) => `
      <div class="rp-action">
        <span class="rp-check ${escHtml(a.status)}"></span>
        <div>
          <div class="rp-action-text ${a.status === 'done' ? 'done' : ''}">${escHtml(a.action)}</div>
          ${a.notes ? `<div class="rp-notes">${escHtml(a.notes)}</div>` : ''}
        </div>
        <span class="rp-owner">${escHtml(a.owner)}</span>
        <span class="rp-eta">${escHtml(a.eta)}</span>
        <span class="rp-status ${escHtml(a.status)}">${escHtml(a.status.replace('_', ' '))}</span>
      </div>
    `).join('');
    return `
      <section class="rp-phase">
        <div class="rp-phase-head">${escHtml(p.phase)}</div>
        ${actions}
      </section>
    `;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="rp-wrap">
  <div class="rp-progress">
    <div style="color:var(--cm-fg-dim);font-size:12px;">Overall progress</div>
    <div class="rp-progress-bar"><div class="rp-progress-fill" style="width:${progressPct}%"></div></div>
    <div class="rp-progress-meta">${done} of ${allActions.length} actions complete · ${progressPct}%</div>
  </div>
  ${phases}
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'rp-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const REMEDIATION_PLAN_TEMPLATE: ComposeAppTemplate = {
  slug: 'remediation-plan',
  title: 'Remediation plan (phased checklist)',
  description:
    'Phased remediation checklist with progress bar. Supply { phases[{phase, actions[{action,owner,eta,status,notes?}]}] }. Status: todo / in_progress / done / blocked. Use for remediation workflows, security-gap closure plans, migration rollouts. Also accepts the alias slug "remediation_plan".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
