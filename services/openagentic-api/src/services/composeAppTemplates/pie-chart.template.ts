/**
 * pie-chart — generic pie / donut chart for proportional breakdowns.
 * ECharts engine.
 *
 * Spec: #655 follow-up to #654.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const SliceSchema = z.object({
  name: z.string(),
  value: z.number().nonnegative(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  /** Each slice {name, value}. Values do not need to sum to 100. */
  slices: z.array(SliceSchema).min(1),
  /** Donut hole inner radius as a percentage (0 = full pie, 50 = donut). */
  donut: z.number().min(0).max(80).default(0),
  /** Show values on slice labels. Default true. */
  showValues: z.boolean().default(true),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Cloud spend by service — last 30 days',
  subtitle: 'USD across all subscriptions',
  slices: [
    { name: 'Compute (VMs/AKS)', value: 4820 },
    { name: 'Storage', value: 1230 },
    { name: 'Networking', value: 980 },
    { name: 'Databases', value: 1640 },
    { name: 'AI / ML', value: 720 },
  ],
  donut: 40,
  showValues: true,
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.pc-wrap { display: grid; gap: 12px; }
#pc-chart { width: 100%; height: 380px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="pc-wrap">
  <div id="pc-chart"></div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('pc-data').textContent);
const el = document.getElementById('pc-chart');
const chart = echarts.init(el, null, { renderer: 'svg' });
const inner = data.donut || 0;
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { orient: 'vertical', right: 12, top: 12, textStyle: { color: CM.fgDim } },
  color: CM.palette,
  series: [{
    type: 'pie',
    radius: inner > 0 ? [inner + '%', '70%'] : '70%',
    center: ['38%', '50%'],
    avoidLabelOverlap: true,
    label: data.showValues
      ? { color: CM.fg, formatter: '{b}\\n{c}' }
      : { color: CM.fg, formatter: '{b}' },
    labelLine: { lineStyle: { color: CM.border } },
    itemStyle: { borderColor: CM.bg, borderWidth: 2 },
    data: data.slices,
  }],
});
window.addEventListener('resize', () => chart.resize());
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'pc-data': params },
    inlineScripts: [script],
  });
}

function escHtml(s: unknown): string {
  return String(s ?? '').replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;').replaceAll(/'/g, '&#39;');
}

export const PIE_CHART_TEMPLATE: ComposeAppTemplate = {
  slug: 'pie-chart',
  title: 'Generic pie / donut chart',
  description:
    'Pie or donut chart for proportional breakdown. Use for spend-by-category / share-of-X / distribution by group. Supply { title, slices: [{name, value}], donut? (0-80%, default 0), showValues? }.',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
