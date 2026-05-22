/**
 * incident-card — single-incident summary card.
 *
 * Phase 6 mocks-parity work. Audit slug: `incident_card`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const AlertSchema = z.object({
  id: z.string(),
  name: z.string(),
  fired_at: z.string().optional(),
});

const ParamsSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  opened_at: z.string().min(1),
  owner: z.string().min(1),
  status: z.enum(['open', 'investigating', 'mitigated', 'resolved']),
  impact: z.string().min(1),
  related_alerts: z.array(AlertSchema).default([]),
  summary: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  id: 'INC-4827',
  title: 'payment-gateway 5xx storm (eu-west-1)',
  severity: 'high',
  opened_at: '2026-05-13T14:22:01Z',
  owner: 'trent@openagentic.io',
  status: 'investigating',
  impact: '~12% of EU checkout requests failing; estimated $4.2k/hr revenue at risk',
  summary: 'Downstream stripe-proxy connection pool exhausted; pool max raise scheduled for 15:00 UTC.',
  related_alerts: [
    { id: 'A-9301', name: 'p99-latency-payment-gateway', fired_at: '14:22:01Z' },
    { id: 'A-9302', name: 'error-rate-stripe-proxy', fired_at: '14:24:30Z' },
    { id: 'A-9305', name: 'connection-pool-exhausted', fired_at: '14:48:11Z' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const css = `
.ic-card { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
.ic-head { padding: 14px 16px; border-bottom: 1px solid var(--cm-border); display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; }
.ic-id { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); }
.ic-title { color: var(--cm-fg); font-size: 16px; font-weight: 600; }
.ic-sev { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); text-transform: uppercase; letter-spacing: 0.04em; }
.ic-sev.critical { background: color-mix(in srgb, var(--cm-error) 18%, transparent); color: var(--cm-error); }
.ic-sev.high     { background: color-mix(in srgb, var(--cm-warn) 18%, transparent); color: var(--cm-warn); }
.ic-sev.medium   { background: color-mix(in srgb, var(--cm-info) 18%, transparent); color: var(--cm-info); }
.ic-sev.low      { background: color-mix(in srgb, var(--cm-success) 18%, transparent); color: var(--cm-success); }
.ic-body { padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ic-field-label { font-size: 11px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.ic-field-value { font-size: 13px; color: var(--cm-fg); font-family: var(--cm-mono); margin-top: 2px; word-break: break-word; }
.ic-impact { grid-column: 1 / -1; padding: 12px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); color: var(--cm-fg); font-size: 13px; }
.ic-summary { grid-column: 1 / -1; color: var(--cm-fg-dim); font-size: 13px; }
.ic-alerts { grid-column: 1 / -1; }
.ic-alerts-list { margin-top: 6px; display: grid; gap: 4px; }
.ic-alert { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; padding: 8px 10px; background: var(--cm-bg-3); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); font-family: var(--cm-mono); font-size: 12px; }
.ic-alert-id { color: var(--cm-accent); }
.ic-alert-name { color: var(--cm-fg); }
.ic-alert-ts { color: var(--cm-fg-muted); }
.ic-status { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); background: var(--cm-bg-3); color: var(--cm-fg-dim); border: 1px solid var(--cm-border); }
.ic-status.open          { color: var(--cm-error); border-color: color-mix(in srgb, var(--cm-error) 40%, transparent); }
.ic-status.investigating { color: var(--cm-warn);  border-color: color-mix(in srgb, var(--cm-warn) 40%, transparent); }
.ic-status.mitigated     { color: var(--cm-info);  border-color: color-mix(in srgb, var(--cm-info) 40%, transparent); }
.ic-status.resolved      { color: var(--cm-success); border-color: color-mix(in srgb, var(--cm-success) 40%, transparent); }
`;

  const alertRows = params.related_alerts.map((a) => `
    <div class="ic-alert">
      <span class="ic-alert-id">${escHtml(a.id)}</span>
      <span class="ic-alert-name">${escHtml(a.name)}</span>
      <span class="ic-alert-ts">${a.fired_at ? escHtml(a.fired_at) : ''}</span>
    </div>
  `).join('');

  const body = `
<div class="viz-head"><span class="viz-title">${escHtml(params.title)}</span><span class="cm-tag info">incident-card</span></div>
<div class="ic-card">
  <div class="ic-head">
    <span class="ic-id">${escHtml(params.id)}</span>
    <span class="ic-title">${escHtml(params.title)}</span>
    <span class="ic-sev ${escHtml(params.severity)}">${escHtml(params.severity)}</span>
  </div>
  <div class="ic-body">
    <div><div class="ic-field-label">Opened</div><div class="ic-field-value">${escHtml(params.opened_at)}</div></div>
    <div><div class="ic-field-label">Owner</div><div class="ic-field-value">${escHtml(params.owner)}</div></div>
    <div><div class="ic-field-label">Status</div><div class="ic-field-value"><span class="ic-status ${escHtml(params.status)}">${escHtml(params.status)}</span></div></div>
    <div><div class="ic-field-label">Severity</div><div class="ic-field-value">${escHtml(params.severity)}</div></div>
    <div class="ic-impact"><strong style="color:var(--cm-fg-dim);">Impact:</strong> ${escHtml(params.impact)}</div>
    ${params.summary ? `<div class="ic-summary">${escHtml(params.summary)}</div>` : ''}
    ${params.related_alerts.length > 0 ? `
      <div class="ic-alerts">
        <div class="ic-field-label">Related alerts</div>
        <div class="ic-alerts-list">${alertRows}</div>
      </div>` : ''}
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'ic-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const INCIDENT_CARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'incident-card',
  title: 'Incident summary card',
  description:
    'Single-incident summary card { id, title, severity, opened_at, owner, status, impact, related_alerts[] }. Use when surfacing one incident with its quick facts + impact statement + related alert list. Also accepts the alias slug "incident_card".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
