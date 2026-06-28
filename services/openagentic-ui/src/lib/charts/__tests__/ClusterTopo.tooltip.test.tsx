/**
 * ClusterTopo already has click-to-drill side panel; tests here add a
 * quick hover tooltip showing status + replicas without requiring a click.
 *
 * Real-data shape: matches /api/cluster/services payload (status,
 * replicas {ready, desired}, tag, image).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClusterTopo, type ClusterTopoData } from '../components/ClusterTopo';

afterEach(() => cleanup());

const SAMPLE: ClusterTopoData = {
  tiers: ['core', 'data', 'mcp'],
  tierLabels: { core: 'Core', data: 'Data', mcp: 'MCP' },
  nodes: [
    { id: 'api', label: 'openagentic-api', tier: 'core', status: 'ok', replicas: { ready: 2, desired: 2 }, tag: 'v0.7.1' },
    { id: 'pg',  label: 'postgres',        tier: 'data', status: 'ok', replicas: { ready: 1, desired: 1 } },
    { id: 'aws', label: 'oap-aws-mcp',     tier: 'mcp',  status: 'err', replicas: { ready: 0, desired: 2 } },
  ],
  links: [
    { source: 'api', target: 'pg' },
    { source: 'api', target: 'aws' },
  ],
};

describe('<ClusterTopo> hover tooltip', () => {
  it('shows no tooltip before mouseover', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  // Helper: find the LEAF node-group that has the cursor:pointer style
  // (the actual mouse-enter target inside ClusterTopo) AND contains the
  // node's label text. Walks the smallest-matching match, not the outer
  // container that swallows every leaf's text.
  function findNodeGroup(container: HTMLElement, label: string): SVGGElement {
    const groups = Array.from(container.querySelectorAll<SVGGElement>('svg g'))
      .filter((g) => g.textContent === label || g.querySelector('text')?.textContent === label);
    // smallest one (fewest descendants) — that's the leaf node wrapper
    return groups.reduce((best, g) =>
      g.children.length < best.children.length ? g : best, groups[0])!;
  }

  it('shows tooltip on node hover with node label + status + replicas', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    const apiGroup = findNodeGroup(container, 'openagentic-api');
    expect(apiGroup).not.toBeUndefined();
    fireEvent.mouseEnter(apiGroup, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(apiGroup, { clientX: 200, clientY: 100 });
    const tip = container.querySelector('[role="tooltip"]');
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('openagentic-api');
    expect(tip!.textContent).toContain('ok');
    expect(tip!.textContent).toContain('2');
  });

  it('tooltip disappears on mouseleave', () => {
    const { container } = render(<ClusterTopo data={SAMPLE} />);
    const apiGroup = findNodeGroup(container, 'openagentic-api');
    fireEvent.mouseEnter(apiGroup, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(apiGroup, { clientX: 200, clientY: 100 });
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    fireEvent.mouseLeave(apiGroup);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });
});
