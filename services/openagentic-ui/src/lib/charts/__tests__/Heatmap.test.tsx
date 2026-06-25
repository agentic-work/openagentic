import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Heatmap, type HeatmapData } from '../components/Heatmap';

afterEach(() => cleanup());

const SAMPLE: HeatmapData = {
  rows: ['gpt-5.4', 'claude-opus', 'gemini-2.5'],
  cols: Array.from({ length: 6 }, (_, i) => i),
  cells: Array.from({ length: 18 }, (_, i) => ({
    row: ['gpt-5.4', 'claude-opus', 'gemini-2.5'][i % 3],
    col: i % 6,
    value: (i % 6) * 12 + 10,
  })),
  legendLabel: 'req/hr',
};

describe('<Heatmap>', () => {
  it('renders one <rect> per cell (excludes legend rect)', () => {
    const { container } = render(<Heatmap data={SAMPLE} />);
    // Cells have explicit stroke attribute; legend rect has fill=url(#...) and no stroke
    const cells = Array.from(container.querySelectorAll('svg rect[rx="2"]')).filter(
      (r) => r.getAttribute('stroke') !== null,
    );
    expect(cells.length).toBe(SAMPLE.cells.length);
  });

  it('renders the legend gradient', () => {
    const { container } = render(<Heatmap data={SAMPLE} />);
    expect(container.querySelector('linearGradient#aw-heat-legend')).not.toBeNull();
  });

  it('shows empty-state when cells=[]', () => {
    const { container } = render(<Heatmap data={{ rows: [], cols: [], cells: [] }} />);
    expect(container.textContent).toContain('no cells');
  });

  it('renders legend label when provided', () => {
    const { container } = render(<Heatmap data={SAMPLE} />);
    expect(container.textContent).toContain('req/hr');
  });
});
