/**
 * #781 Phase B — PNG export for artifact slide-outs.
 *
 * Strategy: SVG-rasterize fallback (no `html-to-image` dep).
 *   1. Snapshot the element's outerHTML inside an SVG <foreignObject>
 *   2. Encode the SVG → data: URL
 *   3. Draw the data URL into a <canvas> via Image.onload
 *   4. canvas.toBlob('image/png') → trigger download
 *
 * In jsdom (no canvas/Image), step 3 fails — we fall back to handing
 * the user the SVG itself (still a valid vector image). In real
 * browsers users get a real PNG.
 *
 * Note: foreignObject can't render external resources (CSS files,
 * webfonts, etc.). The artifact slide-out uses inline styles where
 * possible. Phase C renderers that need precise pixel fidelity should
 * embed their fonts/CSS inline.
 */

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Wrap an HTMLElement as an SVG with a foreignObject containing its outerHTML. */
export function wrapElementAsSvg(element: HTMLElement): string {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width)) || 800;
  const height = Math.max(1, Math.ceil(rect.height)) || 600;
  const innerHtml = element.outerHTML;
  // Strip any <script> tags defensively before embedding
  const safeHtml = innerHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <foreignObject width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;font-family:ui-sans-serif,system-ui,sans-serif">
      ${safeHtml}
    </div>
  </foreignObject>
</svg>`;
}

function svgToBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    // Revoke after the click has had a chance to fire
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function rasterizeSvgToPng(svg: string, width: number, height: number): Promise<Blob | null> {
  // jsdom lacks Image + canvas — return null to fall back
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  // Detect real canvas support — jsdom's getContext logs "Not implemented"
  // via virtualConsole AND returns null, but ALSO synchronously emits a
  // stderr error that's noisy and causes downstream test failures. The
  // simplest reliable check: look for a real OffscreenCanvas constructor
  // (present in real browsers, absent in jsdom).
  if (typeof OffscreenCanvas === 'undefined') return null;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise<Blob | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, width, height);
        if (typeof (canvas as HTMLCanvasElement).toBlob === 'function') {
          (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/png');
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
    // jsdom may never fire onload — race a timeout
    setTimeout(() => resolve(null), 1500);
  });
}

/**
 * Export the element as a PNG (real browser) or SVG (jsdom / fallback).
 * Always triggers a download anchor click. Always returns the Blob the
 * caller can pass to a download link separately if desired.
 */
export async function exportArtifactToPng(element: HTMLElement, filename: string): Promise<Blob> {
  const svg = wrapElementAsSvg(element);
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width)) || 800;
  const height = Math.max(1, Math.ceil(rect.height)) || 600;

  // Try real PNG rasterization first
  const png = await rasterizeSvgToPng(svg, width, height);
  if (png) {
    triggerDownload(png, filename.endsWith('.png') ? filename : `${filename}.png`);
    return png;
  }

  // Fallback to SVG download
  const blob = svgToBlob(svg);
  const fallbackName = filename.replace(/\.png$/, '.svg');
  triggerDownload(blob, fallbackName.endsWith('.svg') ? fallbackName : `${fallbackName}.svg`);
  return blob;
}
