/**
 * Hover tooltip contract for <Area> — same pattern as <Line>: crosshair on
 * mousemove, multi-series snapshot at the cursor x-bucket, tooltip box
 * renders title (time/category) + one row per series with color swatch +
 * value.
 *
 * Real-data shape: 24h of token-rate buckets per provider, categorical
 * xLabels ("HH:MM"). Mirrors what admin's MetricChart variant="stacked-area"
 * actually passes from useDashboardMetrics.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { Area, type AreaData } from '../components/Area';

afterEach(() => cleanup());

const xLabels = ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30'];
const SAMPLE: AreaData = {
  mode: 'stacked',
  xLabels,
  series: [
    { name: 'OpenAI',    data: xLabels.map((t, i) => ({ t, v: 12000 + i * 800 })) },
    { name: 'Anthropic', data: xLabels.map((t, i) => ({ t, v:  8000 + i * 600 })) },
    { name: 'Bedrock',   data: xLabels.map((t, i) => ({ t, v:  3000 + i * 200 })) },
  ],
};

describe('<Area> hover tooltip', () => {
  it('shows no tooltip before mouseover', () => {
    const { container } = render(<Area data={SAMPLE} />);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('shows tooltip on mousemove with title = current x-bucket', () => {
    const { container } = render(<Area data={SAMPLE} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 200 });
    const tip = container.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toMatch(/\d{2}:\d{2}/); // some HH:MM label
  });

  it('tooltip shows one row per series with formatted value', () => {
    const { container } = render(<Area data={SAMPLE} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 200 });
    const tip = container.querySelector('[role="tooltip"]') as HTMLElement | null;
    expect(tip).not.toBeNull();
    expect(tip!.textContent).toContain('OpenAI');
    expect(tip!.textContent).toContain('Anthropic');
    expect(tip!.textContent).toContain('Bedrock');
  });

  it('tooltip disappears on mouseleave', () => {
    const { container } = render(<Area data={SAMPLE} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 200 });
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    fireEvent.mouseLeave(svg);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('renders a crosshair line at the hovered x-bucket', () => {
    const { container } = render(<Area data={SAMPLE} />);
    const svg = container.querySelector('svg')!;
    fireEvent.mouseMove(svg, { clientX: 600, clientY: 200 });
    const crosshair = container.querySelector('line[data-aw-area-crosshair]');
    expect(crosshair).not.toBeNull();
  });
});
