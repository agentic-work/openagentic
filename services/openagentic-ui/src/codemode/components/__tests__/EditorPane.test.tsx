import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReadFileResult, EditorPaneProps } from '../EditorPane';

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react so no actual canvas / web-workers are needed
// ---------------------------------------------------------------------------
vi.mock('@monaco-editor/react', () => ({
  Editor: ({ value, language, theme }: { value: string; language: string; theme: string }) => (
    <div
      data-testid="mock-monaco"
      data-language={language}
      data-theme={theme}
    >
      {value}
    </div>
  ),
  loader: { config: () => {} },
}));

// Mock monacoLoader to avoid real monaco init
vi.mock('../../monaco/monacoLoader', () => ({
  getMonaco: vi.fn().mockResolvedValue({
    editor: {
      defineTheme: vi.fn(),
      setTheme: vi.fn(),
    },
  }),
  registerCmThemes: vi.fn(),
}));

// Mock URL.createObjectURL for image tests
const mockObjectURL = 'blob:http://localhost/test-image';
vi.stubGlobal('URL', {
  createObjectURL: vi.fn().mockReturnValue(mockObjectURL),
  revokeObjectURL: vi.fn(),
});

// Mock pdfjs-dist legacy build — the real bundle dies inside jsdom because
// Promise checks fail.  We just need PDFViewer to render its toolbar.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: () => ({ width: 100, height: 140 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
      destroy: vi.fn(),
    }),
  }),
  GlobalWorkerOptions: { workerSrc: '' },
  version: '5.0.0-test',
}));

// Import AFTER mocks are set up
const { EditorPane } = await import('../EditorPane');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeContent(overrides: Partial<ReadFileResult> = {}): ReadFileResult {
  return {
    content: 'print("hello")',
    contentType: 'text/plain',
    size: 14,
    mtimeMs: Date.now(),
    sha256: 'abc123',
    isBinary: false,
    ...overrides,
  };
}

function defaultProps(overrides: Partial<EditorPaneProps> = {}): EditorPaneProps {
  return {
    activePath: null,
    fileContent: null,
    error: null,
    cursorPosition: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('EditorPane', () => {
  beforeEach(() => {
    // Reset data-cm-theme attribute
    document.documentElement.removeAttribute('data-cm-theme');
  });

  it('shows empty state when activePath is null', async () => {
    await act(async () => {
      render(<EditorPane {...defaultProps()} />);
    });
    expect(screen.getByText(/no file open/i)).toBeTruthy();
  });

  it('shows loading state when fileContent is null and no error', async () => {
    await act(async () => {
      render(<EditorPane {...defaultProps({ activePath: '/a/main.py' })} />);
    });
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('shows error banner when error is set', async () => {
    await act(async () => {
      render(
        <EditorPane
          {...defaultProps({ activePath: '/a/main.py', error: 'permission denied' })}
        />
      );
    });
    expect(screen.getByText(/permission denied/i)).toBeTruthy();
  });

  it('renders mock-monaco for text content with correct language and theme', async () => {
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/workspace/main.py',
          fileContent: makeContent({ isBinary: false, content: 'print("hi")' }),
        })}
      />
    );
    // Wait for async getMonaco to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const el = screen.getByTestId('mock-monaco');
    expect(el.getAttribute('data-language')).toBe('python');
    expect(el.getAttribute('data-theme')).toBe('cm-default');
  });

  it('applies cm-dracula theme when data-cm-theme=dracula is set', async () => {
    document.documentElement.setAttribute('data-cm-theme', 'dracula');
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/workspace/main.py',
          fileContent: makeContent({ isBinary: false, content: 'x=1' }),
        })}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const el = screen.getByTestId('mock-monaco');
    expect(el.getAttribute('data-theme')).toBe('cm-dracula');
  });

  it('renders img element for image binary content', async () => {
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/workspace/logo.png',
          fileContent: makeContent({
            isBinary: true,
            content: null,
            contentType: 'image/png',
            size: 4096,
          }),
        })}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.classList.contains('fp-editor-image')).toBe(true);
  });

  it('renders BinaryPlaceholder for non-image binary content', async () => {
    await act(async () => {
      render(
        <EditorPane
          {...defaultProps({
            activePath: '/workspace/archive.zip',
            fileContent: makeContent({
              isBinary: true,
              content: null,
              contentType: 'application/zip',
              size: 1024,
              reason: 'binary',
            }),
          })}
        />
      );
    });
    expect(screen.getByText(/binary file/i)).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // A.22 Phase 1 — file-kind routing (image/SVG/PDF base64 path)
  // ---------------------------------------------------------------------------

  it('renders ImageViewer (img with blob src) for png path with base64 content', async () => {
    await act(async () => {
      render(
        <EditorPane
          {...defaultProps({
            activePath: '/workspace/logo.png',
            fileContent: makeContent({
              isBinary: true,
              content: 'iVBORw0KGgo=',
              contentType: 'image/png',
              size: 16,
              // @ts-expect-error - encoding only present on base64 payloads
              encoding: 'base64',
            }),
          })}
        />
      );
    });
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.classList.contains('fp-editor-image')).toBe(true);
    expect(img.src.startsWith('blob:')).toBe(true);
  });

  it('renders ImageViewer for svg path with base64 content', async () => {
    const svgB64 = btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await act(async () => {
      render(
        <EditorPane
          {...defaultProps({
            activePath: '/workspace/icon.svg',
            fileContent: makeContent({
              isBinary: true,
              content: svgB64,
              contentType: 'image/svg+xml',
              size: 40,
              // @ts-expect-error
              encoding: 'base64',
            }),
          })}
        />
      );
    });
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.classList.contains('fp-editor-image')).toBe(true);
  });

  it('renders PDFViewer toolbar (page indicator + nav buttons) for pdf path with base64', async () => {
    const pdfB64 = btoa('%PDF-1.4 stub');
    await act(async () => {
      render(
        <EditorPane
          {...defaultProps({
            activePath: '/workspace/spec.pdf',
            fileContent: makeContent({
              isBinary: true,
              content: pdfB64,
              contentType: 'application/pdf',
              size: 14,
              // @ts-expect-error
              encoding: 'base64',
            }),
          })}
        />
      );
    });
    // Only check for the toolbar — pdfjs-dist isn't mocked here so we don't
    // assert page count.
    expect(screen.getByRole('toolbar', { name: /pdf controls/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /next page/i })).toBeTruthy();
  });

  it('routes .ts to Monaco (text editor)', async () => {
    render(
      <EditorPane
        {...defaultProps({
          activePath: '/workspace/util.ts',
          fileContent: makeContent({
            isBinary: false,
            content: 'export const x = 1;',
            contentType: 'application/typescript',
          }),
        })}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const el = screen.getByTestId('mock-monaco');
    expect(el.getAttribute('data-language')).toBe('typescript');
  });
});
