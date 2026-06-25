/**
 * PrimitivesShowcase — smoke test.
 *
 * Mounts the dev-only showcase page and asserts each primitive's
 * signature DOM root is reachable. Intentionally shallow — this test
 * exists to catch import-time regressions and prove the page boots
 * without throwing. It does NOT validate visual fidelity (that's the
 * mock-parity audit at /dev/v2-primitives in a real browser).
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

import PrimitivesShowcase from '../PrimitivesShowcase';

describe('PrimitivesShowcase', () => {
  it('renders every v2 primitive root class without throwing', () => {
    const { container } = render(<PrimitivesShowcase />);

    // Page title
    expect(container.textContent).toContain(
      'v2 primitives showcase — mock parity reference',
    );

    // Each primitive's signature class
    expect(container.querySelector('.cm-savings-card')).not.toBeNull();
    expect(container.querySelector('.cm-kpi-grid')).not.toBeNull();
    expect(container.querySelector('.cm-streaming-table')).not.toBeNull();
    expect(container.querySelector('.cm-tool-parallel-hdr')).not.toBeNull();
    expect(container.querySelector('.cm-subagent')).not.toBeNull();
    expect(container.querySelector('.cm-citation')).not.toBeNull();
    expect(container.querySelector('.cm-avatar')).not.toBeNull();
    expect(container.querySelector('.cm-status-row')).not.toBeNull();
    expect(container.querySelector('.cm-cost-pill')).not.toBeNull();
    expect(container.querySelector('[class*="cm-sev"]')).not.toBeNull();

    // MessageHeader uses .cm-msg-head
    expect(container.querySelector('.cm-msg-head')).not.toBeNull();

    // HandoffPill uses .cm-handoff
    expect(container.querySelector('.cm-handoff')).not.toBeNull();

    // ToolCard uses .cm-tool
    expect(container.querySelector('.cm-tool')).not.toBeNull();

    // WidgetRenderer uses .cm-widget
    expect(container.querySelector('.cm-widget')).not.toBeNull();

    // AppRenderer uses [data-app-renderer="true"]
    expect(
      container.querySelector('[data-app-renderer="true"]'),
    ).not.toBeNull();
  });

  it('toolbar exposes a dark/light theme toggle', () => {
    const { getByTestId } = render(<PrimitivesShowcase />);
    expect(getByTestId('theme-toggle-dark')).toBeInTheDocument();
    expect(getByTestId('theme-toggle-light')).toBeInTheDocument();
    // Dark is the default — pressed=true
    expect(getByTestId('theme-toggle-dark').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
