/**
 * fileKind — extension-first file kind detection for the codemode editor.
 *
 * Used by FilePanel to decide which RPC encoding to request, and by
 * EditorPane to route to the right renderer (Monaco / ImageViewer / PDFViewer
 * / BinaryPlaceholder).
 */

export type FileKind = 'image' | 'svg' | 'pdf' | 'text';

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
]);

const SVG_EXTS = new Set(['svg']);

const PDF_EXTS = new Set(['pdf']);

function ext(path: string): string {
  const i = path.lastIndexOf('.');
  if (i < 0) return '';
  return path.slice(i + 1).toLowerCase();
}

/**
 * Decide a file's kind from its path. Falls back to 'text' for anything not
 * an image/svg/pdf — Monaco will handle text + everything else.
 *
 * `contentType` is honored as a fallback for paths without extensions
 * (rare — daemon-supplied URIs always include a name).
 */
export function fileKind(path: string, contentType?: string): FileKind {
  const e = ext(path);
  if (IMAGE_EXTS.has(e)) return 'image';
  if (SVG_EXTS.has(e)) return 'svg';
  if (PDF_EXTS.has(e)) return 'pdf';

  // Fallback to contentType
  if (contentType) {
    if (contentType === 'application/pdf') return 'pdf';
    if (contentType === 'image/svg+xml') return 'svg';
    if (contentType.startsWith('image/')) return 'image';
  }

  return 'text';
}

/**
 * Predicate for "should we ask the daemon for base64?" — covers image/svg/pdf.
 */
export function isBase64Kind(kind: FileKind): boolean {
  return kind !== 'text';
}
