import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { Line, type LineData } from '../components/Line';

afterEach(() => cleanup());

const now = new Date('2026-05-13T12:00:00Z');
function gen(n: number, base: number) {
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(+now + i * 60 * 60_000),
    v: base + Math.sin(i / 3) * (base * 0.2),
  }));
}

const SAMPLE: LineData = {
  series: [
    { name: 'OpenAI', data: gen(24, 12000) },
    { name: 'Anthropic', data: gen(24, 8000) },
  ],
  unit: ' tok/min',
};

describe('<Line>', () => {
  it('renders an SVG with one path per series', () => {
    const { container } = render(<Line data={SAMPLE} />);
    const paths = container.querySelectorAll('path[stroke-width="2"]');
    expect(paths.length).toBe(2);
  });

  it('renders empty-state when there is no data', () => {
    const { container } = render(<Line data={{ series: [] }} />);
    expect(container.textContent).toContain('no time-series data');
  });

  it('accepts ISO/string/number timestamps via normalization', () => {
    const stringSeries: LineData = {
      series: [{
        name: 'X',
        data: [
          { t: '2026-05-13T10:00:00Z', v: 100 },
          { t: '2026-05-13T11:00:00Z', v: 200 },
          { t: '2026-05-13T12:00:00Z', v: 150 },
        ],
      }],
    };
    expect(() => render(<Line data={stringSeries} />)).not.toThrow();
  });

  it('uses theme palette by index (falls back when no color override)', () => {
    const { container } = render(<Line data={SAMPLE} />);
    const paths = container.querySelectorAll('path[stroke-width="2"]');
    const strokes = Array.from(paths).map((p) => p.getAttribute('stroke'));
    expect(strokes.length).toBe(2);
    expect(strokes[0]).not.toBe(strokes[1]);
  });

  it('honors per-series color override', () => {
    const colored: LineData = {
      series: [{ name: 'X', color: '#ff00ff', data: gen(10, 100) }],
    };
    const { container } = render(<Line data={colored} />);
    const path = container.querySelector('path[stroke-width="2"]');
    expect(path?.getAttribute('stroke')).toBe('#ff00ff');
  });
});
