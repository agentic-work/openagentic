/**
 * A.12 — DaemonRPC bridge fill integration test.
 *
 * Verifies that:
 *   1. When CodeModeChatView mounts with a stable daemonRPC.call, the zustand
 *      bridge store receives that call function (i.e., setBridgeCall fires).
 *   2. When CodeModeChatView unmounts, the bridge is cleared to null.
 *   3. FilePanel, mounted BEFORE CodeModeChatView, re-fetches the root dir
 *      once the bridge call becomes available (the mount-effect re-fires).
 *
 * Test 3 is the live-prod regression: FilePanel mounts with bridgeCall=null,
 * calls loadDir which throws. When CodeModeChatView later sets the bridge,
 * the tree should load. The bug was that FilePanel's mount effect had deps
 * [rootPath, initialExpandedPath], not [loadDir], so it never re-fired when
 * the call became available.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// ── Auth stub ──────────────────────────────────────────────────────────────
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', email: 'tester@openagentic.io', name: 'Tester' },
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
    isApiDown: false,
    login: vi.fn(),
    getAuthHeaders: () => ({}),
    getAccessToken: vi.fn().mockResolvedValue(null),
    validateSession: vi.fn().mockResolvedValue(true),
  }),
}));

// ── Stable daemonRPC.call stub ─────────────────────────────────────────────
const stableDaemonCall = vi.fn().mockResolvedValue({ entries: [] });

const baseChatReturn = {
  messages: [],
  isStreaming: false,
  error: null,
  sendMessage: vi.fn(),
  clear: vi.fn(),
  cancel: vi.fn(),
  contextTokens: 0,
  compactionFlash: null,
  model: 'test-model',
  fastMode: undefined,
  totalCostUsd: 0,
  totalOutputTokens: 0,
  lastTurnMs: undefined,
  pendingPermission: null,
  respondToPermission: vi.fn(),
  sendControl: vi.fn(),
  sessionMeta: {
    tools: [],
    mcpServers: [],
    agents: [],
    skills: [],
    plugins: [],
    slashCommands: [],
    cwd: '/workspaces/u-1',
    permissionMode: 'default',
    openagenticVersion: '0.6.7',
    budgetCapUsd: null,
    detail: undefined,
  },
  inkDomViews: {},
  sendUiEvent: vi.fn(),
  activePicker: null,
  closePicker: vi.fn(),
  daemonRPC: { call: stableDaemonCall, onResponse: vi.fn() },
};

vi.mock('../../hooks/useCodeModeChat', () => ({
  useCodeModeChat: () => baseChatReturn,
}));

vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: () => ({
    push: vi.fn(),
    stepBack: vi.fn(() => null),
    stepForward: vi.fn(() => null),
    isBrowsing: false,
    resetBrowse: vi.fn(),
  }),
}));

vi.mock('../../hooks/useTurnCompleteSound', () => ({
  useTurnCompleteSound: () => {},
  getSoundsEnabled: () => false,
  setSoundsEnabled: () => {},
}));

vi.mock('../../hooks/usePermissionMode', () => ({
  usePermissionMode: () => ({
    mode: 'default',
    config: {},
    cycle: vi.fn(),
  }),
}));

// ── Monaco stub ────────────────────────────────────────────────────────────
vi.mock('@monaco-editor/react', () => ({
  Editor: ({ value }: { value: string }) => (
    <div data-testid="mock-monaco">{value}</div>
  ),
  loader: { config: () => {} },
}));

// Mock EditorPane directly to avoid monaco import chain issues
vi.mock('@/codemode/components/EditorPane', () => ({
  EditorPane: () => <div data-testid="mock-editor-pane" />,
}));

// ── fileStatusStore stub ───────────────────────────────────────────────────
vi.mock('@/codemode/state/fileStatusStore', async () => {
  const { createFileStatusStore } = await import('@/codemode/state/fileStatusStore');
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

// ── Imports ────────────────────────────────────────────────────────────────
import { CodeModeChatView } from '../CodeModeChatView';
import { FileTreeSection } from '@/codemode/components/FileTreeSection';
import { useDaemonRPCBridge } from '@/codemode/state/daemonRPCBridge';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

beforeEach(() => {
  useDaemonRPCBridge.getState().setCall(null);
  useDaemonRPCBridge.getState().setCwd(null);
  useCodeModeStore.setState({
    connectionState: 'connected',
    reconnectAttempts: 0,
    interactionMode: 'normal',
    currentSteps: [],
    currentTodos: [],
    agentTree: [],
  } as any, false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A.12 — bridge fill integration', () => {
  it('1. CodeModeChatView pushes daemonRPC.call into the bridge store on mount', async () => {
    // Before mount: bridge is null
    expect(useDaemonRPCBridge.getState().call).toBeNull();

    await act(async () => {
      render(<CodeModeChatView sessionId="s-1" />);
    });

    // After mount: bridge should be set to stableDaemonCall
    expect(useDaemonRPCBridge.getState().call).toBe(stableDaemonCall);
  });

  it('2. bridge is cleared to null when CodeModeChatView unmounts', async () => {
    const { unmount } = await act(async () =>
      render(<CodeModeChatView sessionId="s-1" />),
    );

    expect(useDaemonRPCBridge.getState().call).toBe(stableDaemonCall);

    await act(async () => {
      unmount();
    });

    expect(useDaemonRPCBridge.getState().call).toBeNull();
  });

  it('A14-4. after mount, bridge.cwd === sessionMeta.cwd', async () => {
    expect(useDaemonRPCBridge.getState().cwd).toBeNull();

    await act(async () => {
      render(<CodeModeChatView sessionId="s-1" />);
    });

    expect(useDaemonRPCBridge.getState().cwd).toBe('/workspaces/u-1');
  });

  it('A14-5. bridge.cwd is cleared to null when CodeModeChatView unmounts', async () => {
    const { unmount } = await act(async () =>
      render(<CodeModeChatView sessionId="s-1" />),
    );

    expect(useDaemonRPCBridge.getState().cwd).toBe('/workspaces/u-1');

    await act(async () => {
      unmount();
    });

    expect(useDaemonRPCBridge.getState().cwd).toBeNull();
  });

  /**
   * Test 3 — regression: FileTreeSection mounts with bridgeCall=null (tree-error).
   * When the bridge is subsequently set (simulating CodeModeChatView mounting
   * as a sibling), the tree MUST load — i.e., loadDir(rootPath) must be called
   * with the real call function, not the stub.
   *
   * FileTreeSection owns tree loading (post A.13; it was moved from FilePanel).
   * Bug fix: loadDir is in mount-effect deps so re-fires on bridgeCall null→fn.
   */
  it('3. FileTreeSection reloads root dir when bridge call transitions null→fn (live regression)', async () => {
    const mockCall = vi.fn().mockResolvedValue({ entries: [] });

    // Mount with null bridge — tree-error shows
    await act(async () => {
      render(<FileTreeSection rootPath="/workspaces/regression-test" />);
    });

    const treeError = document.querySelector('[data-testid="tree-error"]');
    expect(treeError).not.toBeNull();
    expect(mockCall).not.toHaveBeenCalled();

    // Now set the bridge (simulating CodeModeChatView sibling mounting)
    await act(async () => {
      useDaemonRPCBridge.getState().setCall(mockCall);
    });

    // FileTreeSection MUST call loadDir(rootPath) with the real call
    expect(mockCall).toHaveBeenCalledWith('list_dir', {
      path: '/workspaces/regression-test',
      depth: 1,
    });
  });
});
