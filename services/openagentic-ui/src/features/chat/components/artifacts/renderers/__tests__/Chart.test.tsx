/**
 * #781 Phase C3 — Chart renderer tests (rev2, Recharts+ReactFlow premium).
 *
 * Pro-grade chart renderer. bar/line/area/pie via Recharts with
 * Linear/Stripe-grade styling; sankey/flow via React Flow.
 *
 * Tests are shape-agnostic for the rendered DOM (Recharts emits its own
 * SVG structure) — we assert presence of the root, chart container,
 * empty state, title rail, and that bar charts produce per-bar elements.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Chart } from '../Chart.js';

// jsdom doesn't compute layout, so Recharts ResponsiveContainer needs
// explicit width/height passed via testWidth + testHeight props on a
// thin wrapper used by tests. The component supports this contract.

describe('Chart renderer — #781 Phase C3 (rev2)', () => {
  it('shows empty state when no data', () => {
    render(<Chart kind="bar" data={[]} />);
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
  });

  it('renders a chart-root with the canonical testid', () => {
    render(
      <Chart
        kind="bar"
        data={[{ label: 'x', value: 1 }]}
        testWidth={400}
        testHeight={240}
      />,
    );
    expect(screen.getByTestId('chart-root')).toBeInTheDocument();
  });

  it('renders the chart title when provided', () => {
    render(
      <Chart
        kind="bar"
        title="Azure cost · 30d"
        data={[{ label: 'x', value: 1 }]}
        testWidth={400}
        testHeight={240}
      />,
    );
    expect(screen.getByText(/Azure cost · 30d/)).toBeInTheDocument();
  });

  it('bar chart renders one bar element per data point', () => {
    const { container } = render(
      <Chart
        kind="bar"
        data={[
          { label: 'AIF', value: 42.79 },
          { label: 'CDN', value: 5.41 },
          { label: 'NET', value: 0.66 },
        ]}
        testWidth={400}
        testHeight={240}
      />,
    );
    // New chart lib (cutover 2026-05-14): one <rect rx="1"> per bar inside
    // the series <g fill> wrapper. 1 series × 3 categories = 3 bars.
    const bars = container.querySelectorAll('svg g[fill] rect[rx="1"]');
    expect(bars.length).toBeGreaterThanOrEqual(3);
  });

  it('line chart renders an SVG path for the line series', () => {
    const { container } = render(
      <Chart
        kind="line"
        data={[
          { label: 'Jan', value: 12 },
          { label: 'Feb', value: 18 },
          { label: 'Mar', value: 24 },
          { label: 'Apr', value: 22 },
        ]}
        testWidth={400}
        testHeight={240}
      />,
    );
    // New chart lib: <path stroke-width="2"> per series.
    const line = container.querySelector('svg path[stroke-width="2"]');
    expect(line).toBeInTheDocument();
  });

  it('area chart renders an area path with translucent fill', () => {
    const { container } = render(
      <Chart
        kind="area"
        data={[
          { label: 'Jan', value: 12 },
          { label: 'Feb', value: 18 },
        ]}
        testWidth={400}
        testHeight={240}
      />,
    );
    // New chart lib: overlay-mode area path with fill-opacity 0.35.
    const area = container.querySelector('svg path[fill-opacity="0.35"]');
    expect(area).toBeInTheDocument();
  });

  it('sankey kind renders an SVG with d3-sankey gradient defs + flow paths', () => {
    const { container } = render(
      <Chart
        kind="sankey"
        data={[]}
        nodes={[
          { id: 'aws', label: 'AWS', value: 1200 },
          { id: 'azure', label: 'Azure', value: 600 },
          { id: 'compute', label: 'Compute', value: 800 },
          { id: 'storage', label: 'Storage', value: 1000 },
        ]}
        links={[
          { source: 'aws', target: 'compute', value: 700 },
          { source: 'aws', target: 'storage', value: 500 },
          { source: 'azure', target: 'compute', value: 100 },
          { source: 'azure', target: 'storage', value: 500 },
        ]}
        testWidth={600}
        testHeight={400}
      />,
    );
    // New chart lib (cutover 2026-05-14): SVG sankey with one
    // linearGradient per source ribbon. React Flow is gone.
    expect(container.querySelector('svg')).toBeInTheDocument();
    const grads = container.querySelectorAll('linearGradient[id^="aw-sankey-g-"]');
    expect(grads.length).toBeGreaterThan(0);
  });

  it('unknown kind falls back to bar without crashing', () => {
    render(
      <Chart
        kind={'pie' as any}
        data={[
          { label: 'x', value: 1 },
          { label: 'y', value: 2 },
        ]}
        testWidth={400}
        testHeight={240}
      />,
    );
    expect(screen.getByTestId('chart-root')).toBeInTheDocument();
  });

  // #816 — compose_visual emits an optional `caption` alongside the chart
  // payload. The renderer must show it BELOW the chart body (separate from
  // the title figcaption at the top) so users see a one-sentence narrative
  // anchored to the visualization.
  describe('#816 caption render', () => {
    it('bar chart renders an aw-chart-caption below the chart body when caption is provided', () => {
      const { container } = render(
        <Chart
          kind="bar"
          title="Cost split"
          caption="Total $1,000 split evenly between AWS and Azure over 30 days."
          data={[
            { label: 'AWS', value: 500 },
            { label: 'Azure', value: 500 },
          ]}
          testWidth={400}
          testHeight={240}
        />,
      );
      const cap = container.querySelector('.aw-chart-caption');
      expect(cap).not.toBeNull();
      expect(cap?.textContent ?? '').toContain('Total $1,000 split evenly');
    });

    it('sankey chart renders an aw-chart-caption below the flow when caption is provided', () => {
      const { container } = render(
        <Chart
          kind="sankey"
          title="cloud_spend_breakdown"
          caption="Sankey shows $1,000 cloud spend split into AWS $500 and Azure $500."
          data={[]}
          nodes={[
            { id: 'total', label: 'Total Cloud Spend', value: 1000 },
            { id: 'aws', label: 'AWS', value: 500 },
            { id: 'azure', label: 'Azure', value: 500 },
          ]}
          links={[
            { source: 'total', target: 'aws', value: 500 },
            { source: 'total', target: 'azure', value: 500 },
          ]}
          testWidth={600}
          testHeight={400}
        />,
      );
      const cap = container.querySelector('.aw-chart-caption');
      expect(cap).not.toBeNull();
      expect(cap?.textContent ?? '').toContain('Sankey shows $1,000 cloud spend');
    });

    it('does NOT render an aw-chart-caption when caption is absent', () => {
      const { container } = render(
        <Chart
          kind="bar"
          title="No caption case"
          data={[{ label: 'x', value: 1 }]}
          testWidth={400}
          testHeight={240}
        />,
      );
      expect(container.querySelector('.aw-chart-caption')).toBeNull();
    });

    it('does NOT render an aw-chart-caption for whitespace-only caption', () => {
      const { container } = render(
        <Chart
          kind="bar"
          caption="   "
          data={[{ label: 'x', value: 1 }]}
          testWidth={400}
          testHeight={240}
        />,
      );
      expect(container.querySelector('.aw-chart-caption')).toBeNull();
    });
  });
});
