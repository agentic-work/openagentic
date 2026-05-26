/**
 * A.13 — FileTreeSection tests.
 *
 * FileTreeSection is a new component extracted from FilePanel's .fp-left
 * column. It lives in the ChatSidebar and renders the workspace header +
 * FileTree when the bridge call is available, or a tree-error when it is not.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../../state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('../../state/fileStatusStore');
  const store = createFileStatusStore();
  return {
    useFileStatusStore: store,
    useOpenTabs: () => store((s: any) => s.tabs),
    useActivePath: () => store((s: any) => s.activePath),
    useExpandedPaths: () => store((s: any) => s.expandedPaths),
    useIsDirty: (p: string) => store((s: any) => s.dirtyPaths.has(p)),
    useIsEditing: (p: string) => store((s: any) => s.editingPath === p),
    useIsRecentlyModified: (p: string) => store((s: any) => s.recentlyModifiedPaths.has(p)),
    createFileStatusStore,
  };
});

import { FileTreeSection } from '../FileTreeSection';
import { useDaemonRPCBridge } from '../../state/daemonRPCBridge';

beforeEach(() => {
  useDaemonRPCBridge.getState().setCall(null);
  useDaemonRPCBridge.getState().setCwd(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FileTreeSection', () => {
  it('renders tree-error when bridge call is null', async () => {
    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/test" />);
    });

    expect(screen.getByTestId('tree-error')).toBeInTheDocument();
    expect(screen.getByTestId('tree-error').textContent).toMatch(/Daemon RPC not yet available/);
  });

  it('calls bridge on mount and renders tree when bridge is available', async () => {
    const mockCall = vi.fn().mockResolvedValue({
      entries: [
        { name: 'index.ts', type: 'file', size: 100, mtimeMs: 0, mode: 0o644, isReadable: true },
      ],
    });

    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/test" />);
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/test',
      depth: 1,
    });

    // Tree nodes should be visible
    const nodes = document.querySelectorAll('.fp-node');
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('reloads when bridge transitions null→fn', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });

    // Mount with null bridge
    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/reload-test" />);
    });

    expect(mockCall).not.toHaveBeenCalled();

    // Set the bridge
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/reload-test',
      depth: 1,
    });
  });

  it('renders workspace header with rootPath basename', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/myproject" />);
    });

    expect(screen.getByTestId('file-tree-section')).toBeInTheDocument();
  });
});

describe('FileTreeSection — A.14 bridge.cwd priority', () => {
  it('A14-1. when bridge.cwd is set, loadDir uses cwd not props.rootPath', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
      useDaemonRPCBridge.getState().setCwd('/workspaces/89ff9244-7768-41f2-8627-0f8b9184022e');
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces" />);
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/89ff9244-7768-41f2-8627-0f8b9184022e',
      depth: 1,
    });
    expect(mockCall).not.toHaveBeenCalledWith('list_dir', {
      path: '/workspaces',
      depth: 1,
    });
  });

  it('A14-2. when bridge.cwd is null, falls back to props.rootPath', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
      // cwd stays null
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/fallback-path" />);
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/fallback-path',
      depth: 1,
    });
  });

  it('A14-3. when bridge.cwd changes, tree reloads with new path', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
      useDaemonRPCBridge.getState().setCwd('/workspaces/user-aaa');
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces" />);
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/user-aaa',
      depth: 1,
    });

    mockCall.mockClear();

    await act(async () => {
      useDaemonRPCBridge.getState().setCwd('/workspaces/user-bbb');
    });

    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/user-bbb',
      depth: 1,
    });
  });
});

// ===========================================================================
// A.21.b / A.18.b — context menu CRUD + drag-and-drop upload
// ===========================================================================

/**
 * Helper: render FileTreeSection with the bridge wired to a mock that returns
 * a populated entries list, then resolve the mount + initial-load microtasks.
 *
 * Returns the mock so each test can drive subsequent calls and assertions.
 */
async function renderWithFile(
  fileName = 'doc.txt',
): Promise<ReturnType<typeof vi.fn>> {
  const mockCall = vi.fn().mockResolvedValue({
    entries: [
      { name: fileName, type: 'file', size: 10, mtimeMs: 0, mode: 0o644, isReadable: true },
    ],
  });
  await act(async () => {
    useDaemonRPCBridge.getState().setCall(mockCall);
    useDaemonRPCBridge.getState().setCwd('/workspaces/u');
  });
  await act(async () => {
    render(<FileTreeSection rootPath="/workspaces/u" />);
  });
  return mockCall;
}

