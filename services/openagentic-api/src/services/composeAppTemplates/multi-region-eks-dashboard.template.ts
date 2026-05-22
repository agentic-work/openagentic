/**
 * multi-region-eks-dashboard — world map with region pins + cluster + node
 * + monthly cost annotations, plus a cost heatmap (cluster × resource type)
 * and right-sizing recommendations table.
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md
 *       (mock 06: aws-k8s-aiops)
 *
 * The world map is rendered with d3 via a hand-coded equirectangular projection
 * over a small embedded outline (we do NOT pull a topojson world atlas — those
 * bundles are 100+ KiB and not on the lib allow-list). The pins drop on
 * region centers — the world outline is decorative.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const ClusterSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  nodeCount: z.number().int().nonnegative(),
  monthlyCostUsd: z.number().nonnegative(),
});

const HeatCellSchema = z.object({
  clusterId: z.string(),
  resourceType: z.enum(['ec2', 'ebs', 'eks-control', 'eks-data', 'load-balancer', 'other']),
  monthlyCostUsd: z.number().nonnegative(),
});

const RecommendationSchema = z.object({
  clusterId: z.string(),
  action: z.string(),
  estSavingsUsd: z.number().nonnegative(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  clusters: z.array(ClusterSchema).min(1),
  heatmap: z.array(HeatCellSchema).default([]),
  recommendations: z.array(RecommendationSchema).default([]),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'EKS — multi-region cost + right-size',
  clusters: [
    { id: 'us-east', name: 'prod-us-east', region: 'us-east-1', lat: 38.9, lon: -77.0, nodeCount: 12, monthlyCostUsd: 5400 },
    { id: 'us-west', name: 'prod-us-west', region: 'us-west-2', lat: 45.5, lon: -122.7, nodeCount: 9, monthlyCostUsd: 3200 },
    { id: 'eu-west', name: 'prod-eu-west', region: 'eu-west-1', lat: 53.3, lon: -6.3, nodeCount: 7, monthlyCostUsd: 2400 },
    { id: 'ap-southeast', name: 'prod-ap-southeast', region: 'ap-southeast-1', lat: 1.3, lon: 103.8, nodeCount: 6, monthlyCostUsd: 1900 },
    { id: 'sa-east', name: 'staging-sa', region: 'sa-east-1', lat: -23.5, lon: -46.6, nodeCount: 3, monthlyCostUsd: 1300 },
  ],
  heatmap: [
    { clusterId: 'us-east', resourceType: 'ec2', monthlyCostUsd: 4200 },
    { clusterId: 'us-east', resourceType: 'ebs', monthlyCostUsd: 700 },
    { clusterId: 'us-east', resourceType: 'eks-control', monthlyCostUsd: 75 },
    { clusterId: 'us-west', resourceType: 'ec2', monthlyCostUsd: 2400 },
    { clusterId: 'us-west', resourceType: 'ebs', monthlyCostUsd: 600 },
    { clusterId: 'eu-west', resourceType: 'ec2', monthlyCostUsd: 1900 },
    { clusterId: 'eu-west', resourceType: 'ebs', monthlyCostUsd: 380 },
    { clusterId: 'ap-southeast', resourceType: 'ec2', monthlyCostUsd: 1500 },
    { clusterId: 'ap-southeast', resourceType: 'ebs', monthlyCostUsd: 320 },
    { clusterId: 'sa-east', resourceType: 'ec2', monthlyCostUsd: 1100 },
  ],
  recommendations: [
    { clusterId: 'us-east', action: 'Right-size m5.4xlarge → m6i.2xlarge × 8', estSavingsUsd: 1820 },
    { clusterId: 'us-west', action: 'Move idle workers to spot', estSavingsUsd: 940 },
    { clusterId: 'eu-west', action: 'Convert gp2 → gp3', estSavingsUsd: 220 },
    { clusterId: 'ap-southeast', action: 'Reduce cluster autoscaler max from 16 → 10', estSavingsUsd: 540 },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.eks-wrap { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
#eks-map { width: 100%; height: 320px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
#eks-heat { width: 100%; height: 320px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px; box-sizing: border-box; }
.eks-recs { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px; margin-top: 12px; }
.eks-rec-row { display: grid; grid-template-columns: 140px 1fr auto; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--cm-border); font-size: 13px; align-items: center; }
.eks-rec-row:last-child { border-bottom: none; }
.eks-rec-cluster { color: var(--cm-fg-dim); font-family: var(--cm-mono); font-size: 12px; }
.eks-rec-action { color: var(--cm-fg); }
.eks-rec-savings { color: var(--cm-success); font-family: var(--cm-mono); }
.eks-pin { fill: var(--cm-accent); stroke: var(--cm-bg); stroke-opacity: 0.4; }
.eks-pin-label { fill: var(--cm-fg); font-size: 10px; font-family: var(--cm-mono); pointer-events: none; }
.eks-graticule { fill: none; stroke: var(--cm-border); stroke-opacity: 0.25; stroke-dasharray: 2 4; }
.eks-land { fill: var(--cm-bg-3); stroke: var(--cm-border); stroke-width: 0.5; }
@media (max-width: 800px) { .eks-wrap { grid-template-columns: 1fr; } }
`;

  const totalCost = params.clusters.reduce((a, c) => a + c.monthlyCostUsd, 0);
  const totalSavings = params.recommendations.reduce((a, r) => a + r.estSavingsUsd, 0);
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

  const recsHtml = params.recommendations.map((r) => {
    const cluster = params.clusters.find((c) => c.id === r.clusterId)?.name ?? r.clusterId;
    return `<div class="eks-rec-row"><span class="eks-rec-cluster">${esc(cluster)}</span><span class="eks-rec-action">${esc(r.action)}</span><span class="eks-rec-savings">−${fmt(r.estSavingsUsd)}/mo</span></div>`;
  }).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${esc(params.title)}</span>
  <span class="cm-tag info">multi-region-eks-dashboard</span>
</div>
<div style="display:flex;gap:24px;margin:0 0 12px 0;font-size:13px;color:var(--cm-fg-dim);">
  <div>Clusters <span style="color:var(--cm-fg);font-weight:600;">${params.clusters.length}</span></div>
  <div>Nodes <span style="color:var(--cm-fg);font-weight:600;">${params.clusters.reduce((a, c) => a + c.nodeCount, 0)}</span></div>
  <div>Current <span style="color:var(--cm-fg);font-weight:600;">${fmt(totalCost)}/mo</span></div>
  <div>Right-size opportunity <span style="color:var(--cm-success);font-weight:600;">−${fmt(totalSavings)}/mo</span></div>
</div>
<div class="eks-wrap">
  <svg id="eks-map"></svg>
  <div id="eks-heat"></div>
</div>
<div class="eks-recs">
  <h3 style="margin:0 0 6px 0;font-size:12px;color:var(--cm-fg-dim);text-transform:uppercase;letter-spacing:0.04em;">Right-sizing recommendations</h3>
  ${recsHtml}
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('eks-data').textContent);

// --- Map (equirectangular, decorative graticule + pins) ---
const svg = d3.select('#eks-map');
const w = svg.node().clientWidth || 600;
const h = 320;
svg.attr('viewBox', '0 0 ' + w + ' ' + h);

// Decorative graticule.
const g = svg.append('g').attr('class', 'eks-graticule');
for (let lon = -180; lon <= 180; lon += 30) {
  g.append('line').attr('x1', ((lon + 180) / 360) * w).attr('x2', ((lon + 180) / 360) * w).attr('y1', 0).attr('y2', h);
}
for (let lat = -60; lat <= 60; lat += 30) {
  const y = ((90 - lat) / 180) * h;
  g.append('line').attr('y1', y).attr('y2', y).attr('x1', 0).attr('x2', w);
}

// Approximate land outlines — simple ellipses for continents.
const land = [
  { cx: 0.21 * w, cy: 0.46 * h, rx: 0.13 * w, ry: 0.20 * h }, // North America
  { cx: 0.30 * w, cy: 0.70 * h, rx: 0.07 * w, ry: 0.14 * h }, // South America
  { cx: 0.51 * w, cy: 0.55 * h, rx: 0.08 * w, ry: 0.16 * h }, // Africa
  { cx: 0.50 * w, cy: 0.34 * h, rx: 0.10 * w, ry: 0.10 * h }, // Europe
  { cx: 0.70 * w, cy: 0.42 * h, rx: 0.18 * w, ry: 0.18 * h }, // Asia
  { cx: 0.83 * w, cy: 0.74 * h, rx: 0.07 * w, ry: 0.08 * h }, // Oceania
];
land.forEach(function (l) {
  svg.append('ellipse').attr('class', 'eks-land').attr('cx', l.cx).attr('cy', l.cy).attr('rx', l.rx).attr('ry', l.ry);
});

const proj = function (lon, lat) {
  return [((lon + 180) / 360) * w, ((90 - lat) / 180) * h];
};

const maxCost = Math.max.apply(null, data.clusters.map(function (c) { return c.monthlyCostUsd; }));
data.clusters.forEach(function (c) {
  const pt = proj(c.lon, c.lat);
  const r = 6 + (c.monthlyCostUsd / maxCost) * 14;
  svg.append('circle').attr('class', 'eks-pin').attr('cx', pt[0]).attr('cy', pt[1]).attr('r', r).attr('fill-opacity', 0.85);
  svg.append('text').attr('class', 'eks-pin-label').attr('x', pt[0] + r + 4).attr('y', pt[1] + 4).text(c.region + ' · $' + Math.round(c.monthlyCostUsd / 1000) + 'k');
});

// --- Heatmap (cluster × resourceType) ---
const heatRoot = document.getElementById('eks-heat');
const resourceTypes = Array.from(new Set(data.heatmap.map(function (c) { return c.resourceType; })));
const clusterIds = data.clusters.map(function (c) { return c.id; });
const cellMap = {};
data.heatmap.forEach(function (cell) { cellMap[cell.clusterId + ':' + cell.resourceType] = cell.monthlyCostUsd; });
const maxHeat = Math.max.apply(null, [1].concat(data.heatmap.map(function (c) { return c.monthlyCostUsd; })));

let html = '<div style="font-size:12px;color:var(--cm-fg-dim);margin-bottom:6px;">Cost by cluster × resource</div>';
html += '<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:var(--cm-mono);">';
html += '<tr><th style="text-align:left;color:var(--cm-fg-dim);padding:4px 6px;"></th>';
resourceTypes.forEach(function (rt) { html += '<th style="text-align:right;color:var(--cm-fg-dim);padding:4px 6px;">' + rt + '</th>'; });
html += '</tr>';
clusterIds.forEach(function (cid) {
  html += '<tr><td style="color:var(--cm-fg);padding:3px 6px;">' + cid + '</td>';
  resourceTypes.forEach(function (rt) {
    const v = cellMap[cid + ':' + rt] || 0;
    const intensity = v / maxHeat;
    const bg = 'color-mix(in srgb, ' + CM.accent + ' ' + ((0.05 + intensity * 0.55) * 100).toFixed(0) + '%, transparent)';
    html += '<td style="text-align:right;padding:3px 6px;background:' + bg + ';color:var(--cm-fg);">' + (v ? '$' + Math.round(v) : '·') + '</td>';
  });
  html += '</tr>';
});
html += '</table>';
heatRoot.innerHTML = html;
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.d3],
    jsonPayloads: { 'eks-data': params },
    inlineScripts: [script],
  });
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const MULTI_REGION_EKS_DASHBOARD_TEMPLATE: ComposeAppTemplate = {
  slug: 'multi-region-eks-dashboard',
  title: 'Multi-region EKS dashboard',
  description:
    'World-map view of EKS clusters across regions with cost-sized pins, plus a cluster × resource-type cost heatmap and a right-sizing recommendations table. Use when the user asks for multi-region EKS audit / cost / right-sizing analysis. Supply clusters[{id,name,region,lat,lon,nodeCount,monthlyCostUsd}], heatmap[], recommendations[].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.d3],
  exampleParams,
};
