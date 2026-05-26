import React from 'react';

// =============================================================================
// Wire-format type (from A.1)
// =============================================================================

export interface ListDirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  mtimeMs: number;
  mode: number;
  isReadable: boolean;
}

// =============================================================================
// Component props
// =============================================================================

export interface FileTreeProps {
  /** Root path that owns these entries. e.g. "/workspaces/<userId>". */
  rootPath: string;
  /** Map from absolute path → that path's immediate children (from list_dir). */
  childrenByPath: Map<string, ListDirEntry[]>;
  /** Set of absolute paths currently expanded. */
  expandedPaths: Set<string>;
  /** Currently active (selected) file path, or null. */
  activePath: string | null;
  /** Path openagentic is currently editing (Phase C); for ●editing indicator. */
  editingPath: string | null;
  /** Paths with unsaved buffer (Phase B); for ●dirty indicator. */
  dirtyPaths: Set<string>;
  /** Paths recently modified (Phase C); for green pulse animation. */
  recentlyModifiedPaths: Set<string>;
  /** User clicked a file leaf → open it. */
  onOpenFile: (path: string) => void;
  /** User clicked a directory's twisty → toggle expand. */
  onToggleExpand: (path: string) => void;
  /** Optional: right-click on a tree node → show context menu. */
  onContextMenu?: (e: React.MouseEvent, path: string, kind: 'file' | 'dir') => void;
}

// =============================================================================
// File icon kind mapper (named export — used by FileTabs, status strip, etc.)
// =============================================================================

export function fileIconKind(name: string): string {
  const lower = name.toLowerCase();

  // No-extension special cases (check before extension logic)
  if (lower === 'dockerfile') return 'yaml';
  if (lower === '.gitignore' || lower === '.env.example') return 'md';

  const dotIdx = name.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === 0) {
    // No extension or hidden file with no secondary extension
    return 'txt';
  }

  const ext = lower.slice(dotIdx);
  switch (ext) {
    case '.py':
      return 'py';
    case '.ts':
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.jsx':
    case '.mjs':
      return 'js';
    case '.json':
      return 'json';
    case '.md':
      return 'md';
    case '.yml':
    case '.yaml':
    case '.toml':
      return 'yaml';
    case '.css':
    case '.scss':
      return 'css';
    case '.html':
      return 'html';
    case '.svg':
      return 'svg';
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.bmp':
    case '.ico':
      return 'image';
    case '.pdf':
      return 'pdf';
    case '.sh':
    case '.bash':
      return 'sh';
    case '.go':
      return 'go';
    case '.rs':
      return 'rs';
    default:
      return 'txt';
  }
}

// =============================================================================
// Internal flat-traversal record
// =============================================================================

interface FlatNode {
  path: string;
  entry: ListDirEntry;
  lvl: number;
}

function buildFlatNodes(
  parentPath: string,
  childrenByPath: Map<string, ListDirEntry[]>,
  expandedPaths: Set<string>,
  lvl: number,
  out: FlatNode[]
): void {
  const entries = childrenByPath.get(parentPath) ?? [];
  for (const entry of entries) {
    const path = `${parentPath}/${entry.name}`;
    out.push({ path, entry, lvl });
    if (
      entry.type === 'dir' &&
      expandedPaths.has(path) &&
      childrenByPath.has(path)
    ) {
      buildFlatNodes(path, childrenByPath, expandedPaths, lvl + 1, out);
    }
  }
}

// =============================================================================
// FileTree component
// =============================================================================

export function FileTree(props: FileTreeProps): JSX.Element {
  const {
    rootPath,
    childrenByPath,
    expandedPaths,
    activePath,
    editingPath,
    dirtyPaths,
    recentlyModifiedPaths,
    onOpenFile,
    onToggleExpand,
    onContextMenu,
  } = props;

  // Build flat list of nodes (all siblings of fp-tree, not nested)
  const flat: FlatNode[] = [];
  buildFlatNodes(rootPath, childrenByPath, expandedPaths, 0, flat);

  return (
    <div className="fp-tree">
      {flat.map(({ path, entry, lvl }) => {
        const isDir = entry.type === 'dir';
        const isFile = entry.type === 'file' || entry.type === 'other';
        const isSymlink = entry.type === 'symlink';
        const isExpanded = expandedPaths.has(path);
        const isActive = path === activePath;
        const isEditing = path === editingPath;
        const isDirty = dirtyPaths.has(path);
        const isRecent = recentlyModifiedPaths.has(path);
        const isUnreadableSymlink = isSymlink && !entry.isReadable;

        // CSS classes for the row div
        const nodeClasses = [
          'fp-node',
          `lvl-${lvl}`,
          isActive ? 'active' : '',
          isRecent ? 'flash' : '',
          isEditing ? 'editing' : '',
        ]
          .filter(Boolean)
          .join(' ');

        // Inline style for unreadable symlinks
        const nodeStyle: React.CSSProperties | undefined = isUnreadableSymlink
          ? { opacity: 0.5 }
          : undefined;

        // Title for unreadable symlinks
        const nodeTitle = isUnreadableSymlink
          ? 'symlink target outside workspace'
          : undefined;

        // Row click: dirs toggle expand, files open
        function handleRowClick(e: React.MouseEvent) {
          if (isDir) {
            onToggleExpand(path);
          } else {
            onOpenFile(path);
          }
        }

        function handleRowKeyDown(e: React.KeyboardEvent) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isDir) {
              onToggleExpand(path);
            } else {
              onOpenFile(path);
            }
          }
        }

        // Twisty click (dirs only) — stops propagation to avoid double-toggle
        function handleTwistyClick(e: React.MouseEvent) {
          e.stopPropagation();
          onToggleExpand(path);
        }

        function handleTwistyKeyDown(e: React.KeyboardEvent) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggleExpand(path);
          }
        }

        // Twisty element
        const twisty = isDir ? (
          <span
            className="twisty"
            role="button"
            tabIndex={0}
            onClick={handleTwistyClick}
            onKeyDown={handleTwistyKeyDown}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="twisty empty">·</span>
        );

        // Icon element
        const iconEl =
          isDir ? (
            <span className="icon folder">📁</span>
          ) : (
            <span className={`icon file-${fileIconKind(entry.name)}`}>📄</span>
          );

        // Indicator (priority: editing > dirty > recent > none)
        let indicator: React.ReactNode = null;
        if (isEditing) {
          indicator = (
            <span className="ind editing" title="openagentic is editing"></span>
          );
        } else if (isDirty) {
          indicator = (
            <span className="ind dirty" title="unsaved changes">
              ●
            </span>
          );
        } else if (isRecent) {
          indicator = (
            <span className="ind recent" title="recently modified"></span>
          );
        }

        return (
          <div
            key={path}
            className={nodeClasses}
            style={nodeStyle}
            title={nodeTitle}
            role="button"
            tabIndex={0}
            aria-current={isActive ? 'page' : undefined}
            onClick={handleRowClick}
            onKeyDown={handleRowKeyDown}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, path, isDir ? 'dir' : 'file') : undefined}
          >
            {twisty}
            {iconEl}
            <span className="name">{entry.name}</span>
            {indicator}
          </div>
        );
      })}
    </div>
  );
}
