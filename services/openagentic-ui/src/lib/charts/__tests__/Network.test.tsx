import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Network, type NetworkData } from '../components/Network';

afterEach(() => cleanup());

const SAMPLE: NetworkData = {
  nodes: [
    { id: 'ui', name: 'ui', kind: 'frontend', size: 18 },
    { id: 'api', name: 'api', kind: 'api', size: 26 },
    { id: 'pg', name: 'Postgres', kind: 'datastore', size: 16 },
  ],
  links: [
    { source: 'ui', target: 'api', value: 18 },
    { source: 'api', target: 'pg', value: 22 },
  ],
};

describe('<Network>', () => {
  it('renders an SVG with one <g class="node"> per node', () => {
    const { container } = render(<Network data={SAMPLE} />);
    const nodeGroups = container.querySelectorAll('svg g.node');
    expect(nodeGroups.length).toBe(SAMPLE.nodes.length);
  });

  it('renders one <line> per link', () => {
    const { container } = render(<Network data={SAMPLE} />);
    const lines = container.querySelectorAll('svg line');
    expect(lines.length).toBe(SAMPLE.links.length);
  });

  it('uses theme palette color per kind', () => {
    const { container } = render(<Network data={SAMPLE} />);
    const circles = container.querySelectorAll('svg g.node circle');
    expect(circles.length).toBe(SAMPLE.nodes.length);
    // Each circle should have a fill set
    Array.from(circles).forEach((c) => {
      expect(c.getAttribute('fill')).toBeTruthy();
    });
  });

  it('honors colorByKind override', () => {
    const { container } = render(
      <Network data={{ ...SAMPLE, colorByKind: { api: '#deadbe' } }} />,
    );
    const apiCircle = Array.from(container.querySelectorAll('svg g.node')).find(
      (g) => g.textContent?.includes('api'),
    )?.querySelector('circle');
    expect(apiCircle?.getAttribute('fill')).toBe('#deadbe');
  });

  it('renders empty-state when nodes=[]', () => {
    const { container } = render(<Network data={{ nodes: [], links: [] }} />);
    expect(container.textContent).toContain('no nodes');
  });
});
