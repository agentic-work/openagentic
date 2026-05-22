import React, { useEffect, useRef, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

export interface FileContextMenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface FileContextMenuProps {
  x: number;
  y: number;
  items: FileContextMenuItem[];
  onClose: () => void;
}

// =============================================================================
// FileContextMenu
// =============================================================================

const FLIP_THRESHOLD = 200;

export function FileContextMenu({
  x,
  y,
  items,
  onClose,
}: FileContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  // Compute flip flags based on viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const flipX = vw - x < FLIP_THRESHOLD;
  const flipY = vh - y < FLIP_THRESHOLD;

  // Inline style for positioning
  const style: React.CSSProperties = {
    position: 'fixed',
    left: flipX ? undefined : x,
    right: flipX ? vw - x : undefined,
    top: flipY ? undefined : y,
    bottom: flipY ? vh - y : undefined,
    zIndex: 1000,
  };

  // Click outside → close (capture phase)
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [onClose]);

  // Scroll outside → close
  useEffect(() => {
    function handleScroll() {
      onClose();
    }
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Enabled items only for keyboard nav
  const enabledIndices = items
    .map((item, idx) => (item.disabled ? -1 : idx))
    .filter(i => i >= 0);

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const curPos = enabledIndices.indexOf(focusedIdx);
      const nextPos = curPos < enabledIndices.length - 1 ? curPos + 1 : 0;
      const nextIdx = enabledIndices[nextPos];
      setFocusedIdx(nextIdx);
      // Focus the item element
      const itemEl = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[nextIdx];
      itemEl?.focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const curPos = enabledIndices.indexOf(focusedIdx);
      const prevPos = curPos > 0 ? curPos - 1 : enabledIndices.length - 1;
      const prevIdx = enabledIndices[prevPos];
      setFocusedIdx(prevIdx);
      const itemEl = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[prevIdx];
      itemEl?.focus();
    }
  }

  function handleItemKeyDown(e: React.KeyboardEvent, item: FileContextMenuItem) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!item.disabled) {
        item.onClick();
        onClose();
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const classes = [
    'fp-ctx-menu',
    flipX ? 'flip-x' : '',
    flipY ? 'flip-y' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={menuRef}
      className={classes}
      role="menu"
      style={style}
      onKeyDown={handleMenuKeyDown}
      tabIndex={-1}
      aria-label="Context menu"
    >
      {items.map((item, idx) => (
        <div
          key={idx}
          role="menuitem"
          tabIndex={item.disabled ? -1 : 0}
          className={[
            'fp-ctx-item',
            item.disabled ? 'disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-disabled={item.disabled ? true : undefined}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          onKeyDown={e => handleItemKeyDown(e, item)}
        >
          <span className="fp-ctx-label">{item.label}</span>
          {item.shortcut !== undefined && (
            <span className="fp-ctx-shortcut">{item.shortcut}</span>
          )}
        </div>
      ))}
    </div>
  );
}
