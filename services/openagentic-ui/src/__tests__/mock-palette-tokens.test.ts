/**
 * Mock-widget palette tokens — RED→GREEN regression for AC-T1.
 *
 * The compose_visual templates emit inline HTML with var(--mw-*) tokens.
 * These are isolated from the user-customizable --accent system so the
 * mock-01 sediment look-and-feel is preserved regardless of theme picker.
 *
 * SoT: mocks/UX/01-cloud-ops.html lines 16-30 + 46-58.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_CSS = resolve(__dirname, '../index.css');
const css = readFileSync(INDEX_CSS, 'utf-8');

describe('Mock-widget palette tokens — namespace --mw-* (AC-T1)', () => {
  it('defines the dark-theme bg ramp as --mw-bg-0..4', () => {
    expect(css).toMatch(/--mw-bg-0\s*:\s*#09090b/);
    expect(css).toMatch(/--mw-bg-1\s*:\s*#0f1012/);
    expect(css).toMatch(/--mw-bg-2\s*:\s*#16181c/);
    expect(css).toMatch(/--mw-bg-3\s*:\s*#1c1f24/);
    expect(css).toMatch(/--mw-bg-4\s*:\s*#242831/);
  });

  it('defines the dark-theme fg ramp as --mw-fg-0..3', () => {
    expect(css).toMatch(/--mw-fg-0\s*:\s*#f8fafc/);
    expect(css).toMatch(/--mw-fg-1\s*:\s*#d4d4d8/);
    expect(css).toMatch(/--mw-fg-2\s*:\s*#a1a1aa/);
    expect(css).toMatch(/--mw-fg-3\s*:\s*#71717a/);
  });

  it('defines the mock-01 accent purple as --mw-accent + soft + line', () => {
    expect(css).toMatch(/--mw-accent\s*:\s*#8b5cf6/);
    expect(css).toMatch(/--mw-accent-soft\s*:\s*rgba\(139,\s*92,\s*246,\s*0?\.14\)/);
    expect(css).toMatch(/--mw-accent-line\s*:\s*rgba\(139,\s*92,\s*246,\s*0?\.32\)/);
  });

  it('defines --mw-line-1 (separator hairline used by every compose_visual template)', () => {
    expect(css).toMatch(/--mw-line-1\s*:\s*rgba\(255,\s*255,\s*255,\s*0?\.06\)/);
  });

  it('defines status tints (--mw-success/danger/warning/info)', () => {
    expect(css).toMatch(/--mw-success\s*:\s*#22c55e/);
    expect(css).toMatch(/--mw-danger\s*:\s*#ef4444/);
    expect(css).toMatch(/--mw-warning\s*:\s*#f59e0b/);
    expect(css).toMatch(/--mw-info\s*:\s*#38bdf8/);
  });

  it('defines a light-theme override block with --mw-* values from mock-01 light', () => {
    const hasLightBlock =
      /(\.theme-light|\[data-theme=['"]light['"]\])\s*[\s\S]*--mw-bg-1\s*:\s*#ffffff/s.test(css);
    expect(hasLightBlock).toBe(true);
  });
});
