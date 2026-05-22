/**
 * FilePanel tests — post A.13 editor-only.
 *
 * After A.13, FilePanel is a pure editor pane (FileTabs + EditorPane).
 * Tree functionality moved to FileTreeSection. These tests verify:
 *   - Panel mounts without crash
 *   - Editor area (.fp-right) is rendered
 *   - No tree (.fp-left, .fp-chrome) is rendered
 *   - Tab open/close via FileTabs works
 *   - Keyboard shortcut Cmd+W closes active tab
 *   - Collapsed state renders thin bar
 *   - No .fp-center (children prop removed)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react
// ---------------------------------------------------------------------------
vi.mock('@monaco-editor/react', () => ({
  Editor: ({ value }: { value: string }) => (
    <div data-testid="mock-monaco">{value}</div>
  ),
  loader: { config: () => {} },
}));

vi.mock('../../monaco/monacoLoader', () => ({
  getMonaco: vi.fn().mockResolvedValue({
    editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
  }),
  registerCmThemes: vi.fn(),
}));

// Mock EditorPane to avoid monaco import chain issues
vi.mock('../EditorPane', () => ({
  EditorPane: () => <div data-testid="mock-editor-pane" className="fp-editor" />,
}));

// ---------------------------------------------------------------------------
// Mock daemonRPCBridge
// ---------------------------------------------------------------------------
const mockCall = vi.fn();
vi.mock('../../state/daemonRPCBridge', () => ({
  useDaemonRPCBridgeCall: () => mockCall,
  useDaemonRPCBridge: Object.assign(
    (selector: (s: { call: typeof mockCall; setCall: () => void }) => unknown) =>
      selector({ call: mockCall, setCall: () => {} }),
    { getState: () => ({ call: mockCall, setCall: () => {} }) },
  ),
}));

// ---------------------------------------------------------------------------
// Mock fileStatusStore
// ---------------------------------------------------------------------------
vi.mock('../../state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('../../state/fileStatusStore');
  const store = createFileStatusStore();
  return {
    useFileStatusStore: store,
    useOpenTabs: () => store(s => s.tabs),
    useActivePath: () => store(s => s.activePath),
    useExpandedPaths: () => store(s => s.expandedPaths),
    useIsDirty: (path: string) => store(s => s.dirtyPaths.has(path)),
    useIsEditing: (path: string) => store(s => s.editingPath === path),
    useIsRecentlyModified: (path: string) => store(s => s.recentlyModifiedPaths.has(path)),
    createFileStatusStore,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOT = '/workspaces/u1';

function makeReadFileResult(content: string, isBinary = false) {
  return {
    content: isBinary ? null : content,
    contentType: isBinary ? 'application/octet-stream' : 'text/plain',
    size: content.length,
    mtimeMs: Date.now(),
    sha256: 'abc123',
    isBinary,
  };
}

async function renderFilePanel(props: Record<string, unknown> = {}) {
  const { FilePanel } = await import('../FilePanel');
  return render(<FilePanel rootPath={ROOT} {...props} />);
}

// ---------------------------------------------------------------------------
// Reset store and mocks between tests
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.clearAllMocks();
  mockCall.mockResolvedValue(makeReadFileResult(''));
  const { useFileStatusStore } = await import('../../state/fileStatusStore');
  useFileStatusStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Mount behavior — editor only
// ---------------------------------------------------------------------------
describe('FilePanel — mount behavior (editor-only post A.13)', () => {
  it('1. Mounts without crash and renders file-panel root', async () => {
    await act(async () => {
      await renderFilePanel();
    });
    expect(document.querySelector('[data-testid="file-panel"]')).not.toBeNull();
  });

  it('2. Renders .fp-right (editor area) but NOT .fp-left or .fp-chrome', async () => {
    await act(async () => {
      await renderFilePanel();
    });
    expect(document.querySelector('.fp-right')).not.toBeNull();
    expect(document.querySelector('.fp-left')).toBeNull();
    expect(document.querySelector('.fp-chrome')).toBeNull();
  });

  it('3. Does NOT render tree-error (no tree in editor pane)', async () => {
    await act(async () => {
      await renderFilePanel();
    });
    expect(document.querySelector('[data-testid="tree-error"]')).toBeNull();
  });

  it('4. Does NOT call list_dir on mount (tree loading moved to FileTreeSection)', async () => {
    await act(async () => {
      await renderFilePanel();
    });
    const listDirCalls = mockCall.mock.calls.filter(c => c[0] === 'list_dir');
    expect(listDirCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5-6. File open (tab management)
// ---------------------------------------------------------------------------
describe('FilePanel — file open (via FileTabs)', () => {
  it('5. Click tab → calls read_file for the tab path', async () => {
    const filePath = `${ROOT}/main.py`;
    mockCall.mockResolvedValue(makeReadFileResult('# hello'));

    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(filePath);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const tab = container.querySelector('.fp-tab') as HTMLElement;
    expect(tab).not.toBeNull();

    await act(async () => {
      fireEvent.click(tab);
    });

    expect(mockCall).toHaveBeenCalledWith('read_file', { path: filePath });
  });

  it('6. Close tab → store update', async () => {
    const filePath = `${ROOT}/main.py`;
    mockCall.mockResolvedValue(makeReadFileResult('# hello'));

    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(filePath);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const closeBtn = container.querySelector('.fp-tab .close') as HTMLElement;
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(closeBtn);
    });

    const { tabs } = useFileStatusStore.getState();
    expect(tabs.find(t => t.path === filePath)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Keyboard shortcuts
// ---------------------------------------------------------------------------
describe('FilePanel — keyboard shortcuts', () => {
  it('7. Cmd+W on focused panel → closes active tab', async () => {
    const filePath = `${ROOT}/main.py`;
    mockCall.mockResolvedValue(makeReadFileResult(''));

    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(filePath);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const panel = container.querySelector('[data-testid="file-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(panel, { key: 'w', metaKey: true });
    });

    const { tabs } = useFileStatusStore.getState();
    expect(tabs.find(t => t.path === filePath)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Collapsed state
// ---------------------------------------------------------------------------
describe('FilePanel — collapsed state', () => {
  it('8. collapsed=true → renders thin bar, no .fp-right editor', async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel({ collapsed: true }));
    });

    expect(container.querySelector('.fp-collapsed')).not.toBeNull();
    expect(container.querySelector('.fp-right')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. No children prop / no .fp-center
// ---------------------------------------------------------------------------
describe('FilePanel — no children (A.13: children prop removed)', () => {
  it('9. No .fp-center element rendered (children prop removed in A.13)', async () => {
    await act(async () => {
      await renderFilePanel();
    });
    expect(document.querySelector('.fp-center')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Download toast for binary file
// ---------------------------------------------------------------------------
describe('FilePanel — download (via context, if triggered)', () => {
  it('10. Polling does not call list_dir (polling moved to FileTreeSection)', async () => {
    vi.useFakeTimers();
    mockCall.mockResolvedValue(makeReadFileResult(''));

    await act(async () => {
      await renderFilePanel();
    });

    const callCountBefore = mockCall.mock.calls.filter(c => c[0] === 'list_dir').length;

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    const callCountAfter = mockCall.mock.calls.filter(c => c[0] === 'list_dir').length;
    expect(callCountAfter).toBe(callCountBefore);
  });
});
