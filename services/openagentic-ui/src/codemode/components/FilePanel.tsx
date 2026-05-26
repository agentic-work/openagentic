/**
 * FilePanel — A.13 editor-only pane.
 *
 * Post-A.13 this component renders ONLY the right-pane editor (FileTabs +
 * EditorPane). The chrome row, left explorer column, and center column have
 * been removed — the file tree now lives in FileTreeSection (mounted in the
 * ChatSidebar) and the chat column is a sibling at ChatContainer level.
 *
 * The loadFile logic is retained here for tab management (read_file RPC for
 * open tabs). Tree loading (list_dir) is fully owned by FileTreeSection.
 *
 * Bridge: reads the daemon call from useDaemonRPCBridgeCall() (zustand).
 * CodeModeChatView (sibling) writes it on mount.
 *
 * KNOWN LIMITATION (Phase B):
 *   Binary file download is not supported in A.6 because the daemon's
 *   read_file RPC returns `content: null` for binary files. A Phase B
 *   chunked-binary-frame protocol is required for true binary download.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import './FilePanel.css';

import { FileTabs } from './FileTabs';
import { EditorPane, type ReadFileResult } from './EditorPane';
import { fileKind, isBase64Kind } from './fileKind';
import { useDaemonRPCBridge, useDaemonRPCBridgeCall } from '../state/daemonRPCBridge';
import {
  useFileStatusStore,
  useOpenTabs,
  useActivePath,
  useIsDirty,
} from '../state/fileStatusStore';

// =============================================================================
// Props
// =============================================================================

export interface FilePanelProps {
  /** Workspace root path — kept for API compat; not used for tree loading. */
  rootPath: string;
  /** Optional collapsed state — when true, panel renders as a thin toggle bar. */
  collapsed?: boolean;
  /** Notification when collapsed state changes. */
  onCollapsedChange?: (collapsed: boolean) => void;
}

// =============================================================================
// LRU Cache helper (max 20 entries)
// =============================================================================

const LRU_MAX = 20;

function lruSet<V>(map: Map<string, V>, key: string, value: V): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  next.set(key, value);
  if (next.size > LRU_MAX) {
    const oldest = next.keys().next().value;
    if (oldest !== undefined) next.delete(oldest);
  }
  return next;
}

// =============================================================================
// Basename helper
// =============================================================================

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// =============================================================================
// Toast component
// =============================================================================

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className="fp-toast" data-testid="toast">{message}</div>;
}

// =============================================================================
// FilePanel — editor only
// =============================================================================

