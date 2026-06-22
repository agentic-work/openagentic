/**
 * savings-grid — sortable grid of cost-savings opportunities.
 *
 * Phase 6 mocks-parity work. Audit slug: `savings_grid`. Filename uses
 * hyphens to match registry convention (test regex `[a-z][a-z0-9-]*`);
 * an underscore alias is registered separately.
 *
 * Rows: { resource, current_cost, recommended_action, monthly_savings,
 *         risk: low|medium|high }. Default sort is monthly_savings desc;
 * top row highlighted as the biggest win.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

/** Coerce numeric strings to numbers — model occasionally emits "540.00" instead of 540. */
const numOrStr = z.union([z.number().nonnegative(), z.string().transform((v) => {
  const n = Number.parseFloat(v.replace(/[,$]/g, ''));
  return Number.isNaN(n) || n < 0 ? 0 : n;
})]);

const RowSchema = z.object({
  resource: z.string(),
  current_cost: numOrStr,
  recommended_action: z.string(),
  monthly_savings: numOrStr,
  risk: z.enum(['low', 'medium', 'high']).default('low'),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  currency: z.string().default('USD'),
  rows: z.array(RowSchema).min(1),
  highlight_top_n: z.number().int().positive().default(1),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'AWS cost — savings opportunities (monthly)',
  currency: 'USD',
  highlight_top_n: 2,
  rows: [
    { resource: 'i-0abc...east1-prod-api-3', current_cost: 540, recommended_action: 'right-size m5.4xlarge → m5.xlarge', monthly_savings: 320, risk: 'low' },
    { resource: 'vol-09cd...gp2-1tb', current_cost: 102, recommended_action: 'convert gp2 → gp3', monthly_savings: 41, risk: 'low' },
    { resource: 'nat-gw-prod-eu-west-1', current_cost: 168, recommended_action: 'consolidate 2 NAT gateways → 1', monthly_savings: 84, risk: 'medium' },
    { resource: 'rds-staging-pg14', current_cost: 240, recommended_action: 'stop nightly 8pm-6am', monthly_savings: 80, risk: 'low' },
    { resource: 'eks-prod-node-group-cpu', current_cost: 1240, recommended_action: 'enable cluster-autoscaler scale-to-zero', monthly_savings: 380, risk: 'high' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: params.currency, maximumFractionDigits: 0 }).format(n);

  const sorted = [...params.rows].sort((a, b) => b.monthly_savings - a.monthly_savings);
  const totalSavings = sorted.reduce((a, r) => a + r.monthly_savings, 0);
  const totalCurrent = sorted.reduce((a, r) => a + r.current_cost, 0);

  const css = `
.sg-wrap { display: grid; gap: 12px; }
.sg-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.sg-kpi { padding: 12px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.sg-kpi-label { font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.sg-kpi-value { font-size: 20px; font-weight: 600; color: var(--cm-fg); font-family: var(--cm-mono); margin-top: 4px; }
.sg-kpi-value.savings { color: var(--cm-success); }
.sg-table-wrap { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
table.sg { width: 100%; border-collapse: collapse; font-size: 13px; }
table.sg th { padding: 8px 12px; text-align: left; background: var(--cm-bg-3); color: var(--cm-fg-dim); font-weight: 600; cursor: pointer; user-select: none; border-bottom: 1px solid var(--cm-border); }
table.sg th[aria-sort="descending"]::after { content: " ▼"; color: var(--cm-accent); font-size: 10px; }
table.sg th[aria-sort="ascending"]::after  { content: " ▲"; color: var(--cm-accent); font-size: 10px; }
table.sg td { padding: 8px 12px; border-bottom: 1px solid var(--cm-border); color: var(--cm-fg); }
table.sg tr.highlight { background: linear-gradient(90deg, color-mix(in srgb, var(--cm-success) 10%, transparent), transparent 60%); }
table.sg td.num { font-family: var(--cm-mono); text-align: right; }
table.sg td.savings { color: var(--cm-success); font-family: var(--cm-mono); text-align: right; font-weight: 600; }
.sg-risk { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); }
.sg-risk.low    { background: color-mix(in srgb, var(--cm-success) 15%, transparent); color: var(--cm-success); }
.sg-risk.medium { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn); }
.sg-risk.high   { background: color-mix(in srgb, var(--cm-error) 15%, transparent); color: var(--cm-error); }
`;

  const rowsHtml = sorted.map((r, i) => `
    <tr class="${i < params.highlight_top_n ? 'highlight' : ''}" data-resource="${escHtml(r.resource)}">
      <td>${escHtml(r.resource)}</td>
      <td class="num">${fmt(r.current_cost)}</td>
      <td>${escHtml(r.recommended_action)}</td>
      <td class="savings">−${fmt(r.monthly_savings)}</td>
      <td><span class="sg-risk ${escHtml(r.risk)}">${escHtml(r.risk)}</span></td>
    </tr>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  <span class="cm-tag info">savings-grid</span>
</div>
<div class="sg-wrap">
  <div class="sg-kpis">
    <div class="sg-kpi"><div class="sg-kpi-label">Resources</div><div class="sg-kpi-value">${sorted.length}</div></div>
    <div class="sg-kpi"><div class="sg-kpi-label">Current monthly</div><div class="sg-kpi-value">${fmt(totalCurrent)}</div></div>
    <div class="sg-kpi"><div class="sg-kpi-label">Potential savings</div><div class="sg-kpi-value savings">−${fmt(totalSavings)}</div></div>
  </div>
  <div class="sg-table-wrap">
    <table class="sg" id="sg-table">
      <thead>
        <tr>
          <th data-key="resource">Resource</th>
          <th data-key="current_cost">Current</th>
          <th data-key="recommended_action">Recommended action</th>
          <th data-key="monthly_savings" aria-sort="descending">Monthly savings</th>
          <th data-key="risk">Risk</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('sg-data').textContent);
const table = document.getElementById('sg-table');
const tbody = table.querySelector('tbody');
const riskOrder = { low: 0, medium: 1, high: 2 };
let sortKey = 'monthly_savings';
let sortDir = 'desc';
function render(rows) {
  tbody.innerHTML = '';
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (sortKey === 'monthly_savings' && sortDir === 'desc' && i < data.highlight_top_n) tr.classList.add('highlight');
    tr.innerHTML = ''
      + '<td>' + escapeHtml(r.resource) + '</td>'
      + '<td class="num">' + fmtCurrency(r.current_cost) + '</td>'
      + '<td>' + escapeHtml(r.recommended_action) + '</td>'
      + '<td class="savings">−' + fmtCurrency(r.monthly_savings) + '</td>'
      + '<td><span class="sg-risk ' + escapeHtml(r.risk) + '">' + escapeHtml(r.risk) + '</span></td>';
    tbody.appendChild(tr);
  });
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function fmtCurrency(n) { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: data.currency, maximumFractionDigits: 0 }).format(n); } catch { return String(n); } }
function sortBy(key) {
  if (sortKey === key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  else { sortKey = key; sortDir = 'desc'; }
  const rows = data.rows.slice().sort((a, b) => {
    let av = a[key], bv = b[key];
    if (key === 'risk') { av = riskOrder[av] || 0; bv = riskOrder[bv] || 0; }
    if (typeof av === 'string') { av = av.toLowerCase(); bv = String(bv).toLowerCase(); return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv); }
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  table.querySelectorAll('th').forEach((th) => th.removeAttribute('aria-sort'));
  const active = table.querySelector('th[data-key="' + key + '"]');
  if (active) active.setAttribute('aria-sort', sortDir === 'desc' ? 'descending' : 'ascending');
  render(rows);
}
table.querySelectorAll('th[data-key]').forEach((th) => {
  th.addEventListener('click', () => sortBy(th.getAttribute('data-key')));
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'sg-data': params },
    inlineScripts: [script],
  });
}

void CDN_LIB;

export const SAVINGS_GRID_TEMPLATE: ComposeAppTemplate = {
  slug: 'savings-grid',
  title: 'Cost-savings opportunity grid (sortable)',
  description:
    'Sortable grid of cost-savings opportunities. Each row { resource, current_cost, recommended_action, monthly_savings, risk: low|medium|high }. Top-N rows highlighted as biggest wins. Default sort is monthly_savings desc. Also accepts the alias slug "savings_grid".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
