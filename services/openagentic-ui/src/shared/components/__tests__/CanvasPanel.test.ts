/**
 * Tests for CanvasPanel's preview helpers.
 *
 * These helpers decide whether an artifact can be previewed in Canvas and
 * build the iframe-ready HTML document. Bugs here surface as "artifacts
 * don't render" (the Canvas opens but shows raw source as <pre>).
 */

import { describe, it, expect } from 'vitest';
import {
  buildPreviewHTML,
  isPreviewable,
  type CanvasContent,
} from '../CanvasPanel';

function makeContent(overrides: Partial<CanvasContent>): CanvasContent {
  return {
    id: 'test-id',
    type: 'html',
    title: 'Test Artifact',
    content: '',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('CanvasPanel / isPreviewable', () => {
  it('returns false for null', () => {
    expect(isPreviewable(null)).toBe(false);
  });

  it('returns true for core types (html, react, svg, markdown)', () => {
    for (const type of ['html', 'react', 'svg', 'markdown'] as const) {
      expect(isPreviewable(makeContent({ type }))).toBe(true);
    }
  });

  it('returns true for chart / csv / latex / canvas (regression: previously false)', () => {
    for (const type of ['chart', 'csv', 'latex', 'canvas'] as const) {
      expect(isPreviewable(makeContent({ type }))).toBe(true);
    }
  });

  it('returns true when language is previewable even if type is generic', () => {
    expect(isPreviewable(makeContent({ type: 'code', language: 'tsx' }))).toBe(true);
    expect(isPreviewable(makeContent({ type: 'code', language: 'chart-json' }))).toBe(true);
    expect(isPreviewable(makeContent({ type: 'code', language: 'tex' }))).toBe(true);
  });

  it('returns false for types with no template and no language hint', () => {
    expect(isPreviewable(makeContent({ type: 'code', language: 'python' }))).toBe(false);
    expect(isPreviewable(makeContent({ type: 'tool-output' }))).toBe(false);
  });
});

describe('CanvasPanel / buildPreviewHTML branches', () => {
  it('html branch embeds the raw HTML and injects the OAT bridge', () => {
    const html = buildPreviewHTML(
      makeContent({ type: 'html', content: '<div id="x">hi</div>' }),
      'dark'
    );
    expect(html).toContain('<div id="x">hi</div>');
    expect(html).toContain('ArtifactRuntime');
  });

  it('chart branch inlines Chart.js and the parsed spec', () => {
    const spec = JSON.stringify({
      type: 'bar',
      data: { labels: ['A', 'B'], datasets: [{ data: [1, 2] }] },
    });
    const html = buildPreviewHTML(makeContent({ type: 'chart', content: spec }), 'dark');
    expect(html).toContain('chart.js@4');
    expect(html).toContain('<canvas id="chart">');
    // The spec is JSON.stringify'd as an embedded JS string literal, so the
    // iframe parses it back out at runtime. Assert the escaped form is present.
    expect(html).toContain('\\"type\\":\\"bar\\"');
  });

  it('chart branch neutralizes embedded </script> so it cannot escape the script tag', () => {
    const specWithTag = '{"labels":["</script>"]}';
    const html = buildPreviewHTML(makeContent({ type: 'chart', content: specWithTag }), 'dark');
    // Raw </script> inside the inline JSON would otherwise close our script tag; we rewrite
    // it to <\/script> before embedding. Verify there is no raw closing tag in the body spec.
    const bodyStart = html.indexOf('<body>');
    expect(bodyStart).toBeGreaterThanOrEqual(0);
    const body = html.slice(bodyStart);
    expect(body).not.toContain('</script>"]');
  });

  it('csv branch produces a table skeleton and preserves source in a JSON literal', () => {
    const csv = 'name,age\nAda,42\nGrace,28';
    const html = buildPreviewHTML(makeContent({ type: 'csv', content: csv }), 'light');
    expect(html).toContain('<table>');
    // Source is embedded as a JSON string literal, so csv bytes survive verbatim.
    expect(html).toContain(JSON.stringify(csv));
  });

  it('latex branch loads KaTeX and embeds the source safely', () => {
    const tex = '\\int_0^1 x^2 \\, dx = \\frac{1}{3}';
    const html = buildPreviewHTML(makeContent({ type: 'latex', content: tex }), 'dark');
    expect(html).toContain('katex.min.css');
    expect(html).toContain('katex.render');
    // Backslashes round-trip through JSON.stringify so KaTeX sees the original source.
    expect(html).toContain(JSON.stringify(tex));
  });

  it('canvas branch wraps raw JS inside a try/catch around the canvas element', () => {
    const js = 'ctx.fillStyle = "#f00"; ctx.fillRect(10, 10, 50, 50);';
    const html = buildPreviewHTML(makeContent({ type: 'canvas', content: js }), 'dark');
    expect(html).toContain('<canvas id="drawing"');
    expect(html).toContain(js);
    expect(html).toContain('try {');
    expect(html).toContain('canvas-error');
  });

  it('fallback <pre> branch escapes angle brackets so raw code cannot break out', () => {
    const html = buildPreviewHTML(
      makeContent({ type: 'code', content: '<script>alert(1)</script>' }),
      'dark'
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // And no unescaped <script>alert leakage.
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('svg branch embeds the raw SVG verbatim', () => {
    const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
    const html = buildPreviewHTML(makeContent({ type: 'svg', content: svg }), 'light');
    expect(html).toContain(svg);
  });

  it('react branch loads React UMD + Babel and injects the component source', () => {
    const code = 'function App() { return <div>hi</div>; }';
    const html = buildPreviewHTML(
      makeContent({ type: 'react', content: code, language: 'tsx' }),
      'dark'
    );
    expect(html).toContain('react@18/umd/react.production.min.js');
    expect(html).toContain('data-presets="react,typescript"');
    expect(html).toContain('function App');
  });

  it('full-HTML passthrough injects theme defense into <head>', () => {
    const fullDoc = '<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>';
    const html = buildPreviewHTML(makeContent({ type: 'html', content: fullDoc }), 'dark');
    // Theme-defense block must appear once and preserve the doctype.
    expect(html).toMatch(/<!DOCTYPE html>/i);
    expect(html).toContain('data-aw-theme-defense');
  });
});
