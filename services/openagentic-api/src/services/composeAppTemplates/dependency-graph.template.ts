/**
 * dependency-graph — force-directed graph of packages/services.
 * ECharts graph type with force layout.
 *
 * Phase 6 mocks-parity work. Audit slug: `dependency_graph`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const NodeSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  group: z.string().optional(),
  size: z.number().positive().optional(),
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  weight: z.number().positive().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'openagentic-api — internal service dependencies',
  subtitle: 'force-directed · node size ∝ outbound edges',
  nodes: [
    { id: 'api',         label: 'openagentic-api',  group: 'core',     size: 30 },
    { id: 'ui',          label: 'openagentic-ui',   group: 'frontend', size: 20 },
    { id: 'milvus',      label: 'milvus',           group: 'data',     size: 18 },
    { id: 'postgres',    label: 'postgres',         group: 'data',     size: 22 },
    { id: 'redis',       label: 'redis',            group: 'data',     size: 16 },
    { id: 'synth-cdn',   label: 'synth-cdn',        group: 'platform', size: 12 },
    { id: 'synth-exec',  label: 'synth-executor',   group: 'platform', size: 14 },
    { id: 'aws-mcp',     label: 'oap-aws-mcp',      group: 'mcp',      size: 14 },
    { id: 'azure-mcp',   label: 'oap-azure-mcp',    group: 'mcp',      size: 14 },
    { id: 'gcp-mcp',     label: 'oap-gcp-mcp',      group: 'mcp',      size: 14 },
  ],
  edges: [
    { from: 'ui',         to: 'api',         weight: 3 },
    { from: 'api',        to: 'postgres',    weight: 4 },
    { from: 'api',        to: 'redis',       weight: 3 },
    { from: 'api',        to: 'milvus',      weight: 2 },
    { from: 'api',        to: 'aws-mcp',     weight: 1 },
    { from: 'api',        to: 'azure-mcp',   weight: 1 },
    { from: 'api',        to: 'gcp-mcp',     weight: 1 },
    { from: 'api',        to: 'synth-exec',  weight: 2 },
    { from: 'synth-exec', to: 'synth-cdn',   weight: 1 },
    { from: 'ui',         to: 'synth-cdn',   weight: 1 },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const css = `
#dg-chart { width: 100%; height: 480px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
`;

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div id="dg-chart"></div>`;

  const script = `
const data = JSON.parse(document.getElementById('dg-data').textContent);
const groups = Array.from(new Set(data.nodes.map(function (n) { return n.group || 'default'; })));
const categories = groups.map(function (g) { return { name: g }; });
const chart = echarts.init(document.getElementById('dg-chart'), null, { renderer: 'svg' });
chart.setOption({
  backgroundColor: 'transparent',
  tooltip: { trigger: 'item' },
  legend: { data: groups, textStyle: { color: CM.fgDim }, top: 6 },
  color: CM.palette,
  series: [{
    type: 'graph',
    layout: 'force',
    roam: true,
    label: { show: true, color: CM.fg, fontFamily: 'ui-monospace, monospace', fontSize: 11, position: 'right' },
    edgeSymbol: ['none', 'arrow'],
    edgeSymbolSize: [0, 8],
    lineStyle: { color: 'source', opacity: 0.65, curveness: 0.1 },
    emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
    force: { repulsion: 220, edgeLength: [80, 160], gravity: 0.05 },
    categories: categories,
    data: data.nodes.map(function (n) {
      return {
        id: n.id,
        name: n.label || n.id,
        symbolSize: n.size || 14,
        category: groups.indexOf(n.group || 'default'),
      };
    }),
    links: data.edges.map(function (e) { return { source: e.from, target: e.to, value: e.weight || 1 }; }),
  }],
});
window.addEventListener('resize', function () { chart.resize(); });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.echarts],
    jsonPayloads: { 'dg-data': params },
    inlineScripts: [script],
  });
}

export const DEPENDENCY_GRAPH_TEMPLATE: ComposeAppTemplate = {
  slug: 'dependency-graph',
  title: 'Dependency graph (force-directed)',
  description:
    'Force-directed dependency graph of packages or services. Supply nodes[{id,label?,group?,size?}] and edges[{from,to,weight?}]. Renders with ECharts force layout, color-coded by group, arrow edges. Use for "show me deps of X" / service-topology / npm-package-graph asks. Also accepts the alias slug "dependency_graph".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.echarts],
  exampleParams,
};
