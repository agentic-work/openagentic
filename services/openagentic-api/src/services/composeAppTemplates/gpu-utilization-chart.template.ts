/**
 * gpu-utilization-chart — multi-series time-series of GPU % util per node.
 * ECharts line chart, smoothed.
 *
 * Phase 6 mocks-parity work. Audit slug: `gpu_utilization_chart`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const SeriesSchema = z.object({
  node: z.string(),
  values: z.array(z.number().min(0).max(100)),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  buckets: z.array(z.string()).min(2),
  series: z.array(SeriesSchema).min(1),
  /** Optional saturation threshold line. Default 85. */
  threshold: z.number().min(0).max(100).default(85),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'GPU utilization — training cluster (%)',
  subtitle: '8 nodes · 5-min buckets · last hour',
  threshold: 85,
  buckets: ['14:00', '14:05', '14:10', '14:15', '14:20', '14:25', '14:30', '14:35', '14:40', '14:45', '14:50', '14:55'],
  series: [
    { node: 'gpu-node-01', values: [62, 71, 78, 81, 84, 88, 91, 87, 83, 80, 74, 69] },
    { node: 'gpu-node-02', values: [58, 64, 69, 72, 75, 79, 82, 80, 76, 73, 69, 64] },
    { node: 'gpu-node-03', values: [88, 92, 94, 95, 96, 97, 98, 96, 94, 92, 90, 87] },
    { node: 'gpu-node-04', values: [41, 45, 49, 52, 55, 58, 60, 58, 55, 52, 49, 44] },
    { node: 'gpu-node-05', values: [12, 14, 18, 22, 26, 30, 34, 32, 28, 24, 20, 16] },
    { node: 'gpu-node-06', values: [76, 80, 83, 85, 86, 88, 89, 87, 84, 81, 78, 74] },
    { node: 'gpu-node-07', values: [55, 60, 65, 68, 71, 74, 76, 74, 71, 68, 65, 61] },
    { node: 'gpu-node-08', values: [33, 36, 39, 42, 45, 48, 51, 49, 46, 43, 40, 36] },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  // Sanity: every series length matches buckets.
  for (const s of params.series) {
    if (s.values.length !== params.buckets.length) {
      throw new Error(`gpu-utilization-chart: series "${s.node}" has ${s.values.length} values; expected ${params.buckets.length} to match buckets length`);
    }
  }

  const css = `
#gu-chart { width: 100%; height: 380px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div id="gu-chart"></div>`;

  const script = `
const data = JSON.parse(document.getElementById('gu-data').textContent);
const palette = CM.palette;
const series = data.series.map(function (s, i) {
  return {
    name: s.node,
    type: 'line',
    smooth: true,
    showSymbol: false,
    data: s.values,
    lineStyle: { color: palette[i % palette.length], width: 2 },
    itemStyle: { color: palette[i % palette.length] },
    emphasis: { focus: 'series', lineStyle: { width: 3 } },
    markLine: i === 0 ? {
      symbol: 'none',
      label: { color: CM.error, formatter: 'saturated', fontSize: 10 },
      lineStyle: { color: CM.error, type: 'dashed', width: 1, opacity: 0.7 },
      data: [{ yAxis: data.threshold }],
    } : undefined,
  };
});
const chart = echarts.init(document.getElementById('gu-chart'), null, { renderer: 'svg' });
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  tooltip: { trigger: 'axis', valueFormatter: function (v) { return (v == null ? '—' : v) + '%'; } },
  legend: { textStyle: { color: CM.fgDim }, top: 4, type: 'scroll' },
  grid: { left: 56, right: 24, top: 36, bottom: 40 },
  xAxis: { type: 'category', data: data.buckets, axisLabel: { color: CM.fg }, axisLine: { lineStyle: { color: CM.border } } },
  yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: CM.fg, formatter: '{value}%' }, axisLine: { lineStyle: { color: CM.border } }, splitLine: { lineStyle: { color: CM.borderSoft } } },
  series: series,
});
window.addEventListener('resize', function () { chart.resize(); });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'gu-data': params },
    inlineScripts: [script],
  });
}

export const GPU_UTILIZATION_CHART_TEMPLATE: ComposeAppTemplate = {
  slug: 'gpu-utilization-chart',
  title: 'GPU utilization chart (multi-series, %)',
  description:
    'Multi-series time-series of GPU utilization % per node. Supply { buckets[time-labels], series[{node, values[]}], threshold? (default 85, drawn as dashed line) }. Each node gets a smoothed line; legend supports many nodes via scroll. Use for GPU fleet utilization views, training cluster saturation. Also accepts the alias slug "gpu_utilization_chart".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
