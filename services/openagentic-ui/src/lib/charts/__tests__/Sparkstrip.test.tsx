import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Sparkstrip, type SparkstripData } from '../components/Sparkstrip';

afterEach(() => cleanup());

const SAMPLE: SparkstripData = {
  kpis: [
    { name: 'p50 TTFT', unit: 'ms', cur: 384, delta: -6.2, good: 'down', trend: [400, 395, 390, 388, 386, 384] },
    { name: 'requests', unit: '/min', cur: 142, delta: 11.0, good: 'up', trend: [100, 110, 120, 130, 140, 142] },
    { name: 'errors', unit: '%', cur: 1.2, delta: -0.4, good: 'down', trend: [2, 1.8, 1.5, 1.3, 1.2] },
  ],
};

describe('<Sparkstrip>', () => {
  it('renders one card per KPI', () => {
    const { container } = render(<Sparkstrip data={SAMPLE} />);
    expect(container.textContent).toContain('p50 TTFT');
    expect(container.textContent).toContain('requests');
    expect(container.textContent).toContain('errors');
  });

  it('renders the current value with unit', () => {
    const { container } = render(<Sparkstrip data={SAMPLE} />);
    expect(container.textContent).toContain('384');
    expect(container.textContent).toContain('ms');
  });

  it('renders delta arrow + percent', () => {
    const { container } = render(<Sparkstrip data={SAMPLE} />);
    expect(container.textContent).toContain('↓ 6.2%');
    expect(container.textContent).toContain('↑ 11.0%');
  });

  it('renders one <svg> sparkline per KPI', () => {
    const { container } = render(<Sparkstrip data={SAMPLE} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(SAMPLE.kpis.length);
  });
});
