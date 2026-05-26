/**
 * EditorPane — Monaco-based read-only editor for the codemode file panel.
 *
 * Breadcrumbs finding: Monaco standalone does NOT support workbench-level
 * breadcrumbs (those are VSCode-shell features, not part of monaco-editor).
 * Fallback: a custom `.fp-editor-breadcrumbs` strip above the editor renders
 * path segments separated by `/` chevrons. Styled via CSS.
 *
 * A.22 Phase 1: file-kind router selects between Monaco / ImageViewer /
 * PDFViewer based on the active path's extension. Binary files arriving with
 * `encoding: 'base64'` content go to ImageViewer or PDFViewer; everything
 * else (zip, etc.) falls through to BinaryPlaceholder.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { getMonaco } from '../monaco/monacoLoader';
import { languageFromExt, languageLabel } from '../monaco/languageFromExt';
import { BinaryPlaceholder } from './BinaryPlaceholder';
import { EditorStatusStrip } from './EditorStatusStrip';
import { ImageViewer } from './ImageViewer';
import { PDFViewer } from './PDFViewer';
import { fileKind, type FileKind } from './fileKind';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface ReadFileResult {
  content: string | null;
  contentType: string;
  size: number;
  mtimeMs: number;
  sha256: string;
  isBinary: boolean;
  reason?: 'binary' | 'too_large';
  /** A.22: present when the daemon returned base64-encoded binary content. */
  encoding?: 'base64';
  /** A.22: true when the file exceeded the 5 MB binary cap. */
  sizeOverLimit?: boolean;
  /** A.22: byte size when sizeOverLimit is true. */
  sizeBytes?: number;
}

export interface EditorPaneProps {
  activePath: string | null;
  fileContent: ReadFileResult | null;
  error: string | null;
  cursorPosition: { line: number; column: number } | null;
  onCursorChange?: (pos: { line: number; column: number }) => void;
  onDownload?: (path: string) => void;
  /** Buffer changed in the editor — parent updates contentByPath and dirty store. */
  onContentChange?: (path: string, content: string) => void;
  /** Cmd/Ctrl+S or autosave-on-blur — parent persists via write_file RPC. */
  onSave?: (path: string, content: string) => void | Promise<void>;
  /** True when the active path has unsaved buffer changes. Drives blur autosave. */
  isDirty?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

function currentThemeId(): string {
  return document.documentElement.getAttribute('data-cm-theme') ?? 'default';
}

/**
 * Placeholder binary fetch for image preview. In A.6 the parent FilePanel
 * will wire in the real daemon RPC. Tests mock this module.
 */
export async function fetchBinary(_path: string): Promise<Uint8Array> {
  return new Uint8Array(0);
}

// ---------------------------------------------------------------------------
// useImageBlob — create a blob URL from binary content
// ---------------------------------------------------------------------------
function useImageBlob(
  path: string | null,
  contentType: string,
  active: boolean,
): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !path) {
      setBlobUrl(null);
      return;
    }

    let cancelled = false;
    fetchBinary(path).then((bytes) => {
      if (cancelled) return;
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      setBlobUrl(url);
    });

    return () => {
      cancelled = true;
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, [path, contentType, active]);

  return blobUrl;
}

// ---------------------------------------------------------------------------
// LegacyImageRender — preserves the pre-A.22 fetchBinary flow for the
// `content: null` image case.  Kept narrow on purpose — the modern path goes
// through ImageViewer with a base64 payload.
// ---------------------------------------------------------------------------
interface LegacyImageRenderProps {
  path: string;
  fileContent: ReadFileResult;
  cursorPosition: { line: number; column: number } | null;
  onDownload?: (path: string) => void;
}

