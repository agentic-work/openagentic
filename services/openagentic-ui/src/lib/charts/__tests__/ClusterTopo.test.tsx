import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClusterTopo, type ClusterTopoData } from '../components/ClusterTopo';

afterEach(() => cleanup());

const SAMPLE: ClusterTopoData = {
  tiers: ['core', 'data', 'mcp'],
  tierLabels: { core: 'Core', data: 'Data', mcp: 'MCP' },
  nodes: [
    { id: 'api',   label: 'openagentic-api', tier: 'core', status: 'ok',   replicas: { ready: 2, desired: 2 }, tag: 'v0.7.1' },
    { id: 'wf',    label: 'workflows',       tier: 'core', status: 'ok',   replicas: { ready: 1, desired: 1 } },
    { id: 'pg',    label: 'postgres',        tier: 'data', status: 'ok',   replicas: { ready: 1, desired: 1 } },
    { id: 'milv',  label: 'milvus',          tier: 'data', status: 'warn', replicas: { ready: 0, desired: 1 } },
    { id: 'azure', label: 'oap-azure-mcp',   tier: 'mcp',  status: 'ok',   replicas: { ready: 1, desired: 1 } },
    { id: 'aws',   label: 'oap-aws-mcp',     tier: 'mcp',  status: 'err',  replicas: { ready: 0, desired: 2 } },
  ],
  links: [
    { source: 'api', target: 'pg' },
    { source: 'api', target: 'milv' },
    { source: 'api', target: 'azure' },
    { source: 'api', target: 'aws' },
    { source: 'wf', target: 'pg' },
  ],
};

describe('<ClusterTopo>', () => {
  it('renders a circle per node and one path per link', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    // Each node is 2 circles (halo + main); 6 nodes × 2 = 12
    const circles = container.querySelectorAll('svg circle');
    expect(circles.length).toBe(SAMPLE.nodes.length * 2);
    // Links are <path d="M...C..."> — exactly one per link
    const linkPaths = container.querySelectorAll('svg path[d^="M"]');
    expect(linkPaths.length).toBe(SAMPLE.links.length);
  });

  it('renders tier-column labels', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    expect(container.textContent).toContain('Core');
    expect(container.textContent).toContain('Data');
    expect(container.textContent).toContain('MCP');
  });

  it('shows empty-state when no nodes', () => {
    const { container } = render(
      <ClusterTopo data={{ tiers: [], nodes: [], links: [] }} />,
    );
    expect(container.textContent).toContain('no services');
  });

  it('clicking a node opens the side panel with its details', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    // Each node group renders a circle in the SVG; clicking the parent <g> selects it
    const groups = container.querySelectorAll('svg g[opacity]');
    // Find the node group whose text contains 'openagentic-api'
    let target: Element | null = null;
    for (const g of Array.from(groups)) {
      if (g.textContent?.includes('openagentic-api')) { target = g; break; }
    }
    expect(target).not.toBeNull();
    fireEvent.click(target!);
    // Side panel should show the label + tier + replicas tag
    expect(container.textContent).toContain('openagentic-api');
    expect(container.textContent).toContain('v0.7.1');
    expect(container.textContent).toContain('replicas');
  });

  it('clicking a tier column header filters by tier', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    // Each tier label is in a <text>; the click target is the invisible <rect> above it
    const tierRects = container.querySelectorAll('svg g rect[fill="transparent"]');
    expect(tierRects.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(tierRects[0]); // click "Core" header
    // Selection set: only the side panel doesn't appear (tier filter, not node select).
    // But all non-core nodes should be dimmed (opacity < 1).
    const nodeGroups = Array.from(container.querySelectorAll('svg g[opacity]'));
    const dimmedNodeCount = nodeGroups.filter((g) => parseFloat(g.getAttribute('opacity') ?? '1') < 1).length;
    expect(dimmedNodeCount).toBeGreaterThan(0);
  });
});
