import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

import { ChartExpandModal } from '../ChartExpandModal';

afterEach(() => cleanup());

// The InlineVizBadge "Expand" button opens ChartExpandModal. The modal is a
// position:fixed overlay. If rendered inline (a descendant of the chat stream),
// any transformed / overflow:hidden ancestor (AgenticActivityStream has
// `transform` styles) becomes the containing block for position:fixed — the
// overlay is then clipped to that ancestor and never covers the viewport, so
// clicking Expand appears to "do nothing". The fix portals the overlay to
// document.body so it escapes every transformed ancestor (the same pattern
// WidgetRenderer's own modal already uses).
describe('ChartExpandModal — portals to document.body (Expand button visibility)', () => {
  it('renders the dialog into document.body, NOT inside a transformed local wrapper', () => {
    const { container } = render(
      <div data-testid="wrapper" style={{ transform: 'translateZ(0)', overflow: 'hidden' }}>
        <ChartExpandModal title="Cost Sankey" open={true} onClose={() => {}}>
          <div data-testid="chart-body">chart</div>
        </ChartExpandModal>
      </div>,
    );

    // The local (transformed) subtree must NOT contain the overlay — it is
    // portaled out, otherwise position:fixed would be trapped by the transform.
    expect(container.querySelector('[data-aw-chart-expand]')).toBeNull();

    // The overlay IS mounted under document.body.
    const dialog = document.body.querySelector('[data-aw-chart-expand]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('role')).toBe('dialog');
    // And the chart children render inside it.
    expect(dialog!.querySelector('[data-testid="chart-body"]')).not.toBeNull();
  });

  it('renders nothing anywhere when open=false', () => {
    render(
      <ChartExpandModal title="T" open={false} onClose={() => {}}>
        <div data-testid="chart-body">chart</div>
      </ChartExpandModal>,
    );
    expect(document.body.querySelector('[data-aw-chart-expand]')).toBeNull();
  });
});
