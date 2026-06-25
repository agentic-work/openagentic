/**
 * #781 Phase B — exportArtifactToPdf tests.
 *
 * Browser-print-fallback strategy: open a hidden iframe with the markdown
 * rendered as a printable doc, trigger the browser's print dialog, and
 * return a sentinel Blob the caller can use to trigger a download link.
 *
 * The function exposes the constructed printable HTML for testing so
 * callers can assert the markdown was wrapped into a valid HTML doc.
 */
import { describe, it, expect } from 'vitest';
import { buildPrintableHtml } from '../exportPdf.js';

describe('exportArtifactToPdf — #781 Phase B', () => {
  it('buildPrintableHtml wraps markdown content in a printable HTML doc with title', () => {
    const html = buildPrintableHtml('Cost Report', '# Hello\n\nbody');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Cost Report</title>');
    expect(html).toContain('Hello');
    expect(html).toContain('body');
  });

  it('buildPrintableHtml escapes title HTML special characters', () => {
    const html = buildPrintableHtml('A <b>bold</b> & "quoted"', 'body');
    // Title escapes < > & " into entities for the <title> tag
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<title>A <b>bold</b>');
  });

  it('buildPrintableHtml includes print-friendly styles (no chrome, serif typography)', () => {
    const html = buildPrintableHtml('x', 'y');
    expect(html).toMatch(/font-family:[^;]*serif/i);
    expect(html).toContain('@media print');
  });

  it('buildPrintableHtml renders fenced-code markdown blocks as <pre><code>', () => {
    const md = '```python\nprint(1)\n```';
    const html = buildPrintableHtml('x', md);
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('print(1)');
  });
});
