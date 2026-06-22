import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartFrame } from '../hooks/useChartFrame';
import { useRef, useEffect } from 'react';
import { render } from '@testing-library/react';
import React from 'react';

describe('useChartFrame', () => {
  let svgRef: SVGSVGElement;
  let contentRef: SVGGElement;
  let menuRoot: HTMLElement | null;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Build a tiny SVG + content <g> so the hook has something to bind to
    const ns = 'http://www.w3.org/2000/svg';
    svgRef = document.createElementNS(ns, 'svg') as SVGSVGElement;
    svgRef.setAttribute('viewBox', '0 0 100 100');
    contentRef = document.createElementNS(ns, 'g') as SVGGElement;
    svgRef.appendChild(contentRef);
    document.body.appendChild(svgRef);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function Harness({ disable = false }: { disable?: boolean }) {
    const svgEl = useRef<SVGSVGElement>(null);
    const contentEl = useRef<SVGGElement>(null);
    useChartFrame(svgEl, contentEl, { title: 'test', disabled: disable });
    return (
      <svg ref={svgEl} viewBox="0 0 100 100" data-testid="svg">
        <g ref={contentEl} data-testid="content"></g>
      </svg>
    );
  }

  it('mounts without throwing when refs are valid', () => {
    expect(() => render(<Harness />)).not.toThrow();
  });

  it('attaches a contextmenu listener that opens a menu div', () => {
    const { getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    const evt = new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 });
    svg.dispatchEvent(evt);
    const menu = document.querySelector('[data-aw-chart-menu]');
    expect(menu).not.toBeNull();
    expect((menu as HTMLElement).style.display).toBe('block');
  });

  it('context menu has Reset, Fit, Copy SVG, Export PNG, Fullscreen', () => {
    const { getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector('[data-aw-chart-menu]') as HTMLElement;
    const labels = Array.from(menu.querySelectorAll('[data-aw-menu-item]')).map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(labels.some((l) => l.startsWith('Reset'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Fit'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Copy SVG'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Export PNG'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Fullscreen'))).toBe(true);
  });

  it('Escape key closes an open menu', () => {
    const { getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    let menu = document.querySelector('[data-aw-chart-menu]') as HTMLElement;
    expect(menu.style.display).toBe('block');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    menu = document.querySelector('[data-aw-chart-menu]') as HTMLElement;
    expect(menu.style.display).toBe('none');
  });

  it('does nothing when disabled=true (no menu element created on right-click)', () => {
    const { getByTestId } = render(<Harness disable />);
    const svg = getByTestId('svg');
    svg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    const menu = document.querySelector('[data-aw-chart-menu]');
    expect(menu).toBeNull();
  });
});
