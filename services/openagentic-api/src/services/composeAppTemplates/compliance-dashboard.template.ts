/**
 * compliance-dashboard — controls grid grouped by family with MET / PARTIAL /
 * GAP counts and an overall readiness %.
 *
 * Phase 6 mocks-parity work. Audit slug: `compliance_dashboard`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ControlSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['met', 'partial', 'gap']),
  evidence: z.string().optional(),
});

const FamilySchema = z.object({
  family: z.string(),
  controls: z.array(ControlSchema).min(1),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  framework: z.string().min(1),
  families: z.array(FamilySchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'FedRAMP-High readiness',
  framework: 'FedRAMP-High Rev 5',
  subtitle: 'omhs-prod tenant · scan 2026-05-13',
  families: [
    {
      family: 'AC — Access Control',
      controls: [
        { id: 'AC-2', name: 'Account Management', status: 'met', evidence: 'SSO + lifecycle automation' },
        { id: 'AC-3', name: 'Access Enforcement', status: 'met' },
        { id: 'AC-6', name: 'Least Privilege', status: 'partial', evidence: 'tenant RBAC ok; admin emergency-break needs review' },
        { id: 'AC-17', name: 'Remote Access', status: 'met' },
      ],
    },
    {
      family: 'AU — Audit & Accountability',
      controls: [
        { id: 'AU-2', name: 'Event Logging', status: 'met' },
        { id: 'AU-3', name: 'Content of Audit Records', status: 'met' },
        { id: 'AU-12', name: 'Audit Generation', status: 'partial' },
      ],
    },
    {
      family: 'SC — System & Communications',
      controls: [
        { id: 'SC-7', name: 'Boundary Protection', status: 'met' },
        { id: 'SC-8', name: 'Transmission Confidentiality', status: 'met' },
        { id: 'SC-13', name: 'Cryptographic Protection', status: 'gap', evidence: 'FIPS validated module not yet enforced' },
      ],
    },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  let totalMet = 0, totalPartial = 0, totalGap = 0;
  for (const f of params.families) {
    for (const c of f.controls) {
      if (c.status === 'met') totalMet++;
      else if (c.status === 'partial') totalPartial++;
      else totalGap++;
    }
  }
  const total = totalMet + totalPartial + totalGap;
  const readiness = total === 0 ? 0 : Math.round(((totalMet + totalPartial * 0.5) / total) * 100);

  const css = `
.cd-wrap { display: grid; gap: 12px; }
.cd-readiness { display: grid; grid-template-columns: auto 1fr; gap: 16px; padding: 14px 16px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); align-items: center; }
.cd-score { font-size: 36px; font-weight: 700; font-family: var(--cm-mono); }
.cd-score.good { color: var(--cm-success); }
.cd-score.ok   { color: var(--cm-warn); }
.cd-score.bad  { color: var(--cm-error); }
.cd-bar { width: 100%; height: 10px; background: var(--cm-bg-3); border-radius: 5px; overflow: hidden; margin-top: 6px; }
.cd-bar-fill { height: 100%; background: linear-gradient(90deg, var(--cm-success), var(--cm-warn), var(--cm-error)); }
.cd-totals { display: flex; gap: 12px; margin-top: 6px; font-size: 12px; color: var(--cm-fg-dim); font-family: var(--cm-mono); }
.cd-totals .met     { color: var(--cm-success); }
.cd-totals .partial { color: var(--cm-warn); }
.cd-totals .gap     { color: var(--cm-error); }
.cd-fam { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
.cd-fam-head { padding: 10px 14px; background: var(--cm-bg-3); display: grid; grid-template-columns: 1fr auto; align-items: center; }
.cd-fam-name { color: var(--cm-fg); font-weight: 600; font-size: 13px; }
.cd-fam-counts { display: flex; gap: 8px; font-family: var(--cm-mono); font-size: 11px; }
.cd-fam-counts span { padding: 2px 8px; border-radius: 999px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); }
.cd-ctrl { display: grid; grid-template-columns: 80px 1fr auto; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--cm-border); align-items: center; }
.cd-ctrl-id { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.cd-ctrl-name { color: var(--cm-fg); font-size: 13px; }
.cd-ctrl-evidence { font-size: 11px; color: var(--cm-fg-muted); margin-top: 2px; }
.cd-pill { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); text-transform: uppercase; }
.cd-pill.met     { background: color-mix(in srgb, var(--cm-success) 15%, transparent); color: var(--cm-success); }
.cd-pill.partial { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn); }
.cd-pill.gap     { background: color-mix(in srgb, var(--cm-error) 15%, transparent); color: var(--cm-error); }
`;

  const scoreCls = readiness >= 85 ? 'good' : readiness >= 70 ? 'ok' : 'bad';

  const families = params.families.map((f) => {
    const met = f.controls.filter((c) => c.status === 'met').length;
    const partial = f.controls.filter((c) => c.status === 'partial').length;
    const gap = f.controls.filter((c) => c.status === 'gap').length;
    const ctrls = f.controls.map((c) => `
      <div class="cd-ctrl">
        <span class="cd-ctrl-id">${escHtml(c.id)}</span>
        <div>
          <div class="cd-ctrl-name">${escHtml(c.name)}</div>
          ${c.evidence ? `<div class="cd-ctrl-evidence">${escHtml(c.evidence)}</div>` : ''}
        </div>
        <span class="cd-pill ${escHtml(c.status)}">${escHtml(c.status)}</span>
      </div>
    `).join('');
    return `
      <section class="cd-fam">
        <div class="cd-fam-head">
          <span class="cd-fam-name">${escHtml(f.family)}</span>
          <div class="cd-fam-counts">
            <span style="color:var(--cm-success);">met ${met}</span>
            <span style="color:var(--cm-warn);">partial ${partial}</span>
            <span style="color:var(--cm-error);">gap ${gap}</span>
          </div>
        </div>
        ${ctrls}
      </section>
    `;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  <span>${escHtml(params.framework)}</span>
</div>
<div class="cd-wrap">
  <div class="cd-readiness">
    <div class="cd-score ${scoreCls}">${readiness}%</div>
    <div>
      <div style="color:var(--cm-fg);font-weight:600;">Overall readiness</div>
      <div class="cd-bar"><div class="cd-bar-fill" style="width:${readiness}%"></div></div>
      <div class="cd-totals">
        <span class="met">met ${totalMet}</span>
        <span class="partial">partial ${totalPartial}</span>
        <span class="gap">gap ${totalGap}</span>
        <span>of ${total} controls</span>
      </div>
      ${params.subtitle ? `<div style="font-size:11px;color:var(--cm-fg-muted);margin-top:4px;">${escHtml(params.subtitle)}</div>` : ''}
    </div>
  </div>
  ${families}
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'cd-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const COMPLIANCE_DASHBOARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'compliance-dashboard',
  title: 'Compliance controls dashboard (by family)',
  description:
    'Compliance dashboard — controls grouped by family with MET / PARTIAL / GAP counts + overall readiness percentage. Supply { framework, families[{family, controls[{id,name,status,evidence?}]}] }. Use for FedRAMP / SOC-2 / ISO / HIPAA readiness views. Also accepts the alias slug "compliance_dashboard".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
