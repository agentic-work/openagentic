import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

import { InkDomView } from '../InkDomView';
import {
  InkDomViewContext,
  type InkDomViewContextValue,
} from '../InkDomView';
import {
  applyDiffOps,
} from '../../state/streamReducer';
import type {
  DiffOp,
  VdomNode,
} from '../../types/_sdk-bindings';

afterEach(() => {
  cleanup();
});

function vnode(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: VdomNode[] = [],
): VdomNode {
  return { id, type, props, children };
}

function makeCtx(
  views: Record<string, { vdom: VdomNode } | undefined>,
  sendUiEvent = vi.fn(),
): InkDomViewContextValue {
  return {
    getView: (viewId) => views[viewId],
    sendUiEvent,
  };
}

describe('InkDomView — initial mount', () => {
  it('renders a small box(text(#text)) tree as a flex div containing a span containing text', () => {
    const tree = vnode('root', 'box', { flexDirection: 'column' }, [
      vnode('t', 'text', { bold: true }, [
        vnode('t.x', '#text', { value: 'Help' }, []),
      ]),
    ]);
    const ctx = makeCtx({ v1: { vdom: tree } });
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]');
    expect(root).toBeTruthy();
    expect((root as HTMLElement).tagName).toBe('DIV');
    expect((root as HTMLElement).style.display).toBe('flex');
    expect(container.textContent).toBe('Help');
  });

  it('renders nothing visible (empty shell) when the viewId is not in context', () => {
    const ctx = makeCtx({});
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="missing" />
      </InkDomViewContext.Provider>,
    );
    // Some marker for the data-empty state, but no thrown error.
    expect(container.querySelector('[data-ink-empty]')).toBeTruthy();
  });
});

