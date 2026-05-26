import { describe, it, expect } from 'vitest';

import {
  reduce,
  createInitialState,
  applyDiffOps,
} from '../streamReducer';
import type { ChatState } from '../streamReducer';
import type {
  AssistantChatMessage,
  ChatMessage,
} from '../../types/uiState';
import type {
  DiffOp,
  UiOpenFrame,
  UiPatchFrame,
  UiCloseFrame,
  VdomNode,
} from '../../types/_sdk-bindings';

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function vnode(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  children: VdomNode[] = [],
): VdomNode {
  return { id, type, props, children };
}

function withStreamingAssistant(state: ChatState, asstId: string): ChatState {
  const userMsg: ChatMessage = {
    id: 'u1',
    role: 'user',
    text: '/help',
    createdAt: 0,
  };
  const asstMsg: AssistantChatMessage = {
    id: asstId,
    role: 'assistant',
    blocks: [],
    streaming: true,
    createdAt: 0,
  };
  return {
    ...state,
    messages: [userMsg, asstMsg],
    streamingMessageId: asstId,
  };
}

// ────────────────────────────────────────────────────────────────────
// applyDiffOps — pure helper
// ────────────────────────────────────────────────────────────────────

// Path encoding (daemon-emitted): pathOf(node) walks parent chain until
// it hits the synthetic container root (whose parent is null). The
// user's JSX root is the wire vdom root, AND its id is included in
// every path because the synthetic container is the only excluded
// ancestor. So for a node directly under the wire root,
// path = [wireRootId, nodeId]. For the wire root itself,
// path = [wireRootId]. For append_child, path points to the PARENT
// (so appending to the wire root: path = [wireRootId]). For
// remove_child, path includes the removed child's id at the end.
describe('applyDiffOps — pure DiffOp[] applier', () => {
  it('set_prop replaces a prop on the targeted node', () => {
    const tree = vnode('root', 'box', {}, [
      vnode('title', 'text', { bold: true }, []),
    ]);
    const ops: DiffOp[] = [
      { kind: 'set_prop', path: ['root', 'title'], propKey: 'bold', value: false },
    ];
    const next = applyDiffOps(tree, ops);
    expect(next.children[0].props.bold).toBe(false);
    // Original is not mutated (purity).
    expect(tree.children[0].props.bold).toBe(true);
  });

  it('set_prop with undefined value deletes the prop', () => {
    const tree = vnode('root', 'box', {}, [
      vnode('title', 'text', { bold: true, color: 'red' }, []),
    ]);
    const ops: DiffOp[] = [
      { kind: 'set_prop', path: ['root', 'title'], propKey: 'bold', value: undefined },
    ];
    const next = applyDiffOps(tree, ops);
    expect('bold' in next.children[0].props).toBe(false);
    expect(next.children[0].props.color).toBe('red');
  });

  it('set_prop on the wire root itself (path = [rootId])', () => {
    const tree = vnode('root', 'box', { padding: 1 }, []);
    const ops: DiffOp[] = [
      { kind: 'set_prop', path: ['root'], propKey: 'padding', value: 2 },
    ];
    const next = applyDiffOps(tree, ops);
    expect(next.props.padding).toBe(2);
  });

  it('replace_node swaps the targeted node for a new vdom subtree', () => {
    const tree = vnode('root', 'box', {}, [
      vnode('a', 'text', {}, [vnode('a.t', '#text', { value: 'old' }, [])]),
    ]);
    const ops: DiffOp[] = [
      {
        kind: 'replace_node',
        path: ['root', 'a', 'a.t'],
        node: vnode('a.t', '#text', { value: 'new' }, []),
      },
    ];
    const next = applyDiffOps(tree, ops);
    expect(next.children[0].children[0].props.value).toBe('new');
  });

  it('append_child appends a new child to the parent at the given path', () => {
    const tree = vnode('root', 'box', {}, [vnode('a', 'text', {}, [])]);
    const ops: DiffOp[] = [
      {
        kind: 'append_child',
        path: ['root'],
        node: vnode('b', 'text', {}, [vnode('b.t', '#text', { value: 'b' }, [])]),
      },
    ];
    const next = applyDiffOps(tree, ops);
    expect(next.children).toHaveLength(2);
    expect(next.children[1].id).toBe('b');
    expect(next.children[1].children[0].props.value).toBe('b');
  });

  it('remove_child deletes the node whose path ends with its id', () => {
    const tree = vnode('root', 'box', {}, [
      vnode('a', 'text', {}, []),
      vnode('b', 'text', {}, []),
    ]);
    const ops: DiffOp[] = [
      { kind: 'remove_child', path: ['root', 'b'] },
    ];
    const next = applyDiffOps(tree, ops);
    expect(next.children).toHaveLength(1);
    expect(next.children[0].id).toBe('a');
  });

  it('applies a sequence of mixed ops in order', () => {
    const tree = vnode('root', 'box', {}, [
      vnode('a', 'text', { bold: false }, []),
    ]);
    const ops: DiffOp[] = [
      { kind: 'set_prop', path: ['root', 'a'], propKey: 'bold', value: true },
      {
        kind: 'append_child',
        path: ['root'],
        node: vnode('c', 'text', {}, []),
      },
      { kind: 'remove_child', path: ['root', 'a'] },
    ];
    const next = applyDiffOps(tree, ops);
    // After: only 'c' remains.
    expect(next.children).toHaveLength(1);
    expect(next.children[0].id).toBe('c');
  });
});

// ────────────────────────────────────────────────────────────────────
// Reducer ui_open / ui_patch / ui_close
// ────────────────────────────────────────────────────────────────────

