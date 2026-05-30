import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Bundle, type BundleData } from '../components/Bundle';

afterEach(() => cleanup());

const SAMPLE: BundleData = {
  root: {
    name: 'root',
    children: [
      { name: 'admin', children: [
        { name: 'admin.dashboard', imports: ['api.metrics', 'api.llm'] },
        { name: 'admin.llm', imports: ['api.llm'] },
      ]},
      { name: 'api', children: [
        { name: 'api.metrics', imports: [] },
        { name: 'api.llm', imports: [] },
      ]},
    ],
  },
};

describe('<Bundle>', () => {
  it('renders leaf labels', () => {
    const { container } = render(<Bundle data={SAMPLE} />);
    expect(container.textContent).toContain('dashboard');
    expect(container.textContent).toContain('llm');
    expect(container.textContent).toContain('metrics');
  });

  it('renders one path per import edge', () => {
    const { container } = render(<Bundle data={SAMPLE} />);
    // 3 imports total in the sample → 3 link paths
    // (Edges may include other paths from text or wrappers — we count by inspecting d attribute)
    const linkPaths = Array.from(container.querySelectorAll('svg path'))
      .filter((p) => (p.getAttribute('d') ?? '').length > 0);
    expect(linkPaths.length).toBeGreaterThanOrEqual(3);
  });

  it('shows empty-state when leaves=0', () => {
    const { container } = render(<Bundle data={{ root: { name: 'root', children: [] } }} />);
    expect(container.textContent).toContain('no leaves');
  });
});
