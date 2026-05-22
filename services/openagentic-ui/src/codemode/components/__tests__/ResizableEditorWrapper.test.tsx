/**
 * ResizableEditorWrapper — vertical splitter test suite.
 *
 * Verifies the draggable splitter on the LEFT edge of the editor pane:
 * default width, localStorage persistence, drag-to-resize with min/max
 * clamps, collapsed bypass path, and listener cleanup on unmount.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { ResizableEditorWrapper } from '../ResizableEditorWrapper';

const STORAGE_KEY = 'cm-editor-pane-width';

beforeEach(() => {
  window.localStorage.clear();
  // Make 60vw deterministic — jsdom defaults innerWidth to 1024 → 60vw = 614.4
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function getRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="resizable-editor-wrapper"]');
  if (!el) throw new Error('wrapper root not found');
  return el as HTMLElement;
}

function getHandle(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-testid="resizable-editor-handle"]');
  if (!el) throw new Error('resize handle not found');
  return el as HTMLElement;
}

/**
 * jsdom does not implement the PointerEvent constructor, so RTL's
 * fireEvent.pointerDown falls back to a bare Event with no clientX/button.
 * We dispatch real MouseEvents typed as `pointerdown`/`pointermove`/`pointerup`
 * — jsdom builds those correctly and React's synthetic event system delegates
 * onPointerDown for any event whose type starts with `pointer`.
 */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { clientX?: number; button?: number } = {},
): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: 0,
  });
}

describe('ResizableEditorWrapper', () => {
  it('1. renders with default 480px width when localStorage empty', () => {
    const { container } = render(
      <ResizableEditorWrapper>
        <div data-testid="child">child</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    expect(root.style.width).toBe('480px');
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('2. reads persisted width from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '550');
    const { container } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    expect(root.style.width).toBe('550px');
  });

  it('3. drag from 480 → 600 updates style.width and writes 600 to localStorage on pointerup', () => {
    const { container } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    const handle = getHandle(container);

    // Starting state: 480px wide. The wrapper sits flush with the right edge,
    // so the handle (left edge of the wrapper) sits at viewport.x =
    // innerWidth - 480 = 1024 - 480 = 544. Dragging the handle LEFT to x=424
    // grows the editor by 120px → 600px.
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', { clientX: 544, button: 0 }));
    });
    act(() => {
      document.dispatchEvent(pointer('pointermove', { clientX: 424 }));
    });
    expect(root.style.width).toBe('600px');

    act(() => {
      document.dispatchEvent(pointer('pointerup', { clientX: 424 }));
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('600');
  });

  it('4. clamps to min (280) when target < 280', () => {
    const { container } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    const handle = getHandle(container);

    // Drag the handle far to the right — target width would be 100px → clamp 280.
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', { clientX: 544, button: 0 }));
    });
    act(() => {
      document.dispatchEvent(pointer('pointermove', { clientX: 924 }));
    });
    expect(root.style.width).toBe('280px');

    act(() => {
      document.dispatchEvent(pointer('pointerup', { clientX: 924 }));
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('280');
  });

  it('5. clamps to max (60vw) when target > max', () => {
    const { container } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    const handle = getHandle(container);

    // 60vw at innerWidth=1024 is 614.4 → floor 614.
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', { clientX: 544, button: 0 }));
    });
    // Drag way left — target ~ 1000px → clamp to 614.
    act(() => {
      document.dispatchEvent(pointer('pointermove', { clientX: 24 }));
    });
    const widthPx = parseInt(root.style.width, 10);
    expect(widthPx).toBeLessThanOrEqual(615);
    expect(widthPx).toBeGreaterThanOrEqual(613);

    act(() => {
      document.dispatchEvent(pointer('pointerup', { clientX: 24 }));
    });
    const stored = parseInt(window.localStorage.getItem(STORAGE_KEY) || '0', 10);
    expect(stored).toBeLessThanOrEqual(615);
    expect(stored).toBeGreaterThanOrEqual(613);
  });

  it('6. collapsed prop bypasses resize and renders as a thin bar (no handle)', () => {
    const { container } = render(
      <ResizableEditorWrapper collapsed>
        <div data-testid="child">x</div>
      </ResizableEditorWrapper>,
    );
    const root = getRoot(container);
    // Children still pass through (FilePanel handles its own collapsed render),
    // but the resize handle MUST NOT be present.
    expect(container.querySelector('[data-testid="resizable-editor-handle"]')).toBeNull();
    // Width is auto / not the 480 default — let the child control its own width.
    expect(root.style.width).toBe('');
  });

  it('7. removes pointermove/pointerup listeners on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { container, unmount } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );

    const handle = getHandle(container);
    act(() => {
      handle.dispatchEvent(pointer('pointerdown', { clientX: 544, button: 0 }));
    });

    // After pointerdown the wrapper should have registered pointermove + pointerup
    const moveAdded = addSpy.mock.calls.some(c => c[0] === 'pointermove');
    const upAdded = addSpy.mock.calls.some(c => c[0] === 'pointerup');
    expect(moveAdded).toBe(true);
    expect(upAdded).toBe(true);

    unmount();

    const moveRemoved = removeSpy.mock.calls.some(c => c[0] === 'pointermove');
    const upRemoved = removeSpy.mock.calls.some(c => c[0] === 'pointerup');
    expect(moveRemoved).toBe(true);
    expect(upRemoved).toBe(true);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('a11y: handle exposes role=separator, aria-orientation=vertical, aria-valuenow', () => {
    const { container } = render(
      <ResizableEditorWrapper>
        <div>x</div>
      </ResizableEditorWrapper>,
    );
    const handle = getHandle(container);
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
  });
});
