import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Area, type AreaData } from '../components/Area';

afterEach(() => cleanup());

const now = new Date('2026-05-13T12:00:00Z');
function gen(n: number, base: number) {
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(+now + i * 60 * 60_000),
    v: base + Math.sin(i / 3) * (base * 0.2),
  }));
}

const SAMPLE: AreaData = {
  series: [
    { name: 'OpenAI', data: gen(24, 12000) },
    { name: 'Anthropic', data: gen(24, 8000) },
    { name: 'Bedrock', data: gen(24, 3000) },
  ],
};

describe('<Area>', () => {
  it('stacked mode renders one <path> per series', () => {
    const { container } = render(<Area data={SAMPLE} />);
    const paths = container.querySelectorAll('path[fill-opacity="0.7"]');
    expect(paths.length).toBe(3);
  });

  it('overlay mode renders one <path> per series with translucent fill', () => {
    const { container } = render(<Area data={{ ...SAMPLE, mode: 'overlay' }} />);
    const paths = container.querySelectorAll('path[fill-opacity="0.35"]');
    expect(paths.length).toBe(3);
  });

  it('renders empty-state when there is no data', () => {
    const { container } = render(<Area data={{ series: [] }} />);
    expect(container.textContent).toContain('no time-series data');
  });

  it('accepts ISO/string timestamps via normalization', () => {
    const strSeries: AreaData = {
      series: [{
        name: 'X',
        data: [
          { t: '2026-05-13T10:00:00Z', v: 100 },
          { t: '2026-05-13T11:00:00Z', v: 200 },
        ],
      }],
    };
    expect(() => render(<Area data={strSeries} />)).not.toThrow();
  });

  it('honors per-series color override', () => {
    const colored: AreaData = {
      series: [{ name: 'X', color: '#ff00aa', data: gen(5, 100) }],
    };
    const { container } = render(<Area data={colored} />);
    const path = container.querySelector('path[fill-opacity="0.7"]');
    expect(path?.getAttribute('fill')).toBe('#ff00aa');
  });
});
