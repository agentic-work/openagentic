/**
 * EChartsRenderer — server-side ECharts SVG renderer.
 *
 * One renderer for sankey, chord, sunburst, radial_tree, treemap,
 * parallel_coords, heatmap. Calls echarts.init in SSR mode and
 * `renderToSVGString()` to produce a deterministic SVG string.
 *
 * Why ECharts: 66k★ Apache-2.0 with built-in SVG renderer that works in
 * pure Node (no jsdom). Replaces ~80 LOC of hand-rolled math per chart
 * type with a ~15-line config. Reference:
 * https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg
 *
 * Determinism: ECharts in SSR mode does NOT reach for window/document
 * and does NOT use Math.random or Date. Same input → same SVG output.
 *
 * IMPORTANT: import order matters. We must import echarts core + the
 * SVG renderer BEFORE any chart types we register. The renderer is what
 * unlocks `renderToSVGString()` in Node.
 */

// ECharts SSR entry — pulls a Node-safe build with no DOM dependency.
// See https://echarts.apache.org/handbook/en/basics/help#use-svg-rendering
//
// We import the whole subpath as a namespace and cast to `any` at the use
// site because echarts' `./charts` + `./components` subpaths ship a `.d.ts`
// whose exported names don't survive `moduleResolution: NodeNext` in the
// production Docker tsc step (pnpm-installed layout in the build container
// differs from the dev tree, and nodenext picks the narrower dts). The
// namespace import skips TS's named-export verification AND keeps us in
// pure ESM (require() in this file would conflict with top-level await
// elsewhere in the bundle and trigger ERR_AMBIGUOUS_MODULE_SYNTAX).
import * as echarts from 'echarts/lib/echarts.js';
import * as echartsRenderersNs from 'echarts/renderers';
import * as echartsChartsNs from 'echarts/charts';
import * as echartsComponentsNs from 'echarts/components';

const echartsRenderers = echartsRenderersNs as any;
const echartsCharts = echartsChartsNs as any;
const echartsComponents = echartsComponentsNs as any;

echarts.use([
  echartsRenderers.SVGRenderer,
  echartsCharts.SankeyChart,
  echartsCharts.GraphChart,
  echartsCharts.SunburstChart,
  echartsCharts.TreeChart,
  echartsCharts.TreemapChart,
  echartsCharts.ParallelChart,
  echartsCharts.HeatmapChart,
  echartsComponents.TitleComponent,
  echartsComponents.TooltipComponent,
  echartsComponents.GridComponent,
  echartsComponents.ParallelComponent,
  echartsComponents.VisualMapComponent,
]);

export type EChartTemplate =
  | 'sankey'
  | 'chord'
  | 'sunburst'
  | 'radial_tree'
  | 'treemap'
  | 'parallel_coords'
  | 'heatmap';

export interface RenderedSvg {
  kind: 'svg';
  content: string;
}

const DIMS = { width: 800, height: 420 };

/**
 * CLAUDE.md Rule 8(b) — every color value emitted into the SVG must
 * resolve through the iframe parent's `--cm-*` tokens at render time.
 * ECharts accepts CSS color strings verbatim and writes them into
 * `fill="..."` / `stroke="..."` attributes; `var(--cm-accent, #hex)`
 * is a valid CSS color string with a documented hex fallback for
 * contexts where the iframe preamble didn't run.
 *
 * The TOKEN_* constants below are SVG-CSS expressions, NOT bare hex
 * literals. They're stored as `var(--cm-*, #fallback)` so the arch
 * cage `no-hardcoded-colors-in-compose.source-regression` accepts them.
 */
