import * as React from 'react';

import { lookupInkDom, InkText } from './inkDomRegistry';
import type { VdomNode } from '../types/_sdk-bindings';

// ────────────────────────────────────────────────────────────────────
// Context — provided by the chat view, consumed by InkDomView
// ────────────────────────────────────────────────────────────────────

/**
 * Shape provided by the chat view via `InkDomViewContext.Provider`.
 *
 * `getView(viewId)` returns the latest vdom snapshot for the view, or
 * `undefined` if the view has been closed (via `ui_close`) or never
 * existed. The provider derives this from the reducer's `inkDomViews`
 * state on every render.
 *
 * `sendUiEvent(viewId, nodeId, kind, payload)` builds a `UiEventFrame`
 * with the given fields and writes it over the chat WS via the hook's
 * `sendWsFrame` callback. The hook owns the WS lifecycle; this context
 * exposes only the function that constructs and emits the frame.
 *
 * Both fields are required so the type check fails loudly if a parent
 * forgets to wire one.
 */
export interface InkDomViewContextValue {
  /** Look up the latest vdom snapshot for a viewId, or undefined. */
  getView: (viewId: string) => { vdom: VdomNode } | undefined;
  /**
   * Build and emit a UiEventFrame over the chat WS. The hook returned
   * from `useCodeModeChat` provides the production implementation;
   * tests substitute a `vi.fn()` and assert call args directly.
   */
  sendUiEvent: (
    viewId: string,
    nodeId: string,
    kind: 'key' | 'click' | 'focus' | 'blur',
    payload: Record<string, unknown>,
  ) => void;
}

export const InkDomViewContext = React.createContext<
  InkDomViewContextValue | null
>(null);

// ────────────────────────────────────────────────────────────────────
// DOM-event → Ink event translation
// ────────────────────────────────────────────────────────────────────

/**
 * Translate a DOM `KeyboardEvent` into the Ink `{input, key}` shape
 * that the daemon's `useInput` handler expects. Ink's stdin handler
 * produces this same shape from raw terminal escape sequences; we
 * mirror it here so the daemon-side hook code is unchanged when its
 * source is browser DOM events instead of stdin.
 *
 * Modifier keys (ctrl, shift, meta) appear as boolean fields. Named
 * keys (return, escape, tab, backspace, delete, upArrow, downArrow,
 * leftArrow, rightArrow, pageUp, pageDown) appear as boolean fields.
 * Printable characters land in `input` (a single-character string).
 */
function domKeyEventToInkPayload(
  e: React.KeyboardEvent | KeyboardEvent,
): { input: string; key: Record<string, boolean> } {
  const key: Record<string, boolean> = {};
  if (e.ctrlKey) key.ctrl = true;
  if (e.shiftKey) key.shift = true;
  if (e.metaKey) key.meta = true;
  if (e.altKey) key.alt = true;

  let input = '';
  switch (e.key) {
    case 'Enter':
      key.return = true;
      break;
    case 'Escape':
      key.escape = true;
      break;
    case 'Tab':
      key.tab = true;
      break;
    case 'Backspace':
      key.backspace = true;
      break;
    case 'Delete':
      key.delete = true;
      break;
    case 'ArrowUp':
      key.upArrow = true;
      break;
    case 'ArrowDown':
      key.downArrow = true;
      break;
    case 'ArrowLeft':
      key.leftArrow = true;
      break;
    case 'ArrowRight':
      key.rightArrow = true;
      break;
    case 'PageUp':
      key.pageUp = true;
      break;
    case 'PageDown':
      key.pageDown = true;
      break;
    case 'Home':
      key.home = true;
      break;
    case 'End':
      key.end = true;
      break;
    default:
      // Printable characters: e.key is the character itself
      // (e.g. 'a', '?', ' '). Modifier-only events (e.g. ShiftLeft on
      // its own) report e.key === 'Shift'/'Control'/'Meta' which we
      // skip — those don't carry input on Ink's wire.
      if (e.key.length === 1) input = e.key;
      break;
  }
  return { input, key };
}

