/**
 * Phase A2 — SankeyRenderer (compose_visual:sankey template).
 *
 * Anchors lifted from mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.html:
 *   <div class="cm-sankey">
 *     <svg class="cm-sankey-svg" viewBox="0 0 800 380">
 *       <rect class="cm-sankey-node" .../>
 *       <text class="cm-sankey-label">{label}</text>
 *       <text class="cm-sankey-sub">{sub}</text>
 *       <path class="cm-sankey-flow" d="..." />
 *       <text class="cm-sankey-legend">{legend}</text>
 *     </svg>
 *   </div>
 *
 * Layout: three columns (left subjects → middle groups → right aggregates),
 * sized by `value`. Theme tokens drive all colors (`--accent`, `--cm-ok`,
 * `--cm-warn`, `--cm-err`, `--cm-info`, `--cm-fg-*`).
 *
 * Plan: docs/superpowers/plans/2026-05-11-chatmode-five-layer-remediation.md
 *       §Phase 2.2.3 — A2 UI render pipeline.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FrameRendererRegistry } from '../FrameRendererRegistry';
import { SankeyRenderer } from '../templates/SankeyRenderer';

const payload = {
  title: 'subs → resource groups → resource counts',
  columns: [
    {
      id: 'left',
      label: 'Subscription',
      nodes: [
        { id: 'agentic-prod', label: 'agentic-prod', sub: '39 resources · 4 RGs', value: 39, tone: 'ok' as const },
        { id: 'agentic-staging', label: 'agentic-staging', sub: '6 resources · 3 RGs', value: 6, tone: 'a' as const },
        { id: 'your-deployment-customer-east', label: 'your-deployment-customer-east', sub: '22 resources · 5 RGs', value: 22, tone: 'warn' as const },
      ],
    },
    {
      id: 'middle',
      label: 'Resource Group',
      nodes: [
        { id: 'prod-west-rg', label: 'prod-west-rg', value: 18, tone: 'ok' as const },
        { id: 'prod-east-rg', label: 'prod-east-rg', value: 11, tone: 'ok' as const },
        { id: 'stg-app-rg', label: 'stg-app-rg', value: 3, tone: 'a' as const },
        { id: 'your-deployment-prod-rg', label: 'your-deployment-prod-rg', value: 9, tone: 'warn' as const },
      ],
    },
    {
      id: 'right',
      label: 'Resource Type',
      nodes: [
        { id: 'aks', label: 'aks', sub: '14 clusters', value: 14, tone: 'info' as const },
        { id: 'storage', label: 'storage / sql', sub: '12 accts', value: 12, tone: 'info' as const },
        { id: 'network', label: 'network', sub: '9 (vnets+fd+gw)', value: 9, tone: 'info' as const },
      ],
    },
  ],
  flows: [
    { from: 'agentic-prod', to: 'prod-west-rg', value: 18, tone: 'ok' as const },
    { from: 'agentic-prod', to: 'prod-east-rg', value: 11, tone: 'ok' as const },
    { from: 'agentic-staging', to: 'stg-app-rg', value: 3, tone: 'a' as const },
    { from: 'your-deployment-customer-east', to: 'your-deployment-prod-rg', value: 9, tone: 'warn' as const },
    { from: 'prod-west-rg', to: 'aks', value: 8, tone: 'ok' as const },
    { from: 'prod-east-rg', to: 'storage', value: 5, tone: 'ok' as const },
    { from: 'your-deployment-prod-rg', to: 'network', value: 4, tone: 'warn' as const },
  ],
};

describe('SankeyRenderer', () => {
  it('registry maps "sankey" slug to a non-null component', () => {
    const C = FrameRendererRegistry.lookup('sankey');
    expect(C).toBe(SankeyRenderer);
    expect(FrameRendererRegistry.has('sankey')).toBe(true);
  });

  it('renders cm-sankey root + cm-sankey-svg with viewBox', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const root = container.querySelector('.cm-sankey');
    expect(root).not.toBeNull();
    const svg = root?.querySelector('svg.cm-sankey-svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
  });

  it('renders one cm-sankey-node rect per node across all columns', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const nodes = container.querySelectorAll('rect.cm-sankey-node');
    // 3 + 4 + 3 = 10 nodes total
    expect(nodes.length).toBe(10);
  });

  it('renders cm-sankey-label text for each node label', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const labels = Array.from(container.querySelectorAll('text.cm-sankey-label')).map(
      (n) => n.textContent,
    );
    expect(labels).toContain('agentic-prod');
    expect(labels).toContain('prod-west-rg');
    expect(labels).toContain('aks');
  });

  it('renders cm-sankey-flow path per flow', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const flows = container.querySelectorAll('path.cm-sankey-flow');
    expect(flows.length).toBe(payload.flows.length);
  });

  it('exposes role=img + aria-label using title', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const svg = container.querySelector('.cm-sankey-svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toContain('subs → resource groups');
  });

  it('renders nothing when columns/flows are empty', () => {
    const { container } = render(
      <SankeyRenderer title="empty" columns={[]} flows={[]} />,
    );
    expect(container.querySelector('.cm-sankey')).toBeNull();
  });

  it('renders column legend labels', () => {
    const { container } = render(<SankeyRenderer {...payload} />);
    const legend = Array.from(container.querySelectorAll('text.cm-sankey-legend')).map(
      (n) => n.textContent,
    );
    expect(legend).toContain('Subscription');
    expect(legend).toContain('Resource Group');
    expect(legend).toContain('Resource Type');
  });
});
