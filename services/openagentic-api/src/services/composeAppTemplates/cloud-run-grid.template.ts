/**
 * cloud-run-grid — grid of GCP Cloud Run service cards with status,
 * sparklines, latency, error rate.
 *
 * the design notes
 *       (mock 04: gcp-cloudrun-interrogation)
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

/**
 * GCP Cloud Run native status values → canonical display status mapping.
 *
 * GCP Cloud Run API returns: SERVING, SERVING_TRAFFIC, NOT_SERVING, CONDITION_SUCCEEDED,
 * CONDITION_FAILED, UNKNOWN + lowercase variants + 'ready'/'serving'/'failed'/'unknown'.
 * Our display uses: healthy | degraded | down.
 *
 * Coercion rules (tolerant input, strict display):
 *   SERVING / SERVING_TRAFFIC / ready / serving / healthy → 'healthy'
 *   NOT_SERVING / CONDITION_FAILED / failed → 'down'
 *   everything else (UNKNOWN / empty / any unrecognized value) → 'degraded'
 */
function coerceStatus(raw: unknown): 'healthy' | 'degraded' | 'down' {
  if (typeof raw !== 'string') return 'degraded';
  const s = raw.trim().toLowerCase();
  if (['healthy', 'serving', 'serving_traffic', 'condition_succeeded', 'ready', 'ok', 'active', 'running'].includes(s)) return 'healthy';
  if (['down', 'not_serving', 'failed', 'condition_failed', 'stopped', 'error', 'terminated'].includes(s)) return 'down';
  if (['degraded', 'slow', 'warning', 'impaired'].includes(s)) return 'degraded';
  // Canonical values pass through as-is
  if (s === 'healthy') return 'healthy';
  if (s === 'degraded') return 'degraded';
  if (s === 'down') return 'down';
  return 'degraded'; // unknown → degraded (visible indicator without falsely flagging green)
}

const ServiceSchema = z
  .object({
    /** Optional: auto-generated as `${name}:${region}` when absent. GCP Cloud Run
     *  API doesn't return a separate 'id' — model may omit it. */
    id: z.string().optional(),
    name: z.string(),
    /** Optional: defaults to 'global' when absent. Some Cloud Run APIs (and
     *  smaller models) drop region from the per-service blob even though the
     *  region info is implicit in the parent list call. */
    region: z.string().default('global'),
    /** Accepts GCP native status strings ('ready', 'serving', 'SERVING', 'NOT_SERVING',
     *  'failed', etc.) and coerces to the canonical display enum. Optional with
     *  default 'healthy' — models that omit status are presumed-healthy. */
    status: z
      .union([z.enum(['healthy', 'degraded', 'down']), z.string().transform(coerceStatus)])
      .default('healthy'),
    revision: z.string().optional(),
    /** rps coerces numeric strings (model sometimes emits "120" not 120). */
    rps: z.union([z.number().nonnegative(), z.string().transform(Number)]).optional(),
    rpsSpark: z.array(z.union([z.number().nonnegative(), z.string().transform(Number)])).default([]),
    latencyP99Ms: z.union([z.number().nonnegative(), z.string().transform(Number)]).optional(),
    errorRatePct: z.union([z.number().nonnegative(), z.string().transform(Number)]).optional(),
    lastDeployAt: z.string().optional(),
  })
  .passthrough(); // Tolerate extra fields (lastUpdate, replicas, cpu, memory, uri, ingress, etc.)

