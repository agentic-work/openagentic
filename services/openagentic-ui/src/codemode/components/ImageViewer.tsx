/**
 * ImageViewer — base64 -> Blob -> ObjectURL <img> renderer for the codemode
 * editor pane (A.22 Phase 1).
 *
 * Used for png/jpg/gif/webp/bmp/ico AND svg. SVGs are rendered via blob URL
 * (rather than inlined) so the daemon-fetched markup runs in an isolated
 * context — the surrounding app DOM cannot be reached from a sandboxed image.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface ImageViewerProps {
  /** Source path — used for alt text + cache key. */
  path: string;
  /** Base64-encoded file bytes from the daemon. */
  base64: string;
  /** MIME type — controls how the browser decodes the blob. */
  contentType: string;
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1) || p;
}

function base64ToUint8Array(b64: string): Uint8Array {
  // atob is fine in jsdom + browsers
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function ImageViewer({
  path,
  base64,
  contentType,
}: ImageViewerProps): React.ReactElement {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const bytes = base64ToUint8Array(base64);
    const blob = new Blob([bytes], { type: contentType });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setBlobUrl(url);

    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [path, base64, contentType]);

  return (
    <div className="fp-editor-image-wrap">
      <img
        className="fp-editor-image"
        src={blobUrl ?? undefined}
        alt={basename(path)}
      />
    </div>
  );
}