function rightClickFirstFile() {
  // FileTree renders one .fp-node per entry; in renderWithFile() we ship a
  // single file entry so the first node IS that file. The component's
  // onContextMenu callback receives kind='file' from FileTree based on the
  // entry type, so right-clicking this node triggers the file-flavor menu.
  const fileNode = document.querySelector('.fp-node') as HTMLElement | null;
  if (!fileNode) {
    throw new Error('test setup: no .fp-node in DOM');
  }
  fireEvent.contextMenu(fileNode);
}

function clickMenuItem(label: string) {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const item = items.find(el => el.textContent?.includes(label));
  if (!item) throw new Error(`menu item "${label}" not found`);
  fireEvent.click(item);
}

describe('FileTreeSection — context menu CRUD', () => {
  it('right-click on a file pops the context menu', async () => {
    await renderWithFile();
    rightClickFirstFile();
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    // Items now enabled (was disabled in A.18.b — should now have onClick handlers)
    const items = document.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(0);
  });

  it('Delete sends delete_file RPC and refreshes', async () => {
    const mockCall = await renderWithFile('doomed.txt');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    rightClickFirstFile();
    mockCall.mockClear();
    // Now mock delete success + the refresh list_dir
    mockCall.mockResolvedValueOnce({ deleted: true }).mockResolvedValue({ entries: [] });

    await act(async () => {
      clickMenuItem('Delete');
    });
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('delete_file', {
        path: '/workspaces/u/doomed.txt',
      });
    });
    // refresh
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('list_dir', {
        path: '/workspaces/u',
        depth: 1,
      });
    });

    confirmSpy.mockRestore();
  });

  it('Delete does NOT send RPC when user cancels confirm', async () => {
    const mockCall = await renderWithFile('safe.txt');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    rightClickFirstFile();
    mockCall.mockClear();

    await act(async () => {
      clickMenuItem('Delete');
    });
    expect(mockCall).not.toHaveBeenCalledWith('delete_file', expect.anything());

    confirmSpy.mockRestore();
  });

  it('Rename sends rename_file RPC and refreshes', async () => {
    const mockCall = await renderWithFile('old.txt');
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new.txt');

    rightClickFirstFile();
    mockCall.mockClear();
    mockCall
      .mockResolvedValueOnce({ from: 'x', to: 'y', renamed: true })
      .mockResolvedValue({ entries: [] });

    await act(async () => {
      clickMenuItem('Rename');
    });
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('rename_file', {
        from: '/workspaces/u/old.txt',
        to: '/workspaces/u/new.txt',
      });
    });

    promptSpy.mockRestore();
  });

  it('Rename does NOT send RPC when user cancels prompt', async () => {
    const mockCall = await renderWithFile('old.txt');
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    rightClickFirstFile();
    mockCall.mockClear();

    await act(async () => {
      clickMenuItem('Rename');
    });
    expect(mockCall).not.toHaveBeenCalledWith('rename_file', expect.anything());

    promptSpy.mockRestore();
  });

  it('New File sends write_file with empty content and refreshes', async () => {
    const mockCall = await renderWithFile('a.txt');
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('newfile.md');

    rightClickFirstFile();
    mockCall.mockClear();
    mockCall
      .mockResolvedValueOnce({ bytesWritten: 0, mtimeMs: 1 })
      .mockResolvedValue({ entries: [] });

    await act(async () => {
      clickMenuItem('New File');
    });
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('write_file', {
        path: '/workspaces/u/newfile.md',
        content: '',
      });
    });
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('list_dir', {
        path: '/workspaces/u',
        depth: 1,
      });
    });

    promptSpy.mockRestore();
  });

  it('New Folder remains disabled (daemon mkdir not implemented)', async () => {
    await renderWithFile();
    rightClickFirstFile();

    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const newFolder = items.find(el => el.textContent?.includes('New Folder'));
    expect(newFolder).toBeDefined();
    expect(newFolder!.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('FileTreeSection — drag-and-drop upload', () => {
  it('drop event sends write_file per file and refreshes tree', async () => {
    const mockCall = await renderWithFile();
    const dropZone = screen.getByTestId('file-tree-section');

    // Set up post-drop responses: 2 write_file successes + N list_dir refreshes
    mockCall.mockClear();
    mockCall
      .mockResolvedValueOnce({ bytesWritten: 5, mtimeMs: 1 })
      .mockResolvedValueOnce({ bytesWritten: 7, mtimeMs: 2 })
      .mockResolvedValue({ entries: [] });

    // jsdom's File polyfill doesn't always implement .text(); shim it.
    function makeFile(content: string, name: string) {
      const f = new File([content], name, { type: 'text/plain' });
      if (typeof (f as unknown as { text: unknown }).text !== 'function') {
        Object.defineProperty(f, 'text', {
          value: async () => content,
        });
      } else {
        // Some jsdom versions return [object Object]; force the polyfill.
        Object.defineProperty(f, 'text', {
          value: async () => content,
        });
      }
      return f;
    }
    const fileA = makeFile('hello', 'a.txt');
    const fileB = makeFile('goodbye', 'b.txt');

    // jsdom doesn't fully implement DataTransfer; fake it.
    const dataTransfer = {
      files: [fileA, fileB],
      types: ['Files'],
    };

    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer });
    });

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('write_file', {
        path: '/workspaces/u/a.txt',
        content: 'hello',
        overwrite: true,
      });
      expect(mockCall).toHaveBeenCalledWith('write_file', {
        path: '/workspaces/u/b.txt',
        content: 'goodbye',
        overwrite: true,
      });
    });

    // Refresh list_dir was called after writes
    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith('list_dir', {
        path: '/workspaces/u',
        depth: 1,
      });
    });
  });

  it('drop with zero files does not call write_file', async () => {
    const mockCall = await renderWithFile();
    const dropZone = screen.getByTestId('file-tree-section');

    mockCall.mockClear();
    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer: { files: [], types: ['Files'] } });
    });
    expect(mockCall).not.toHaveBeenCalledWith('write_file', expect.anything());
  });
});

