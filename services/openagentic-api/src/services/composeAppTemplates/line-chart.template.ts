/**
 * line-chart — generic time/series line chart. ECharts engine.
 *
 * Spec: #655 follow-up to #654.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const SeriesSchema = z.object({
  name: z.string(),
  data: z.array(z.number()),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  /** X-axis category labels (often time buckets — Mon, Tue, …; or Jan, Feb …). */
  categories: z.array(z.string()).min(1),
  /** One or more Y-series. */
  series: z.array(SeriesSchema).min(1),
  xAxisLabel: z.string().optional(),
  yAxisLabel: z.string().optional(),
  /** Smooth (curved) lines vs straight segments. Default true. */
  smooth: z.boolean().default(true),
  /** Filled area under each line. Default false. */
  area: z.boolean().default(false),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Daily request volume — last 7 days',
  subtitle: 'k requests / day across api + workflows',
  categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  series: [
    { name: 'api', data: [120, 132, 101, 134, 90, 230, 210] },
    { name: 'workflows', data: [88, 92, 86, 95, 70, 180, 165] },
  ],
  xAxisLabel: 'day',
  yAxisLabel: 'requests (k)',
  smooth: true,
  area: false,
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.lc-wrap { display: grid; gap: 12px; }
#lc-chart { width: 100%; height: 360px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="lc-wrap">
  <div id="lc-chart"></div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('lc-data').textContent);
const el = document.getElementById('lc-chart');
const chart = echarts.init(el, null, { renderer: 'svg' });
const series = data.series.map(s => ({
  name: s.name,
  type: 'line',
  data: s.data,
  smooth: data.smooth,
  ...(data.area ? { areaStyle: { opacity: 0.25 } } : {}),
  symbol: 'circle',
  symbolSize: 5,
}));
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  tooltip: { trigger: 'axis' },
  legend: data.series.length > 1 ? { textStyle: { color: CM.fgDim } } : { show: false },
  grid: { left: 56, right: 24, top: 32, bottom: 40 },
  xAxis: {
    type: 'category',
    data: data.categories,
    name: data.xAxisLabel || '',
    nameTextStyle: { color: CM.fgDim },
    axisLabel: { color: CM.fg },
    axisLine: { lineStyle: { color: CM.border } },
    boundaryGap: false,
  },
  yAxis: {
    type: 'value',
    name: data.yAxisLabel || '',
    nameTextStyle: { color: CM.fgDim },
    axisLabel: { color: CM.fg },
    axisLine: { lineStyle: { color: CM.border } },
    splitLine: { lineStyle: { color: CM.borderSoft } },
  },
  color: CM.palette,
  series,
});
window.addEventListener('resize', () => chart.resize());
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'lc-data': params },
    inlineScripts: [script],
  });
}

function escHtml(s: unknown): string {
  return String(s ?? '').replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;').replaceAll(/'/g, '&#39;');
}

export const LINE_CHART_TEMPLATE: ComposeAppTemplate = {
  slug: 'line-chart',
  title: 'Generic line chart (single or multi-series)',
  description:
    'Line chart for time-series or any ordered x-axis. Use for trend lines / daily metrics / latency over time / multi-line comparisons. Supply { title, categories: [string], series: [{name, data: [number]}], smooth?, area? }.',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