/**
 * Walk up the DOM tree from `target` until we find an element with
 * `data-ink-node-id`. Returns the node id, or null if no ink node is
 * an ancestor (which would mean the event fired on the InkDomView's
 * root container itself — fall back to the view's root nodeId).
 */
function findInkNodeId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  let cur: Element | null = target;
  while (cur) {
    const id = cur.getAttribute('data-ink-node-id');
    if (id) return id;
    cur = cur.parentElement;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// InkDomView — the public component
// ────────────────────────────────────────────────────────────────────

export interface InkDomViewProps {
  /** Stable view id from the daemon's `ui_open` frame. */
  viewId: string;
}

/**
 * Render the latest vdom snapshot for the given viewId, with DOM
 * event handlers that emit `ui_event` frames back to the daemon.
 *
 * Renders a small empty-shell `<div data-ink-empty>` when the view is
 * not in the context (e.g. after `ui_close`, or before `ui_open`
 * arrives). This is intentional: the view's lifecycle is fully
 * driven by the daemon, and we want to render *something* so the
 * surrounding message bubble has a stable layout, but nothing that
 * implies the picker is still active.
 */
export const InkDomView: React.FC<InkDomViewProps> = ({ viewId }) => {
  const ctx = React.useContext(InkDomViewContext);
  if (!ctx) {
    return (
      <div
        data-ink-empty="no-context"
        data-ink-view-id={viewId}
        style={{ display: 'none' }}
      />
    );
  }

  const view = ctx.getView(viewId);
  if (!view) {
    return (
      <div
        data-ink-empty="no-view"
        data-ink-view-id={viewId}
        style={{ display: 'none' }}
      />
    );
  }

  // Recursive renderer — same registry the existing InkDom tests use.
  const renderChild = React.useMemo(() => {
    const r = (child: VdomNode, key: React.Key): React.ReactNode => {
      const C = lookupInkDom(child.type);
      if (C === 'text-leaf') {
        return <InkText key={key} node={child} />;
      }
      return <C key={key} node={child} renderChild={r} />;
    };
    return r;
  }, []);

  // Event handlers — capture-phase DOM events on the wrapper, walk up
  // to find the closest data-ink-node-id, translate, dispatch.
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const nodeId = findInkNodeId(e.target) ?? view.vdom.id;
      const payload = domKeyEventToInkPayload(e);
      ctx.sendUiEvent(viewId, nodeId, 'key', payload);
    },
    [ctx, viewId, view.vdom.id],
  );

  const onClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const nodeId = findInkNodeId(e.target) ?? view.vdom.id;
      const button =
        e.button === 1 ? 'middle' : e.button === 2 ? 'right' : 'left';
      ctx.sendUiEvent(viewId, nodeId, 'click', { button });
    },
    [ctx, viewId, view.vdom.id],
  );

  const onFocus = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const nodeId = findInkNodeId(e.target) ?? view.vdom.id;
      ctx.sendUiEvent(viewId, nodeId, 'focus', {});
    },
    [ctx, viewId, view.vdom.id],
  );

  const onBlur = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const nodeId = findInkNodeId(e.target) ?? view.vdom.id;
      ctx.sendUiEvent(viewId, nodeId, 'blur', {});
    },
    [ctx, viewId, view.vdom.id],
  );

  return (
    <div
      data-ink-view="true"
      data-ink-view-id={viewId}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      // The wrapper itself isn't focusable by default — focus lands on
      // the rendered Box's tabIndex (or whichever node has `useFocus`
      // gated focus). The wrapper just centralizes event capture so we
      // don't have to attach handlers to every primitive.
      style={{
        display: 'contents', // wrapper has no layout effect
      }}
    >
      {renderChild(view.vdom, view.vdom.id)}
    </div>
  );
};
