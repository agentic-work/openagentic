/**
 * FileTreeSection — A.13 workspace file tree for the ChatSidebar.
 *
 * Extracted from FilePanel's .fp-left column. Renders:
 *   - A workspace header with refresh button
 *   - A FileTree populated from childrenByPath / expandedPaths (via fileStatusStore)
 *   - A tree-error div when bridge.call is null or list_dir fails
 *
 * The data-loading logic (loadDir polling + childrenByPath state) that
 * previously lived in FilePanel now lives here. FilePanel becomes a
 * pure editor pane.
 *
 * Bridge: reads useDaemonRPCBridgeCall() from the zustand bridge store.
 * When CodeModeChatView mounts as a sibling and pushes its daemonRPC.call,
 * this component re-fires the initial load (loadDir is in the effect deps).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileTree, type ListDirEntry } from './FileTree';
import { FileContextMenu, type FileContextMenuItem } from './FileContextMenu';
import { useDaemonRPCBridge, useDaemonRPCBridgeCall, useDaemonRPCBridgeCwd } from '../state/daemonRPCBridge';
import { useExpandedPaths, useActivePath, useFileStatusStore } from '../state/fileStatusStore';

// =============================================================================
// Props
// =============================================================================

export interface FileTreeSectionProps {
  /** Workspace root path (e.g., "/workspaces/<userId>") */
  rootPath: string;
  /** Optional initial directory to expand on mount. */
  initialExpandedPath?: string;
}

// =============================================================================
// Basename helper
// =============================================================================

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

// =============================================================================
// FileTreeSection
// =============================================================================

