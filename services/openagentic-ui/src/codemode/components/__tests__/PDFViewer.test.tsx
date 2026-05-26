/**
 * Tests for PDFViewer (A.22 Phase 1).
 *
 * pdfjs-dist is mocked so we don't need a real PDF document.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ----- mock pdfjs-dist -----
const mockRender = vi.fn().mockResolvedValue(undefined);
const mockGetPage = vi.fn().mockImplementation(async (_pageNum: number) => ({
  getViewport: ({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 140 * scale,
  }),
  render: ({ canvasContext, viewport }: any) => ({
    promise: mockRender(canvasContext, viewport),
  }),
  cleanup: vi.fn(),
}));

const fakeDoc = {
  numPages: 3,
  getPage: mockGetPage,
  destroy: vi.fn(),
};

const mockGetDocument = vi.fn().mockReturnValue({
  promise: Promise.resolve(fakeDoc),
});

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: (...args: any[]) => mockGetDocument(...args),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '5.0.0-test',
}));

// Import AFTER mocks
const { PDFViewer } = await import('../PDFViewer');

// jsdom canvas getContext stub
beforeEach(() => {
  mockGetDocument.mockClear();
  mockGetPage.mockClear();
  mockRender.mockClear();
  // Provide a getContext shim (jsdom returns null)
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    canvas: document.createElement('canvas'),
  })) as any;
});

describe('PDFViewer', () => {
  it('passes the base64 binary as Uint8Array to getDocument', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    await act(async () => {
      render(
        <PDFViewer
          path="/workspace/spec.pdf"
          base64={base64}
          contentType="application/pdf"
        />
      );
    });
    await act(async () => {
      // wait for getDocument resolution
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetDocument).toHaveBeenCalledOnce();
    const arg = mockGetDocument.mock.calls[0][0];
    expect(arg).toBeDefined();
    // Either {data: Uint8Array} or Uint8Array
    const data = arg.data ?? arg;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.byteLength).toBe(Buffer.from(base64, 'base64').byteLength);
  });

  it('renders the first page on mount', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    await act(async () => {
      render(
        <PDFViewer
          path="/workspace/spec.pdf"
          base64={base64}
          contentType="application/pdf"
        />
      );
    });
    // Allow promise chain to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockGetPage).toHaveBeenCalledWith(1);
    expect(mockRender).toHaveBeenCalledOnce();
  });

  it('shows page indicator like "1 / 3"', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    await act(async () => {
      render(
        <PDFViewer
          path="/workspace/spec.pdf"
          base64={base64}
          contentType="application/pdf"
        />
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText(/1\s*\/\s*3/)).toBeTruthy();
  });

  it('clicking next button advances the page and renders page 2', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    await act(async () => {
      render(
        <PDFViewer
          path="/workspace/spec.pdf"
          base64={base64}
          contentType="application/pdf"
        />
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const next = screen.getByRole('button', { name: /next/i });
    await act(async () => {
      fireEvent.click(next);
      await new Promise((r) => setTimeout(r, 20));
    });

    // getPage(2) called
    const calls = mockGetPage.mock.calls.map((c) => c[0]);
    expect(calls).toContain(2);
  });

  it('zoom in button bumps the rendered viewport scale', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    await act(async () => {
      render(
        <PDFViewer
          path="/workspace/spec.pdf"
          base64={base64}
          contentType="application/pdf"
        />
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const initialRenderCount = mockRender.mock.calls.length;
    const zoomIn = screen.getByRole('button', { name: /zoom in/i });
    await act(async () => {
      fireEvent.click(zoomIn);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockRender.mock.calls.length).toBeGreaterThan(initialRenderCount);
  });

  it('cleans up the document on unmount', async () => {
    const base64 = Buffer.from('%PDF-1.4 stub').toString('base64');
    const { unmount } = render(
      <PDFViewer
        path="/workspace/spec.pdf"
        base64={base64}
        contentType="application/pdf"
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fakeDoc.destroy).toHaveBeenCalled();
  });
});
