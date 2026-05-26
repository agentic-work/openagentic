/**
 * PDFViewer — pdfjs-dist canvas-based PDF renderer for the codemode editor
 * pane (A.22 Phase 1).
 *
 * Uses the legacy build (`pdfjs-dist/legacy/build/pdf.mjs`) for SSR safety
 * and the matching worker (`pdf.worker.min.mjs`).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// ---------------------------------------------------------------------------
// Worker setup — bundle the worker as a static URL.
// ---------------------------------------------------------------------------
// vite/vitest will resolve this URL at build time. In tests the import is
// stubbed so this is a no-op.
try {
  // @ts-ignore — Vite-specific URL import
  const workerUrl = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
  (pdfjs as any).GlobalWorkerOptions.workerSrc = workerUrl;
} catch {
  // ignore — Vitest mock path
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface PDFViewerProps {
  /** Source path — used for the cache key. */
  path: string;
  /** Base64-encoded PDF bytes from the daemon. */
  base64: string;
  /** MIME type — typically application/pdf. */
  contentType: string;
}

// ---------------------------------------------------------------------------
// PDFViewer
// ---------------------------------------------------------------------------
export function PDFViewer({
  path,
  base64,
}: PDFViewerProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNum, setPageNum] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [error, setError] = useState<string | null>(null);

  // ── Load the document on path/base64 change ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPageNum(1);

    const data = base64ToUint8Array(base64);
    const loadingTask = (pdfjs as any).getDocument({ data });
    loadingTask.promise
      .then((doc: any) => {
        if (cancelled) {
          doc.destroy?.();
          return;
        }
        // Destroy any previous doc
        if (docRef.current) {
          docRef.current.destroy?.();
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message ?? 'Failed to load PDF');
        }
      });

    return () => {
      cancelled = true;
      if (docRef.current) {
        docRef.current.destroy?.();
        docRef.current = null;
      }
    };
  }, [path, base64]);

  // ── Render the active page on page/scale change ──────────────────────────
  useEffect(() => {
    if (!docRef.current || numPages === 0) return;
    let cancelled = false;

    docRef.current.getPage(pageNum).then((page: any) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      task.promise.catch(() => {
        // ignore render cancellation
      });
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current?.cancel) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pageNum, scale, numPages]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onPrev = useCallback(() => {
    setPageNum((p) => Math.max(1, p - 1));
  }, []);
  const onNext = useCallback(() => {
    setPageNum((p) => Math.min(numPages, p + 1));
  }, [numPages]);
  const onZoomIn = useCallback(() => {
    setScale((s) => Math.min(3, +(s + 0.5).toFixed(2)));
  }, []);
  const onZoomOut = useCallback(() => {
    setScale((s) => Math.max(0.5, +(s - 0.5).toFixed(2)));
  }, []);

  if (error) {
    return (
      <div className="fp-editor-pdf-error" role="alert">
        <strong>PDF error:</strong> {error}
      </div>
    );
  }

  return (
    <div className="fp-editor-pdf-wrap">
      <div className="fp-editor-pdf-toolbar" role="toolbar" aria-label="PDF controls">
        <button
          type="button"
          aria-label="Previous page"
          onClick={onPrev}
          disabled={pageNum <= 1}
        >
          ◀
        </button>
        <span className="fp-editor-pdf-page-indicator" aria-live="polite">
          {pageNum} / {numPages || '–'}
        </span>
        <button
          type="button"
          aria-label="Next page"
          onClick={onNext}
          disabled={pageNum >= numPages}
        >
          ▶
        </button>
        <span className="fp-editor-pdf-toolbar-sep">·</span>
        <button type="button" aria-label="Zoom out" onClick={onZoomOut}>−</button>
        <span className="fp-editor-pdf-zoom-indicator">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" aria-label="Zoom in" onClick={onZoomIn}>+</button>
      </div>
      <div className="fp-editor-pdf-canvas-wrap">
        <canvas ref={canvasRef} className="fp-editor-pdf-canvas" />
      </div>
    </div>
  );
}
