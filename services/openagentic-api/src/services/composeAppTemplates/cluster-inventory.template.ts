/**
 * cluster-inventory — table of clusters.
 *
 * Phase 6 mocks-parity work. Audit slug: `cluster_inventory`.
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB, escHtml } from './_shared.js';

const ClusterSchema = z.object({
  name: z.string(),
  region: z.string(),
  k8s_version: z.string(),
  node_count: z.number().int().nonnegative(),
  pods: z.number().int().nonnegative(),
  status: z.enum(['healthy', 'degraded', 'critical', 'unknown']).default('unknown'),
  owner: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  clusters: z.array(ClusterSchema).min(1),
  subtitle: z.string().optional(),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'Kubernetes cluster inventory',
  subtitle: '7 clusters · 3 regions',
  clusters: [
    { name: 'prod-eks-us-east-1', region: 'us-east-1', k8s_version: '1.29.6', node_count: 28, pods: 412, status: 'healthy', owner: 'platform' },
    { name: 'prod-eks-eu-west-1', region: 'eu-west-1', k8s_version: '1.29.6', node_count: 18, pods: 264, status: 'healthy', owner: 'platform' },
    { name: 'prod-eks-ap-se-1',   region: 'ap-southeast-1', k8s_version: '1.28.9', node_count: 12, pods: 188, status: 'degraded', owner: 'platform' },
    { name: 'staging-eks',        region: 'us-east-1', k8s_version: '1.29.6', node_count: 6, pods: 92, status: 'healthy', owner: 'platform' },
    { name: 'dev-k3s-local',      region: 'on-prem',   k8s_version: '1.29.4', node_count: 3, pods: 41, status: 'healthy', owner: 'trent' },
    { name: 'edge-cdg',           region: 'eu-west-3', k8s_version: '1.28.5', node_count: 4, pods: 38, status: 'critical', owner: 'edge-team' },
    { name: 'sandbox-eks',        region: 'us-west-2', k8s_version: '1.27.11', node_count: 2, pods: 14, status: 'unknown', owner: 'research' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);

  const totals = {
    nodes: params.clusters.reduce((a, c) => a + c.node_count, 0),
    pods:  params.clusters.reduce((a, c) => a + c.pods, 0),
    healthy:  params.clusters.filter((c) => c.status === 'healthy').length,
    degraded: params.clusters.filter((c) => c.status === 'degraded').length,
    critical: params.clusters.filter((c) => c.status === 'critical').length,
  };

  const css = `
.ci-wrap { display: grid; gap: 12px; }
.ci-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.ci-kpi { padding: 10px 12px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.ci-kpi-label { font-size: 10px; color: var(--cm-fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.ci-kpi-value { font-size: 20px; font-weight: 600; font-family: var(--cm-mono); margin-top: 4px; color: var(--cm-fg); }
.ci-kpi-value.healthy  { color: var(--cm-success); }
.ci-kpi-value.degraded { color: var(--cm-warn); }
.ci-kpi-value.critical { color: var(--cm-error); }
.ci-host { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); overflow: hidden; }
table.ci { width: 100%; border-collapse: collapse; font-size: 13px; }
table.ci th { padding: 8px 12px; text-align: left; background: var(--cm-bg-3); color: var(--cm-fg-dim); font-weight: 600; border-bottom: 1px solid var(--cm-border); }
table.ci td { padding: 8px 12px; border-bottom: 1px solid var(--cm-border); color: var(--cm-fg); }
table.ci td.mono { font-family: var(--cm-mono); }
table.ci td.num  { font-family: var(--cm-mono); text-align: right; }
.ci-status { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-family: var(--cm-mono); }
.ci-status.healthy  { background: color-mix(in srgb, var(--cm-success) 15%, transparent);  color: var(--cm-success); }
.ci-status.degraded { background: color-mix(in srgb, var(--cm-warn) 15%, transparent); color: var(--cm-warn); }
.ci-status.critical { background: color-mix(in srgb, var(--cm-error) 15%, transparent);  color: var(--cm-error); }
.ci-status.unknown  { background: var(--cm-bg-3); color: var(--cm-fg-dim); }
`;

  const rows = params.clusters.map((c) => `
    <tr>
      <td class="mono">${escHtml(c.name)}</td>
      <td class="mono">${escHtml(c.region)}</td>
      <td class="mono">${escHtml(c.k8s_version)}</td>
      <td class="num">${c.node_count}</td>
      <td class="num">${c.pods}</td>
      <td><span class="ci-status ${escHtml(c.status)}">${escHtml(c.status)}</span></td>
      <td class="mono">${c.owner ? escHtml(c.owner) : ''}</td>
    </tr>
  `).join('');

  const body = `
<div class="viz-head">
  <span class="viz-title">${escHtml(params.title)}</span>
  ${params.subtitle ? `<span>${escHtml(params.subtitle)}</span>` : ''}
</div>
<div class="ci-wrap">
  <div class="ci-kpis">
    <div class="ci-kpi"><div class="ci-kpi-label">Clusters</div><div class="ci-kpi-value">${params.clusters.length}</div></div>
    <div class="ci-kpi"><div class="ci-kpi-label">Nodes</div><div class="ci-kpi-value">${totals.nodes}</div></div>
    <div class="ci-kpi"><div class="ci-kpi-label">Pods</div><div class="ci-kpi-value">${totals.pods}</div></div>
    <div class="ci-kpi"><div class="ci-kpi-label">Healthy</div><div class="ci-kpi-value healthy">${totals.healthy}</div></div>
    <div class="ci-kpi"><div class="ci-kpi-label">Degraded / Critical</div><div class="ci-kpi-value ${totals.critical > 0 ? 'critical' : 'degraded'}">${totals.degraded + totals.critical}</div></div>
  </div>
  <div class="ci-host">
    <table class="ci">
      <thead><tr>
        <th>Name</th><th>Region</th><th>k8s</th><th>Nodes</th><th>Pods</th><th>Status</th><th>Owner</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [],
    jsonPayloads: { 'ci-data': params },
    inlineScripts: [],
  });
}

void CDN_LIB;

export const CLUSTER_INVENTORY_TEMPLATE: ComposeAppTemplate = {
  slug: 'cluster-inventory',
  title: 'Kubernetes cluster inventory',
  description:
    'Table of Kubernetes clusters with summary KPIs. Supply { clusters[{name, region, k8s_version, node_count, pods, status: healthy|degraded|critical|unknown, owner?}] }. Use when the user asks "show me my clusters" / cluster fleet overview / k8s inventory. Also accepts the alias slug "cluster_inventory".',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [],
  exampleParams,
};
