/**
 * Phase 11 — VizHead (mock 10 inline visualizer).
 *
 * Mock 10 anatomy (lines 288-306):
 *   <div class="viz-head">
 *     <div class="ico">📊</div>
 *     <span class="name">visualize.show_widget</span>
 *     <span class="badge">cost_sankey_6mo</span>
 *     <span class="timer">streaming…</span>
 *   </div>
 *
 * VizHead is the banner that sits above an embedded visualization
 * widget (compose_visual T1 inline). The timer toggles between
 * "streaming…" while the widget is mid-stream and "Ns" once final.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VizHead } from '../VizHead';

describe('VizHead (mock 10)', () => {
  it('renders cm-viz-head root with ico / name / badge / timer', () => {
    const { container } = render(
      <VizHead ico="📊" name="visualize.show_widget" badge="cost_sankey_6mo" timer="streaming…" />
    );
    expect(container.querySelector('.cm-viz-head')).not.toBeNull();
    expect(container.querySelector('.cm-viz-head .ico')).toHaveTextContent('📊');
    expect(container.querySelector('.cm-viz-head .name')).toHaveTextContent('visualize.show_widget');
    expect(container.querySelector('.cm-viz-head .badge')).toHaveTextContent('cost_sankey_6mo');
    expect(container.querySelector('.cm-viz-head .timer')).toHaveTextContent('streaming…');
  });

  it('omits badge + timer when undefined', () => {
    const { container } = render(<VizHead name="visualize.show_widget" />);
    expect(container.querySelector('.cm-viz-head .badge')).toBeNull();
    expect(container.querySelector('.cm-viz-head .timer')).toBeNull();
  });

  it('exposes role=heading with aria-level for a11y', () => {
    const { container } = render(<VizHead name="x" />);
    const h = container.querySelector('.cm-viz-head');
    expect(h?.getAttribute('role')).toBe('heading');
    expect(h?.getAttribute('aria-level')).toBe('3');
  });

  it('passes through final timer state (ms / s suffix)', () => {
    const { container } = render(
      <VizHead name="visualize.show_widget" timer="2.41s" />
    );
    expect(container.querySelector('.cm-viz-head .timer')).toHaveTextContent('2.41s');
  });
});
