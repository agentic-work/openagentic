/**
 * log-anomaly-chart — time-series of log event counts with anomaly bands.
 * ECharts line + areaStyle.
 *
 * Phase 6 mocks-parity work. Audit slug: `log_anomaly_chart`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const PointSchema = z.object({
  ts: z.string(),
  count: z.number().nonnegative(),
  lower_band: z.number().nonnegative().optional(),
  upper_band: z.number().nonnegative().optional(),
  is_anomaly: z.boolean().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  source: z.string().optional(),
  points: z.array(PointSchema).min(2),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'payment-gateway error log counts',
  source: 'cloudwatch:/aws/payment-gateway/prod',
  subtitle: '5-min buckets · anomaly band = mean ± 3σ',
  points: [
    { ts: '14:00', count: 12,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:05', count: 14,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:10', count: 16,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:15', count: 18,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:20', count: 24,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:25', count: 320, lower_band: 5,  upper_band: 35, is_anomaly: true },
    { ts: '14:30', count: 480, lower_band: 5,  upper_band: 35, is_anomaly: true },
    { ts: '14:35', count: 510, lower_band: 5,  upper_band: 35, is_anomaly: true },
    { ts: '14:40', count: 340, lower_band: 5,  upper_band: 35, is_anomaly: true },
    { ts: '14:45', count: 88,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:50', count: 22,  lower_band: 5,  upper_band: 35, is_anomaly: false },
    { ts: '14:55', count: 18,  lower_band: 5,  upper_band: 35, is_anomaly: false },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const css = `
#la-chart { width: 100%; height: 360px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.source ? `<span>${escHtml(params.source)}</span>` : ''}
</div>
<div id="la-chart"></div>
${params.subtitle ? `<div style="font-size:11px;color:var(--cm-fg-muted);margin-top:6px;">${escHtml(params.subtitle)}</div>` : ''}`;

  const script = `
const data = JSON.parse(document.getElementById('la-data').textContent);
const cats   = data.points.map(function (p) { return p.ts; });
const counts = data.points.map(function (p) { return p.count; });
const lower  = data.points.map(function (p) { return p.lower_band == null ? null : p.lower_band; });
const upper  = data.points.map(function (p) { return p.upper_band == null ? null : p.upper_band; });
const bandWidth = data.points.map(function (p) {
  if (p.lower_band == null || p.upper_band == null) return null;
  return Math.max(0, p.upper_band - p.lower_band);
});
const anomalies = data.points
  .map(function (p, i) { return p.is_anomaly ? [cats[i], p.count] : null; })
  .filter(function (x) { return x !== null; });

const chart = echarts.init(document.getElementById('la-chart'), null, { renderer: 'svg' });
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  tooltip: { trigger: 'axis' },
  legend: { textStyle: { color: CM.fgDim }, top: 4, data: ['count', 'anomaly'] },
  grid: { left: 56, right: 24, top: 32, bottom: 40 },
  xAxis: { type: 'category', data: cats, axisLabel: { color: CM.fg }, axisLine: { lineStyle: { color: CM.border } } },
  yAxis: { type: 'value', axisLabel: { color: CM.fg }, axisLine: { lineStyle: { color: CM.border } }, splitLine: { lineStyle: { color: CM.borderSoft } } },
  series: [
    { name: 'lower band', type: 'line', data: lower, lineStyle: { opacity: 0 }, stack: 'band', symbol: 'none', showSymbol: false, tooltip: { show: false } },
    { name: 'band', type: 'line', data: bandWidth, lineStyle: { opacity: 0 }, areaStyle: { color: CM.infoSoft }, stack: 'band', symbol: 'none', showSymbol: false, tooltip: { show: false } },
    { name: 'count', type: 'line', data: counts, smooth: true, symbolSize: 5, lineStyle: { color: CM.accent2, width: 2 }, itemStyle: { color: CM.accent2 } },
    { name: 'anomaly', type: 'scatter', data: anomalies, symbol: 'circle', symbolSize: 12, itemStyle: { color: CM.error, borderColor: CM.fg, borderWidth: 1 } },
  ],
});
window.addEventListener('resize', function () { chart.resize(); });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'la-data': params },
    inlineScripts: [script],
  });
}

export const LOG_ANOMALY_CHART_TEMPLATE: ComposeAppTemplate = {
  slug: 'log-anomaly-chart',
  title: 'Log anomaly chart (time-series + anomaly band)',
  description:
    'ECharts line + area chart of log event counts over time, with an upper/lower expected band and highlighted anomaly points. Supply { points[{ts, count, lower_band?, upper_band?, is_anomaly?}] }. Use for anomaly-detection narratives, log-spike investigations. Also accepts the alias slug "log_anomaly_chart".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
