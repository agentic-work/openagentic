/**
 * WidgetRenderer — `reactflow_arch` kind contract (POST Sev-0 #835 rip).
 *
 * Pre-#835 state: kind='reactflow_arch' mounted ReactFlowArchWidget with
 * a `.react-flow` surface. That gave the model crammed/overlapping
 * "fucking horrible" diagrams (user direction 2026-05-14) because
 * ReactFlow needs explicit (x,y) coords the model can't reliably author.
 *
 * Post-#835 state: kind='reactflow_arch' routes through the lib/charts
 * ChartArtifact dispatcher with template='network' (d3-force auto-layout,
 * --cm-* theme tokens, shared frame). The legacy wire shape is translated
 * by reactflowToNetwork() so existing model emissions still render.
 *
 * Pins:
 *   - kind="reactflow_arch" does NOT mount an iframe (still parent-tree)
 *   - kind="reactflow_arch" does NOT mount a `.react-flow` container
 *   - kind="reactflow_arch" DOES mount a Network SVG via ChartArtifact
 *   - data-widget-kind="reactflow_arch" attribute is preserved for
 *     Playwright probes + UX-parity test selectors
 *   - bad JSON renders an inline error instead of crashing
 *   - ReactFlow lib import is NOT pulled into this code path (verified
 *     by the absence of .react-flow class — keeps it for static docs only)
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WidgetRenderer } from '../WidgetRenderer.js';

const VALID_PAYLOAD = JSON.stringify({
  nodes: [
    { id: 'fd', position: { x: 0, y: 0 }, data: { label: 'Front Door' }, type: 'edge' },
    { id: 'gw', position: { x: 200, y: 0 }, data: { label: 'AppGW' }, type: 'gateway' },
  ],
  edges: [{ id: 'e1', source: 'fd', target: 'gw' }],
});

describe('WidgetRenderer — reactflow_arch kind (post-#835 lib/charts rip)', () => {
  it('does NOT mount an iframe', () => {
    render(
      <WidgetRenderer
        template="reactflow_arch"
        kind={'reactflow_arch' as never}
        content={VALID_PAYLOAD}
        title="topology"
      />,
    );
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('does NOT mount a ReactFlow `.react-flow` container (lib ripped from this path)', () => {
    const { container } = render(
      <WidgetRenderer
        template="reactflow_arch"
        kind={'reactflow_arch' as never}
        content={VALID_PAYLOAD}
        title="topology"
      />,
    );
    expect(container.querySelector('.react-flow')).toBeNull();
  });

  it('preserves data-widget-kind="reactflow_arch" wrapper for downstream probes', () => {
    const { container } = render(
      <WidgetRenderer
        template="reactflow_arch"
        kind={'reactflow_arch' as never}
        content={VALID_PAYLOAD}
        title="topology"
      />,
    );
    const root = container.querySelector('[data-widget-kind="reactflow_arch"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-widget-template')).toBe('reactflow_arch');
  });

  it('mounts the ChartArtifact Network SVG (d3-force auto-layout) for valid input', () => {
    const { container } = render(
      <WidgetRenderer
        template="reactflow_arch"
        kind={'reactflow_arch' as never}
        content={VALID_PAYLOAD}
        title="topology"
      />,
    );
    // ChartArtifact wraps its children in a chart frame; the Network
    // component renders an <svg> with <circle> nodes + <line> links.
    // jsdom won't run d3-force, but the SVG element is mounted
    // synchronously.
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders an inline error when content is malformed JSON', () => {
    const { container } = render(
      <WidgetRenderer
        template="reactflow_arch"
        kind={'reactflow_arch' as never}
        content="not-json {{{"
        title="topology"
      />,
    );
    const err = container.querySelector('[role="alert"]');
    expect(err).not.toBeNull();
    expect(err?.textContent?.toLowerCase()).toMatch(/parse|json|nodes|edges/i);
    // Wrapper attr stays so Playwright still recognizes the slot.
    expect(err?.getAttribute('data-widget-kind')).toBe('reactflow_arch');
  });
});
