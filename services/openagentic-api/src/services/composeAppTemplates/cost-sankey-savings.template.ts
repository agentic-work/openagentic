/**
 * cost-sankey-savings — sankey of current cost flows + savings card with
 * per-category deltas. echarts-based.
 *
 * the design notes
 *       (mock 06: aws-k8s-aiops uses this for the cost optimization frame)
 *
 * Difference from compose_visual:sankey — this is the FULL augmented app
 * with the savings sidebar, not just the chart.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const FlowSchema = z.object({
  from: z.string(),
  to: z.string(),
  value: z.number().nonnegative(),
});

const SavingSchema = z.object({
  category: z.string(),
  currentMonthly: z.number().nonnegative(),
  optimizedMonthly: z.number().nonnegative(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  flows: z.array(FlowSchema).min(1),
  savings: z.array(SavingSchema).min(1),
  currency: z.string().default('USD'),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'EKS cost — current → optimized (monthly)',
  flows: [
    { from: 'us-east-1', to: 'EC2', value: 5400 },
    { from: 'us-west-2', to: 'EC2', value: 3200 },
    { from: 'eu-west-1', to: 'EC2', value: 1800 },
    { from: 'us-east-1', to: 'EBS', value: 1100 },
    { from: 'us-west-2', to: 'EBS', value: 760 },
    { from: 'eu-west-1', to: 'EBS', value: 420 },
    { from: 'EC2', to: 'optimized', value: 6800 },
    { from: 'EC2', to: 'savings', value: 3600 },
    { from: 'EBS', to: 'optimized', value: 1700 },
    { from: 'EBS', to: 'savings', value: 580 },
  ],
  savings: [
    { category: 'EC2 right-size', currentMonthly: 10400, optimizedMonthly: 6800 },
    { category: 'EBS gp3 swap', currentMonthly: 2280, optimizedMonthly: 1700 },
    { category: 'idle node trim', currentMonthly: 1500, optimizedMonthly: 0 },
  ],
  currency: 'USD',
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.css-wrap { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
#css-chart { width: 100%; height: 460px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.css-card { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px; }
.css-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--cm-border); }
.css-row:last-child { border-bottom: none; }
.css-label { color: var(--cm-fg); font-size: 13px; }
.css-delta-pos { color: var(--cm-success); font-family: var(--cm-mono); font-size: 13px; }
.css-delta-neg { color: var(--cm-error); font-family: var(--cm-mono); font-size: 13px; }
.css-total { padding: 12px 0 0; font-size: 14px; }
.css-total-num { font-size: 20px; font-weight: 600; color: var(--cm-accent); font-family: var(--cm-mono); }
@media (max-width: 700px) { .css-wrap { grid-template-columns: 1fr; } }
`;

  const totalCurrent = params.savings.reduce((a, s) => a + s.currentMonthly, 0);
  const totalOptimized = params.savings.reduce((a, s) => a + s.optimizedMonthly, 0);
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: params.currency, maximumFractionDigits: 0 }).format(n);

  let savingsRows = '';
  for (const s of params.savings) {
    const delta = s.currentMonthly - s.optimizedMonthly;
    const cls = delta > 0 ? 'css-delta-pos' : 'css-delta-neg';
    savingsRows += `<div class="css-row"><div class="css-label">${escapeHtml(s.category)}</div><div class="${cls}">−${fmt(delta)}</div></div>`;
  }

  const body = `
<div class="viz-head"><span class="viz-title">${escapeHtml(params.title)}</span><span class="cm-tag info">cost-sankey-savings</span></div>
<div class="css-wrap">
  <div id="css-chart"></div>
  <div class="css-card">
    <div style="font-size:13px;color:var(--cm-fg-dim);margin-bottom:8px;">Right-sizing opportunities</div>
    ${savingsRows}
    <div class="css-total">
      <div style="color:var(--cm-fg-dim);">Total monthly savings</div>
      <div class="css-total-num">−${fmt(totalCurrent - totalOptimized)}</div>
      <div style="color:var(--cm-fg-muted);font-size:11px;">${fmt(totalCurrent)} → ${fmt(totalOptimized)}</div>
    </div>
  </div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('css-data').textContent);
const nodeNames = new Set();
data.flows.forEach(function (f) { nodeNames.add(f.from); nodeNames.add(f.to); });
const chart = echarts.init(document.getElementById('css-chart'), null, { renderer: 'svg' });
chart.setOption({
  backgroundColor: 'transparent',
  textStyle: { color: CM.fgDim, fontFamily: 'ui-monospace, monospace' },
  tooltip: { trigger: 'item', triggerOn: 'mousemove' },
  series: [{
    type: 'sankey',
    layoutIterations: 32,
    nodeAlign: 'justify',
    label: { color: CM.fg, fontFamily: 'ui-monospace, monospace', fontSize: 11 },
    lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.55 },
    data: Array.from(nodeNames).map(function (n) {
      return { name: n, itemStyle: { color: n === 'savings' ? CM.success : (n === 'optimized' ? CM.accent : CM.accent2) } };
    }),
    links: data.flows.map(function (f) { return { source: f.from, target: f.to, value: f.value }; }),
  }],
});
window.addEventListener('resize', function () { chart.resize(); });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'css-data': params },
    inlineScripts: [script],
  });
}

function escapeHtml(s: string): string {
  return String(s).replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;').replaceAll(/'/g, '&#39;');
}

export const COST_SANKEY_SAVINGS_TEMPLATE: ComposeAppTemplate = {
  slug: 'cost-sankey-savings',
  title: 'Cost sankey + savings sidebar',
  description:
    'Render a sankey of current cost flows alongside a sidebar of right-sizing opportunities with per-category savings deltas. Use when the user asks for cost analysis with optimization recommendations. Supply flows[{from,to,value}] and savings[{category,currentMonthly,optimizedMonthly}].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
