/**
 * latency-heatmap — services × time-buckets heatmap of p99 latencies.
 * ECharts heatmap.
 *
 * Phase 6 mocks-parity work. Audit slug: `latency_heatmap`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ParamsSchema = z.object({
  title: z.string().min(1),
  /** Row labels (e.g. service names). */
  services: z.array(z.string()).min(1),
  /** Column labels (e.g. time-bucket labels). */
  buckets: z.array(z.string()).min(1),
  /** Sparse cell values [serviceIndex, bucketIndex, value]. */
  values: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().nonnegative()])).min(1),
  /** Unit displayed on the legend + tooltips. Default "ms". */
  unit: z.string().default('ms'),
  /** Manual upper bound for visualMap; auto-computed when omitted. */
  max: z.number().nonnegative().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'p99 latency by service × 5-min bucket',
  unit: 'ms',
  services: ['auth', 'payments', 'orders', 'catalog', 'search'],
  buckets: ['14:00', '14:05', '14:10', '14:15', '14:20', '14:25', '14:30'],
  values: [
    [0, 0, 120], [0, 1, 110], [0, 2, 130], [0, 3, 115], [0, 4, 105], [0, 5, 118], [0, 6, 124],
    [1, 0, 240], [1, 1, 260], [1, 2, 410], [1, 3, 1850], [1, 4, 1720], [1, 5, 980], [1, 6, 320],
    [2, 0, 88],  [2, 1, 92],  [2, 2, 87],  [2, 3, 95],  [2, 4, 102], [2, 5, 99],  [2, 6, 96],
    [3, 0, 56],  [3, 1, 62],  [3, 2, 58],  [3, 3, 71],  [3, 4, 65],  [3, 5, 60],  [3, 6, 64],
    [4, 0, 320], [4, 1, 290], [4, 2, 310], [4, 3, 305], [4, 4, 280], [4, 5, 295], [4, 6, 300],
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const computedMax = params.max ?? Math.max(...params.values.map((v) => v[2]));

  const css = `
#lh-chart { width: 100%; height: 360px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  <span>unit: ${escHtml(params.unit)}</span>
</div>
<div id="lh-chart"></div>`;

  const script = `
const data = JSON.parse(document.getElementById('lh-data').textContent);
const chart = echarts.init(document.getElementById('lh-chart'), null, { renderer: 'svg' });
// Heatmap ramp: low→high via successSoft → success → warn → error.
// Uses theme tokens so accent overrides flow through (e.g. a teal-accent
// theme repaints the low end without code changes).
const heatRamp = [CM.successSoft, CM.success, CM.warn, CM.error];
chart.setOption({
  backgroundColor: 'transparent',
  tooltip: { position: 'top', formatter: function (p) {
    return data.services[p.data[1]] + ' · ' + data.buckets[p.data[0]] + '<br/>' + p.data[2] + ' ' + data.unit;
  } },
  grid: { left: 80, right: 24, top: 40, bottom: 50 },
  xAxis: { type: 'category', data: data.buckets, axisLabel: { color: CM.fg }, splitArea: { show: false } },
  yAxis: { type: 'category', data: data.services, axisLabel: { color: CM.fg }, splitArea: { show: false } },
  visualMap: {
    min: 0, max: ${computedMax},
    calculable: true,
    orient: 'horizontal',
    left: 'center', bottom: 4,
    textStyle: { color: CM.fgDim },
    inRange: { color: heatRamp }
  },
  series: [{
    name: 'p99 latency',
    type: 'heatmap',
    data: data.values.map(function (v) { return [v[1], v[0], v[2]]; }),
    label: { show: false },
    itemStyle: { borderColor: CM.borderSoft, borderWidth: 1 },
    emphasis: { itemStyle: { borderColor: CM.fg, borderWidth: 2 } },
  }],
});
window.addEventListener('resize', function () { chart.resize(); });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'lh-data': params },
    inlineScripts: [script],
  });
}

export const LATENCY_HEATMAP_TEMPLATE: ComposeAppTemplate = {
  slug: 'latency-heatmap',
  title: 'Latency heatmap (services × time buckets)',
  description:
    'ECharts heatmap of latency (or other numeric metric) by service × time-bucket. Cells colored low→high (green→red). Supply services[] row labels, buckets[] column labels, values[] as sparse [serviceIdx, bucketIdx, value] triples. Also accepts the alias slug "latency_heatmap".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
