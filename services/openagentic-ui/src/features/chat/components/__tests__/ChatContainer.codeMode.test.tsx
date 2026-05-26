/**
 * A.13 — ChatContainer code mode: renders 2-pane layout (chat + editor).
 *
 * Post-A.13: when canUseAwcode=true, the container mounts:
 *   - CodeModeLayout (chat, flex: 1)
 *   - FilePanel (editor only, sibling — NOT a wrapper of CodeModeLayout)
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// ── Base stubs (shared with ChatContainer.subAgents.test.tsx) ──────────────
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (p: any) => React.createElement('div', p, p?.children) }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'u1', isAdmin: false },
    getAccessToken: vi.fn(async () => 'tok'),
    getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer tok' })),
    logout: vi.fn(),
  }),
}));

vi.mock('@/features/settings/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { theme: 'dark' }, updateSettings: vi.fn() }),
}));

vi.mock('@/stores/useChatStore', () => ({
  useChatStore: () => ({
    sessions: {}, activeSessionId: null,
    addMessage: vi.fn(), updateMessage: vi.fn(),
    updateStreamingMessage: vi.fn(), finishStreamingMessage: vi.fn(),
  }),
}));

vi.mock('@/stores/useUIVisibilityStore', () => ({
  useUIVisibilityStore: () => ({
    showChatSessions: false, showMetricsPanel: false, showSettings: false,
    showKeyboardHelp: false, showDocsViewer: false, showAdminPortal: false,
    showBackgroundJobs: false, showTokenUsage: false, showTokenGraph: false,
    showPersonalTokenUsage: false, showPromptTechniques: false,
    showMCPTools: false, showImageAnalysis: false, canvasOpen: false,
    showMCPIndicators: true, showThinkingInline: true, showModelBadges: true,
    isSidebarExpanded: false, showDeleteConfirm: false,
    toggle: vi.fn(), set: vi.fn(), open: vi.fn(), close: vi.fn(),
    closeAll: vi.fn(), setDeleteConfirm: vi.fn(),
  }),
}));

vi.mock('@/stores/useChatStreamingStore', () => ({
  useChatStreamingStore: () => ({
    streamingContent: '', streamingStatus: 'idle', realtimeCoTSteps: [],
    currentCoTData: null, thinkingTime: 0, thinkingStartTime: null,
    appendContent: vi.fn(), setContent: vi.fn(), startStreaming: vi.fn(),
    finishStreaming: vi.fn(), setStatus: vi.fn(), addCoTStep: vi.fn(),
    setCoTData: vi.fn(), clearCoTSteps: vi.fn(), startThinking: vi.fn(),
    stopThinking: vi.fn(), reset: vi.fn(),
  }),
}));

vi.mock('@/stores/useModelStore', () => ({
  useModelStore: () => ({
    selectedModel: null, availableModels: [], isMultiModelEnabled: false,
    setSelectedModel: vi.fn(), setAvailableModels: vi.fn(),
    setMultiModelEnabled: vi.fn(), initializeModel: vi.fn(),
  }),
}));

vi.mock('@/stores/useCodeModeStore', () => ({
  useActiveSessionId: () => null,
  useCodeModeStore: () => ({}),
}));

vi.mock('../../hooks/useChatSessions', () => ({
  useChatSessions: () => ({
    setActiveSession: vi.fn(), createNewSession: vi.fn(), loadSessions: vi.fn(),
    deleteSession: vi.fn(), loadSessionMessages: vi.fn(), updateSessionTitle: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMCPTools', () => ({
  useMCPTools: () => ({
    availableMCPFunctions: [], enabledTools: new Set<string>(),
    activeMcpCalls: [], currentToolRound: 0,
    loadMCPFunctions: vi.fn(), handleToggleTool: vi.fn(),
    handleToolExecution: vi.fn(), setActiveMcpCalls: vi.fn(),
  }),
}));

// canUseAwcode = true to enable code mode (lives inside permissions object)
vi.mock('@/hooks/useUserPermissions', () => ({
  useUserPermissions: () => ({ permissions: { canUseAwcode: true } }),
}));

vi.mock('@/shared/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  KeyboardShortcutsHelp: () => null,
}));

vi.mock('../UnifiedAgentActivity', () => ({
  useSSEToAgentState: () => ({
    state: {}, handlers: {
      onToolExecution: vi.fn(), onStreamComplete: vi.fn(), onError: vi.fn(),
    }, isActive: false, reset: vi.fn(),
  }),
}));

vi.mock('@/features/code/hooks/useCodeModeWebSocket', () => ({
  useCodeModeWebSocket: () => ({}),
}));

// ── Heavy children stubs ───────────────────────────────────────────────────
// ChatSidebar captures onAppModeChange so tests can switch mode
let capturedOnAppModeChange: ((mode: string) => void) | null = null;
vi.mock('../ChatSidebar', () => ({
  default: (props: any) => {
    capturedOnAppModeChange = props.onAppModeChange;
    return <button data-testid="mode-toggle" onClick={() => props.onAppModeChange?.('code')} />;
  },
}));
vi.mock('../ChatInputBar', () => ({ default: () => null }));
vi.mock('../MetricsPanel', () => ({ default: () => null }));
vi.mock('../ImageAnalysis', () => ({ default: () => null }));
vi.mock('../BackgroundJobsPanel', () => ({ default: () => null }));
vi.mock('../OnboardingTour', () => ({ OnboardingTour: () => null }));
vi.mock('../HITLPanel', () => ({ default: () => null }));
vi.mock('../AdminToolInspector', () => ({ default: () => null }));
vi.mock('../SettingsDropdown', () => ({ default: () => null }));
vi.mock('../MessageContent', () => ({ default: () => null }));
vi.mock('../v2', () => ({
  TopbarCostPill: () => null, Crumbs: () => null, ToolsPill: () => null,
}));
vi.mock('../../hooks/useTopbarToolsCounts', () => ({
  useTopbarToolsCounts: () => ({ internal: 0, connected: 0 }),
}));
vi.mock('@/features/settings/components/SettingsModal', () => ({
  SettingsModal: () => null,
}));
vi.mock('@/features/auth/components/AADLogin', () => ({ default: () => null }));
vi.mock('@/shared/components/CanvasPanel', () => ({ default: () => null }));
vi.mock('@/shared/components/ArtifactPanel', () => ({ ArtifactPanel: () => null }));
vi.mock('@/features/docs/DocsViewer', () => ({ DocsViewer: () => null }));
vi.mock('@/components/ui/GlassmorphismContainer', () => ({
  default: ({ children }: any) => children ?? null,
}));
vi.mock('@/shared/components/StreamErrorBoundary', () => ({
  default: ({ children }: any) => children ?? null,
}));
vi.mock('@/shared/components/ErrorBoundary', () => ({
  default: ({ children }: any) => children ?? null,
}));
vi.mock('@/shared/components/Dialogs/ToolApprovalDialog', () => ({ default: () => null }));
vi.mock('@/features/workflows', () => ({ WorkflowsPage: () => null }));
vi.mock('@/features/workflows/components/WorkspaceNavRail', () => ({
  WorkspaceNavRail: () => null,
}));
vi.mock('../ChatMessages', () => ({ default: () => null }));

vi.mock('@/utils/api', () => ({
  apiEndpoint: (p: string) => `https://test.local${p}`,
  getDocsUrl: () => 'https://test.local/docs',
}));
vi.mock('@/utils/modelSync', () => ({
  onModelsChanged: vi.fn(() => () => {}),
}));
vi.mock('@/services/feedbackApi', () => ({
  submitFeedback: vi.fn(), FeedbackType: {},
}));
vi.mock('@/utils/validation', () => ({
  isValidChatMessage: () => true, validateChartData: (x: any) => x,
  ensureArray: (x: any) => (Array.isArray(x) ? x : []),
  safeArrayAccess: (arr: any[], i: number) => arr?.[i],
}));
vi.mock('@/config/constants', () => ({
  getDocsBaseUrl: () => 'https://test.local',
}));

vi.mock('../../hooks/useChatStream', () => ({
  useChatStream: () => ({
    sendMessage: vi.fn(), stopStreaming: vi.fn(), isStreaming: false,
    currentMessage: null, currentThinking: '', thinkingMetrics: undefined,
    thinkingProgress: undefined, pipelineState: undefined, cotSteps: [],
    contentBlocks: [], contextCompaction: null, normalizedEvents: [],
    runningCost: 0, artifactPanel: null, visualRenders: [], appRenders: [],
    tierHints: {}, handoffOffers: {}, subAgents: [],
  }),
}));

// ── KEY STUBS: CodeModeLayout + FilePanel with testids ──────────────────
vi.mock('@/features/code/components', () => ({
  CodeModeLayout: (props: any) => (
    <div data-testid="code-mode-layout-v2" data-inline={String(props.inline)} />
  ),
}));

vi.mock('../../../../codemode/components/FilePanel', () => ({
  FilePanel: ({ children, rootPath }: { children?: React.ReactNode; rootPath: string }) => (
    <div data-testid="file-panel" data-root={rootPath}>
      {children}
    </div>
  ),
}));

import ChatContainer from '../ChatContainer';
import { fireEvent, act } from '@testing-library/react';

describe('ChatContainer — code mode 2-pane layout (A.13)', () => {
  it('renders FilePanel when switched to code mode', async () => {
    render(<ChatContainer />);
    // Click the mode toggle (captured ChatSidebar stub) to switch to 'code'
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-toggle'));
    });
    expect(screen.getByTestId('file-panel')).toBeInTheDocument();
  });

  it('renders CodeModeLayout when switched to code mode', async () => {
    render(<ChatContainer />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-toggle'));
    });
    expect(screen.getByTestId('code-mode-layout-v2')).toBeInTheDocument();
  });

  it('FilePanel does NOT contain CodeModeLayout (2-pane siblings, not wrapper)', async () => {
    render(<ChatContainer />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('mode-toggle'));
    });
    const filePanel = screen.getByTestId('file-panel');
    const codeLayout = screen.getByTestId('code-mode-layout-v2');
    expect(filePanel.contains(codeLayout)).toBe(false);
  });
});
