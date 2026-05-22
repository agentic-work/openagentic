/**
 * EChartsRenderer — RED→GREEN contract.
 *
 * One server-side renderer that produces deterministic SVG strings for
 * 7 new chart types: chord, sunburst, radial_tree, treemap,
 * parallel_coords, heatmap, plus a re-implementation of sankey that uses
 * ECharts' bundled implementation (Gauss-Seidel relaxation correctly).
 *
 * Why ECharts: Apache ECharts (66k★, Apache-2.0) ships
 * `echarts.renderToSVGString(option)` that works in pure Node — no jsdom,
 * no browser. One ~15-LOC wrapper replaces 80-100 LOC of hand-rolled math
 * per template. Reference: https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg
 *
 * Contract:
 *   render(template, data) → { kind: 'svg', content: '<svg ...>...</svg>' }
 *   Throws on invalid input shape (per-template validation rules).
 *   Determinism: same input → same SVG output (no Math.random, no Date).
 */

import { describe, it, expect } from 'vitest';
import { renderEChart, type EChartTemplate } from '../EChartsRenderer.js';

describe('EChartsRenderer — server-side ECharts SVG renderer', () => {
  describe('sankey (replaces hand-rolled Gauss-Seidel)', () => {
    it('renders a 3-node sankey and returns kind=svg with <svg> markup', () => {
      const out = renderEChart('sankey', {
        flows: [
          { from: 'A', to: 'X', value: 10 },
          { from: 'B', to: 'X', value: 5 },
          { from: 'B', to: 'Y', value: 8 },
        ],
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg[\s>]/);
      expect(out.content).toContain('</svg>');
    });

    it('throws on empty flows array', () => {
      expect(() => renderEChart('sankey', { flows: [] })).toThrow(/at least one flow/i);
    });

    it('throws on negative flow value', () => {
      expect(() =>
        renderEChart('sankey', { flows: [{ from: 'A', to: 'B', value: -1 }] }),
      ).toThrow(/positive number/i);
    });
  });

  describe('chord — relationship arcs around a circle', () => {
    it('renders a 3x3 matrix chord diagram', () => {
      const out = renderEChart('chord', {
        nodes: ['Engineering', 'Sales', 'Support'],
        matrix: [
          [0, 5, 2],
          [5, 0, 3],
          [2, 3, 0],
        ],
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
      // ECharts renders chord-style relations via the graph series with
      // 'circular' layout; the SVG should reference that layout shape.
      expect(out.content.length).toBeGreaterThan(200);
    });

    it('throws when matrix is not square', () => {
      expect(() =>
        renderEChart('chord', {
          nodes: ['A', 'B'],
          matrix: [[0, 1, 2], [1, 0, 0]],
        }),
      ).toThrow(/square/i);
    });
  });

  describe('sunburst — radial hierarchy', () => {
    it('renders a 2-level sunburst from a tree shape', () => {
      const out = renderEChart('sunburst', {
        root: {
          name: 'root',
          children: [
            { name: 'A', value: 10, children: [{ name: 'A1', value: 6 }, { name: 'A2', value: 4 }] },
            { name: 'B', value: 8 },
          ],
        },
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
    });

    it('throws on missing root', () => {
      expect(() => renderEChart('sunburst', {})).toThrow(/root/i);
    });
  });

  describe('radial_tree — tree laid out radially', () => {
    it('renders a 3-level radial tree', () => {
      const out = renderEChart('radial_tree', {
        root: {
          name: 'CEO',
          children: [
            { name: 'CTO', children: [{ name: 'VP-Eng' }, { name: 'VP-Data' }] },
            { name: 'CFO', children: [{ name: 'Controller' }] },
          ],
        },
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
    });
  });

  describe('treemap — area-proportional rectangles', () => {
    it('renders a 4-leaf treemap', () => {
      const out = renderEChart('treemap', {
        root: {
          name: 'budget',
          children: [
            { name: 'eng', value: 100 },
            { name: 'sales', value: 60 },
            { name: 'ops', value: 40 },
            { name: 'g&a', value: 25 },
          ],
        },
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
    });
  });

  describe('parallel_coords — multi-dimensional comparison', () => {
    it('renders 3 series across 4 axes', () => {
      const out = renderEChart('parallel_coords', {
        dims: ['cpu', 'mem', 'disk', 'net'],
        rows: [
          { name: 'pod-a', values: [80, 60, 40, 30] },
          { name: 'pod-b', values: [40, 90, 70, 20] },
          { name: 'pod-c', values: [55, 45, 30, 90] },
        ],
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
    });

    it('throws when row values length does not match dims', () => {
      expect(() =>
        renderEChart('parallel_coords', {
          dims: ['a', 'b'],
          rows: [{ name: 'x', values: [1, 2, 3] }],
        }),
      ).toThrow(/length/i);
    });
  });

  describe('heatmap — 2D scalar grid', () => {
    it('renders a 3x4 heatmap', () => {
      const out = renderEChart('heatmap', {
        x: ['Mon', 'Tue', 'Wed', 'Thu'],
        y: ['00:00', '06:00', '12:00'],
        cells: [
          [0, 0, 12], [0, 1, 5], [0, 2, 1],
          [1, 0, 8], [1, 1, 18], [1, 2, 3],
          [2, 0, 6], [2, 1, 22], [2, 2, 9],
          [3, 0, 4], [3, 1, 14], [3, 2, 7],
        ],
      });
      expect(out.kind).toBe('svg');
      expect(out.content).toMatch(/^<svg/);
    });
  });

  describe('determinism', () => {
    it('produces identical SVG output for identical input (no Math.random / Date)', () => {
      const data = {
        flows: [
          { from: 'A', to: 'X', value: 10 },
          { from: 'B', to: 'X', value: 5 },
        ],
      };
      const a = renderEChart('sankey', data);
      const b = renderEChart('sankey', data);
      expect(a.content).toBe(b.content);
    });
  });

  describe('unknown template', () => {
    it('throws on unsupported template name', () => {
      expect(() =>
        renderEChart('not_a_template' as unknown as EChartTemplate, {}),
      ).toThrow(/unsupported|unknown/i);
    });
  });
});
