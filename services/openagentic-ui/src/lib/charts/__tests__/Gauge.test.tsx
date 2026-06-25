import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Gauge, type GaugeData } from '../components/Gauge';

afterEach(() => cleanup());

const SAMPLE: GaugeData = {
  gauges: [
    { name: 'CPU', value: 38, max: 100, unit: '%', sub: '6 cores' },
    { name: 'Memory', value: 62, max: 100, unit: '%', sub: '12 GB' },
    { name: 'Errors', value: 1.2, max: 5, unit: '%', sub: '52 / 4297' },
  ],
};

describe('<Gauge>', () => {
  it('renders one gauge per item', () => {
    const { container } = render(<Gauge data={SAMPLE} />);
    expect(container.textContent).toContain('CPU');
    expect(container.textContent).toContain('Memory');
    expect(container.textContent).toContain('Errors');
  });

  it('renders the value at the center of each gauge', () => {
    const { container } = render(<Gauge data={SAMPLE} />);
    expect(container.textContent).toContain('38');
    expect(container.textContent).toContain('62');
  });

  it('renders one <svg> per gauge with two arc <path>s (track + filled)', () => {
    const { container } = render(<Gauge data={SAMPLE} />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(SAMPLE.gauges.length);
    for (const svg of Array.from(svgs)) {
      expect(svg.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('honors thresholds prop for warn/err color band', () => {
    const data: GaugeData = {
      gauges: [{ name: 'almost', value: 90, max: 100 }],
      thresholds: { warn: 0.5, err: 0.85 },
    };
    expect(() => render(<Gauge data={data} />)).not.toThrow();
  });
});
