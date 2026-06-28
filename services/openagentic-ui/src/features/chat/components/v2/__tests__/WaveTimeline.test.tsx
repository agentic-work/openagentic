/**
 * Phase 22 — WaveTimeline (mocks 06, 08).
 *
 * Mock 06 anatomy:
 *   <div class="cm-wave-timeline">
 *     <div class="cm-wt-hdr">
 *       <svg /><span class="cm-wt-title">{title}</span>
 *     </div>
 *     <div class="cm-wt-row">
 *       <div class="cm-tag">Wave 1<span class="cm-dates">day 1-14</span></div>
 *       <div class="cm-wt-bar">
 *         <div class="cm-seg cm-tone-a" style="left: 0%; width: 15%">retire · 34 VMs</div>
 *       </div>
 *     </div>
 *   </div>
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WaveTimeline } from '../WaveTimeline';

const sample = {
  title: '90-day cutover · 4 waves',
  rows: [
    { id: '1', label: 'Wave 1', dates: 'day 1-14', segments: [{ left: 0, width: 15, label: 'retire · 34 VMs', tone: 'a' as const }] },
    { id: '2', label: 'Wave 2', dates: 'day 15-42', segments: [{ left: 16, width: 30, label: 'stateless migration · 48 VMs', tone: 'b' as const }] },
    { id: '3', label: 'Wave 3', dates: 'day 43-70', segments: [{ left: 48, width: 30, label: 'stateful + SCCs · 35 VMs', tone: 'c' as const }] },
    { id: '4', label: 'Wave 4', dates: 'day 71-90', segments: [{ left: 79, width: 20, label: 'crown-jewels · 17 VMs', tone: 'd' as const }] },
  ],
};

describe('WaveTimeline (mocks 06, 08)', () => {
  it('renders cm-wave-timeline with cm-wt-hdr title', () => {
    const { container } = render(<WaveTimeline title={sample.title} rows={sample.rows} />);
    const root = container.querySelector('.cm-wave-timeline');
    expect(root).not.toBeNull();
    expect(root!.querySelector('.cm-wt-title')).toHaveTextContent('90-day cutover');
  });

  it('renders one cm-wt-row per row', () => {
    const { container } = render(<WaveTimeline title="t" rows={sample.rows} />);
    expect(container.querySelectorAll('.cm-wt-row').length).toBe(4);
  });

  it('renders cm-tag with label + cm-dates per row', () => {
    const { container } = render(<WaveTimeline title="t" rows={sample.rows} />);
    const tags = container.querySelectorAll('.cm-wt-row .cm-tag');
    expect(tags[0]).toHaveTextContent('Wave 1');
    expect(tags[0].querySelector('.cm-dates')).toHaveTextContent('day 1-14');
  });

  it('renders cm-seg with cm-tone-{a,b,c,d} variant + left/width inline-style', () => {
    const { container } = render(<WaveTimeline title="t" rows={sample.rows} />);
    const segs = container.querySelectorAll('.cm-seg');
    expect(segs[0]).toHaveClass('cm-tone-a');
    expect(segs[0].getAttribute('style') || '').toMatch(/left:\s*0%/);
    expect(segs[0].getAttribute('style') || '').toMatch(/width:\s*15%/);
    expect(segs[3]).toHaveClass('cm-tone-d');
  });

  it('renders nothing when rows empty', () => {
    const { container } = render(<WaveTimeline title="t" rows={[]} />);
    expect(container.querySelector('.cm-wave-timeline')).toBeNull();
  });
});
