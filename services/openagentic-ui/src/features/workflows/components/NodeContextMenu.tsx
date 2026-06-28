/**
 * NodeContextMenu — TDD-driven right-click context menu for canvas nodes.
 *
 * Pure presentation: receives an array of menu items + an (x, y) anchor.
 * Renders a positioned floating menu; clicking an item fires the item's
 * onSelect AND onClose so the menu hides; Escape calls onClose.
 *
 * Disabled items render but are inert: clicking does NOT call onSelect
 * or onClose. Danger items get a red label tint.
 */

import React, { useEffect, useRef } from 'react';

export interface NodeContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Optional keyboard hint shown on the right side, e.g. "⌘D" */
  shortcut?: string;
  /** Disabled items render but are not clickable. */
  disabled?: boolean;
}

export interface NodeContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  items: NodeContextMenuItem[];
  onClose: () => void;
}

export const NodeContextMenu: React.FC<NodeContextMenuProps> = ({
  isOpen,
  x,
  y,
  items,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      data-testid="node-context-menu"
      role="menu"
      // Terminal Glass: frosted context menu floating over the canvas via the
      // .glass class. Was an opaque #161b22 menu. Position + text set inline.
      className="glass"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        minWidth: 180,
        padding: 4,
        borderRadius: 'var(--radius-md, 12px)',
        color: 'var(--color-text)',
        fontSize: 13,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={!!item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          style={{
            display: 'flex',
            width: '100%',
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            textAlign: 'left',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            color: item.danger ? 'var(--color-error)' : 'inherit',
            opacity: item.disabled ? 0.5 : 1,
            borderRadius: 4,
            justifyContent: 'space-between',
          }}
        >
          <span>{item.label}</span>
          {item.shortcut ? (
            <span
              style={{
                marginLeft: 16,
                fontSize: 11,
                color: 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {item.shortcut}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
};
