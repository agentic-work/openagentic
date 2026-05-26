import React, { useRef } from 'react';
import { fileIconKind } from './FileTree';
import type { OpenTab } from '../state/fileStatusStore';

// =============================================================================
// Props
// =============================================================================

export interface FileTabsProps {
  /** Open tabs in MRU order (controlled by FileStatusStore — A.2). */
  tabs: OpenTab[];
  /** Currently active tab's path, or null. */
  activePath: string | null;
  /** Paths with unsaved buffer (Phase B fills this; A.4 just renders the dot). */
  dirtyPaths: Set<string>;
  /** User clicked a tab → activate it. */
  onSelect: (path: string) => void;
  /** User clicked the × on a tab → close it. */
  onClose: (path: string) => void;
  /** Optional: user clicked the trailing + to open more. If not provided, hide +. */
  onAddTab?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Per-kind glyph used in tab icons.  A.22 Phase 1 — replaces blanket 📄. */
function iconGlyph(kind: string): string {
  switch (kind) {
    case 'png':
    case 'jpg':
    case 'gif':
    case 'image':
    case 'svg':
      return '🖼️';
    case 'pdf':
      return '📕';
    case 'py':
    case 'tsx':
    case 'js':
    case 'json':
    case 'yaml':
      return '⚙️';
    case 'md':
      return '📝';
    default:
      return '📄';
  }
}

// =============================================================================
// FileTabs component
// =============================================================================

export function FileTabs(props: FileTabsProps): JSX.Element {
  const { tabs, activePath, dirtyPaths, onSelect, onClose, onAddTab } = props;

  // Ref to the wrapper so we can query all tab elements for arrow nav
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Empty state
  if (tabs.length === 0) {
    return (
      <div className="fp-tabs">
        <span className="fp-tabs-empty">No file open</span>
      </div>
    );
  }

  function getAllTabEls(): HTMLElement[] {
    if (!wrapperRef.current) return [];
    return Array.from(wrapperRef.current.querySelectorAll<HTMLElement>('.fp-tab'));
  }

  function handleTabClick(path: string, isActive: boolean) {
    if (!isActive) {
      onSelect(path);
    }
  }

  function handleCloseClick(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    onClose(path);
  }

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLSpanElement>, path: string, isActive: boolean) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isActive) {
        onSelect(path);
      }
    } else if (e.key === 'w' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onClose(path);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const allTabs = getAllTabEls();
      const idx = allTabs.indexOf(e.currentTarget as HTMLElement);
      if (idx >= 0 && idx < allTabs.length - 1) {
        allTabs[idx + 1].focus();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const allTabs = getAllTabEls();
      const idx = allTabs.indexOf(e.currentTarget as HTMLElement);
      if (idx > 0) {
        allTabs[idx - 1].focus();
      }
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="fp-tabs"
      role="tablist"
      aria-label="Open files"
    >
      {tabs.map(tab => {
        const { path } = tab;
        const name = basename(path);
        const isActive = path === activePath;
        const isDirty = dirtyPaths.has(path);
        const kind = fileIconKind(name);
        const tabId = `tab-${slugify(name)}`;

        const closeEl = isDirty ? (
          <span
            className="close dirty"
            title="Unsaved — click to close"
            onClick={e => handleCloseClick(e, path)}
          >
            ●
          </span>
        ) : (
          <span
            className="close"
            title="Close"
            onClick={e => handleCloseClick(e, path)}
          >
            ×
          </span>
        );

        return (
          <span
            key={path}
            id={tabId}
            className={isActive ? 'fp-tab active' : 'fp-tab'}
            role="tab"
            aria-selected={isActive}
            aria-controls="cm-editor-pane"
            tabIndex={0}
            onClick={() => handleTabClick(path, isActive)}
            onKeyDown={e => handleTabKeyDown(e, path, isActive)}
          >
            <span className={`icon ${kind}`}>{iconGlyph(kind)}</span>
            <span>{name}</span>
            {closeEl}
          </span>
        );
      })}

      <span className="fp-tabs-spacer"></span>

      {onAddTab !== undefined && (
        <span
          className="fp-tabs-action"
          title="Open more"
          role="button"
          tabIndex={0}
          onClick={onAddTab}
        >
          +
        </span>
      )}
    </div>
  );
}
