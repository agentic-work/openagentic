/**
 * FilePanel save-flow tests.
 *
 * - onContentChange from EditorPane updates contentByPath + marks dirty
 * - onSave success: write_file RPC called with overwrite:true; clears dirty;
 *   shows "Saved <basename>" toast.
 * - onSave failure: toast shows the error; dirty remains.
 * - Tab close on dirty path triggers confirm; cancel = no-op; ok = closes.
 * - Tab title shows • prefix when path is dirty (FileTabs uses dirtyPaths set).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Capture EditorPane props so the test can drive onContentChange/onSave directly.
// ---------------------------------------------------------------------------
type CapturedEditorProps = {
  activePath: string | null;
  fileContent: any;
  isDirty?: boolean;
  onContentChange?: (path: string, content: string) => void;
  onSave?: (path: string, content: string) => void | Promise<void>;
};

const capturedEditorProps: { current: CapturedEditorProps | null } = { current: null };

vi.mock('../EditorPane', () => ({
  EditorPane: (props: CapturedEditorProps) => {
    capturedEditorProps.current = props;
    return <div data-testid="mock-editor-pane" data-active-path={props.activePath ?? ''} />;
  },
}));

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

// ---------------------------------------------------------------------------
// Daemon RPC bridge
// ---------------------------------------------------------------------------
const mockCall = vi.fn();
vi.mock('../../state/daemonRPCBridge', () => ({
  useDaemonRPCBridgeCall: () => mockCall,
  useDaemonRPCBridge: Object.assign(
    (selector: any) => selector({ call: mockCall, setCall: () => {} }),
    { getState: () => ({ call: mockCall, setCall: () => {} }) },
  ),
}));

// ---------------------------------------------------------------------------
// File status store
// ---------------------------------------------------------------------------
vi.mock('../../state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('../../state/fileStatusStore');
  const store = createFileStatusStore();
  return {
    useFileStatusStore: store,
    useOpenTabs: () => store((s: any) => s.tabs),
    useActivePath: () => store((s: any) => s.activePath),
    useExpandedPaths: () => store((s: any) => s.expandedPaths),
    useIsDirty: (path: string) => store((s: any) => s.dirtyPaths.has(path)),
    useIsEditing: (path: string) => store((s: any) => s.editingPath === path),
    useIsRecentlyModified: (path: string) => store((s: any) => s.recentlyModifiedPaths.has(path)),
    createFileStatusStore,
  };
});

const ROOT = '/workspaces/u1';

function makeReadFileResult(content: string) {
  return {
    content,
    contentType: 'text/plain',
    size: content.length,
    mtimeMs: Date.now(),
    sha256: 'abc',
    isBinary: false,
  };
}

async function renderFilePanel(props: Record<string, unknown> = {}) {
  const { FilePanel } = await import('../FilePanel');
  return render(<FilePanel rootPath={ROOT} {...props} />);
}

beforeEach(async () => {
  vi.clearAllMocks();
  capturedEditorProps.current = null;
  const { useFileStatusStore } = await import('../../state/fileStatusStore');
  useFileStatusStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FilePanel — buffer changes & dirty tracking', () => {
  it('1. onContentChange updates contentByPath + marks path dirty in store', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockResolvedValue(makeReadFileResult('a'));
    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);

    await act(async () => {
      await renderFilePanel();
    });

    // Wait for read_file to populate
    await waitFor(() => expect(capturedEditorProps.current?.fileContent).not.toBeNull());

    act(() => {
      capturedEditorProps.current?.onContentChange?.(path, 'a // edited');
    });

    expect(useFileStatusStore.getState().dirtyPaths.has(path)).toBe(true);
    // EditorPane re-renders with isDirty=true
    await waitFor(() => expect(capturedEditorProps.current?.isDirty).toBe(true));
    // The new buffer is propagated as fileContent.content
    expect(capturedEditorProps.current?.fileContent?.content).toBe('a // edited');
  });
});

describe('FilePanel — save success', () => {
  it('2. onSave calls write_file with overwrite:true, clears dirty, shows toast', async () => {
    const path = `${ROOT}/main.ts`;
    // First read_file returns content; second call (write_file) succeeds.
    mockCall.mockImplementation(async (method: string) => {
      if (method === 'read_file') return makeReadFileResult('a');
      if (method === 'write_file') return { bytesWritten: 12, mtimeMs: Date.now() };
      throw new Error('unexpected method ' + method);
    });

    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);
    useFileStatusStore.getState().markDirty(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });
    await waitFor(() => expect(capturedEditorProps.current?.fileContent).not.toBeNull());

    await act(async () => {
      await capturedEditorProps.current?.onSave?.(path, 'updated content');
    });

    expect(mockCall).toHaveBeenCalledWith('write_file', {
      path,
      content: 'updated content',
      overwrite: true,
    });
    expect(useFileStatusStore.getState().dirtyPaths.has(path)).toBe(false);
    const toast = container.querySelector('[data-testid="toast"]');
    expect(toast?.textContent).toMatch(/saved/i);
    expect(toast?.textContent).toContain('main.ts');
  });
});

describe('FilePanel — save failure', () => {
  it('3. onSave failure leaves dirty + shows error toast', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockImplementation(async (method: string) => {
      if (method === 'read_file') return makeReadFileResult('a');
      if (method === 'write_file') throw new Error('disk full');
      throw new Error('unexpected method ' + method);
    });

    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);
    useFileStatusStore.getState().markDirty(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });
    await waitFor(() => expect(capturedEditorProps.current?.fileContent).not.toBeNull());

    await act(async () => {
      await capturedEditorProps.current?.onSave?.(path, 'updated content');
    });

    expect(useFileStatusStore.getState().dirtyPaths.has(path)).toBe(true);
    const toast = container.querySelector('[data-testid="toast"]');
    expect(toast?.textContent).toMatch(/disk full/i);
  });
});

describe('FilePanel — close-on-dirty confirm', () => {
  it('4. closeTab on dirty path: confirm cancelled → tab stays', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockResolvedValue(makeReadFileResult('a'));
    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);
    useFileStatusStore.getState().markDirty(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const closeBtn = container.querySelector('.fp-tab .close') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(useFileStatusStore.getState().tabs.find(t => t.path === path)).toBeDefined();
    expect(useFileStatusStore.getState().dirtyPaths.has(path)).toBe(true);
    confirmSpy.mockRestore();
  });

  it('5. closeTab on dirty path: confirm accepted → closes + clears dirty', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockResolvedValue(makeReadFileResult('a'));
    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);
    useFileStatusStore.getState().markDirty(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const closeBtn = container.querySelector('.fp-tab .close') as HTMLElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(useFileStatusStore.getState().tabs.find(t => t.path === path)).toBeUndefined();
    expect(useFileStatusStore.getState().dirtyPaths.has(path)).toBe(false);
    confirmSpy.mockRestore();
  });

  it('6. closeTab on clean path: no confirm, just closes', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockResolvedValue(makeReadFileResult('a'));
    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const confirmSpy = vi.spyOn(window, 'confirm');
    const closeBtn = container.querySelector('.fp-tab .close') as HTMLElement;
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useFileStatusStore.getState().tabs.find(t => t.path === path)).toBeUndefined();
    confirmSpy.mockRestore();
  });
});

describe('FilePanel — dirty state propagation to FileTabs', () => {
  it('7. Dirty path renders close as .close.dirty (• marker) in FileTabs', async () => {
    const path = `${ROOT}/main.ts`;
    mockCall.mockResolvedValue(makeReadFileResult('a'));
    const { useFileStatusStore } = await import('../../state/fileStatusStore');
    useFileStatusStore.getState().openTab(path);
    useFileStatusStore.getState().markDirty(path);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = await renderFilePanel());
    });

    const dirtyClose = container.querySelector('.fp-tab .close.dirty');
    expect(dirtyClose).not.toBeNull();
    expect(dirtyClose?.textContent).toBe('●');
  });
});
