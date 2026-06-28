import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { AwChartRenderer } from '../AwChartRenderer';

afterEach(() => cleanup());

const SANKEY_PAYLOAD = {
  template: 'sankey',
  data: {
    nodes: [
      { id: 'a', label: 'A', kind: 'source' as const },
      { id: 'b', label: 'B', kind: 'sink' as const },
    ],
    links: [{ source: 'a', target: 'b', value: 100 }],
  },
};

describe('<AwChartRenderer>', () => {
  it('renders the inner chart when structuredContent.template is sankey', () => {
    const { container } = render(<AwChartRenderer structuredContent={SANKEY_PAYLOAD} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(container.querySelectorAll('linearGradient').length).toBeGreaterThan(0);
  });

  it('unwraps `structuredContent.props` envelope if present (legacy nesting)', () => {
    const { container } = render(<AwChartRenderer structuredContent={{ props: SANKEY_PAYLOAD }} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('accepts flat props (admin-side callers)', () => {
    const { container } = render(
      <AwChartRenderer template="sankey" data={SANKEY_PAYLOAD.data} />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows error when template is missing', () => {
    const { container } = render(<AwChartRenderer structuredContent={{}} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('missing `template`');
  });

  it('renders UnknownTemplateError for unknown template (no crash)', () => {
    const { container } = render(
      <AwChartRenderer structuredContent={{ template: 'flying_carpet', data: {} }} />,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('flying_carpet');
  });
});