function LegacyImageRender({
  path,
  fileContent,
  cursorPosition,
  onDownload,
}: LegacyImageRenderProps): React.ReactElement {
  const blobUrl = useImageBlob(path, fileContent.contentType, true);
  return (
    <div className="fp-editor">
      <img
        className="fp-editor-image"
        src={blobUrl ?? undefined}
        alt={basename(path)}
      />
      <EditorStatusStrip
        path={path}
        languageLabel="image"
        cursor={cursorPosition}
        sizeBytes={fileContent.size}
        onDownload={onDownload ? () => onDownload(path) : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorPane
// ---------------------------------------------------------------------------
export function EditorPane({
  activePath,
  fileContent,
  error,
  cursorPosition,
  onCursorChange,
  onDownload,
  onContentChange,
  onSave,
  isDirty,
}: EditorPaneProps): React.ReactElement {
  const [monacoReady, setMonacoReady] = useState(false);
  const [themeId, setThemeId] = useState<string>(() => currentThemeId());
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // Refs to keep the latest callbacks/path/dirty available inside Monaco
  // disposables (which capture the closure once at mount).
  const onSaveRef = useRef<EditorPaneProps['onSave']>(onSave);
  const onContentChangeRef = useRef<EditorPaneProps['onContentChange']>(onContentChange);
  const activePathRef = useRef<string | null>(activePath);
  const isDirtyRef = useRef<boolean>(!!isDirty);
  const lastKeystrokeRef = useRef<number>(0);

  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  useEffect(() => { onContentChangeRef.current = onContentChange; }, [onContentChange]);
  useEffect(() => { activePathRef.current = activePath; }, [activePath]);
  useEffect(() => { isDirtyRef.current = !!isDirty; }, [isDirty]);

  // ---------------------------------------------------------------------------
  // Initialise Monaco + register themes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    getMonaco().then((m) => {
      if (!alive) return;
      monacoRef.current = m;
      setMonacoReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Theme sync — MutationObserver on documentElement.attributes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const id = currentThemeId();
      setThemeId(id);
      monacoRef.current?.editor?.setTheme?.(`cm-${id}`);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-cm-theme'],
    });

    // Cross-tab sync via localStorage 'storage' event
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cm-theme' && e.newValue) {
        const id = e.newValue;
        setThemeId(id);
        monacoRef.current?.editor?.setTheme?.(`cm-${id}`);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Font sync
  // ---------------------------------------------------------------------------
  const fontFamily = typeof window !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue('--cm-mono-font').trim() ||
      '"JetBrains Mono", "Fira Code", monospace'
    : '"JetBrains Mono", monospace';

  // ---------------------------------------------------------------------------
  // Editor mount — wires cursor, save command, blur autosave.
  // ---------------------------------------------------------------------------
  const BLUR_AUTOSAVE_DEBOUNCE_MS = 500;

  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;
      editor.onDidChangeCursorPosition((e: any) => {
        const pos = {
          line: e.position.lineNumber,
          column: e.position.column,
        };
        onCursorChange?.(pos);
      });
      // Apply font options
      editor.updateOptions({
        fontFamily,
        fontLigatures: true,
        fontSize: 13,
        lineHeight: 1.5,
      });

      // Cmd/Ctrl+S → onSave with the current buffer
      const m = monaco ?? monacoRef.current;
      if (m?.KeyMod && m?.KeyCode && typeof editor.addCommand === 'function') {
        editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
          const path = activePathRef.current;
          if (!path) return;
          const value = typeof editor.getValue === 'function' ? editor.getValue() : '';
          onSaveRef.current?.(path, value);
        });
      }

      // Autosave on blur when the buffer is dirty AND the user paused typing.
      if (typeof editor.onDidBlurEditorWidget === 'function') {
        editor.onDidBlurEditorWidget(() => {
          if (!isDirtyRef.current) return;
          const path = activePathRef.current;
          if (!path) return;
          const sinceLastKey = Date.now() - lastKeystrokeRef.current;
          if (sinceLastKey < BLUR_AUTOSAVE_DEBOUNCE_MS) return;
          const value = typeof editor.getValue === 'function' ? editor.getValue() : '';
          onSaveRef.current?.(path, value);
        });
      }
    },
    [fontFamily, onCursorChange],
  );

  // Buffer change handler — bridges @monaco-editor/react onChange into props.
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      lastKeystrokeRef.current = Date.now();
      const path = activePathRef.current;
      if (!path) return;
      onContentChangeRef.current?.(path, value ?? '');
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // File-kind routing (A.22 Phase 1)
  // ---------------------------------------------------------------------------
  const kind: FileKind = activePath
    ? fileKind(activePath, fileContent?.contentType)
    : 'text';

  // Legacy fallback: when an older daemon returns content:null for an image,
  // we still render a placeholder via the binary path. The new ImageViewer
  // path activates only when content (base64) is present.
  const hasBase64Content =
    fileContent?.isBinary === true && typeof fileContent.content === 'string';

  // ---------------------------------------------------------------------------
  // Render: empty state
  // ---------------------------------------------------------------------------
  if (!activePath) {
    return (
      <div className="fp-editor fp-editor-empty">
        <div className="fp-editor-empty-msg">
          <span className="fp-editor-logo">◈</span>
          <p>No file open · Click a file in the tree to view it</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: error state
  // ---------------------------------------------------------------------------
  if (error) {
    return (
      <div className="fp-editor fp-editor-error">
        <div className="fp-editor-error-banner">
          <strong>Error:</strong> {error}
          <span className="fp-editor-retry-hint"> — try clicking the file again</span>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: loading state
  // ---------------------------------------------------------------------------
  if (!fileContent) {
    return (
      <div className="fp-editor fp-editor-loading-wrap">
        <div className="fp-editor-loading">Loading {basename(activePath)}…</div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: image / SVG preview (A.22 Phase 1)
  // ---------------------------------------------------------------------------
  if ((kind === 'image' || kind === 'svg') && hasBase64Content) {
    return (
      <div className="fp-editor">
        <ImageViewer
          path={activePath}
          base64={fileContent.content as string}
          contentType={fileContent.contentType}
        />
        <EditorStatusStrip
          path={activePath}
          languageLabel={kind === 'svg' ? 'svg' : 'image'}
          cursor={cursorPosition}
          sizeBytes={fileContent.size}
          onDownload={onDownload ? () => onDownload(activePath) : undefined}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: PDF preview (A.22 Phase 1)
  // ---------------------------------------------------------------------------
  if (kind === 'pdf' && hasBase64Content) {
    return (
      <div className="fp-editor">
        <PDFViewer
          path={activePath}
          base64={fileContent.content as string}
          contentType={fileContent.contentType}
        />
        <EditorStatusStrip
          path={activePath}
          languageLabel="pdf"
          cursor={cursorPosition}
          sizeBytes={fileContent.size}
          onDownload={onDownload ? () => onDownload(activePath) : undefined}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: legacy image (no base64 content from daemon — show blob via
  // existing useImageBlob fetchBinary path)
  // ---------------------------------------------------------------------------
  if (
    fileContent.isBinary &&
    fileContent.contentType.startsWith('image/') &&
    !hasBase64Content
  ) {
    return <LegacyImageRender
      path={activePath}
      fileContent={fileContent}
      cursorPosition={cursorPosition}
      onDownload={onDownload}
    />;
  }

  // ---------------------------------------------------------------------------
  // Render: binary / too_large placeholder
  // ---------------------------------------------------------------------------
  if (fileContent.isBinary) {
    const reason = fileContent.sizeOverLimit
      ? 'too_large'
      : (fileContent.reason ?? 'binary');
    return (
      <div className="fp-editor">
        <BinaryPlaceholder
          contentType={fileContent.contentType}
          size={fileContent.size}
          reason={reason}
          onDownload={onDownload ? () => onDownload(activePath) : undefined}
        />
        <EditorStatusStrip
          path={activePath}
          languageLabel="binary"
          cursor={null}
          sizeBytes={fileContent.size}
          onDownload={onDownload ? () => onDownload(activePath) : undefined}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: text (Monaco)
  // ---------------------------------------------------------------------------
  const lang = languageFromExt(activePath);
  const label = languageLabel(lang);
  const monacoTheme = `cm-${themeId}`;

  // Custom breadcrumb strip (fallback since Monaco standalone has no breadcrumbs)
  const segments = activePath.split('/').filter(Boolean);

  return (
    <div className="fp-editor">
      {/* Custom breadcrumb strip */}
      <div className="fp-editor-breadcrumbs" aria-label="File breadcrumb">
        {segments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="fp-breadcrumb-sep">/</span>}
            <span
              className={`fp-breadcrumb-seg${i === segments.length - 1 ? ' active' : ''}`}
            >
              {seg}
            </span>
          </React.Fragment>
        ))}
      </div>

      {monacoReady ? (
        <Editor
          height="100%"
          value={fileContent.content ?? ''}
          language={lang}
          theme={monacoTheme}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
          options={{
            readOnly: false,
            domReadOnly: false,
            lineNumbers: 'on',
            wordWrap: 'off',
            minimap: { enabled: false },
            stickyScroll: { enabled: true },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
            roundedSelection: false,
          }}
        />
      ) : (
        <div className="fp-editor-loading">Loading editor…</div>
      )}

      <EditorStatusStrip
        path={activePath}
        languageLabel={label}
        cursor={cursorPosition}
        sizeBytes={fileContent.size}
        onDownload={onDownload ? () => onDownload(activePath) : undefined}
      />
    </div>
  );
}
