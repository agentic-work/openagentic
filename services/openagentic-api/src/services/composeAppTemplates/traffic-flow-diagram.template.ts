/**
 * traffic-flow-diagram — Front Door → AppGW → backend pools, with annotations
 * (rps, p50/p99, listeners, health) + WAF rule side panel.
 *
 * Spec: docs/superpowers/specs/2026-05-03-chatmode-end-state-design.md
 *       (mock 03: frontdoor-appgw-interrogation)
 */

import { z } from 'zod';
import type { ComposeAppTemplate } from '../composeAppTemplates.js';
import { buildHtml, CDN_LIB } from './_shared.js';

const PoolMemberSchema = z.object({
  id: z.string(),
  label: z.string(),
  health: z.enum(['green', 'yellow', 'red']).default('green'),
});

const BackendPoolSchema = z.object({
  id: z.string(),
  label: z.string(),
  members: z.array(PoolMemberSchema).min(1),
});

const ListenerSchema = z.object({
  id: z.string(),
  label: z.string(),
  port: z.number().int().positive(),
  protocol: z.enum(['http', 'https', 'tcp']).default('https'),
  certExpiresAt: z.string().optional(),
});

const AppGwSchema = z.object({
  id: z.string(),
  label: z.string(),
  listeners: z.array(ListenerSchema).min(1),
  backendPoolIds: z.array(z.string()).min(1),
});

const FrontDoorSchema = z.object({
  id: z.string(),
  label: z.string(),
  rpsP50: z.number().nonnegative().optional(),
  latencyP50Ms: z.number().nonnegative().optional(),
  latencyP99Ms: z.number().nonnegative().optional(),
});

const WafRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  ruleSet: z.enum(['custom', 'managed']),
  action: z.enum(['allow', 'block', 'log']),
  enabled: z.boolean(),
});

const ParamsSchema = z.object({
  title: z.string().min(1),
  frontDoor: FrontDoorSchema,
  appGws: z.array(AppGwSchema).min(1),
  backendPools: z.array(BackendPoolSchema).min(1),
  wafRules: z.array(WafRuleSchema).default([]),
});

type Params = z.infer<typeof ParamsSchema>;

const exampleParams: Params = {
  title: 'prod tenant — Front Door + App Gateway',
  frontDoor: { id: 'fd-prod', label: 'fd-prod-global', rpsP50: 1240, latencyP50Ms: 28, latencyP99Ms: 142 },
  appGws: [
    {
      id: 'agw-east',
      label: 'agw-prod-east',
      listeners: [
        { id: 'l1', label: 'web-https', port: 443, protocol: 'https', certExpiresAt: '2026-06-12' },
        { id: 'l2', label: 'api-https', port: 443, protocol: 'https', certExpiresAt: '2026-05-20' },
      ],
      backendPoolIds: ['pool-web', 'pool-api'],
    },
    {
      id: 'agw-west',
      label: 'agw-prod-west',
      listeners: [
        { id: 'l3', label: 'web-https', port: 443, protocol: 'https', certExpiresAt: '2026-09-01' },
      ],
      backendPoolIds: ['pool-web'],
    },
  ],
  backendPools: [
    { id: 'pool-web', label: 'web-pool', members: [
      { id: 'web-1', label: 'web-1', health: 'green' },
      { id: 'web-2', label: 'web-2', health: 'green' },
      { id: 'web-3', label: 'web-3', health: 'yellow' },
    ] },
    { id: 'pool-api', label: 'api-pool', members: [
      { id: 'api-1', label: 'api-1', health: 'green' },
      { id: 'api-2', label: 'api-2', health: 'green' },
    ] },
  ],
  wafRules: [
    { id: 'w1', label: 'OWASP CRS 3.2', ruleSet: 'managed', action: 'block', enabled: true },
    { id: 'w2', label: 'Block known bots', ruleSet: 'managed', action: 'block', enabled: true },
    { id: 'w3', label: 'Allow internal CIDR', ruleSet: 'custom', action: 'allow', enabled: true },
    { id: 'w4', label: 'Rate-limit /login', ruleSet: 'custom', action: 'block', enabled: false },
  ],
};

