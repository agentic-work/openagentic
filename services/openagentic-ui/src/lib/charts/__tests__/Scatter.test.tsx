import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Scatter, type ScatterData } from '../components/Scatter';

afterEach(() => cleanup());

const SAMPLE: ScatterData = {
  xLabel: 'tokens',
  yLabel: 'ms',
  points: [
    { x: 1000, y: 200, size: 0.01, category: 'OpenAI' },
    { x: 5000, y: 800, size: 0.05, category: 'OpenAI' },
    { x: 2000, y: 400, size: 0.02, category: 'Anthropic' },
    { x: 8000, y: 1500, size: 0.08, category: 'Anthropic' },
  ],
};

describe('<Scatter>', () => {
  it('renders one circle per point', () => {
    const { container } = render(<Scatter data={SAMPLE} />);
    const circles = container.querySelectorAll('svg circle');
    expect(circles.length).toBe(SAMPLE.points.length);
  });

  it('uses per-category color from theme palette', () => {
    const { container } = render(<Scatter data={SAMPLE} />);
    const fills = Array.from(container.querySelectorAll('svg circle')).map((c) => c.getAttribute('fill'));
    // OpenAI points share a fill; Anthropic points share a different fill
    const openai = fills.filter((_, i) => SAMPLE.points[i].category === 'OpenAI');
    const anthropic = fills.filter((_, i) => SAMPLE.points[i].category === 'Anthropic');
    expect(new Set(openai).size).toBe(1);
    expect(new Set(anthropic).size).toBe(1);
    expect(openai[0]).not.toBe(anthropic[0]);
  });

  it('honors colorByCategory override', () => {
    const { container } = render(
      <Scatter data={{ ...SAMPLE, colorByCategory: { OpenAI: '#deadbe', Anthropic: '#beefca' } }} />,
    );
    const fills = Array.from(container.querySelectorAll('svg circle')).map((c) => c.getAttribute('fill'));
    expect(fills).toContain('#deadbe');
    expect(fills).toContain('#beefca');
  });

  it('shows empty-state when no points', () => {
    const { container } = render(<Scatter data={{ points: [] }} />);
    expect(container.textContent).toContain('no points');
  });

  it('supports log scales on both axes', () => {
    const { container } = render(
      <Scatter data={{ ...SAMPLE, xScale: 'log', yScale: 'log' }} />,
    );
    expect(container.querySelectorAll('svg circle').length).toBe(SAMPLE.points.length);
  });
});