const TOKEN_ACCENT = 'var(--cm-accent, #8b5cf6)';
const TOKEN_SUCCESS = 'var(--cm-success, #10b981)';
const TOKEN_WARN = 'var(--cm-warn, #f59e0b)';
const TOKEN_INFO = 'var(--cm-info, #3b82f6)';
const TOKEN_ERROR = 'var(--cm-error, #ef4444)';
const TOKEN_INFO_2 = 'var(--cm-info, #06b6d4)';
const TOKEN_ACCENT_2 = 'var(--cm-accent-2, #ec4899)';
const TOKEN_SUCCESS_2 = 'var(--cm-success, #84cc16)';

const TOKEN_FG_0 = 'var(--cm-fg-0, #f8fafc)';
const TOKEN_FG_1 = 'var(--cm-fg-1, #d4d4d8)';
const TOKEN_FG_2 = 'var(--cm-fg-2, #a1a1aa)';
const TOKEN_FG_3 = 'var(--cm-fg-3, #71717a)';
const TOKEN_BG_1 = 'var(--cm-bg-1, #0f1012)';
const TOKEN_BG_3 = 'var(--cm-bg-3, #1c1f24)';
const TOKEN_BORDER = 'var(--cm-border, #3f3f46)';
const TOKEN_SHADOW = 'color-mix(in srgb, var(--cm-accent, #8b5cf6) 50%, transparent)';

const DARK_PALETTE = [
  TOKEN_ACCENT,
  TOKEN_SUCCESS,
  TOKEN_WARN,
  TOKEN_INFO,
  TOKEN_ERROR,
  TOKEN_INFO_2,
  TOKEN_ACCENT_2,
  TOKEN_SUCCESS_2,
];

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function buildSankeyOption(data: any): unknown {
  if (!data || !Array.isArray(data.flows) || data.flows.length === 0) {
    throw new Error('sankey requires at least one flow in data.flows');
  }
  data.flows.forEach((f: any, i: number) => {
    if (typeof f?.from !== 'string' || typeof f?.to !== 'string') {
      throw new Error(`flow ${i}: from and to must be strings`);
    }
    // Reject negative and non-finite values (kept strict — those are data
    // bugs). Zero is allowed at validation time and filtered out below
    // (#1106: cost-breakdown sankeys legitimately contain $0.00 line items).
    if (!isFiniteNumber(f.value) || f.value < 0) {
      throw new Error(`flow ${i}: value must be a positive number`);
    }
  });

  // #1106 — drop zero-value rows. Cost-breakdown sankeys often include
  // $0.00 line items (Bandwidth, idle services). Rejecting the whole render
  // because one row is zero is hostile UX. Filter zeros, render the rest.
  const positiveFlows = data.flows.filter((f: any) => f.value > 0);
  if (positiveFlows.length === 0) {
    throw new Error('sankey: no positive-value flows after filtering zeros');
  }

  const nodeNames = new Set<string>();
  for (const f of positiveFlows) {
    nodeNames.add(f.from);
    nodeNames.add(f.to);
  }
  const nodes = Array.from(nodeNames).map((name) => ({ name }));
  const links = positiveFlows.map((f: any) => ({ source: f.from, target: f.to, value: f.value }));

  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'sankey',
      data: nodes,
      links,
      emphasis: { focus: 'adjacency' },
      lineStyle: { color: 'gradient', curveness: 0.5 },
      label: { color: TOKEN_FG_0, fontFamily: 'Inter, system-ui', fontSize: 12 },
      itemStyle: { color: TOKEN_ACCENT, borderColor: TOKEN_ACCENT },
    }],
  };
}