describe('InkDomView — applies ui_patch DiffOps via reducer state changes', () => {
  it('set_prop on a child re-renders the node with the new prop', () => {
    let tree = vnode('root', 'box', {}, [
      vnode('t', 'text', { bold: true }, [
        vnode('t.x', '#text', { value: 'Hi' }, []),
      ]),
    ]);
    const view = { vdom: tree };
    const views: Record<string, { vdom: VdomNode }> = { v1: view };
    const ctx = makeCtx(views);

    const { container, rerender } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const initial = container.querySelector('[data-ink-node-id="t"]') as HTMLElement;
    expect(initial.style.fontWeight).toBe('600');

    const ops: DiffOp[] = [
      { kind: 'set_prop', path: ['root', 't'], propKey: 'bold', value: false },
    ];
    tree = applyDiffOps(tree, ops);
    views['v1'] = { vdom: tree };
    rerender(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const after = container.querySelector('[data-ink-node-id="t"]') as HTMLElement;
    expect(after.style.fontWeight).toBe('400');
  });

  it('replace_node on a #text leaf updates the rendered text', () => {
    let tree = vnode('root', 'box', {}, [
      vnode('t', 'text', {}, [vnode('t.x', '#text', { value: 'old' }, [])]),
    ]);
    const views: Record<string, { vdom: VdomNode }> = { v1: { vdom: tree } };
    const { container, rerender } = render(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('old');

    tree = applyDiffOps(tree, [
      {
        kind: 'replace_node',
        path: ['root', 't', 't.x'],
        node: vnode('t.x', '#text', { value: 'new' }, []),
      },
    ]);
    views['v1'] = { vdom: tree };
    rerender(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('new');
  });

  it('append_child renders the new sibling', () => {
    let tree = vnode('root', 'box', {}, [
      vnode('a', 'text', {}, [vnode('a.t', '#text', { value: 'a' }, [])]),
    ]);
    const views: Record<string, { vdom: VdomNode }> = { v1: { vdom: tree } };
    const { container, rerender } = render(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('a');

    tree = applyDiffOps(tree, [
      {
        kind: 'append_child',
        path: ['root'],
        node: vnode('b', 'text', {}, [vnode('b.t', '#text', { value: 'b' }, [])]),
      },
    ]);
    views['v1'] = { vdom: tree };
    rerender(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('ab');
  });

  it('remove_child removes the sibling from the rendered output', () => {
    let tree = vnode('root', 'box', {}, [
      vnode('a', 'text', {}, [vnode('a.t', '#text', { value: 'a' }, [])]),
      vnode('b', 'text', {}, [vnode('b.t', '#text', { value: 'b' }, [])]),
    ]);
    const views: Record<string, { vdom: VdomNode }> = { v1: { vdom: tree } };
    const { container, rerender } = render(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('ab');

    tree = applyDiffOps(tree, [{ kind: 'remove_child', path: ['root', 'b'] }]);
    views['v1'] = { vdom: tree };
    rerender(
      <InkDomViewContext.Provider value={makeCtx(views)}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    expect(container.textContent).toBe('a');
  });
});

describe('InkDomView — DOM events emit UiEventFrame via sendUiEvent', () => {
  it('keydown on the root container emits a key UiEventFrame with the right viewId/nodeId/kind', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', { tabIndex: 0 }, [
      vnode('t', 'text', {}, [vnode('t.x', '#text', { value: 'x' }, [])]),
    ]);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]') as HTMLElement;
    act(() => {
      fireEvent.keyDown(root, { key: 'ArrowDown' });
    });
    expect(sendUiEvent).toHaveBeenCalledTimes(1);
    const call = sendUiEvent.mock.calls[0];
    // Signature: sendUiEvent(viewId, nodeId, kind, payload)
    expect(call[0]).toBe('v1');
    expect(call[1]).toBe('root');
    expect(call[2]).toBe('key');
    // payload carries Ink-shape { input, key }
    const payload = call[3] as { input: string; key: Record<string, boolean> };
    expect(payload.key.downArrow).toBe(true);
  });

  it('translates Enter into key.return:true', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', {}, []);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]') as HTMLElement;
    act(() => {
      fireEvent.keyDown(root, { key: 'Enter' });
    });
    const payload = sendUiEvent.mock.calls[0][3] as {
      input: string;
      key: Record<string, boolean>;
    };
    expect(payload.key.return).toBe(true);
  });

  it('translates Escape into key.escape:true', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', {}, []);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]') as HTMLElement;
    act(() => {
      fireEvent.keyDown(root, { key: 'Escape' });
    });
    const payload = sendUiEvent.mock.calls[0][3] as {
      key: Record<string, boolean>;
    };
    expect(payload.key.escape).toBe(true);
  });

  it('translates a printable character into payload.input', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', {}, []);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]') as HTMLElement;
    act(() => {
      fireEvent.keyDown(root, { key: 'q' });
    });
    const payload = sendUiEvent.mock.calls[0][3] as { input: string };
    expect(payload.input).toBe('q');
  });

  it('clicking a child node emits a click UiEventFrame whose nodeId is the inner-most clicked node', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', {}, [
      vnode('btn', 'text', {}, [vnode('btn.t', '#text', { value: 'go' }, [])]),
    ]);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const btn = container.querySelector('[data-ink-node-id="btn"]') as HTMLElement;
    act(() => {
      fireEvent.click(btn);
    });
    expect(sendUiEvent).toHaveBeenCalledTimes(1);
    const [viewId, nodeId, kind] = sendUiEvent.mock.calls[0];
    expect(viewId).toBe('v1');
    expect(nodeId).toBe('btn');
    expect(kind).toBe('click');
  });

  it('focusin / focusout on a node fires focus / blur UiEvents', () => {
    const sendUiEvent = vi.fn();
    const tree = vnode('root', 'box', { tabIndex: 0 }, []);
    const ctx = makeCtx({ v1: { vdom: tree } }, sendUiEvent);
    const { container } = render(
      <InkDomViewContext.Provider value={ctx}>
        <InkDomView viewId="v1" />
      </InkDomViewContext.Provider>,
    );
    const root = container.querySelector('[data-ink-node-id="root"]') as HTMLElement;
    act(() => {
      fireEvent.focus(root);
    });
    act(() => {
      fireEvent.blur(root);
    });
    const kinds = sendUiEvent.mock.calls.map((c) => c[2]);
    expect(kinds).toContain('focus');
    expect(kinds).toContain('blur');
  });
});
