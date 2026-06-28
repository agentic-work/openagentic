import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DependencyGraphRenderer } from '../DependencyGraphRenderer';

const example = {
  title: 'api deps',
  nodes: [
    { id: 'api', label: 'api', group: 'core', size: 28 },
    { id: 'ui', label: 'ui', group: 'frontend', size: 18 },
    { id: 'pg', label: 'postgres', group: 'data', size: 20 },
    { id: 'redis', label: 'redis', group: 'data', size: 16 },
  ],
  edges: [
    { from: 'ui', to: 'api', weight: 3 },
    { from: 'api', to: 'pg', weight: 4 },
    { from: 'api', to: 'redis', weight: 2 },
  ],
};

describe('DependencyGraphRenderer', () => {
  it('renders nodes and edges', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<DependencyGraphRenderer {...example} />);
    expect(container.querySelector('[data-testid="dependency-graph-renderer"]')).not.toBeNull();
    expect(container.querySelectorAll('g[data-node-id]').length).toBe(example.nodes.length);
    expect(container.querySelectorAll('path[data-from]').length).toBe(example.edges.length);
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('placeholder when empty', () => {
    const { container } = render(<DependencyGraphRenderer />);
    expect(container.textContent).toMatch(/no graph data/);
  });
});
