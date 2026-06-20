/**
 * aws-cloud-architecture — AWS architecture diagram with VPCs, subnets,
 * services, and edges. Renders via d3 force-layout grouped by VPC.
 *
 * the design notes
 *       (mock 06: aws-k8s-aiops uses this for the EKS topology context)
 *
 * Visual reference: mocks/Diagrams/2026-04-23-multicloud-arch-mock-1.html
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const ServiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum([
    'ec2',
    'rds',
    'eks',
    'lambda',
    'alb',
    'sqs',
    's3',
    'cloudfront',
    'route53',
    'dynamodb',
    'other',
  ]),
  subnetId: z.string().optional(),
  vpcId: z.string(),
  region: z.string().optional(),
});

const SubnetSchema = z.object({
  id: z.string(),
  label: z.string(),
  vpcId: z.string(),
  visibility: z.enum(['public', 'private']),
});

const VpcSchema = z.object({
  id: z.string(),
  label: z.string(),
  cidr: z.string().optional(),
  region: z.string().optional(),
});

const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  vpcs: z.array(VpcSchema).min(1),
  subnets: z.array(SubnetSchema),
  services: z.array(ServiceSchema).min(1),
  edges: z.array(EdgeSchema).default([]),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'prod-us-east-1 architecture',
  vpcs: [
    { id: 'vpc-prod', label: 'prod-vpc (us-east-1)', cidr: '10.0.0.0/16' },
    { id: 'vpc-data', label: 'data-vpc (us-east-1)', cidr: '10.1.0.0/16' },
  ],
  subnets: [
    { id: 'sn-pub-a', label: 'pub-a 10.0.1.0/24', vpcId: 'vpc-prod', visibility: 'public' },
    { id: 'sn-pri-a', label: 'pri-a 10.0.2.0/24', vpcId: 'vpc-prod', visibility: 'private' },
    { id: 'sn-data-a', label: 'data-a 10.1.1.0/24', vpcId: 'vpc-data', visibility: 'private' },
  ],
  services: [
    { id: 'cf', label: 'CloudFront', kind: 'cloudfront', vpcId: 'vpc-prod' },
    { id: 'alb', label: 'ALB', kind: 'alb', vpcId: 'vpc-prod', subnetId: 'sn-pub-a' },
    { id: 'eks', label: 'EKS prod', kind: 'eks', vpcId: 'vpc-prod', subnetId: 'sn-pri-a' },
    { id: 'rds', label: 'RDS Postgres', kind: 'rds', vpcId: 'vpc-data', subnetId: 'sn-data-a' },
    { id: 's3', label: 'S3 logs', kind: 's3', vpcId: 'vpc-data' },
  ],
  edges: [
    { from: 'cf', to: 'alb', label: 'https' },
    { from: 'alb', to: 'eks', label: 'http' },
    { from: 'eks', to: 'rds', label: '5432/tcp' },
    { from: 'eks', to: 's3', label: 'PUT logs' },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.aws-wrap { display: grid; grid-template-columns: 1fr; gap: 8px; }
.aws-svg { width: 100%; height: 520px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.aws-vpc { fill: color-mix(in srgb, var(--cm-accent) 4%, transparent); stroke: var(--cm-accent); stroke-dasharray: 6 4; stroke-opacity: 0.5; }
.aws-vpc-label { fill: var(--cm-accent); font-family: var(--cm-mono); font-size: 11px; }
.aws-subnet { fill: color-mix(in srgb, var(--cm-accent-2) 4%, transparent); stroke: var(--cm-accent-2); stroke-opacity: 0.4; stroke-dasharray: 3 3; }
.aws-subnet-label { fill: var(--cm-accent-2); font-family: var(--cm-mono); font-size: 10px; }
.aws-svc { fill: var(--cm-bg-3); stroke: var(--cm-border); }
.aws-svc-label { fill: var(--cm-fg); font-size: 11px; font-family: var(--cm-mono); pointer-events: none; }
.aws-svc-kind { fill: var(--cm-fg-dim); font-size: 9px; font-family: var(--cm-mono); pointer-events: none; }
.aws-edge { stroke: var(--cm-fg-muted); stroke-opacity: 0.6; fill: none; }
.aws-edge-label { fill: var(--cm-fg-dim); font-size: 9px; font-family: var(--cm-mono); }
`;
  const body = `
<div class="viz-head"><span class="viz-title">${params.title}</span><span class="cm-tag info">aws-cloud-architecture</span></div>
<div class="aws-wrap"><svg class="aws-svg" id="aws-svg"></svg></div>`;

  const script = `
const data = JSON.parse(document.getElementById('aws-data').textContent);
const svg = d3.select('#aws-svg');
const w = svg.node().clientWidth || 900;
const h = 520;
svg.attr('viewBox', '0 0 ' + w + ' ' + h);

// Lay out VPCs as horizontal bands.
const vpcCount = data.vpcs.length;
const padding = 24;
const vpcWidth = (w - padding * 2);
const vpcHeight = (h - padding * 2 - (vpcCount - 1) * 12) / vpcCount;
const vpcRects = data.vpcs.map(function (v, i) {
  return {
    id: v.id,
    label: v.label,
    cidr: v.cidr || '',
    x: padding,
    y: padding + i * (vpcHeight + 12),
    w: vpcWidth,
    h: vpcHeight,
  };
});

// Inside each VPC, lay out subnets as columns.
const subnetMap = {};
vpcRects.forEach(function (vpc) {
  const subs = data.subnets.filter(function (s) { return s.vpcId === vpc.id; });
  const subPad = 16;
  const subW = (subs.length > 0)
    ? (vpc.w - subPad * 2 - (subs.length - 1) * 12) / Math.max(subs.length, 1)
    : 0;
  subs.forEach(function (s, i) {
    subnetMap[s.id] = {
      id: s.id,
      label: s.label,
      visibility: s.visibility,
      x: vpc.x + subPad + i * (subW + 12),
      y: vpc.y + 28,
      w: subW,
      h: vpc.h - 44,
    };
  });
});

// Inside each subnet (or VPC if no subnet), lay out services as rounded rects.
const serviceCoords = {};
const svcByContainer = {};
data.services.forEach(function (svc) {
  const key = svc.subnetId || svc.vpcId;
  (svcByContainer[key] = svcByContainer[key] || []).push(svc);
});
Object.keys(svcByContainer).forEach(function (containerId) {
  const items = svcByContainer[containerId];
  const cont = subnetMap[containerId] || vpcRects.find(function (v) { return v.id === containerId; });
  if (!cont) return;
  const cols = Math.min(items.length, 4);
  const rowGap = 18;
  const colGap = 18;
  const itemW = 120;
  const itemH = 40;
  items.forEach(function (svc, i) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const totalW = cols * itemW + (cols - 1) * colGap;
    const offsetX = cont.x + (cont.w - totalW) / 2;
    const offsetY = cont.y + 24 + row * (itemH + rowGap);
    serviceCoords[svc.id] = {
      x: offsetX + col * (itemW + colGap),
      y: offsetY,
      w: itemW,
      h: itemH,
      label: svc.label,
      kind: svc.kind,
    };
  });
});

// VPC bands.
const vpcG = svg.selectAll('.aws-vpc-g').data(vpcRects).enter().append('g').attr('class', 'aws-vpc-g');
vpcG.append('rect').attr('class', 'aws-vpc').attr('x', function (d) { return d.x; }).attr('y', function (d) { return d.y; }).attr('width', function (d) { return d.w; }).attr('height', function (d) { return d.h; }).attr('rx', 12);
vpcG.append('text').attr('class', 'aws-vpc-label').attr('x', function (d) { return d.x + 12; }).attr('y', function (d) { return d.y + 18; }).text(function (d) { return d.label + (d.cidr ? '  ' + d.cidr : ''); });

// Subnets.
const subnetG = svg.selectAll('.aws-subnet-g').data(Object.values(subnetMap)).enter().append('g').attr('class', 'aws-subnet-g');
subnetG.append('rect').attr('class', 'aws-subnet').attr('x', function (d) { return d.x; }).attr('y', function (d) { return d.y; }).attr('width', function (d) { return d.w; }).attr('height', function (d) { return d.h; }).attr('rx', 8);
subnetG.append('text').attr('class', 'aws-subnet-label').attr('x', function (d) { return d.x + 8; }).attr('y', function (d) { return d.y + 14; }).text(function (d) { return d.label + ' (' + d.visibility + ')'; });

// Edges (drawn before services so the rects sit on top).
const edgesG = svg.append('g').attr('class', 'aws-edges');
data.edges.forEach(function (e) {
  const a = serviceCoords[e.from];
  const b = serviceCoords[e.to];
  if (!a || !b) return;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  edgesG.append('path').attr('class', 'aws-edge').attr('d', 'M ' + ax + ' ' + ay + ' Q ' + mx + ' ' + (my - 30) + ' ' + bx + ' ' + by);
  if (e.label) {
    edgesG.append('text').attr('class', 'aws-edge-label').attr('x', mx).attr('y', my - 32).attr('text-anchor', 'middle').text(e.label);
  }
});

// Services.
const svcG = svg.selectAll('.aws-svc-g').data(Object.entries(serviceCoords)).enter().append('g').attr('class', 'aws-svc-g').attr('transform', function (d) { return 'translate(' + d[1].x + ',' + d[1].y + ')'; });
svcG.append('rect').attr('class', 'aws-svc').attr('width', function (d) { return d[1].w; }).attr('height', function (d) { return d[1].h; }).attr('rx', 6);
svcG.append('text').attr('class', 'aws-svc-label').attr('x', function (d) { return d[1].w / 2; }).attr('y', 17).attr('text-anchor', 'middle').text(function (d) { return d[1].label; });
svcG.append('text').attr('class', 'aws-svc-kind').attr('x', function (d) { return d[1].w / 2; }).attr('y', 30).attr('text-anchor', 'middle').text(function (d) { return d[1].kind; });
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.d3],
    jsonPayloads: { 'aws-data': params },
    inlineScripts: [script],
  });
}

export const AWS_CLOUD_ARCHITECTURE_TEMPLATE: ComposeAppTemplate = {
  slug: 'aws-cloud-architecture',
  title: 'AWS cloud architecture',
  description:
    'Render an AWS architecture diagram (VPCs, subnets, services, edges). Use when the user asks for a cloud topology / architecture diagram of AWS resources. Supply vpcs[], subnets[], services[] (kind in ec2/rds/eks/lambda/alb/sqs/s3/cloudfront/route53/dynamodb/other), and edges[].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.d3],
  exampleParams,
};
