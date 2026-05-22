/**
 * RED → GREEN: rendered artifacts must respect light + dark theme.
 *
 * Sev-0 2026-05-08. Pre-fix: WidgetRenderer iframe srcdoc PREAMBLE_CSS
 * hardcoded dark palette (#09090b bg, #f8fafc fg). In light mode the
 * iframe stayed black-on-black ⇒ unreadable charts.
 *
 * Post-fix: buildPreambleCSS(theme) emits light or dark palette.
 */
import { describe, it, expect } from 'vitest';
import { buildPreambleCSS } from '../widgetThemePreamble.js';

describe('buildPreambleCSS — light theme', () => {
  const css = buildPreambleCSS('light');
  it('sets a light background', () => {
    expect(css).toMatch(/--bg-0:\s*#f/i);
  });
  it('sets dark foreground for contrast on light bg', () => {
    expect(css).toMatch(/--fg-0:\s*#0|--fg-0:\s*#1/i);
  });
  it('does not leave any obviously-dark hex literal as bg-0', () => {
    expect(css).not.toMatch(/--bg-0:\s*#09090b/);
  });
});

describe('buildPreambleCSS — dark theme', () => {
  const css = buildPreambleCSS('dark');
  it('sets a dark background', () => {
    expect(css).toMatch(/--bg-0:\s*#09090b|--bg-0:\s*#0/i);
  });
  it('sets light foreground', () => {
    expect(css).toMatch(/--fg-0:\s*#f/i);
  });
});

describe('buildPreambleCSS — accent override', () => {
  it('honors a runtime accent token instead of the hardcoded violet', () => {
    const css = buildPreambleCSS('dark', { accent: '#22c55e' });
    expect(css).toContain('#22c55e');
    expect(css).not.toMatch(/--accent:\s*#8b5cf6/);
  });
});

