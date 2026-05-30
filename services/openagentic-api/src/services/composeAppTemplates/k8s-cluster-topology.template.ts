/**
 * k8s-cluster-topology — Kubernetes cluster topology with nodes, pods,
 * namespaces. Renders via cytoscape compound nodes (namespace > node > pod).
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md
 *       (mock 06: aws-k8s-aiops uses this; mock 05: troubleshoot can too)
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const PodSchema = z.object({
  id: z.string(),
  label: z.string(),
  nodeId: z.string(),
  namespace: z.string(),
  status: z.enum(['Running', 'Pending', 'CrashLoopBackOff', 'Succeeded', 'Failed', 'Unknown']),
  cpuMilli: z.number().nonnegative().optional(),
  memMiB: z.number().nonnegative().optional(),
});

const NodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.enum(['control-plane', 'worker']).default('worker'),
  cpuCapacityCores: z.number().positive().optional(),
  memCapacityGiB: z.number().positive().optional(),
  ready: z.boolean().default(true),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  cluster: z.string().min(1),
  namespaces: z.array(z.string()).min(1),
  nodes: z.array(NodeSchema).min(1),
  pods: z.array(PodSchema).min(1),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'prod-eks (us-east-1)',
  cluster: 'prod-eks',
  namespaces: ['agentic-dev', 'observability', 'kube-system'],
  nodes: [
    { id: 'n1', label: 'ip-10-0-1-12', role: 'worker', cpuCapacityCores: 8, memCapacityGiB: 32, ready: true },
    { id: 'n2', label: 'ip-10-0-1-13', role: 'worker', cpuCapacityCores: 8, memCapacityGiB: 32, ready: true },
    { id: 'n3', label: 'ip-10-0-1-14', role: 'worker', cpuCapacityCores: 4, memCapacityGiB: 16, ready: false },
  ],
  pods: [
    { id: 'p1', label: 'api-7d4f', nodeId: 'n1', namespace: 'agentic-dev', status: 'Running', cpuMilli: 420, memMiB: 612 },
    { id: 'p2', label: 'ui-9a2b', nodeId: 'n1', namespace: 'agentic-dev', status: 'Running', cpuMilli: 110, memMiB: 256 },
    { id: 'p3', label: 'milvus-0', nodeId: 'n2', namespace: 'agentic-dev', status: 'Running', cpuMilli: 1200, memMiB: 4096 },
    { id: 'p4', label: 'prometheus-0', nodeId: 'n2', namespace: 'observability', status: 'Running', cpuMilli: 240, memMiB: 1024 },
    { id: 'p5', label: 'kube-proxy-x4', nodeId: 'n3', namespace: 'kube-system', status: 'CrashLoopBackOff', cpuMilli: 0, memMiB: 0 },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.k8s-wrap { display: grid; grid-template-rows: auto 1fr; gap: 8px; }
#k8s-cy { width: 100%; height: 540px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.k8s-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--cm-fg-dim); }
`;
  const body = `
<div class="viz-head"><span class="viz-title">${params.title}</span><span class="cm-tag info">k8s-cluster-topology</span></div>
<div class="k8s-wrap">
  <div class="k8s-legend">
    <span class="cm-tag ok">Running</span>
    <span class="cm-tag warn">Pending</span>
    <span class="cm-tag error">CrashLoopBackOff</span>
    <span class="cm-tag">Succeeded</span>
  </div>
  <div id="k8s-cy"></div>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('k8s-data').textContent);

const elements = [];
data.namespaces.forEach(function (ns) {
  elements.push({ data: { id: 'ns:' + ns, label: ns }, classes: 'ns' });
});
data.nodes.forEach(function (n) {
  elements.push({
    data: { id: 'node:' + n.id, label: n.label + (n.role === 'control-plane' ? '★ ' : ''), ready: n.ready },
    classes: 'k8snode' + (n.ready ? '' : ' notready'),
  });
});
data.pods.forEach(function (p) {
  // A pod belongs to a node AND a namespace; cytoscape compound nodes
  // accept a single parent so we attach to the node and color by status.
  elements.push({
    data: { id: 'pod:' + p.id, label: p.label, parent: 'node:' + p.nodeId, status: p.status, ns: p.namespace },
    classes: 'pod ' + p.status.toLowerCase(),
  });
});

const cy = cytoscape({
  container: document.getElementById('k8s-cy'),
  elements: elements,
  style: [
    { selector: '.ns', style: { 'background-opacity': 0, 'border-width': 1, 'border-color': CM.accent2, 'border-style': 'dashed', 'label': 'data(label)', 'text-valign': 'top', 'color': CM.accent2, 'font-family': 'monospace', 'font-size': 10 } },
    { selector: '.k8snode', style: { 'background-color': CM.bg3, 'border-width': 1, 'border-color': CM.accent, 'shape': 'round-rectangle', 'label': 'data(label)', 'text-valign': 'top', 'color': CM.accent, 'font-family': 'monospace', 'font-size': 11, 'padding': 16 } },
    { selector: '.k8snode.notready', style: { 'border-color': CM.error, 'color': CM.error } },
    { selector: '.pod', style: { 'background-color': CM.border, 'border-width': 1, 'border-color': CM.fgMuted, 'shape': 'round-rectangle', 'label': 'data(label)', 'color': CM.fg, 'font-family': 'monospace', 'font-size': 10, 'width': 86, 'height': 28, 'text-valign': 'center' } },
    { selector: '.pod.running', style: { 'border-color': CM.success } },
    { selector: '.pod.crashloopbackoff', style: { 'border-color': CM.error, 'background-color': CM.errorSoft } },
    { selector: '.pod.pending', style: { 'border-color': CM.warn } },
    { selector: '.pod.failed', style: { 'border-color': CM.error } },
  ],
  layout: { name: 'grid', rows: Math.max(1, Math.ceil(Math.sqrt(data.nodes.length))) },
  wheelSensitivity: 0.2,
});
cy.fit(undefined, 24);
`;
  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.cytoscape],
    jsonPayloads: { 'k8s-data': params },
    inlineScripts: [script],
  });
}

export const K8S_CLUSTER_TOPOLOGY_TEMPLATE: ComposeAppTemplate = {
  slug: 'k8s-cluster-topology',
  title: 'Kubernetes cluster topology',
  description:
    'Render a Kubernetes cluster topology grouped by node, with pod nodes colored by phase (Running / Pending / CrashLoopBackOff / Succeeded / Failed). Use when the user asks to visualize a cluster, see pod placement, or audit node health. Supply namespaces[], nodes[], pods[].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.cytoscape],
  exampleParams,
};