function buildChordOption(data: any): unknown {
  if (!Array.isArray(data?.nodes) || !Array.isArray(data?.matrix)) {
    throw new Error('chord requires nodes: string[] and matrix: number[][]');
  }
  const n = data.nodes.length;
  if (n === 0) throw new Error('chord requires at least one node');
  if (data.matrix.length !== n) {
    throw new Error('chord matrix must be square (rows == nodes.length)');
  }
  for (const row of data.matrix) {
    if (!Array.isArray(row) || row.length !== n) {
      throw new Error('chord matrix must be square (each row.length == nodes.length)');
    }
  }

  const nodes = data.nodes.map((name: string) => ({ name, symbolSize: 30 }));
  const links: Array<{ source: string; target: string; value: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = (data.matrix[i][j] || 0) + (data.matrix[j][i] || 0);
      if (v > 0) {
        links.push({ source: data.nodes[i], target: data.nodes[j], value: v });
      }
    }
  }

  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'graph',
      layout: 'circular',
      circular: { rotateLabel: true },
      data: nodes,
      links,
      lineStyle: { color: 'source', curveness: 0.3, opacity: 0.6 },
      label: { show: true, color: TOKEN_FG_0, fontFamily: 'Inter, system-ui' },
      itemStyle: { color: TOKEN_ACCENT },
      emphasis: { focus: 'adjacency' },
    }],
  };
}

function buildSunburstOption(data: any): unknown {
  if (!data?.root) throw new Error('sunburst requires data.root');
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'sunburst',
      data: [data.root],
      radius: [0, '90%'],
      label: { color: TOKEN_FG_0, fontFamily: 'Inter, system-ui' },
      itemStyle: { borderColor: TOKEN_BG_1, borderWidth: 1 },
      levels: [{}, { itemStyle: { color: TOKEN_ACCENT } }, { itemStyle: { color: TOKEN_SUCCESS } }],
    }],
  };
}

function buildRadialTreeOption(data: any): unknown {
  if (!data?.root) throw new Error('radial_tree requires data.root');
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'tree',
      data: [data.root],
      layout: 'radial',
      symbol: 'circle',
      symbolSize: 8,
      initialTreeDepth: -1,
      lineStyle: { color: TOKEN_BORDER, curveness: 0.5 },
      label: { color: TOKEN_FG_1, fontFamily: 'Inter, system-ui', fontSize: 11 },
      itemStyle: { color: TOKEN_ACCENT },
    }],
  };
}

function buildTreemapOption(data: any): unknown {
  if (!data?.root) throw new Error('treemap requires data.root');
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'treemap',
      data: [data.root],
      breadcrumb: { show: false },
      roam: false,
      nodeClick: false,
      label: { color: TOKEN_FG_0, fontFamily: 'Inter, system-ui' },
      itemStyle: { borderColor: TOKEN_BG_1, borderWidth: 2, gapWidth: 2 },
      levels: [
        { itemStyle: { color: TOKEN_ACCENT } },
        { itemStyle: { color: TOKEN_SUCCESS } },
      ],
    }],
  };
}

function buildParallelCoordsOption(data: any): unknown {
  if (!Array.isArray(data?.dims) || !Array.isArray(data?.rows)) {
    throw new Error('parallel_coords requires dims: string[] and rows: {name,values}[]');
  }
  data.rows.forEach((r: any, i: number) => {
    if (!Array.isArray(r?.values) || r.values.length !== data.dims.length) {
      throw new Error(`row ${i}: values length must match dims.length`);
    }
  });
  return {
    backgroundColor: 'transparent',
    parallelAxis: data.dims.map((dim: string, idx: number) => ({
      dim: idx,
      name: dim,
      nameTextStyle: { color: TOKEN_FG_2, fontFamily: 'Inter, system-ui' },
      axisLabel: { color: TOKEN_FG_3 },
      axisLine: { lineStyle: { color: TOKEN_BORDER } },
    })),
    parallel: {
      left: '5%',
      right: '5%',
      top: '10%',
      bottom: '10%',
      parallelAxisDefault: { type: 'value' },
    },
    series: [{
      type: 'parallel',
      data: data.rows.map((r: any, i: number) => ({
        name: r.name,
        value: r.values,
        lineStyle: { color: DARK_PALETTE[i % DARK_PALETTE.length], width: 2, opacity: 0.8 },
      })),
    }],
  };
}

