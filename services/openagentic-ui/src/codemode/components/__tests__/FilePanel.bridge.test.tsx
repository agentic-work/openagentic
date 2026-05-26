/**
 * FilePanel bridge integration tests — post A.13 (editor-only).
 *
 * After A.13, FilePanel is a pure editor pane. It still reads bridgeCall
 * (for read_file), but the tree-loading (list_dir + tree-error display)
 * has moved to FileTreeSection. These tests verify FilePanel still mounts
 * cleanly regardless of bridge state, and that it renders the editor area.
 *
 * Tree-loading bridge tests live in FileTreeSection.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
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

vi.mock('../EditorPane', () => ({
  EditorPane: () => <div data-testid="mock-editor-pane" />,
}));

// ---------------------------------------------------------------------------
// Mock fileStatusStore with a fresh instance per test suite
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
const ROOT = '/workspaces/bridge-test';

async function renderFilePanel(props: Record<string, unknown> = {}) {
  const { FilePanel } = await import('../FilePanel');
  return render(<FilePanel rootPath={ROOT} {...props} />);
}

// ---------------------------------------------------------------------------
// Reset bridge + store between tests
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.clearAllMocks();
  const { useDaemonRPCBridge } = await import('../../state/daemonRPCBridge');
  useDaemonRPCBridge.getState().setCall(null);

  const { useFileStatusStore } = await import('../../state/fileStatusStore');
  useFileStatusStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Post-A.13: FilePanel is editor-only — bridge tests focus on editor behavior
// ---------------------------------------------------------------------------
describe('FilePanel bridge integration (post A.13 editor-only)', () => {
  it('1. renders without crash when bridge call is null (no tree in FilePanel anymore)', async () => {
    await act(async () => {
      await renderFilePanel();
    });

    const panel = document.querySelector('[data-testid="file-panel"]');
    expect(panel).not.toBeNull();

    // Post A.13: FilePanel has no tree; no tree-error should appear
    const treeError = document.querySelector('[data-testid="tree-error"]');
    expect(treeError).toBeNull();
  });

  it('2. renders .fp-right editor pane regardless of bridge state', async () => {
    await act(async () => {
      await renderFilePanel();
    });

    expect(document.querySelector('.fp-right')).not.toBeNull();
    // No .fp-left (tree moved to FileTreeSection)
    expect(document.querySelector('.fp-left')).toBeNull();
  });

  it('3. renders without crash when bridge.call is set before mount', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });

    const { useDaemonRPCBridge } = await import('../../state/daemonRPCBridge');
    act(() => {
      useDaemonRPCBridge.getState().setCall(mockCall);
    });

    await act(async () => {
      await renderFilePanel();
    });

    const panel = document.querySelector('[data-testid="file-panel"]');
    expect(panel).not.toBeNull();
    // FilePanel no longer calls list_dir (tree is in FileTreeSection)
    expect(mockCall).not.toHaveBeenCalledWith('list_dir', expect.anything());
  });
});