describe('reducer ui_open', () => {
  it('stores the initial vdom under inkDomViews[viewId]', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'view_help',
      command: '/help',
      vdom: vnode('root', 'box', {}, [
        vnode('t', 'text', {}, [vnode('t.x', '#text', { value: 'Help' }, [])]),
      ]),
    };
    const next = reduce(base, { type: 'event', event: open as unknown as never });
    expect(next.inkDomViews).toBeDefined();
    expect(next.inkDomViews['view_help']).toBeDefined();
    expect(next.inkDomViews['view_help'].vdom.type).toBe('box');
    expect(next.inkDomViews['view_help'].vdom.children[0].children[0].props.value).toBe(
      'Help',
    );
  });

  it('pushes an inkdom_view block onto the streaming assistant message', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'view_help',
      command: '/help',
      vdom: vnode('root', 'box'),
    };
    const next = reduce(base, { type: 'event', event: open as unknown as never });
    const asst = next.messages[1] as AssistantChatMessage;
    expect(asst.blocks).toHaveLength(1);
    expect(asst.blocks[0].kind).toBe('inkdom_view');
    if (asst.blocks[0].kind === 'inkdom_view') {
      expect(asst.blocks[0].viewId).toBe('view_help');
      expect(asst.blocks[0].command).toBe('/help');
    }
  });

  it('does not push a duplicate block if ui_open arrives twice for the same viewId', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'view_help',
      command: '/help',
      vdom: vnode('root', 'box'),
    };
    const after1 = reduce(base, { type: 'event', event: open as unknown as never });
    const after2 = reduce(after1, { type: 'event', event: open as unknown as never });
    const asst = after2.messages[1] as AssistantChatMessage;
    expect(asst.blocks.filter((b) => b.kind === 'inkdom_view')).toHaveLength(1);
  });
});

describe('reducer ui_patch', () => {
  it('applies set_prop to the stored vdom', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v',
      command: '/help',
      vdom: vnode('root', 'box', {}, [
        vnode('t', 'text', { bold: true }, []),
      ]),
    };
    const opened = reduce(base, { type: 'event', event: open as unknown as never });
    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'v',
      ops: [{ kind: 'set_prop', path: ['root', 't'], propKey: 'bold', value: false }],
    };
    const next = reduce(opened, { type: 'event', event: patch as unknown as never });
    expect(next.inkDomViews['v'].vdom.children[0].props.bold).toBe(false);
  });

  it('applies replace_node to the stored vdom', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v',
      command: '/help',
      vdom: vnode('root', 'box', {}, [
        vnode('t', 'text', {}, [vnode('t.x', '#text', { value: 'a' }, [])]),
      ]),
    };
    const opened = reduce(base, { type: 'event', event: open as unknown as never });
    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'v',
      ops: [
        {
          kind: 'replace_node',
          path: ['root', 't', 't.x'],
          node: vnode('t.x', '#text', { value: 'b' }, []),
        },
      ],
    };
    const next = reduce(opened, { type: 'event', event: patch as unknown as never });
    expect(next.inkDomViews['v'].vdom.children[0].children[0].props.value).toBe('b');
  });

  it('applies append_child to the stored vdom', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v',
      command: '/help',
      vdom: vnode('root', 'box', {}, [vnode('a', 'text', {}, [])]),
    };
    const opened = reduce(base, { type: 'event', event: open as unknown as never });
    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'v',
      ops: [
        {
          kind: 'append_child',
          path: ['root'],
          node: vnode('b', 'text', {}, []),
        },
      ],
    };
    const next = reduce(opened, { type: 'event', event: patch as unknown as never });
    expect(next.inkDomViews['v'].vdom.children).toHaveLength(2);
    expect(next.inkDomViews['v'].vdom.children[1].id).toBe('b');
  });

  it('applies remove_child to the stored vdom', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v',
      command: '/help',
      vdom: vnode('root', 'box', {}, [
        vnode('a', 'text', {}, []),
        vnode('b', 'text', {}, []),
      ]),
    };
    const opened = reduce(base, { type: 'event', event: open as unknown as never });
    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'v',
      ops: [{ kind: 'remove_child', path: ['root', 'b'] }],
    };
    const next = reduce(opened, { type: 'event', event: patch as unknown as never });
    expect(next.inkDomViews['v'].vdom.children).toHaveLength(1);
    expect(next.inkDomViews['v'].vdom.children[0].id).toBe('a');
  });

  it('ignores ui_patch for an unknown viewId — no throw, state unchanged', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const patch: UiPatchFrame = {
      type: 'ui_patch',
      viewId: 'unknown',
      ops: [{ kind: 'set_prop', path: [], propKey: 'x', value: 1 }],
    };
    const next = reduce(base, { type: 'event', event: patch as unknown as never });
    expect(next).toBe(base);
  });
});

describe('reducer ui_close', () => {
  it('removes the view from inkDomViews', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const open: UiOpenFrame = {
      type: 'ui_open',
      viewId: 'v',
      command: '/help',
      vdom: vnode('root', 'box'),
    };
    const opened = reduce(base, { type: 'event', event: open as unknown as never });
    expect(opened.inkDomViews['v']).toBeDefined();
    const close: UiCloseFrame = {
      type: 'ui_close',
      viewId: 'v',
      reason: 'complete',
    };
    const next = reduce(opened, { type: 'event', event: close as unknown as never });
    expect(next.inkDomViews['v']).toBeUndefined();
  });

  it('is a no-op on an unknown viewId — same identity returned', () => {
    const base = withStreamingAssistant(createInitialState(), 'asst-1');
    const close: UiCloseFrame = { type: 'ui_close', viewId: 'unknown' };
    const next = reduce(base, { type: 'event', event: close as unknown as never });
    expect(next).toBe(base);
  });
});