export function FilePanel({
  rootPath,
  collapsed = false,
  onCollapsedChange,
}: FilePanelProps): JSX.Element {
  // A.20: subscribe so React re-renders + re-fires loadFile when bridge fills,
  // but READ the bridge.call at call-time via getState() so the throwing
  // fallback never gets baked in via closure capture (same bug as A.16).
  const bridgeCall = useDaemonRPCBridgeCall();

  const tabs = useOpenTabs();
  const activePath = useActivePath();
  const dirtyPaths = useFileStatusStore(s => s.dirtyPaths);
  const activeIsDirty = useFileStatusStore(s => activePath !== null && s.dirtyPaths.has(activePath));
  const { closeTab, setActiveTab, openTab, markDirty, clearDirty } = useFileStatusStore.getState();

  const [contentByPath, setContentByPath] = useState<Map<string, ReadFileResult>>(new Map());
  const [errorByPath, setErrorByPath] = useState<Map<string, string>>(new Map());
  const [cursorPosition, setCursorPosition] = useState<{ line: number; column: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  // ── loadFile ──────────────────────────────────────────────────────────────
  // A.20: read bridge.call at call-time via getState() — closure-captured
  // refs go stale when WS reconnects.
  const loadFile = useCallback(
    async (path: string) => {
      if (contentByPath.has(path)) return;
      const liveCall = useDaemonRPCBridge.getState().call;
      if (!liveCall) {
        setErrorByPath(prev => {
          const next = new Map(prev);
          next.set(path, 'Daemon RPC not yet available');
          return next;
        });
        return;
      }
      try {
        // A.22 Phase 1: ask the daemon for base64 when we know the file is
        // a previewable binary kind (image/svg/pdf).  Text falls back to
        // the existing utf8 path.
        const kind = fileKind(path);
        const args: Record<string, unknown> = isBase64Kind(kind)
          ? { path, encoding: 'base64' }
          : { path };
        const result = await liveCall<ReadFileResult>('read_file', args);
        setContentByPath(prev => lruSet(prev, path, result));
        setErrorByPath(prev => {
          const next = new Map(prev);
          next.delete(path);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to read file';
        setErrorByPath(prev => {
          const next = new Map(prev);
          next.set(path, msg);
          return next;
        });
      }
    },
    // bridgeCall in deps so loadFile identity flips when bridge transitions
    // null → fn, re-firing the activePath effect below.
    [bridgeCall, contentByPath],
  );

  // ── Load active file content when activePath changes ──────────────────────
  // A.20.b: also re-fire when bridgeCall transitions null → fn so a click
  // that landed BEFORE the WS opened auto-retries instead of leaving the
  // user stuck on the "try clicking the file again" toast.
  useEffect(() => {
    if (activePath) {
      loadFile(activePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, bridgeCall]);

  // ── Keyboard shortcuts (Cmd+W = close tab) ────────────────────────────────
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    function handleKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;
      if (e.key === 'w') {
        e.preventDefault();
        const active = useFileStatusStore.getState().activePath;
        if (active) {
          closeTab(active);
          setContentByPath(prev => {
            const next = new Map(prev);
            next.delete(active);
            return next;
          });
        }
      }
    }

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [closeTab]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleTabSelect(path: string) {
    try {
      setActiveTab(path);
    } catch {
      openTab(path);
    }
    if (!contentByPath.has(path)) {
      loadFile(path);
    }
  }

  function handleTabClose(path: string) {
    const isDirty = useFileStatusStore.getState().dirtyPaths.has(path);
    if (isDirty) {
      const ok = window.confirm(`Unsaved changes in ${basename(path)}. Discard?`);
      if (!ok) return;
      clearDirty(path);
    }
    closeTab(path);
    setContentByPath(prev => {
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  }

  /** Buffer change inside Monaco — update LRU + mark dirty. */
  function handleContentChange(path: string, content: string) {
    setContentByPath(prev => {
      const existing = prev.get(path);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(path, { ...existing, content, size: content.length });
      return next;
    });
    if (!useFileStatusStore.getState().dirtyPaths.has(path)) {
      markDirty(path);
    }
  }

  /** Cmd+S or blur autosave — write the buffer through the daemon. */
  async function handleSave(path: string, content: string) {
    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setToast('Daemon RPC not yet available — try again in a moment');
      return;
    }
    try {
      await liveCall('write_file', { path, content, overwrite: true });
      clearDirty(path);
      // Keep buffer in sync with what was just saved.
      setContentByPath(prev => {
        const existing = prev.get(path);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(path, { ...existing, content, size: content.length, mtimeMs: Date.now() });
        return next;
      });
      setToast(`Saved ${basename(path)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setToast(msg);
    }
  }

  function downloadFile(path: string) {
    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setToast('Daemon RPC not yet available — try again in a moment');
      return;
    }
    // A.22 Phase 1: previewable binaries download via base64 → byte array.
    const kind = fileKind(path);
    const args: Record<string, unknown> = isBase64Kind(kind)
      ? { path, encoding: 'base64' }
      : { path };
    liveCall<ReadFileResult>('read_file', args)
      .then(result => {
        if (result.content === null) {
          setToast(
            result.sizeOverLimit
              ? 'File exceeds 5 MB download limit'
              : 'Binary download is supported in Phase B',
          );
          return;
        }
        let blob: Blob;
        if (result.isBinary && result.encoding === 'base64') {
          // Decode base64 → bytes for binary download
          const bin = atob(result.content);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], {
            type: result.contentType || 'application/octet-stream',
          });
        } else {
          blob = new Blob([result.content], {
            type: result.contentType || 'text/plain',
          });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = basename(path);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : 'Download failed';
        setToast(msg);
      });
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const activeContent = activePath ? (contentByPath.get(activePath) ?? null) : null;
  const activeError = activePath ? (errorByPath.get(activePath) ?? null) : null;

  // ── Collapsed render ───────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        data-testid="file-panel"
        className="fp-collapsed"
        role="button"
        tabIndex={0}
        title="Expand editor panel"
        onClick={() => onCollapsedChange?.(false)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onCollapsedChange?.(false);
          }
        }}
      >
        📄
      </div>
    );
  }

  // ── Full render — editor only ──────────────────────────────────────────────
  return (
    <div
      ref={panelRef}
      data-testid="file-panel"
      className="fp-panel-root fp-editor-only"
      tabIndex={0}
    >
      <div className="fp-right">
        <FileTabs
          tabs={tabs}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onSelect={handleTabSelect}
          onClose={handleTabClose}
        />

        <EditorPane
          activePath={activePath}
          fileContent={activeContent}
          error={activeError}
          cursorPosition={cursorPosition}
          onCursorChange={setCursorPosition}
          onDownload={downloadFile}
          onContentChange={handleContentChange}
          onSave={handleSave}
          isDirty={activeIsDirty}
        />
      </div>

      {toast !== null && (
        <Toast message={toast} onDone={() => setToast(null)} />
      )}
    </div>
  );
}
