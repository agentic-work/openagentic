/**
 * training-runs-dashboard — ML training run grid with summary KPIs.
 *
 * Phase 6 mocks-parity work. Audit slug: `training_runs_dashboard`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const RunSchema = z.object({
  run_id: z.string(),
  model: z.string(),
  dataset: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'queued', 'cancelled']),
  loss_final: z.number().optional(),
  eval_metric_name: z.string().optional(),
  eval_metric_value: z.number().optional(),
  duration_min: z.number().nonnegative().optional(),
  started_at: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  runs: z.array(RunSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Training runs — openagentic/router classifier',
  subtitle: 'last 7 days',
  runs: [
    { run_id: 'rcm-2026-05-13-a', model: 'router-cls-v3.1', dataset: 'tasks-2026-q2-v4', status: 'completed', loss_final: 0.184, eval_metric_name: 'f1', eval_metric_value: 0.912, duration_min: 184, started_at: '2026-05-13T09:00Z' },
    { run_id: 'rcm-2026-05-13-b', model: 'router-cls-v3.1', dataset: 'tasks-2026-q2-v4', status: 'failed',    loss_final: 0.46,  eval_metric_name: 'f1', eval_metric_value: 0.62,  duration_min: 12,  started_at: '2026-05-13T13:30Z' },
    { run_id: 'rcm-2026-05-12-a', model: 'router-cls-v3.0', dataset: 'tasks-2026-q2-v3', status: 'completed', loss_final: 0.211, eval_metric_name: 'f1', eval_metric_value: 0.890, duration_min: 168, started_at: '2026-05-12T08:00Z' },
    { run_id: 'rcm-2026-05-11-a', model: 'router-cls-v2.7', dataset: 'tasks-2026-q1-v6', status: 'completed', loss_final: 0.245, eval_metric_name: 'f1', eval_metric_value: 0.871, duration_min: 152, started_at: '2026-05-11T07:30Z' },
    { run_id: 'rcm-2026-05-13-c', model: 'router-cls-v3.2', dataset: 'tasks-2026-q2-v5', status: 'running',                   eval_metric_name: 'f1',                                duration_min: 42,  started_at: '2026-05-13T15:00Z' },
    { run_id: 'rcm-2026-05-14-a', model: 'router-cls-v3.2', dataset: 'tasks-2026-q2-v5', status: 'queued' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const totals = {
    running:   params.runs.filter((r) => r.status === 'running').length,
    completed: params.runs.filter((r) => r.status === 'completed').length,
    failed:    params.runs.filter((r) => r.status === 'failed').length,
    queued:    params.runs.filter((r) => r.status === 'queued').length,
  };

  const completed = params.runs.filter((r) => r.status === 'completed' && r.eval_metric_value != null);
  const bestEval = completed.length === 0 ? null : Math.max(...completed.map((r) => r.eval_metric_value!));

  const css = `
.tr-wrap { display: grid; gap: 12px; }
.tr-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.tr-kpi { padding: 10px 12px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.tr-kpi-label { font-size: 10px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.tr-kpi-value { font-size: 20px; font-weight: 600; font-family: var(--cm-mono); margin-top: 4px; color: var(--cm-fg); }
.tr-kpi-value.running   { color: var(--cm-accent); }
.tr-kpi-value.completed { color: var(--cm-success); }
.tr-kpi-value.failed    { color: var(--cm-error); }
.tr-kpi-value.queued    { color: var(--cm-fg-dim); }
.tr-host { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow-x: auto; }
table.tr { border-collapse: collapse; min-width: 100%; font-size: 12px; }
table.tr th { padding: 8px 12px; background: var(--cm-bg-3); color: var(--cm-fg-dim); font-weight: 600; text-align: left; border-bottom: 1px solid var(--cm-border); }
table.tr td { padding: 8px 12px; border-bottom: 1px solid var(--cm-border); color: var(--cm-fg); font-family: var(--cm-mono); }
table.tr tr.best td { background: linear-gradient(90deg, color-mix(in srgb, var(--cm-success) 10%, transparent), transparent 60%); }
.tr-status { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); }
.tr-status.running   { background: color-mix(in srgb, var(--cm-accent) 15%, transparent); color: var(--cm-accent); }
.tr-status.completed { background: color-mix(in srgb, var(--cm-success) 15%, transparent);  color: var(--cm-success); }
.tr-status.failed    { background: color-mix(in srgb, var(--cm-error) 15%, transparent);  color: var(--cm-error); }
.tr-status.queued    { background: var(--cm-bg-3); color: var(--cm-fg-dim); }
.tr-status.cancelled { background: var(--cm-bg-3); color: var(--cm-fg-muted); }
`;

  const rows = params.runs.map((r) => {
    const isBest = bestEval != null && r.eval_metric_value === bestEval && r.status === 'completed';
    return `
      <tr class="${isBest ? 'best' : ''}">
        <td>${escHtml(r.run_id)}</td>
        <td>${escHtml(r.model)}</td>
        <td>${escHtml(r.dataset)}</td>
        <td><span class="tr-status ${escHtml(r.status)}">${escHtml(r.status)}</span></td>
        <td style="text-align:right;">${r.loss_final != null ? r.loss_final.toFixed(3) : '—'}</td>
        <td style="text-align:right;">${r.eval_metric_value != null ? `${escHtml(r.eval_metric_name || 'eval')} ${r.eval_metric_value.toFixed(3)}` : '—'}</td>
        <td style="text-align:right;">${r.duration_min != null ? r.duration_min.toFixed(0) + ' min' : '—'}</td>
        <td>${r.started_at ? escHtml(r.started_at) : ''}</td>
      </tr>
    `;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="tr-wrap">
  <div class="tr-kpis">
    <div class="tr-kpi"><div class="tr-kpi-label">Total</div><div class="tr-kpi-value">${params.runs.length}</div></div>
    <div class="tr-kpi"><div class="tr-kpi-label">Running</div><div class="tr-kpi-value running">${totals.running}</div></div>
    <div class="tr-kpi"><div class="tr-kpi-label">Completed</div><div class="tr-kpi-value completed">${totals.completed}</div></div>
    <div class="tr-kpi"><div class="tr-kpi-label">Failed</div><div class="tr-kpi-value failed">${totals.failed}</div></div>
    <div class="tr-kpi"><div class="tr-kpi-label">Queued</div><div class="tr-kpi-value queued">${totals.queued}</div></div>
  </div>
  <div class="tr-host">
    <table class="tr">
      <thead><tr>
        <th>run_id</th><th>model</th><th>dataset</th><th>status</th><th style="text-align:right;">loss</th><th style="text-align:right;">eval</th><th style="text-align:right;">duration</th><th>started</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'tr-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const TRAINING_RUNS_DASHBOARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'training-runs-dashboard',
  title: 'Training runs dashboard (ML)',
  description:
    'ML training run grid with summary KPIs (total/running/completed/failed/queued). Supply { runs[{run_id, model, dataset, status, loss_final?, eval_metric_name?, eval_metric_value?, duration_min?, started_at?}] }. Best-eval row highlighted. Use for ML training overviews. Also accepts the alias slug "training_runs_dashboard".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
