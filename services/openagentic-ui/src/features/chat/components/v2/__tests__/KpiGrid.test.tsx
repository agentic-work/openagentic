/**
 * KpiGrid — responsive grid of KPI tiles (#502).
 *
 * Used in mocks 02 (k8s-health-report), 04 (multi-region-DR), 06 (merger).
 * Reference DOM: `<div class="art-metric-row">` blocks in
 * mocks/UX/02-kubernetes-health-report.html (line 927-).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { KpiGrid, type KpiTile } from '../KpiGrid';

// JSDOM normalizes computed `borderLeftColor` to `rgb(r, g, b)`; provide
// the rgb() form for direct equality on the inline style read-back.
const RGB = {
  ok: 'rgb(34, 197, 94)', // #22c55e
  warn: 'rgb(245, 158, 11)', // #f59e0b
  err: 'rgb(239, 68, 68)', // #ef4444
};

const baseTiles: KpiTile[] = [
  { title: 'Nodes', value: '24' },
  { title: 'Pods running', value: '318' },
  { title: 'OOMs / 7d', value: '12', severity: 'warn' },
  { title: 'Expiring certs', value: '2', severity: 'err' },
];

describe('KpiGrid', () => {
  it('renders one tile per `tiles` prop entry', () => {
    const { container } = render(<KpiGrid tiles={baseTiles} />);
    const tiles = container.querySelectorAll('.cm-kpi-tile');
    expect(tiles.length).toBe(4);
  });

  it('shows title and value text on each tile', () => {
    render(<KpiGrid tiles={baseTiles} />);
    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.getByText('Pods running')).toBeInTheDocument();
    expect(screen.getByText('318')).toBeInTheDocument();
    expect(screen.getByText('Expiring certs')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders the delta line when delta is set', () => {
    const tiles: KpiTile[] = [
      { title: 'Cluster CPU', value: '73%', delta: '+12% vs 1h ago', deltaTone: 'g' },
    ];
    const { container } = render(<KpiGrid tiles={tiles} />);
    expect(screen.getByText('+12% vs 1h ago')).toBeInTheDocument();
    const delta = container.querySelector('.cm-kpi-delta');
    expect(delta).not.toBeNull();
    expect(delta!.className).toMatch(/cm-kpi-tone-g/);
  });

  it('does not render a delta line when delta is absent', () => {
    const { container } = render(<KpiGrid tiles={[{ title: 'X', value: '1' }]} />);
    expect(container.querySelector('.cm-kpi-delta')).toBeNull();
  });

  it("severity 'warn' applies the warn left-border color", () => {
    const { container } = render(
      <KpiGrid tiles={[{ title: 'OOMs', value: '12', severity: 'warn' }]} />,
    );
    const tile = container.querySelector('.cm-kpi-tile') as HTMLElement;
    expect(tile).not.toBeNull();
    expect(tile.className).toMatch(/cm-kpi-sev-warn/);
    expect(tile.style.borderLeftColor).toBe(RGB.warn);
    expect(tile.style.borderLeftWidth).toBe('4px');
  });

  it("severity 'err' applies the err left-border color", () => {
    const { container } = render(
      <KpiGrid tiles={[{ title: 'Certs', value: '2', severity: 'err' }]} />,
    );
    const tile = container.querySelector('.cm-kpi-tile') as HTMLElement;
    expect(tile.className).toMatch(/cm-kpi-sev-err/);
    expect(tile.style.borderLeftColor).toBe(RGB.err);
  });

  it("severity 'ok' applies the ok left-border color", () => {
    const { container } = render(
      <KpiGrid tiles={[{ title: 'Healthy', value: '24', severity: 'ok' }]} />,
    );
    const tile = container.querySelector('.cm-kpi-tile') as HTMLElement;
    expect(tile.className).toMatch(/cm-kpi-sev-ok/);
    expect(tile.style.borderLeftColor).toBe(RGB.ok);
  });

  it('renders no severity left-border accent when severity is absent', () => {
    const { container } = render(
      <KpiGrid tiles={[{ title: 'Plain', value: '7' }]} />,
    );
    const tile = container.querySelector('.cm-kpi-tile') as HTMLElement;
    // No severity modifier class.
    expect(tile.className).not.toMatch(/cm-kpi-sev-/);
    // No left-border accent (width is 0 or empty).
    const w = tile.style.borderLeftWidth;
    expect(w === '' || w === '0px').toBe(true);
  });

  it('respects the className prop on the root grid', () => {
    const { container } = render(
      <KpiGrid tiles={baseTiles} className="custom-extra" />,
    );
    const root = container.querySelector('.cm-kpi-grid') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.className).toMatch(/custom-extra/);
  });

  it('uses the default 180px min column width when none is given', () => {
    const { container } = render(<KpiGrid tiles={baseTiles} />);
    const root = container.querySelector('.cm-kpi-grid') as HTMLElement;
    expect(root.style.gridTemplateColumns).toContain('180px');
  });

  it('respects a custom minColumnWidth prop', () => {
    const { container } = render(
      <KpiGrid tiles={baseTiles} minColumnWidth={240} />,
    );
    const root = container.querySelector('.cm-kpi-grid') as HTMLElement;
    expect(root.style.gridTemplateColumns).toContain('240px');
    expect(root.style.gridTemplateColumns).not.toContain('180px');
  });
});