const ParamsSchema = z
  .object({
    /** title is required inside params. When absent (model passed it at the outer
     *  compose_app level only), default to 'Cloud Run Services'. */
    title: z.string().min(1).default('Cloud Run Services'),
    services: z.array(ServiceSchema).min(1),
  })
  .passthrough();

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Cloud Run services — all regions',
  services: [
    { id: 's1', name: 'api-gateway', region: 'us-central1', status: 'healthy', revision: 'rev-04822', rps: 1240, rpsSpark: [800, 920, 1100, 950, 1020, 1240], latencyP99Ms: 142, errorRatePct: 0.04, lastDeployAt: '2026-05-01T18:14:00Z' },
    { id: 's2', name: 'api-gateway', region: 'eu-west', status: 'degraded', revision: 'rev-04812', rps: 320, rpsSpark: [400, 380, 350, 320, 290, 320], latencyP99Ms: 612, errorRatePct: 1.42, lastDeployAt: '2026-04-30T22:11:00Z' },
    { id: 's3', name: 'worker', region: 'asia-east', status: 'degraded', revision: 'rev-12044', rps: 92, rpsSpark: [120, 110, 105, 98, 90, 92], latencyP99Ms: 240, errorRatePct: 0.86 },
    { id: 's4', name: 'legacy-billing', region: 'us-central1', status: 'down', revision: 'rev-00112', rps: 0, rpsSpark: [42, 38, 12, 0, 0, 0], latencyP99Ms: 0, errorRatePct: 100 },
    { id: 's5', name: 'reports', region: 'us-east1', status: 'healthy', revision: 'rev-31004', rps: 88, rpsSpark: [60, 70, 80, 75, 90, 88], latencyP99Ms: 96, errorRatePct: 0.01 },
    { id: 's6', name: 'ingest', region: 'us-east1', status: 'healthy', revision: 'rev-21099', rps: 612, rpsSpark: [400, 480, 540, 580, 620, 612], latencyP99Ms: 88, errorRatePct: 0 },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.crg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.crg-card { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 14px; display: grid; gap: 6px; }
.crg-head { display: flex; justify-content: space-between; align-items: center; }
.crg-name { font-family: var(--cm-mono); color: var(--cm-fg); font-size: 13px; }
.crg-region { color: var(--cm-fg-dim); font-size: 11px; font-family: var(--cm-mono); }
.crg-rev { color: var(--cm-fg-muted); font-size: 11px; font-family: var(--cm-mono); }
.crg-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; font-size: 12px; }
.crg-row .crg-label { color: var(--cm-fg-dim); }
.crg-row .crg-val { color: var(--cm-fg); font-family: var(--cm-mono); }
.crg-spark { width: 100%; height: 36px; }
.crg-summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.crg-kpi { padding: 10px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.crg-kpi-label { font-size: 11px; color: var(--cm-fg-dim); }
.crg-kpi-value { font-size: 22px; font-family: var(--cm-mono); margin-top: 4px; }
`;

  const counts = {
    healthy: params.services.filter((s) => s.status === 'healthy').length,
    degraded: params.services.filter((s) => s.status === 'degraded').length,
    down: params.services.filter((s) => s.status === 'down').length,
    total: params.services.length,
  };

  const cards = params.services.map((s) => {
    // Auto-generate id when absent (GCP Cloud Run API doesn't surface a service ID separately)
    const effectiveId = s.id ?? `${s.name}:${s.region}`;
    const tag = s.status === 'healthy' ? 'ok' : s.status === 'degraded' ? 'warn' : 'error';
    return `
      <article class="crg-card" data-id="${esc(effectiveId)}">
        <div class="crg-head">
          <span class="crg-name">${esc(s.name)}</span>
          <span class="cm-tag ${tag}">${esc(s.status)}</span>
        </div>
        <div class="crg-region">${esc(s.region)}${s.revision ? ` · ${esc(s.revision)}` : ''}</div>
        <svg class="crg-spark" data-spark='${JSON.stringify(s.rpsSpark || []).replaceAll(/'/g, '&apos;')}'></svg>
        <div class="crg-row"><span class="crg-label">rps</span><span class="crg-val">${s.rps ?? '—'}</span></div>
        <div class="crg-row"><span class="crg-label">p99</span><span class="crg-val">${s.latencyP99Ms != null ? s.latencyP99Ms + 'ms' : '—'}</span></div>
        <div class="crg-row"><span class="crg-label">err</span><span class="crg-val">${s.errorRatePct != null ? s.errorRatePct.toFixed(2) + '%' : '—'}</span></div>
        ${s.lastDeployAt ? `<div class="crg-rev">deployed ${esc(s.lastDeployAt)}</div>` : ''}
      </article>
    `;
  }).join('');

  const body = `
<div class="viz-head"><span class="viz-title">${esc(params.title)}</span><span class="cm-tag info">cloud-run-grid</span></div>
<div class="crg-summary">
  <div class="crg-kpi"><div class="crg-kpi-label">Total</div><div class="crg-kpi-value">${counts.total}</div></div>
  <div class="crg-kpi"><div class="crg-kpi-label">Healthy</div><div class="crg-kpi-value" style="color:var(--cm-success);">${counts.healthy}</div></div>
  <div class="crg-kpi"><div class="crg-kpi-label">Degraded</div><div class="crg-kpi-value" style="color:var(--cm-warn);">${counts.degraded}</div></div>
  <div class="crg-kpi"><div class="crg-kpi-label">Down</div><div class="crg-kpi-value" style="color:var(--cm-error);">${counts.down}</div></div>
</div>
<div class="crg-grid">${cards}</div>`;

  const script = `
document.querySelectorAll('.crg-spark').forEach(function (svgEl) {
  let raw;
  try { raw = JSON.parse((svgEl.getAttribute('data-spark') || '[]').replace(/&apos;/g, "'")); } catch (e) { raw = []; }
  if (!raw.length) return;
  const w = svgEl.clientWidth || 220;
  const h = 36;
  svgEl.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  const max = Math.max.apply(null, raw);
  const min = Math.min.apply(null, raw);
  const range = max - min || 1;
  const step = w / Math.max(raw.length - 1, 1);
  const path = raw.map(function (v, i) {
    const x = i * step;
    const y = h - 4 - ((v - min) / range) * (h - 8);
    return (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2);
  }).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', CM.accent2);
  p.setAttribute('stroke-width', '1.5');
  p.setAttribute('stroke-linejoin', 'round');
  svgEl.appendChild(p);
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'crg-data': params },
    inlineScripts: [script],
  });
}

function esc(s: string): string {
  return String(s ?? '').replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;').replaceAll(/'/g, '&#39;');
}

void CDN_LIB;

export const CLOUD_RUN_GRID_TEMPLATE: ComposeAppTemplate = {
  slug: 'cloud-run-grid',
  title: 'Cloud Run service grid',
  description:
    'Grid of GCP Cloud Run service cards (healthy/degraded/down). Each card shows region, current revision, request-rate sparkline, p99 latency, error rate, last-deploy time. Use when the user asks to see Cloud Run services across regions or check service health. Supply services[{id,name,region,status,revision?,rps?,rpsSpark[],latencyP99Ms?,errorRatePct?,lastDeployAt?}].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