export function FileTreeSection({ rootPath, initialExpandedPath }: FileTreeSectionProps): JSX.Element {
  // A.16 — Read bridge.call AT call time (via getState) instead of via
  // closure capture from useDaemonRPCBridgeCall(). The mount effect was
  // racing with bridge fill: it'd capture the throwing-fallback at first
  // render, throw, and the tree-error stuck even after bridge filled
  // because the captured `call` reference was stale.
  //
  // Live in console: bridge.call IS a function, manual call from devtools
  // returns entries instantly — but the closure-captured call here was
  // the no-op stub from before the WS opened. getState() always reads
  // latest. We still subscribe via useDaemonRPCBridgeCall() so React
  // re-renders / re-fires the load effect when bridge fills.
  const bridgeCall = useDaemonRPCBridgeCall();

  // A.14: prefer the user-scoped cwd from the bridge (written by CodeModeChatView)
  // over props.rootPath. This ensures list_dir requests go to /workspaces/<userId>
  // rather than the hardcoded /workspaces that canonicalizeUnderRoot rejects.
  const bridgeCwd = useDaemonRPCBridgeCwd();
  const effectiveRootPath = bridgeCwd ?? rootPath;

  const expandedPaths = useExpandedPaths();
  const activePath = useActivePath();
  const { openTab, toggleExpand } = useFileStatusStore.getState();

  const [childrenByPath, setChildrenByPath] = useState<Map<string, ListDirEntry[]>>(new Map());
  const [treeError, setTreeError] = useState<string | null>(null);

  // A.18: right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    path: string;
    kind: 'file' | 'dir';
  } | null>(null);

  // A.21: drag-and-drop upload state — true while a file is being dragged
  // over the tree. Drives the visual drop-zone outline.
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);

  // ── loadDir ──────────────────────────────────────────────────────────────
  // A.16: read bridge.call from getState() at call-time. Closure capture
  // races with bridge fill — the throwing fallback gets baked in on first
  // render. getState() always sees the latest.
  const loadDir = useCallback(
    async (path: string) => {
      const liveCall = useDaemonRPCBridge.getState().call;
      if (!liveCall) {
        setTreeError('Daemon RPC not yet available');
        return;
      }
      try {
        const result = await liveCall<{ entries: ListDirEntry[] }>('list_dir', {
          path,
          depth: 1,
        });
        setChildrenByPath(prev => {
          const next = new Map(prev);
          next.set(path, result.entries);
          return next;
        });
        setTreeError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to list directory';
        setTreeError(msg);
      }
    },
    // bridgeCall in deps so loadDir identity changes when bridge transitions
    // null → fn, which re-fires the mount effect below.
    [bridgeCall],
  );

  // ── Initial load — re-fires when loadDir changes (A.12 fix pattern) ──────
  // A.14: use effectiveRootPath so the load targets the user-scoped workspace.
  useEffect(() => {
    loadDir(effectiveRootPath);
    if (initialExpandedPath && initialExpandedPath !== effectiveRootPath) {
      loadDir(initialExpandedPath);
    }
    // loadDir re-fires when bridgeCall transitions null→fn
    // effectiveRootPath re-fires when bridgeCwd changes (session reconnect)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRootPath, initialExpandedPath, loadDir]);

  // ── Polling: every 2s for root + each expanded path ──────────────────────
  // A.16: read bridge.call via getState at tick time. Always include the
  // root — the first auto-fired loadDir can time out during the WS-ready
  // transition; the next tick recovers. On success, clears treeError so the
  // FileTree replaces the error div.
  useEffect(() => {
    function poll() {
      if (pausedRef.current) return;
      const liveCall = useDaemonRPCBridge.getState().call;
      if (!liveCall) return;
      const root = useDaemonRPCBridge.getState().cwd ?? rootPath;
      const expanded = useFileStatusStore.getState().expandedPaths;
      const paths = new Set<string>([root, ...expanded]);
      paths.forEach(path => {
        liveCall<{ entries: ListDirEntry[] }>('list_dir', { path, depth: 1 })
          .then(result => {
            setChildrenByPath(prev => {
              const next = new Map(prev);
              next.set(path, result.entries);
              return next;
            });
            if (path === root) setTreeError(null);
          })
          .catch(err => {
            // ENOENT means the directory was deleted on the backend (file
            // moved/removed since the user last expanded it). The persisted
            // expandedPaths set otherwise polls forever — evict the stale
            // entry so the tree heals itself. Other errors (network blip,
            // WS reconnect) leave the user's expansion state intact.
            const msg = err instanceof Error ? err.message : String(err);
            if (path !== root && /ENOENT/i.test(msg)) {
              useFileStatusStore.getState().setExpanded(path, false);
            }
          });
      });
    }

    pollingRef.current = setInterval(poll, 2000);

    function onVisibilityChange() {
      pausedRef.current = document.visibilityState === 'hidden';
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (pollingRef.current !== null) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [rootPath]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleOpenFile(path: string) {
    openTab(path);
  }

  function handleToggleExpand(path: string) {
    toggleExpand(path);
    const isCurrentlyExpanded = useFileStatusStore.getState().expandedPaths.has(path);
    if (!isCurrentlyExpanded && !childrenByPath.has(path)) {
      loadDir(path);
    }
  }

  // A.18: right-click context menu handler — mark default-prevented so
  // the browser's native menu doesn't pop, then position our menu at the
  // cursor.
  function handleContextMenu(
    e: React.MouseEvent,
    path: string,
    kind: 'file' | 'dir',
  ) {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, path, kind });
  }

  function buildCtxMenuItems(): FileContextMenuItem[] {
    if (!ctxMenu) return [];
    const isFile = ctxMenu.kind === 'file';
    return [
      {
        label: 'Open',
        onClick: () => {
          if (isFile) openTab(ctxMenu.path);
        },
        disabled: !isFile,
      },
      {
        label: 'Copy path',
        shortcut: '⌘⇧C',
        onClick: () => {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(ctxMenu.path).catch(() => {});
          }
        },
      },
      {
        label: 'Copy name',
        onClick: () => {
          const name = basename(ctxMenu.path);
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(name).catch(() => {});
          }
        },
      },
      {
        label: 'Refresh',
        onClick: () => loadDir(isFile ? effectiveRootPath : ctxMenu.path),
      },
      {
        label: 'Download',
        shortcut: '⌘D',
        onClick: () => {
          if (isFile) downloadFile(ctxMenu.path);
        },
        disabled: !isFile,
      },
      // A.21.b — daemon RPCs are now wired (write_file / delete_file /
      // rename_file in openagentic/src/file-panel/). New Folder remains
      // disabled until the daemon grows a mkdir RPC.
      {
        label: 'New File…',
        onClick: () => {
          handleNewFile();
        },
      },
      // TODO: enable once the daemon ships a mkdir RPC.
      { label: 'New Folder…', onClick: () => {}, disabled: true },
      {
        label: 'Rename…',
        onClick: () => {
          handleRename();
        },
        disabled: !isFile,
      },
      {
        label: 'Delete',
        shortcut: 'Del',
        onClick: () => {
          handleDelete();
        },
        disabled: !isFile,
      },
    ];
  }

  // ── A.21.b — context-menu CRUD handlers ─────────────────────────────────

  async function handleDelete() {
    if (!ctxMenu) return;
    const target = ctxMenu.path;
    if (!window.confirm(`Delete ${basename(target)}?`)) return;

    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setUploadStatus('Daemon RPC not yet available');
      return;
    }
    try {
      await liveCall<{ deleted: true }>('delete_file', { path: target });
      setUploadStatus(`Deleted ${basename(target)}`);
      await loadDir(effectiveRootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setUploadStatus(msg);
    }
  }

  async function handleRename() {
    if (!ctxMenu) return;
    const target = ctxMenu.path;
    const currentName = basename(target);
    const next = window.prompt('New name:', currentName);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;

    const parent = target.slice(0, target.lastIndexOf('/'));
    const to = `${parent}/${trimmed}`;

    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setUploadStatus('Daemon RPC not yet available');
      return;
    }
    try {
      await liveCall('rename_file', { from: target, to });
      setUploadStatus(`Renamed to ${trimmed}`);
      await loadDir(effectiveRootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rename failed';
      setUploadStatus(msg);
    }
  }

  async function handleNewFile() {
    const name = window.prompt('Filename:');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setUploadStatus('Daemon RPC not yet available');
      return;
    }
    try {
      await liveCall('write_file', {
        path: `${effectiveRootPath}/${trimmed}`,
        content: '',
      });
      setUploadStatus(`Created ${trimmed}`);
      await loadDir(effectiveRootPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      setUploadStatus(msg);
    }
  }

  // A.21: download via existing read_file RPC + browser save (text only —
  // binary chunked frames are Phase B). Mirrors FilePanel's downloadFile.
  async function downloadFile(path: string) {
    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setUploadStatus('Daemon RPC not yet available');
      return;
    }
    try {
      const result = await liveCall<{
        content: string | null;
        contentType?: string;
        isBinary?: boolean;
      }>('read_file', { path });
      if (result.isBinary || result.content === null) {
        setUploadStatus('Binary download is supported in Phase B');
        return;
      }
      const blob = new Blob([result.content], {
        type: result.contentType || 'text/plain',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename(path);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      setUploadStatus(msg);
    }
  }

  // A.21: drag-and-drop upload — accepts files dropped into the tree. The
  // upload itself needs a daemon write_file RPC (Phase A.21.b) — for now
  // we surface a friendly placeholder message so the drop affordance is
  // visible and we can ship the visual layer separately.
  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    const liveCall = useDaemonRPCBridge.getState().call;
    if (!liveCall) {
      setUploadStatus('Daemon RPC not yet available');
      return;
    }

    let uploaded = 0;
    const errors: string[] = [];
    for (const f of files) {
      try {
        const text = await f.text();
        await liveCall('write_file', {
          path: `${effectiveRootPath}/${f.name}`,
          content: text,
          overwrite: true,
        });
        uploaded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'upload failed';
        errors.push(`${f.name}: ${msg}`);
      }
    }

    if (errors.length === 0) {
      setUploadStatus(`Uploaded ${uploaded} file${uploaded === 1 ? '' : 's'}`);
    } else if (uploaded > 0) {
      setUploadStatus(`Uploaded ${uploaded}; failed: ${errors.join('; ')}`);
    } else {
      setUploadStatus(`Upload failed: ${errors.join('; ')}`);
    }

    await loadDir(effectiveRootPath);
  }

  const workspaceName = basename(effectiveRootPath) || effectiveRootPath;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      className={`fp-left${isDragOver ? ' fp-left-drag-over' : ''}`}
      data-testid="file-tree-section"
      data-drag-over={isDragOver || undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="fp-left-hdr">
        <span className="label">WORKSPACE</span>
        <span
          className="iconbtn"
          title="Refresh"
          onClick={() => loadDir(effectiveRootPath)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') loadDir(effectiveRootPath);
          }}
          role="button"
          tabIndex={0}
        >
          ↻
        </span>
      </div>

      <div className="fp-workspace">
        <span className="glyph">📂</span>
        <span className="name">{workspaceName}</span>
      </div>

      {treeError ? (
        <div className="fp-tree-error" data-testid="tree-error">
          Error: {treeError}
        </div>
      ) : (
        <FileTree
          rootPath={effectiveRootPath}
          childrenByPath={childrenByPath}
          expandedPaths={expandedPaths}
          activePath={activePath}
          editingPath={null}
          dirtyPaths={new Set()}
          recentlyModifiedPaths={new Set()}
          onOpenFile={handleOpenFile}
          onToggleExpand={handleToggleExpand}
          onContextMenu={handleContextMenu}
        />
      )}

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildCtxMenuItems()}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {uploadStatus && (
        <div
          className="fp-upload-toast"
          data-testid="upload-toast"
          role="status"
          onClick={() => setUploadStatus(null)}
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            padding: '6px 10px',
            background: 'var(--cm-bg-secondary, #161b22)',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--cm-text, #e6edf3)',
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          {uploadStatus}
        </div>
      )}
    </div>
  );
}

export default FileTreeSection;
