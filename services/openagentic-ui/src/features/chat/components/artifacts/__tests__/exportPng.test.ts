/**
 * #781 Phase B — exportArtifactToPng tests.
 *
 * Strategy: SVG-rasterize fallback (no html-to-image dep). We snapshot
 * the element's outerHTML inside a foreignObject SVG, draw to a canvas,
 * and toBlob the canvas as PNG. In jsdom (no canvas implementation),
 * the function falls back to returning the wrapped SVG as a Blob with
 * type 'image/svg+xml' — still a valid downloadable image, just vector.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wrapElementAsSvg, exportArtifactToPng } from '../exportPng.js';

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL — stub
// them on the prototype so spyOn / mockImplementation work cleanly.
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:mock';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('exportArtifactToPng — #781 Phase B', () => {
  it('wrapElementAsSvg returns an <svg> with foreignObject embedding the outerHTML', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>hello</p>';
    document.body.appendChild(div);
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 80, top: 0, left: 0, right: 200, bottom: 80, x: 0, y: 0 }),
    });

    const svg = wrapElementAsSvg(div);

    expect(svg).toContain('<svg');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(svg).toContain('<p>hello</p>');
    expect(svg).toMatch(/width=["']200["']/);
    expect(svg).toMatch(/height=["']80["']/);

    document.body.removeChild(div);
  });

  it('wrapElementAsSvg uses fallback dimensions when getBoundingClientRect returns 0', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span>x</span>';
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }),
    });
    const svg = wrapElementAsSvg(div);
    expect(svg).toMatch(/width=["']\d+["']/);
    expect(svg).toMatch(/height=["']\d+["']/);
    // Fallback should be non-zero
    expect(svg).not.toMatch(/width=["']0["']/);
  });

  it('exportArtifactToPng returns a Blob (svg fallback in jsdom)', async () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>hi</p>';
    document.body.appendChild(div);
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0 }),
    });
    const blob = await exportArtifactToPng(div, 'test.png');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    // In jsdom (no real canvas), fallback returns SVG; assert the MIME
    // prefix matches one of the valid types so the function works in
    // both jsdom and real browsers.
    expect(blob.type).toMatch(/^image\/(png|svg\+xml)/);
    document.body.removeChild(div);
  });

  it('exportArtifactToPng triggers a download anchor click', async () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>x</p>';
    document.body.appendChild(div);
    Object.defineProperty(div, 'getBoundingClientRect', {
      value: () => ({ width: 100, height: 50, top: 0, left: 0, right: 100, bottom: 50, x: 0, y: 0 }),
    });
    // Mock createObjectURL since jsdom doesn't implement it
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.fn();
    // Patch anchor click globally
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    await exportArtifactToPng(div, 'my-artifact.png');

    expect(urlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
    document.body.removeChild(div);
  });
});
