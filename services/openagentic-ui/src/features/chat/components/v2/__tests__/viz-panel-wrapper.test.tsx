/**
 * Z.5 — Unified .viz / .viz-head wrapper around FrameRendererRegistry frames
 *
 * Mock SoT (end-state-07-tri-cloud-cost-spikes.html §114-121):
 *   .viz { margin:14px 0; border:1px solid var(--cm-line-1); border-radius:var(--radius-md);
 *          background:var(--cm-bg-1); overflow:hidden }
 *   .viz-head { display:flex; align-items:center; gap:8px; padding:10px 12px;
 *               border-bottom:1px solid var(--cm-line-1); background:var(--cm-bg-1) }
 *   .viz-head .ico  { 22×22px accent-soft bubble }
 *   .viz-head .name { JetBrains Mono 12px fg-0 500 }
 *   .viz-head .badge{ accent-soft bg, accent fg, accent-line border, mono 10px }
 *   .viz-head .timer{ margin-left:auto, mono 11px, fg-3 }
 *
 * Tests:
 * 1. VizPanel renders .viz root > .viz-head > .ico / .name / .badge / .timer
 * 2. VizPanel renders inner children (FrameRendererRegistry output) inside .viz
 * 3. ToolCard with a known outputTemplate wraps the renderer in VizPanel (.viz)
 * 4. chatmode-v2.css contains .viz and .viz-head blocks
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { VizPanel } from '../VizPanel.js';

const CSS_PATH = resolve(__dirname, '../chatmode-v2.css');

describe('VizPanel component (Z.5)', () => {
  it('renders .viz root containing .viz-head', () => {
    const { container } = render(
      <VizPanel slug="sankey" title="Cost Flow" timer="2.84s">
        <div data-testid="inner-content">inner</div>
      </VizPanel>
    );
    const viz = container.querySelector('.viz');
    expect(viz).not.toBeNull();
    const head = viz?.querySelector('.viz-head');
    expect(head).not.toBeNull();
  });

  it('renders .viz-head with name, badge, and timer', () => {
    const { container } = render(
      <VizPanel slug="sankey" title="compose_visual" timer="2.84s">
        <span>body</span>
      </VizPanel>
    );
    const head = container.querySelector('.viz-head')!;
    expect(head.querySelector('.name')?.textContent).toBe('compose_visual');
    expect(head.querySelector('.badge')?.textContent).toBe('sankey');
    expect(head.querySelector('.timer')?.textContent).toBe('2.84s');
  });

  it('renders .viz-head .ico element', () => {
    const { container } = render(
      <VizPanel slug="savings_grid" title="compose_app">
        <span>body</span>
      </VizPanel>
    );
    expect(container.querySelector('.viz-head .ico')).not.toBeNull();
  });

  it('renders children inside .viz (after .viz-head)', () => {
    const { container } = render(
      <VizPanel slug="sankey" title="compose_visual">
        <div data-testid="inner-content">hello world</div>
      </VizPanel>
    );
    // The inner content should be inside .viz
    const viz = container.querySelector('.viz')!;
    expect(viz.querySelector('[data-testid="inner-content"]')).not.toBeNull();
    expect(viz.querySelector('[data-testid="inner-content"]')?.textContent).toBe('hello world');
  });

  it('omits timer when not provided', () => {
    const { container } = render(
      <VizPanel slug="kpi_grid" title="KPI Dashboard">
        <span />
      </VizPanel>
    );
    expect(container.querySelector('.viz-head .timer')).toBeNull();
  });
});

describe('.viz / .viz-head CSS (Z.5)', () => {
  it('chatmode-v2.css contains .viz block with border and overflow:hidden', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toMatch(/\.viz\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.viz\s*\{[^}]*border:/);
    expect(css).toMatch(/\.viz\s*\{[^}]*background:\s*var\(--cm-bg-1\)/);
  });

  it('chatmode-v2.css contains .viz-head block with flex layout', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toMatch(/\.viz-head\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.viz-head\s*\{[^}]*border-bottom:/);
  });

  it('chatmode-v2.css contains .viz-head .badge and .timer rules', () => {
    const css = readFileSync(CSS_PATH, 'utf-8');
    expect(css).toContain('.viz-head .badge');
    expect(css).toContain('.viz-head .timer');
  });
});
