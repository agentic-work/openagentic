import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Bar, type BarData } from '../components/Bar';

afterEach(() => cleanup());

const SAMPLE: BarData = {
  categories: ['gpt-5.4', 'claude-opus-4.7', 'claude-sonnet-4.6'],
  series: [
    { name: 'chat', values: [412.3, 188.5, 84.3] },
    { name: 'thinking', values: [218.7, 142.1, 0] },
    { name: 'tool_call', values: [92.4, 51.2, 38.7] },
  ],
  showTotals: true,
};

describe('<Bar>', () => {
  it('renders empty-state when there is no data', () => {
    const { container } = render(<Bar data={{ categories: [], series: [] }} />);
    expect(container.textContent).toContain('no data');
  });

  it('stacked mode: one <g> per series, one <rect> per (series, category)', () => {
    const { container } = render(<Bar data={SAMPLE} />);
    const rects = container.querySelectorAll('svg g[fill] rect');
    // 3 series × 3 categories = 9 rects (excluding any chrome rects)
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });

  it('shows total labels above each bar when showTotals=true', () => {
    const { container } = render(<Bar data={SAMPLE} />);
    // Totals: gpt-5.4 = 723.4, claude-opus = 381.8, claude-sonnet = 123
    // d3-format('~s') renders as "723", "382", "123". Look for text elements
    // styled as totals (fontWeight 500, dedicated text-anchor middle).
    const totalLabels = Array.from(container.querySelectorAll('svg text'))
      .filter((t) => (t as HTMLElement).style.fontWeight === '500')
      .map((t) => t.textContent ?? '');
    expect(totalLabels.length).toBe(3);
    expect(totalLabels.some((t) => t.includes('723'))).toBe(true);
  });

  it('grouped mode: same data renders with mode="grouped"', () => {
    const { container } = render(<Bar data={{ ...SAMPLE, mode: 'grouped' }} />);
    const rects = container.querySelectorAll('svg g[fill] rect');
    expect(rects.length).toBeGreaterThanOrEqual(9);
  });

  it('honors per-series color override', () => {
    const colored: BarData = {
      categories: ['a', 'b'],
      series: [{ name: 's', color: '#abcdef', values: [10, 20] }],
    };
    const { container } = render(<Bar data={colored} />);
    const g = container.querySelector('svg g[fill="#abcdef"]');
    expect(g).not.toBeNull();
  });
});
