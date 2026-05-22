/**
 * incident-timeline — vertical timeline of timestamped incident events.
 *
 * Phase 6 mocks-parity work. Audit slug: `incident_timeline` (hyphen
 * alias in registry).
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const EventSchema = z.object({
  ts: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('info'),
  source: z.string().optional(),
  message: z.string().min(1),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  events: z.array(EventSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Incident #4827 — payment-gateway 5xx storm',
  subtitle: 'eu-west-1 · 2026-05-13 14:22 → 15:08 UTC',
  events: [
    { ts: '14:22:01', severity: 'critical', source: 'cloudwatch-alarms', message: 'payment-gateway p99 latency > 3500ms (threshold 800ms)' },
    { ts: '14:22:14', severity: 'high', source: 'pagerduty', message: 'Sev-1 incident opened, on-call paged' },
    { ts: '14:24:30', severity: 'medium', source: 'datadog-trace', message: 'downstream stripe-proxy returning 503 (47% error rate)' },
    { ts: '14:31:02', severity: 'info', source: 'oncall-trent', message: 'Acknowledged — investigating stripe-proxy connection pool' },
    { ts: '14:48:11', severity: 'high', source: 'datadog-trace', message: 'identified: pool exhaustion (waiting=212, max=64)' },
    { ts: '15:01:00', severity: 'info', source: 'oncall-trent', message: 'Patch deployed: pool max 64→256' },
    { ts: '15:08:00', severity: 'low', source: 'cloudwatch-alarms', message: 'all p99 back under SLO; alarm cleared' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const css = `
.it-wrap { position: relative; padding-left: 24px; }
.it-wrap::before { content: ''; position: absolute; left: 8px; top: 4px; bottom: 4px; width: 2px; background: var(--cm-border); }
.it-event { position: relative; padding: 10px 12px 10px 18px; margin-bottom: 10px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.it-event::before { content: ''; position: absolute; left: -20px; top: 14px; width: 12px; height: 12px; border-radius: 50%; background: var(--cm-bg-3); border: 2px solid var(--cm-fg-muted); }
.it-event.critical::before { background: var(--cm-error); border-color: var(--cm-error); box-shadow: 0 0 0 4px color-mix(in srgb, var(--cm-error) 20%, transparent); }
.it-event.high::before     { background: var(--cm-warn); border-color: var(--cm-warn); }
.it-event.medium::before   { background: var(--cm-info); border-color: var(--cm-info); }
.it-event.low::before      { background: var(--cm-success); border-color: var(--cm-success); }
.it-event.info::before     { background: var(--cm-fg-dim); border-color: var(--cm-fg-dim); }
.it-row { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: start; }
.it-ts { font-family: var(--cm-mono); font-size: 12px; color: var(--cm-fg-dim); white-space: nowrap; }
.it-msg { color: var(--cm-fg); font-size: 13px; }
.it-source { font-family: var(--cm-mono); font-size: 11px; color: var(--cm-fg-muted); }
`;

  const items = params.events.map((e) => `
    <div class="it-event ${escHtml(e.severity)}">
      <div class="it-row">
        <span class="it-ts">${escHtml(e.ts)}</span>
        <span class="it-msg">${escHtml(e.message)}</span>
        ${e.source ? `<span class="it-source">${escHtml(e.source)}</span>` : '<span></span>'}
      </div>
    </div>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="it-wrap">${items}</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'it-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const INCIDENT_TIMELINE_TEMPLATE: ComposeAppTemplate = {
  slug: 'incident-timeline',
  title: 'Incident timeline (vertical, severity-colored)',
  description:
    'Vertical timeline of timestamped incident events { ts, severity, source?, message }. Severity-colored marker dots (critical/high/medium/low/info). Use for post-mortem timelines, alert sequences, action logs. Also accepts the alias slug "incident_timeline".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
