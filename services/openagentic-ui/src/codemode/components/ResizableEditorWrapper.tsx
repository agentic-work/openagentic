/**
 * ResizableEditorWrapper — draggable vertical splitter for the right editor pane.
 *
 * Hosts the FilePanel and provides a 4px-wide drag handle on its LEFT edge so
 * users can widen/narrow the editor at the cost of the chat column. Width
 * persists in localStorage[`cm-editor-pane-width`].
 *
 * Behavior contract:
 *   - Default width: 480px
 *   - Min: 280px (anything less hides too much editor chrome)
 *   - Max: 60vw  (anything more crushes the chat column)
 *   - Drag uses pointer events captured on the document so dragging works even
 *     when the cursor strays out of the handle. Listeners are torn down on
 *     pointerup AND on unmount.
 *   - When `collapsed` is true the wrapper bypasses the resize logic entirely
 *     and lets the child (FilePanel's .fp-collapsed thin bar) own its own size.
 *
 * A11y: the handle is a separator with vertical orientation and aria-valuenow
 * reflecting the current width in pixels.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'cm-editor-pane-width';
// 2026-05-05: trimmed default 480→360 to give the chat transcript
// ~+15% horizontal real estate by default (claude.ai/code chat-first
// proportioning). User can still drag-resize wider; this just changes
// the first-load layout for users without a persisted width.
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;

function getMaxWidth(): number {
  // 60vw — re-read on every clamp so a viewport resize takes effect on next drag.
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  return Math.floor(window.innerWidth * 0.6);
}

function readPersistedWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_WIDTH;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return DEFAULT_WIDTH;
  return clamp(n);
}

function clamp(n: number): number {
  return Math.max(MIN_WIDTH, Math.min(getMaxWidth(), n));
}

export interface ResizableEditorWrapperProps {
  children: React.ReactNode;
  /** When true the wrapper bypasses resize and renders as a thin pass-through. */
  collapsed?: boolean;
}

export function ResizableEditorWrapper({
  children,
  collapsed = false,
}: ResizableEditorWrapperProps): JSX.Element {
  const [width, setWidth] = useState<number>(() => readPersistedWidth());
  const [dragging, setDragging] = useState<boolean>(false);

  const widthRef = useRef<number>(width);
  widthRef.current = width;

  // Holds the document-level handlers so the unmount cleanup can remove the
  // exact same function references that pointerdown registered.
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);

  const detachListeners = useCallback(() => {
    if (moveHandlerRef.current) {
      document.removeEventListener('pointermove', moveHandlerRef.current);
      moveHandlerRef.current = null;
    }
    if (upHandlerRef.current) {
      document.removeEventListener('pointerup', upHandlerRef.current);
      upHandlerRef.current = null;
    }
  }, []);

  // Cleanup on unmount — releases listeners that were registered on
  // pointerdown but never resolved by a pointerup (e.g. user navigated away
  // mid-drag).
  useEffect(() => {
    return () => detachListeners();
  }, [detachListeners]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // left click only
      e.preventDefault();
      setDragging(true);

      const handleMove = (ev: PointerEvent) => {
        // The wrapper sits flush against the right edge of the viewport.
        // The new width is the distance from the pointer to the right edge.
        const next = clamp(window.innerWidth - ev.clientX);
        setWidth(next);
      };

      const handleUp = () => {
        detachListeners();
        setDragging(false);
        try {
          window.localStorage.setItem(STORAGE_KEY, String(widthRef.current));
        } catch {
          // localStorage may throw in private mode / quota — non-fatal.
        }
      };

      moveHandlerRef.current = handleMove;
      upHandlerRef.current = handleUp;
      document.addEventListener('pointermove', handleMove);
      document.addEventListener('pointerup', handleUp);
    },
    [detachListeners],
  );

  if (collapsed) {
    // Bypass: let the child (FilePanel's collapsed bar) own its own size.
    return (
      <div
        data-testid="resizable-editor-wrapper"
        style={{ display: 'flex', height: '100%', flexShrink: 0 }}
      >
        {children}
      </div>
    );
  }

  const handleWidth = dragging ? 6 : 4;

  return (
    <div
      data-testid="resizable-editor-wrapper"
      style={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        width: `${width}px`,
        flexShrink: 0,
      }}
    >
      <div
        data-testid="resizable-editor-handle"
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-label="Resize editor pane"
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: `${handleWidth}px`,
          cursor: 'col-resize',
          zIndex: 5,
          background: dragging
            ? 'var(--cm-accent, #3b82f6)'
            : 'transparent',
          transition: dragging ? 'none' : 'background 120ms ease',
          userSelect: 'none',
          touchAction: 'none',
        }}
        onMouseEnter={e => {
          if (!dragging) {
            (e.currentTarget as HTMLDivElement).style.background =
              'color-mix(in srgb, var(--cm-accent, #3b82f6) 50%, transparent)';
          }
        }}
        onMouseLeave={e => {
          if (!dragging) {
            (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          }
        }}
      />
      <div style={{ flex: 1, minWidth: 0, height: '100%' }}>{children}</div>
    </div>
  );
}

export default ResizableEditorWrapper;