function renderHtml(raw: unknown): string {
  const params = ParamsSchema.parse(raw);
  const css = `
.tfd-wrap { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
#tfd-svg { width: 100%; height: 480px; background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); }
.tfd-side { background: var(--cm-bg-2); border: 1px solid var(--cm-border); border-radius: var(--cm-radius); padding: 12px; }
.tfd-side h3 { font-size: 12px; color: var(--cm-fg-dim); margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.04em; }
.tfd-rule { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--cm-border); font-size: 12px; align-items: center; }
.tfd-rule:last-child { border-bottom: none; }
.tfd-rule-label { color: var(--cm-fg); font-family: var(--cm-mono); }
.tfd-rule-disabled { opacity: 0.4; }
.tfd-fd { fill: var(--cm-bg-3); stroke: var(--cm-accent); stroke-width: 1; }
.tfd-agw { fill: var(--cm-bg-3); stroke: var(--cm-accent-2); stroke-width: 1; }
.tfd-pool { fill: var(--cm-bg-3); stroke: var(--cm-fg-muted); stroke-width: 1; }
.tfd-member-green { fill: color-mix(in srgb, var(--cm-success) 18%, transparent); stroke: var(--cm-success); }
.tfd-member-yellow { fill: color-mix(in srgb, var(--cm-warn) 18%, transparent); stroke: var(--cm-warn); }
.tfd-member-red { fill: color-mix(in srgb, var(--cm-error) 18%, transparent); stroke: var(--cm-error); }
.tfd-label { fill: var(--cm-fg); font-size: 11px; font-family: var(--cm-mono); pointer-events: none; }
.tfd-sub { fill: var(--cm-fg-dim); font-size: 9px; font-family: var(--cm-mono); pointer-events: none; }
.tfd-edge { stroke: var(--cm-fg-muted); stroke-opacity: 0.55; fill: none; }
.tfd-edge-label { fill: var(--cm-fg-dim); font-size: 9px; font-family: var(--cm-mono); }
@media (max-width: 720px) { .tfd-wrap { grid-template-columns: 1fr; } }
`;

  const body = `
<div class="viz-head"><span class="viz-title">${esc(params.title)}</span><span class="cm-tag info">traffic-flow-diagram</span></div>
<div class="tfd-wrap">
  <svg id="tfd-svg"></svg>
  <aside class="tfd-side">
    <h3>WAF rules (${params.wafRules.length})</h3>
    ${params.wafRules.map((r) => `<div class="tfd-rule${r.enabled ? '' : ' tfd-rule-disabled'}"><span class="cm-tag ${r.action === 'block' ? 'error' : r.action === 'allow' ? 'ok' : ''}">${esc(r.action)}</span><span class="tfd-rule-label">${esc(r.label)}</span><span class="cm-tag">${esc(r.ruleSet)}</span></div>`).join('')}
  </aside>
</div>`;

  const script = `
const data = JSON.parse(document.getElementById('tfd-data').textContent);
const svg = d3.select('#tfd-svg');
const w = svg.node().clientWidth || 700;
const h = 480;
svg.attr('viewBox', '0 0 ' + w + ' ' + h);

const rowFD = 60;
const rowAGW = 200;
const rowPool = 360;

// Front Door at top center.
const fdW = 220, fdH = 56;
svg.append('rect').attr('class', 'tfd-fd').attr('x', (w - fdW) / 2).attr('y', rowFD - fdH / 2).attr('width', fdW).attr('height', fdH).attr('rx', 8);
svg.append('text').attr('class', 'tfd-label').attr('x', w / 2).attr('y', rowFD - 6).attr('text-anchor', 'middle').text(data.frontDoor.label);
const fdSub = (data.frontDoor.rpsP50 ? data.frontDoor.rpsP50 + ' rps · ' : '') + (data.frontDoor.latencyP50Ms != null ? 'p50 ' + data.frontDoor.latencyP50Ms + 'ms · p99 ' + (data.frontDoor.latencyP99Ms || '?') + 'ms' : '');
svg.append('text').attr('class', 'tfd-sub').attr('x', w / 2).attr('y', rowFD + 14).attr('text-anchor', 'middle').text(fdSub);

// App Gateways tier.
const agwW = 220, agwH = 80;
const agwGap = (w - data.appGws.length * agwW) / (data.appGws.length + 1);
const agwCenters = data.appGws.map(function (g, i) {
  const x = agwGap + i * (agwW + agwGap);
  svg.append('rect').attr('class', 'tfd-agw').attr('x', x).attr('y', rowAGW - agwH / 2).attr('width', agwW).attr('height', agwH).attr('rx', 8);
  svg.append('text').attr('class', 'tfd-label').attr('x', x + agwW / 2).attr('y', rowAGW - 24).attr('text-anchor', 'middle').text(g.label);
  svg.append('text').attr('class', 'tfd-sub').attr('x', x + agwW / 2).attr('y', rowAGW - 8).attr('text-anchor', 'middle').text(g.listeners.length + ' listeners · ' + g.backendPoolIds.length + ' pools');
  // listener pills
  g.listeners.slice(0, 3).forEach(function (l, j) {
    const lx = x + 12 + j * 64;
    svg.append('rect').attr('x', lx).attr('y', rowAGW + 6).attr('width', 60).attr('height', 18).attr('rx', 4).attr('fill', CM.bg).attr('stroke', CM.border);
    svg.append('text').attr('x', lx + 30).attr('y', rowAGW + 19).attr('text-anchor', 'middle').attr('class', 'tfd-sub').text(':' + l.port);
  });
  return { id: g.id, x: x + agwW / 2, y: rowAGW + agwH / 2, backendPoolIds: g.backendPoolIds };
});

// Pools.
const poolW = 200, poolH = 90;
const poolGap = (w - data.backendPools.length * poolW) / (data.backendPools.length + 1);
const poolCenters = data.backendPools.map(function (p, i) {
  const x = poolGap + i * (poolW + poolGap);
  svg.append('rect').attr('class', 'tfd-pool').attr('x', x).attr('y', rowPool - poolH / 2).attr('width', poolW).attr('height', poolH).attr('rx', 8);
  svg.append('text').attr('class', 'tfd-label').attr('x', x + poolW / 2).attr('y', rowPool - 24).attr('text-anchor', 'middle').text(p.label);
  // member dots
  const mPad = 14;
  const mGap = (poolW - mPad * 2) / Math.max(p.members.length, 1);
  p.members.forEach(function (m, j) {
    const mx = x + mPad + mGap * j + mGap / 2;
    svg.append('circle').attr('cx', mx).attr('cy', rowPool + 6).attr('r', 9).attr('class', 'tfd-member-' + m.health);
    svg.append('text').attr('class', 'tfd-sub').attr('x', mx).attr('y', rowPool + 28).attr('text-anchor', 'middle').text(m.label);
  });
  return { id: p.id, x: x + poolW / 2, y: rowPool - poolH / 2 };
});

// Edges FD → AGW.
agwCenters.forEach(function (a) {
  svg.append('path').attr('class', 'tfd-edge').attr('d', 'M ' + (w / 2) + ' ' + (rowFD + fdH / 2) + ' C ' + (w / 2) + ' ' + ((rowFD + rowAGW) / 2) + ' ' + a.x + ' ' + ((rowFD + rowAGW) / 2) + ' ' + a.x + ' ' + (rowAGW - 40));
});
// Edges AGW → pools.
agwCenters.forEach(function (a) {
  a.backendPoolIds.forEach(function (pid) {
    const p = poolCenters.find(function (pp) { return pp.id === pid; });
    if (!p) return;
    svg.append('path').attr('class', 'tfd-edge').attr('d', 'M ' + a.x + ' ' + a.y + ' C ' + a.x + ' ' + ((a.y + p.y) / 2) + ' ' + p.x + ' ' + ((a.y + p.y) / 2) + ' ' + p.x + ' ' + p.y);
  });
});
`;

  return buildHtml({
    title: params.title,
    css,
    bodyHtml: body,
    cdnScripts: [CDN_LIB.d3],
    jsonPayloads: { 'tfd-data': params },
    inlineScripts: [script],
  });
}

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const TRAFFIC_FLOW_DIAGRAM_TEMPLATE: ComposeAppTemplate = {
  slug: 'traffic-flow-diagram',
  title: 'Front Door → App Gateway → backend pools',
  description:
    'Render an Azure traffic flow: Front Door (top) → App Gateways (middle) → backend pools (bottom). Includes per-edge annotations, listener pills, member health dots (green/yellow/red), and a WAF rule side panel. Use when the user asks for traffic flow, listener / WAF interrogation. Supply frontDoor, appGws[], backendPools[], wafRules[].',
  paramsSchema: ParamsSchema,
  htmlTemplate: renderHtml,
  cdnLibs: [CDN_LIB.d3],
  exampleParams,
};
