import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { Sankey, type SankeyData } from '../components/Sankey';

afterEach(() => cleanup());

const SAMPLE: SankeyData = {
  nodes: [
    { id: 'openai',   label: 'OpenAI',   kind: 'source' },
    { id: 'anthropic',label: 'Anthropic',kind: 'source' },
    { id: 'gpt-5.4',  label: 'gpt-5.4',  kind: 'sink' },
    { id: 'claude-opus',label: 'claude-opus', kind: 'sink' },
  ],
  links: [
    { source: 'openai',    target: 'gpt-5.4',     value: 12_400_000, sourceId: 'openai' },
    { source: 'anthropic', target: 'claude-opus', value:  8_900_000, sourceId: 'anthropic' },
  ],
};

describe('<Sankey>', () => {
  it('renders an empty-state when there is no flow data', () => {
    const { container } = render(<Sankey data={{ nodes: [], links: [] }} />);
    expect(container.textContent).toContain('no flow data');
  });

  it('mounts svg + content group with both gradient defs (one per source)', () => {
    const { container } = render(<Sankey data={SAMPLE} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    const grads = container.querySelectorAll('linearGradient');
    expect(grads.length).toBe(2); // one per unique sourceId
    expect(grads[0].id.startsWith('aw-sankey-g-')).toBe(true);
  });

  it('emits one <path> per link, with stroke pointing at the matching gradient', () => {
    const { container } = render(<Sankey data={SAMPLE} />);
    const paths = container.querySelectorAll('svg g path');
    expect(paths.length).toBe(2);
    const strokes = Array.from(paths).map((p) => p.getAttribute('stroke'));
    expect(strokes.some((s) => s?.includes('aw-sankey-g-openai'))).toBe(true);
    expect(strokes.some((s) => s?.includes('aw-sankey-g-anthropic'))).toBe(true);
  });

  it('emits one <rect> per node + label/sub-label text', () => {
    const { container } = render(<Sankey data={SAMPLE} />);
    const rects = container.querySelectorAll('svg rect');
    expect(rects.length).toBe(SAMPLE.nodes.length);
    // labels present
    expect(container.textContent).toContain('OpenAI');
    expect(container.textContent).toContain('Anthropic');
    expect(container.textContent).toContain('gpt-5.4');
    expect(container.textContent).toContain('claude-opus');
  });

  it('honors disableFrame=true by skipping pan/zoom binding', () => {
    const { container } = render(<Sankey data={SAMPLE} disableFrame />);
    // No <svg style="cursor: grab"> when frame is off
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.style.cursor).toBe('default');
  });

  it('uses colorBySource override when provided', () => {
    const { container } = render(
      <Sankey data={{ ...SAMPLE, colorBySource: { openai: '#deadbe', anthropic: '#beefca' } }} />,
    );
    const grads = container.querySelectorAll('linearGradient stop[offset="0%"]');
    const colors = Array.from(grads).map((s) => s.getAttribute('stop-color'));
    expect(colors).toContain('#deadbe');
    expect(colors).toContain('#beefca');
  });
});
