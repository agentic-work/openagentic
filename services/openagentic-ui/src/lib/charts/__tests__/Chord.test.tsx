import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Chord, type ChordData } from '../components/Chord';

afterEach(() => cleanup());

const SAMPLE: ChordData = {
  names: ['ui', 'api', 'pg', 'mcp'],
  matrix: [
    [0, 380,   0, 0],
    [18,  0, 140, 90],
    [0,   8,   0, 0],
    [0,  18,   0, 0],
  ],
};

describe('<Chord>', () => {
  it('renders group arcs (one per name)', () => {
    const { container } = render(<Chord data={SAMPLE} />);
    // Each group has its own <g> wrapper with onMouseEnter; we expect 4 group arcs
    const groupArcs = Array.from(container.querySelectorAll('svg path'))
      .filter((p) => p.getAttribute('fill-opacity') === '0.95');
    expect(groupArcs.length).toBe(SAMPLE.names.length);
  });

  it('renders one label per name', () => {
    const { container } = render(<Chord data={SAMPLE} />);
    for (const name of SAMPLE.names) {
      expect(container.textContent).toContain(name);
    }
  });

  it('shows empty-state when names=[]', () => {
    const { container } = render(<Chord data={{ names: [], matrix: [] }} />);
    expect(container.textContent).toContain('no flows');
  });

  it('honors colorByName override', () => {
    const { container } = render(
      <Chord data={{ ...SAMPLE, colorByName: { ui: '#deadbe' } }} />,
    );
    const groupArcs = Array.from(container.querySelectorAll('svg path[fill-opacity="0.95"]'));
    const fills = groupArcs.map((p) => p.getAttribute('fill'));
    expect(fills).toContain('#deadbe');
  });
});
