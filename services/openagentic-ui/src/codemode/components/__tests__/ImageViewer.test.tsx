/**
 * Tests for ImageViewer (A.22 Phase 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ImageViewer } from '../ImageViewer';

describe('ImageViewer', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn().mockImplementation((_blob: Blob) => 'blob:http://localhost/test-image-' + Math.random());
    revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });
  });

  it('renders an <img> element with class fp-editor-image', () => {
    render(
      <ImageViewer
        path="/workspace/logo.png"
        base64="iVBORw0KGgo="
        contentType="image/png"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.classList.contains('fp-editor-image')).toBe(true);
  });

  it('builds a blob URL from base64 + contentType', () => {
    render(
      <ImageViewer
        path="/workspace/icon.png"
        base64="iVBORw0KGgo="
        contentType="image/png"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('image/png');
    expect(img.src.startsWith('blob:')).toBe(true);
  });

  it('uses the basename for alt text', () => {
    render(
      <ImageViewer
        path="/workspace/sub/logo.png"
        base64="iVBORw0KGgo="
        contentType="image/png"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.alt).toBe('logo.png');
  });

  it('revokes the blob URL on unmount', () => {
    const { unmount } = render(
      <ImageViewer
        path="/workspace/logo.png"
        base64="iVBORw0KGgo="
        contentType="image/png"
      />
    );
    expect(createObjectURL).toHaveBeenCalledOnce();
    const url = createObjectURL.mock.results[0].value;
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('rebuilds + revokes the URL when path changes', () => {
    const { rerender } = render(
      <ImageViewer
        path="/workspace/a.png"
        base64="iVBORw0KGgo="
        contentType="image/png"
      />
    );
    const url1 = createObjectURL.mock.results[0].value;

    act(() => {
      rerender(
        <ImageViewer
          path="/workspace/b.png"
          base64="iVBORw0KGgg="
          contentType="image/png"
        />
      );
    });

    expect(revokeObjectURL).toHaveBeenCalledWith(url1);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('handles SVG with image/svg+xml contentType', () => {
    render(
      <ImageViewer
        path="/workspace/icon.svg"
        base64={Buffer.from('<svg/>').toString('base64')}
        contentType="image/svg+xml"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    const blobArg = createObjectURL.mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('image/svg+xml');
    expect(img.classList.contains('fp-editor-image')).toBe(true);
  });
});
