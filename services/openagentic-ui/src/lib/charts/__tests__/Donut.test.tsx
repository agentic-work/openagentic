import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { Donut, type DonutData } from '../components/Donut';

afterEach(() => cleanup());

const SAMPLE: DonutData = {
  slices: [
    { name: 'OpenAI', value: 16_150_000 },
    { name: 'Anthropic', value: 14_120_000 },
    { name: 'Bedrock', value: 4_480_000 },
  ],
  centerSubtitle: 'tokens · 24h',
};

describe('<Donut>', () => {
  it('renders empty-state when total is 0', () => {
    const { container } = render(<Donut data={{ slices: [] }} />);
    expect(container.textContent).toContain('no data');
  });

  it('renders one <path> per slice', () => {
    const { container } = render(<Donut data={SAMPLE} />);
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBe(SAMPLE.slices.length);
  });

  it('renders the center total in SI format', () => {
    const { container } = render(<Donut data={SAMPLE} />);
    // 34,750,000 → "34.8M" (d3-format ~s)
    expect(container.textContent).toMatch(/3[45]\.\d+M/);
  });

  it('renders the legend with one row per slice', () => {
    const { container } = render(<Donut data={SAMPLE} />);
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('Anthropic');
    expect(container.textContent).toContain('Bedrock');
  });

  it('clicking a slice isolates it and updates center label', () => {
    const { container } = render(<Donut data={SAMPLE} />);
    const paths = container.querySelectorAll('svg path');
    fireEvent.click(paths[0]);
    expect(container.textContent).toContain('OPENAI'); // upper-cased in center
    expect(container.textContent).toContain('share');
  });
});