function buildHeatmapOption(data: any): unknown {
  if (!Array.isArray(data?.x) || !Array.isArray(data?.y) || !Array.isArray(data?.cells)) {
    throw new Error('heatmap requires x: string[], y: string[], cells: [xIdx,yIdx,val][]');
  }
  return {
    backgroundColor: 'transparent',
    grid: { left: 50, right: 30, top: 30, bottom: 50 },
    xAxis: { type: 'category', data: data.x, axisLabel: { color: TOKEN_FG_2 }, axisLine: { lineStyle: { color: TOKEN_BORDER } } },
    yAxis: { type: 'category', data: data.y, axisLabel: { color: TOKEN_FG_2 }, axisLine: { lineStyle: { color: TOKEN_BORDER } } },
    visualMap: {
      min: 0,
      max: Math.max(1, ...data.cells.map((c: any[]) => Number(c[2]) || 0)),
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      textStyle: { color: TOKEN_FG_2 },
      inRange: { color: [TOKEN_BG_3, TOKEN_ACCENT] },
    },
    series: [{
      type: 'heatmap',
      data: data.cells,
      label: { show: true, color: TOKEN_FG_0 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: TOKEN_SHADOW } },
    }],
  };
}

function buildOption(template: EChartTemplate, data: any): unknown {
  switch (template) {
    case 'sankey': return buildSankeyOption(data);
    case 'chord': return buildChordOption(data);
    case 'sunburst': return buildSunburstOption(data);
    case 'radial_tree': return buildRadialTreeOption(data);
    case 'treemap': return buildTreemapOption(data);
    case 'parallel_coords': return buildParallelCoordsOption(data);
    case 'heatmap': return buildHeatmapOption(data);
    default: {
      const exhaustive: never = template;
      throw new Error(`unsupported template: ${String(exhaustive)}`);
    }
  }
}

/**
 * ECharts (zrender) embeds a per-instance counter into clip-path / pattern
 * IDs as `zr<N>-...`, where N increments globally across calls. That makes
 * raw `renderToSVGString()` output non-deterministic across invocations
 * (same input → different SVG bytes). We rewrite the counter to a stable
 * sentinel ("zr-") so identical input always yields identical output —
 * critical for downstream caching, snapshot tests, and SHA-256-based
 * artifact identity. The references stay internally consistent because
 * we rewrite both the `id="..."` definitions and the `url(#...)`
 * references with the same regex.
 */
// zrender embeds the per-instance counter in two places:
//   `zr<N>-...`   — clip-path ID prefix
//   `zr-cls-<N>`  — CSS class name suffix (and corresponding <style> rules)
// Strip both. References stay internally consistent because we rewrite
// every site (id=..., url(#...), class=..., and the inline <style>) with
// the same regex applied to the full SVG string.
const ZR_INSTANCE_PATTERN = /\bzr\d+-/g;
const ZR_CLASS_PATTERN = /\bzr-cls-\d+/g;

function stripZRenderCounter(svg: string): string {
  // Map every per-instance class name to a stable hash-of-its-position
  // so rules in the embedded <style> still target the matching elements.
  const classMap = new Map<string, string>();
  let counter = 0;
  return svg
    .replace(ZR_INSTANCE_PATTERN, 'zr-')
    .replace(ZR_CLASS_PATTERN, (match) => {
      let stable = classMap.get(match);
      if (!stable) {
        stable = `zr-cls-s${counter++}`;
        classMap.set(match, stable);
      }
      return stable;
    });
}

export function renderEChart(template: EChartTemplate, data: unknown): RenderedSvg {
  const option = buildOption(template, data);
  // SSR mode: ECharts internally creates a virtual DOM and renders to SVG.
  // Reference: https://echarts.apache.org/handbook/en/how-to/cross-platform/server
  const chart = (echarts as any).init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: DIMS.width,
    height: DIMS.height,
  });
  chart.setOption(option);
  const raw: string = chart.renderToSVGString();
  chart.dispose();
  return { kind: 'svg', content: stripZRenderCounter(raw) };
}
