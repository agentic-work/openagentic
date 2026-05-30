/**
 * WidgetRenderer — TDD contract for the v2 inline widget mount.
 *
 * The server's `compose_visual` tool emits a `visual_render` NDJSON frame
 * carrying { template, kind, content, title, loading_messages, group_id }.
 * The UI mounts the SVG/HTML inside a SANDBOXED IFRAME with srcdoc — same
 * architecture Claude.ai uses (isolated origin, allow-scripts, no
 * allow-same-origin). Direct DOM injection is rejected because:
 *   - <script> tags inserted via innerHTML do NOT execute (browser sec)
 *   - SMIL <animate> works inline but JS-driven animations need scripts
 *   - SVG widgets can read parent CSS vars via inline values, but we
 *     inject them through the iframe srcdoc preamble for clean isolation
 *
 * This test pins the contract:
 *   - Renders one `<iframe sandbox="allow-scripts">` per widget
 *   - srcdoc contains the supplied content
 *   - Theme CSS custom properties are injected into srcdoc
 *   - Loading-messages pulse renders while content is empty / streaming
 *   - Title shows in header pill
 *   - data-widget-template attr on container for Playwright probing
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WidgetRenderer } from '../WidgetRenderer.js';

describe('WidgetRenderer — v2 inline widget mount', () => {
  it('renders an iframe with sandbox="allow-scripts" carrying srcdoc', () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content='<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="red"/></svg>'
        title="cost_flow"
      />,
    );
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe!.getAttribute('srcdoc')).toContain('<rect');
    expect(iframe!.getAttribute('srcdoc')).toContain('fill="red"');
  });

  it('emits data-widget-template and data-widget-kind for Playwright probing', () => {
    render(
      <WidgetRenderer
        template="bar_chart"
        kind="svg"
        content="<svg/>"
        title="costs"
      />,
    );
    const root = document.querySelector('[data-widget-template]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-widget-template')).toBe('bar_chart');
    expect(root.getAttribute('data-widget-kind')).toBe('svg');
  });

  it('preserves title on the iframe element for a11y (no visible header chrome — Claude.ai flush-inline pattern)', () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content="<svg/>"
        title="azure_cost_split"
      />,
    );
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('title')).toBe('azure_cost_split');
    // No bordered header chrome — flush-inline only.
    expect(document.querySelector('.cm-widget-head')).toBeNull();
  });

  it('shows the loading-messages pulse when content is empty', () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content=""
        title="loading_demo"
        loadingMessages={['Sketching the cost split', 'Computing 6mo trend']}
      />,
    );
    // First message visible; iframe NOT rendered while empty.
    expect(screen.getByText('Sketching the cost split')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('html kind wraps content in srcdoc directly', () => {
    render(
      <WidgetRenderer
        template="kpi_grid"
        kind="html"
        content='<div data-kpi-card>Cost: $66k</div>'
        title="kpis"
      />,
    );
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toContain('data-kpi-card');
    expect(iframe.getAttribute('srcdoc')).toContain('Cost: $66k');
  });

  it('injects parent theme CSS vars into srcdoc preamble', () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content="<svg/>"
        title="x"
      />,
    );
    const srcdoc = (document.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') || '';
    // Preamble must declare the OpenAgentic theme tokens so widgets pick
    // them up via var() — accent, fg, bg minimum.
    expect(srcdoc).toMatch(/--accent:/);
    expect(srcdoc).toMatch(/--fg-0:/);
    expect(srcdoc).toMatch(/--bg-0:/);
  });

  it('preamble includes a postMessage auto-resize bridge so the iframe fits its content', () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content="<svg/>"
        title="x"
      />,
    );
    const srcdoc = (document.querySelector('iframe') as HTMLIFrameElement).getAttribute('srcdoc') || '';
    // The iframe must announce its content scrollHeight back to the parent
    // so we can size it without showing a scrollbar.
    expect(srcdoc).toContain('postMessage');
    expect(srcdoc).toContain('cm-widget-resize');
    expect(srcdoc).toContain('scrollHeight');
  });

  it('header carries an ellipsis "More options" trigger that reveals Expand/Open-in-new-tab via menu', async () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content="<svg/>"
        title="x"
      />,
    );
    // Trigger is rendered up-front (just hidden visually via hover-opacity).
    const trigger = screen.getByRole('button', { name: /more options/i });
    expect(trigger).toBeInTheDocument();
    // Items appear after clicking the trigger (Claude.ai-style menu).
    await act(async () => {
      trigger.click();
    });
    expect(screen.getByRole('menuitem', { name: /expand/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /open in new tab/i })).toBeInTheDocument();
  });

  it('Expand (via ellipsis menu) opens a fullscreen modal carrying the same srcdoc', async () => {
    render(
      <WidgetRenderer
        template="sankey"
        kind="svg"
        content='<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>'
        title="x"
      />,
    );
    // Open the menu first.
    await act(async () => {
      screen.getByRole('button', { name: /more options/i }).click();
    });
    const expand = screen.getByRole('menuitem', { name: /expand/i });
    await act(async () => {
      expand.click();
    });
    await waitFor(() => {
      const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
      expect(iframes.length).toBeGreaterThanOrEqual(2);
    });
    const iframes = Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[];
    expect((iframes[1].getAttribute('srcdoc') || '')).toContain('fill="blue"');
  });
});
