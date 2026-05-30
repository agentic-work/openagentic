/**
 * bar-chart — generic bar chart for x/y series. ECharts engine.
 *
 * Spec: #655 follow-up to #654 — model asked for a "bar_chart" template
 * during live verify and got "unknown template" because the registry
 * only ships domain-specific slugs. This is the generic counterpart.
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
  /** Subtitle shown in the .viz-head band. Optional. */
  subtitle: z.string().optional(),
  /** X-axis category labels (e.g. region names). */
  categories: z.array(z.string()).min(1),
  /** One or more Y-series. Single series → solid bars; multi-series → grouped. */
  series: z.array(SeriesSchema).min(1),
  /** X-axis label. Optional. */
  xAxisLabel: z.string().optional(),
  /** Y-axis label. Optional. */
  yAxisLabel: z.string().optional(),
  /** Stacked when true (multi-series only). Default false → grouped bars. */
  stacked: z.boolean().default(false),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Azure region capacity',
  subtitle: 'percent of allocation cap by region',
  categories: ['East US', 'West US', 'North Europe', 'Southeast Asia'],
  series: [
    { name: 'Allocated', data: [87, 62, 91, 58] },
  ],
  xAxisLabel: 'region',
  yAxisLabel: 'capacity (%)',
  stacked: false,
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.bc-wrap { display: grid; gap: 12px; }
#bc-chart { width: 100%; height: 360px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="bc-wrap">
  <div id="bc-chart"></div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('bc-data').textContent);
const el = document.getElementById('bc-chart');
const chart = echarts.init(el, null, { renderer: 'svg' });
const series = data.series.map(s => ({
  name: s.name,
  type: 'bar',
  data: s.data,
  ...(data.stacked ? { stack: 'total' } : {}),
}));
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: data.series.length > 1 ? { textStyle: { color: CM.fgDim } } : { show: false },
  grid: { left: 56, right: 24, top: 32, bottom: 40 },
  xAxis: {
    type: 'category',
    data: data.categories,
    name: data.xAxisLabel || '',
    nameTextStyle: { color: CM.fgDim },
    axisLabel: { color: CM.fg },
    axisLine: { lineStyle: { color: CM.border } },
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
    jsonPayloads: { 'bc-data': params },
    inlineScripts: [script],
  });
}

function escHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const BAR_CHART_TEMPLATE: ComposeAppTemplate = {
  slug: 'bar-chart',
  title: 'Generic bar chart (single or grouped series)',
  description:
    'Bar chart for x-axis categories + one or more y-series. Use for "show me a bar chart of X" / region capacity / counts by group / stacked-bars-by-quarter etc. Supply { title, categories: [string], series: [{name, data: [number]}], xAxisLabel?, yAxisLabel?, stacked? }.',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
