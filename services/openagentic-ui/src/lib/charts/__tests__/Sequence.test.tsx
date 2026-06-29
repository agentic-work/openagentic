import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Sequence, type SequenceData } from '../components/Sequence';

afterEach(() => cleanup());

const SAMPLE: SequenceData = {
  events: [
    { id: 'u0', name: 'user_msg', kind: 'user', ms: 0 },
    { id: 't1', name: 'tool_search', kind: 'tool_search', ms: 120 },
    { id: 'm2', name: 'azure_list_rgs', kind: 'mcp_call', ms: 380 },
    { id: 's3', name: 'synthesis', kind: 'synthesis', ms: 3200 },
    { id: 'u4', name: 'user_msg', kind: 'user', ms: 3600 },
  ],
  arcs: [
    { src: 'u0', tgt: 't1' },
    { src: 't1', tgt: 'm2' },
    { src: 'm2', tgt: 's3' },
    { src: 's3', tgt: 'u4' },
  ],
};

describe('<Sequence>', () => {
  it('renders one circle per event', () => {
    const { container } = render(<Sequence data={SAMPLE} />);
    const circles = container.querySelectorAll('svg circle');
    expect(circles.length).toBe(SAMPLE.events.length);
  });

  it('renders one arc per causal handoff', () => {
    const { container } = render(<Sequence data={SAMPLE} />);
    // Arc paths have d that starts with M ... A r r 0 0 1/0 ... (elliptical arc)
    const arcs = Array.from(container.querySelectorAll('svg path'))
      .filter((p) => /A \d+/.test(p.getAttribute('d') ?? ''));
    expect(arcs.length).toBe(SAMPLE.arcs.length);
  });

  it('renders empty-state when no events', () => {
    const { container } = render(<Sequence data={{ events: [], arcs: [] }} />);
    expect(container.textContent).toContain('no events');
  });

  it('honors colorByKind override', () => {
    const { container } = render(
      <Sequence data={{ ...SAMPLE, colorByKind: { user: '#deadbe' } }} />,
    );
    const userCircles = Array.from(container.querySelectorAll('svg circle')).filter(
      (c, i) => SAMPLE.events[i].kind === 'user',
    );
    for (const c of userCircles) {
      expect(c.getAttribute('fill')).toBe('#deadbe');
    }
  });
});
