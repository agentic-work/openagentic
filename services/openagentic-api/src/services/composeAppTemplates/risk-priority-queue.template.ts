/**
 * risk-priority-queue — ranked list of risks by priority score.
 *
 * Phase 6 mocks-parity work. Audit slug: `risk_priority_queue`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const RiskSchema = z.object({
  id: z.string(),
  title: z.string(),
  impact: z.number().min(0).max(10),
  probability: z.number().min(0).max(10),
  priority_score: z.number().min(0).max(100).optional(),
  owner: z.string().optional(),
  eta: z.string().optional(),
  status: z.enum(['new', 'accepted', 'mitigated', 'closed']).default('new'),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  risks: z.array(RiskSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Risk register — Q3 priority queue',
  subtitle: 'sorted by priority_score desc (impact × probability)',
  risks: [
    { id: 'R-001', title: 'FedRAMP-Hi crypto gap (SC-13)',           impact: 9, probability: 8, owner: 'sec-eng',  eta: '2026-06-15', status: 'accepted' },
    { id: 'R-002', title: 'Single-AZ payment-gateway',                impact: 8, probability: 6, owner: 'platform', eta: '2026-07-01', status: 'new' },
    { id: 'R-003', title: 'Stripe connect cutover (data migration)',  impact: 9, probability: 5, owner: 'billing',  eta: '2026-08-01', status: 'accepted' },
    { id: 'R-004', title: 'Pen-test scope expansion to MCP plane',    impact: 6, probability: 7, owner: 'sec-eng',  eta: '2026-06-30', status: 'new' },
    { id: 'R-005', title: 'GPU node-pool reservation expiry',         impact: 5, probability: 8, owner: 'platform', eta: '2026-06-10', status: 'mitigated' },
    { id: 'R-006', title: 'Vendor SLA breach — Bedrock EU',           impact: 7, probability: 3, owner: 'platform', eta: '2026-07-15', status: 'new' },
    { id: 'R-007', title: 'Operator burnout (3-person on-call)',      impact: 4, probability: 9, owner: 'eng-mgr',  eta: '2026-06-20', status: 'accepted' },
    { id: 'R-008', title: 'Deprecated UI dep (react-router 6 EOL)',   impact: 3, probability: 7, owner: 'frontend', eta: '2026-09-01', status: 'new' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const scored = params.risks.map((r) => ({
    ...r,
    _score: r.priority_score != null ? r.priority_score : Math.round(r.impact * r.probability),
  }));
  scored.sort((a, b) => b._score - a._score);

  const css = `
.rq-wrap { display: grid; gap: 8px; }
.rq-row { display: grid; grid-template-columns: 56px 1fr 60px 60px 60px 110px 110px 90px; gap: 10px; padding: 10px 12px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); align-items: center; }
.rq-row.top { border-color: color-mix(in srgb, var(--cm-error) 40%, transparent); background: linear-gradient(90deg, color-mix(in srgb, var(--cm-error) 10%, transparent), transparent 40%); }
.rq-rank { font-family: var(--cm-mono); font-size: 18px; color: var(--cm-accent); text-align: center; font-weight: 700; }
.rq-rank.top { color: var(--cm-error); }
.rq-title { color: var(--cm-fg); font-size: 13px; }
.rq-id { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); display: block; margin-top: 2px; }
.rq-num { font-family: var(--cm-mono); font-size: 13px; text-align: center; color: var(--cm-fg); }
.rq-score { font-family: var(--cm-mono); font-size: 14px; font-weight: 600; text-align: center; padding: 4px 6px; border-radius: 6px; }
.rq-score.high { background: color-mix(in srgb, var(--cm-error) 18%, transparent); color: var(--cm-error); }
.rq-score.med  { background: color-mix(in srgb, var(--cm-warn) 18%, transparent); color: var(--cm-warn); }
.rq-score.low  { background: color-mix(in srgb, var(--cm-success) 18%, transparent); color: var(--cm-success); }
.rq-owner { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.rq-eta { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.rq-status { padding: 3px 10px; border-radius: 999px; font-family: var(--cm-mono); font-size: 11px; text-align: center; }
.rq-status.new       { background: var(--cm-bg-3); color: var(--cm-fg-dim); }
.rq-status.accepted  { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn); }
.rq-status.mitigated { background: color-mix(in srgb, var(--cm-info) 15%, transparent); color: var(--cm-info); }
.rq-status.closed    { background: color-mix(in srgb, var(--cm-success) 15%, transparent); color: var(--cm-success); }
.rq-head { display: grid; grid-template-columns: 56px 1fr 60px 60px 60px 110px 110px 90px; gap: 10px; padding: 6px 12px; font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
`;

  const rows = scored.map((r, i) => {
    const sCls = r._score >= 60 ? 'high' : r._score >= 30 ? 'med' : 'low';
    return `
      <div class="rq-row ${i === 0 ? 'top' : ''}">
        <div class="rq-rank ${i === 0 ? 'top' : ''}">#${i + 1}</div>
        <div>
          <div class="rq-title">${escHtml(r.title)}</div>
          <span class="rq-id">${escHtml(r.id)}</span>
        </div>
        <div class="rq-num">${r.impact}</div>
        <div class="rq-num">${r.probability}</div>
        <div class="rq-score ${sCls}">${r._score}</div>
        <div class="rq-owner">${r.owner ? escHtml(r.owner) : ''}</div>
        <div class="rq-eta">${r.eta ? escHtml(r.eta) : ''}</div>
        <div><span class="rq-status ${escHtml(r.status)}">${escHtml(r.status)}</span></div>
      </div>
    `;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="rq-head">
  <span>rank</span><span>risk</span><span>impact</span><span>prob</span><span>score</span><span>owner</span><span>eta</span><span>status</span>
</div>
<div class="rq-wrap">${rows}</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'rq-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const RISK_PRIORITY_QUEUE_TEMPLATE: ComposeAppTemplate = {
  slug: 'risk-priority-queue',
  title: 'Risk priority queue (ranked register)',
  description:
    'Ranked list of risks scored by impact × probability (or supplied priority_score). Supply { risks[{id, title, impact (0-10), probability (0-10), priority_score?, owner?, eta?, status?}] }. Top row highlighted. Use for risk register reviews, prioritization meetings. Also accepts the alias slug "risk_priority_queue".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
