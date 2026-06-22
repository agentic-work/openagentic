/**
 * multi-tenant-audit-dashboard — tabbed dashboard with security score per
 * tenant, critical findings list, drill-downs.
 *
 * the design notes
 *       (mock 02: enterprise multi-tenant audit)
 *
 * Pure DOM + a tiny no-eval tab switch. No CDN libs needed — keeps the
 * payload small and the trust surface minimal.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const FindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string(),
  resource: z.string().optional(),
  remediation: z.string().optional(),
});

const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
  cloud: z.enum(['azure', 'aws', 'gcp', 'k8s', 'multi']),
  scoreOutOf100: z.number().min(0).max(100),
  findings: z.array(FindingSchema),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  tenants: z.array(TenantSchema).min(1),
  scannedAt: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'acme-corp — full security audit',
  scannedAt: '2026-05-03T12:00:00Z',
  tenants: [
    {
      id: 'acme-prod',
      name: 'acme-prod',
      cloud: 'azure',
      scoreOutOf100: 72,
      findings: [
        { id: 'f1', severity: 'critical', title: 'Storage account allows public blob access', resource: 'acmeprodlogs', remediation: 'Disable AllowBlobPublicAccess.' },
        { id: 'f2', severity: 'critical', title: 'NSG rule allows 0.0.0.0/0 → 22', resource: 'nsg-prod-default', remediation: 'Restrict source CIDR or remove rule.' },
        { id: 'f3', severity: 'high', title: 'Key Vault soft-delete disabled', resource: 'kv-acme-prod', remediation: 'Enable purge protection.' },
        { id: 'f4', severity: 'medium', title: 'Diagnostic logs not centralized', resource: 'subscription:default' },
      ],
    },
    {
      id: 'acme-staging',
      name: 'acme-staging',
      cloud: 'azure',
      scoreOutOf100: 84,
      findings: [
        { id: 's1', severity: 'high', title: 'TLS 1.0 still enabled on App Service', resource: 'app-acme-staging' },
        { id: 's2', severity: 'medium', title: 'No private endpoint for SQL', resource: 'sqldb-acme-staging' },
      ],
    },
    {
      id: 'acme-dev',
      name: 'acme-dev',
      cloud: 'azure',
      scoreOutOf100: 91,
      findings: [
        { id: 'd1', severity: 'low', title: 'No tag policy enforced', resource: 'subscription:dev' },
      ],
    },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.mta-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--cm-border); margin: 0 0 12px 0; }
.mta-tab { padding: 8px 14px; cursor: pointer; background: transparent; border: 1px solid transparent; border-bottom: none; border-radius: var(--cm-radius) var(--cm-radius) 0 0; color: var(--cm-fg-dim); font-family: var(--cm-mono); font-size: 12px; }
.mta-tab.active { background: var(--cm-bg-2); border-color: var(--cm-border); color: var(--cm-fg); }
.mta-panel { display: none; padding: 16px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: 0 var(--cm-radius) var(--cm-radius) var(--cm-radius); }
.mta-panel.active { display: block; }
.mta-summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.mta-kpi { padding: 12px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.mta-kpi-label { font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.mta-kpi-value { font-size: 24px; font-weight: 600; color: var(--cm-fg); font-family: var(--cm-mono); margin-top: 4px; }
.mta-score-good { color: var(--cm-success); }
.mta-score-warn { color: var(--cm-warn); }
.mta-score-bad  { color: var(--cm-error); }
.mta-finding { display: grid; grid-template-columns: 90px 1fr; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--cm-border); }
.mta-finding:last-child { border-bottom: none; }
.mta-finding-title { color: var(--cm-fg); font-size: 13px; }
.mta-finding-resource { color: var(--cm-fg-dim); font-size: 11px; font-family: var(--cm-mono); margin-top: 2px; }
.mta-finding-remediation { color: var(--cm-fg-muted); font-size: 12px; margin-top: 4px; }
.mta-export { float: right; padding: 6px 12px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); color: var(--cm-fg); border-radius: var(--cm-radius); cursor: pointer; font-size: 12px; }
`;

  const tabsHtml = params.tenants.map((t, i) => `
    <button class="mta-tab${i === 0 ? ' active' : ''}" data-tab="${esc(t.id)}">${esc(t.name)} <span class="cm-tag" style="margin-left:6px;">${esc(t.cloud)}</span></button>
  `).join('');

  const panelsHtml = params.tenants.map((t, i) => {
    const sevCount = (sev: 'critical' | 'high' | 'medium' | 'low') => t.findings.filter((f) => f.severity === sev).length;
    const scoreCls = t.scoreOutOf100 >= 85 ? 'mta-score-good' : t.scoreOutOf100 >= 70 ? 'mta-score-warn' : 'mta-score-bad';
    const findingsRows = t.findings.map((f) => `
      <div class="mta-finding">
        <div><span class="cm-tag ${f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warn' : ''}">${esc(f.severity)}</span></div>
        <div>
          <div class="mta-finding-title">${esc(f.title)}</div>
          ${f.resource ? `<div class="mta-finding-resource">${esc(f.resource)}</div>` : ''}
          ${f.remediation ? `<div class="mta-finding-remediation">${esc(f.remediation)}</div>` : ''}
        </div>
      </div>
    `).join('');
    return `
      <section class="mta-panel${i === 0 ? ' active' : ''}" data-panel="${esc(t.id)}">
        <button class="mta-export" data-tenant="${esc(t.id)}">Export PDF</button>
        <div class="mta-summary">
          <div class="mta-kpi"><div class="mta-kpi-label">Score</div><div class="mta-kpi-value ${scoreCls}">${t.scoreOutOf100}</div></div>
          <div class="mta-kpi"><div class="mta-kpi-label">Critical</div><div class="mta-kpi-value mta-score-bad">${sevCount('critical')}</div></div>
          <div class="mta-kpi"><div class="mta-kpi-label">High</div><div class="mta-kpi-value mta-score-warn">${sevCount('high')}</div></div>
          <div class="mta-kpi"><div class="mta-kpi-label">Medium</div><div class="mta-kpi-value">${sevCount('medium')}</div></div>
        </div>
        ${findingsRows}
      </section>
    `;
  }).join('');

  const body = `
<div class="viz-head"><span class="viz-title">${esc(params.title)}</span><span class="cm-tag info">multi-tenant-audit-dashboard</span></div>
<nav class="mta-tabs">${tabsHtml}</nav>
${panelsHtml}
${params.scannedAt ? `<div style="font-size:11px;color:var(--cm-fg-muted);margin-top:8px;">Scanned at ${esc(params.scannedAt)}</div>` : ''}
`;

  const script = `
document.querySelectorAll('.mta-tab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    const id = btn.getAttribute('data-tab');
    document.querySelectorAll('.mta-tab').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.mta-panel').forEach(function (p) { p.classList.remove('active'); });
    btn.classList.add('active');
    const panel = document.querySelector('.mta-panel[data-panel="' + id + '"]');
    if (panel) panel.classList.add('active');
  });
});
document.querySelectorAll('.mta-export').forEach(function (btn) {
  btn.addEventListener('click', function () {
    btn.textContent = 'Export queued';
    btn.disabled = true;
  });
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'mta-data': params },
    inlineScripts: [script],
  });
}

function esc(s: string): string {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// No CDN libs — pure DOM. Declare an empty list so the test catalog reflects
// the truth.
export const MULTI_TENANT_AUDIT_DASHBOARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'multi-tenant-audit-dashboard',
  title: 'Multi-tenant audit dashboard',
  description:
    'Tabbed audit dashboard — one tab per tenant — with security score, critical/high/medium counts, and a findings list with severity badges + remediation hints. Use when the user asks for a cross-tenant security audit. Supply tenants[{id,name,cloud,scoreOutOf100,findings[]}].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};

// Unused-import marker (CDN_LIB) — keeps the import shape uniform across
// templates; the registry test does not require cdnLibs to be non-empty.
void CDN_LIB;
