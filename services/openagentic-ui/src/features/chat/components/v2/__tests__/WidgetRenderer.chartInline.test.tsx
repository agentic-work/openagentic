/**
 * #781 — compose_visual inline chart bridge.
 *
 * User 2026-05-13: "compose visual sucks it needs to use react flow and
 * look way more professional - why is that line graph so generic and
 * shitty looking" + "both inline and slideout for more complex artifacts".
 *
 * WidgetRenderer now recognizes a new `kind: 'chart'` where `content` is
 * a JSON string `{kind, data, nodes?, links?, title?}` matching the
 * premium Chart renderer's contract. Instead of mounting an iframe with
 * server-emitted SVG (generic-looking), we mount the premium Recharts/
 * React Flow Chart component INLINE in the parent React tree.
 *
 * Complex artifacts (python-report, react-app, mini-app, runbook, table)
 * continue to route through the slide-out via ArtifactSlideOutLauncher.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WidgetRenderer } from '../WidgetRenderer.js';

describe('WidgetRenderer chart-inline bridge — #781', () => {
  it('mounts premium Chart inline (no iframe) when kind="chart"', () => {
    const payload = JSON.stringify({
      kind: 'line',
      data: [
        { label: 'Jan', value: 12 },
        { label: 'Feb', value: 18 },
        { label: 'Mar', value: 24 },
      ],
      title: 'AWS monthly cost',
    });
    const { container } = render(
      <WidgetRenderer
        template="line-chart"
        kind={'chart' as any}
        content={payload}
        title="AWS cost trend"
      />,
    );
    // chart-root from premium Chart.tsx
    expect(screen.getByTestId('chart-root')).toBeInTheDocument();
    // No iframe — inline render
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('falls back to chart-empty when payload is malformed JSON', () => {
    render(
      <WidgetRenderer
        template="line-chart"
        kind={'chart' as any}
        content="{not valid json"
      />,
    );
    // Premium Chart shows the empty state for malformed/unparsed input
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
  });

  it('handles sankey JSON shape inline (nodes + links)', () => {
    const payload = JSON.stringify({
      kind: 'sankey',
      data: [],
      nodes: [
        { id: 'aws', label: 'AWS' },
        { id: 'compute', label: 'Compute' },
      ],
      links: [{ source: 'aws', target: 'compute', value: 100 }],
    });
    const { container } = render(
      <WidgetRenderer
        template="sankey"
        kind={'chart' as any}
        content={payload}
        title="Cost flow"
      />,
    );
    expect(container.querySelector('.react-flow')).toBeInTheDocument();
  });

  it('does not mount the Chart for kind="svg" (legacy iframe path)', () => {
    const { container } = render(
      <WidgetRenderer
        template="bar-chart"
        kind="svg"
        content="<svg><rect width='10' height='10' /></svg>"
      />,
    );
    // Should still mount the iframe for SVG payloads
    expect(container.querySelector('iframe')).toBeInTheDocument();
    // And NOT mount the premium Chart
    expect(screen.queryByTestId('chart-root')).toBeNull();
  });
});