// ===========================================================================
// 2026-05-05 — auto-prune stale ENOENT paths from expandedPaths.
// Bug repro: codemode-file-panel-state-v1 in localStorage persists
// `expandedPaths`. When a directory is deleted on the backend, the polling
// effect at FileTreeSection.tsx:139-177 keeps firing list_dir({path}) every
// 2s forever — daemon log fills with "file-panel: ENOENT <name>" forever.
// Fix: when list_dir rejects with an ENOENT-shaped error, evict the path
// from expandedPaths so polling stops chasing dead nodes.
// ===========================================================================

describe('FileTreeSection — auto-prune ENOENT paths from expandedPaths', () => {
  it('removes a stale expanded path when polling list_dir rejects with ENOENT', async () => {
    vi.useFakeTimers();

    const STALE = '/workspaces/u/weather-service';
    // Mock: succeed for root + any other path, but reject ENOENT for STALE.
    const mockCall = vi.fn((method: string, args: { path: string }) => {
      if (method === 'list_dir' && args.path === STALE) {
        return Promise.reject(new Error('file-panel: ENOENT weather-service'));
      }
      return Promise.resolve({ entries: [] });
    });

    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
      useDaemonRPCBridge.getState().setCwd('/workspaces/u');
    });

    // Seed a stale path into the persisted store BEFORE mount.
    const { useFileStatusStore: realStore } = await import(
      '../../state/fileStatusStore'
    );
    act(() => {
      realStore.getState().setExpanded(STALE, true);
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/u" />);
    });

    // Confirm the stale path WAS in the store at mount.
    expect(realStore.getState().expandedPaths.has(STALE)).toBe(true);

    // Advance past one poll tick (interval = 2000ms).
    await act(async () => {
      vi.advanceTimersByTime(2100);
      // Drain pending microtasks from list_dir promise rejection.
      await Promise.resolve();
      await Promise.resolve();
    });

    // After ENOENT, the stale path is evicted.
    expect(realStore.getState().expandedPaths.has(STALE)).toBe(false);

    vi.useRealTimers();
  });

  it('does NOT prune the path when list_dir fails for a non-ENOENT reason', async () => {
    // Network blip (e.g. WS reconnect): we should NOT punish the user by
    // collapsing their expanded directories on a transient error.
    vi.useFakeTimers();

    const PATH = '/workspaces/u/src';
    const mockCall = vi.fn((method: string, args: { path: string }) => {
      if (method === 'list_dir' && args.path === PATH) {
        return Promise.reject(new Error('Daemon RPC timeout'));
      }
      return Promise.resolve({ entries: [] });
    });

    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
      useDaemonRPCBridge.getState().setCwd('/workspaces/u');
    });

    const { useFileStatusStore: realStore } = await import(
      '../../state/fileStatusStore'
    );
    act(() => {
      realStore.getState().setExpanded(PATH, true);
    });

    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/u" />);
    });

    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Path stays — only ENOENT triggers prune.
    expect(realStore.getState().expandedPaths.has(PATH)).toBe(true);

    vi.useRealTimers();
  });
});
