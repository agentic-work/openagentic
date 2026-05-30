/**
 * #502 follow-up — ChatContainer subAgents prop wiring (deviation from d8f5635a).
 *
 * d8f5635a wired `useChatStream` to expose a `subAgents` array AND wired
 * `<ChatMessages>` to accept + render the prop. But the agent did NOT
 * thread the value from the hook's return through ChatContainer's
 * destructuring + JSX. That left the SubAgentCard render block dormant.
 *
 * This test pins down the missing seam:
 *   useChatStream() -> subAgents -> <ChatMessages subAgents={...} />
 *
 * RED on a ChatContainer that hasn't been touched (current main): the spy
 * on ChatMessages sees subAgents=undefined.
 * GREEN once ChatContainer destructures subAgents and forwards it.
 *
 * NOTE: ChatContainer pulls in ~15 stores/hooks/contexts. We mock the
 * full surface area at module-load time so the component can mount
 * with a minimal render tree. The single source of truth for this test
 * is the `messagesSpy` capture — anything else we render is plumbing.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// ---------------------------------------------------------------------------
// react-router-dom — useNavigate is called at component top
// ---------------------------------------------------------------------------
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

// ---------------------------------------------------------------------------
// react-hotkeys-hook — used at top of Chat (useHotkeys)
// ---------------------------------------------------------------------------
vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn(),
}));

// ---------------------------------------------------------------------------
// framer-motion — keep <motion.div /> + AnimatePresence as plain wrappers
// ---------------------------------------------------------------------------
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: any) => React.createElement('div', props, props?.children),
    },
  ),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------
vi.mock('@/app/providers/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'u1', isAdmin: false },
    getAccessToken: vi.fn(async () => 'tok'),
    getAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer tok' })),
    logout: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Settings hook
// ---------------------------------------------------------------------------
vi.mock('@/features/settings/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { theme: 'dark' },
    updateSettings: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Chat / UI / streaming / model stores
// ---------------------------------------------------------------------------
vi.mock('@/stores/useChatStore', () => ({
  useChatStore: () => ({
    sessions: {},
    activeSessionId: null,
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateStreamingMessage: vi.fn(),
    finishStreamingMessage: vi.fn(),
  }),
}));

vi.mock('@/stores/useUIVisibilityStore', () => ({
  useUIVisibilityStore: () => ({
    showChatSessions: false,
    showMetricsPanel: false,
    showSettings: false,
    showKeyboardHelp: false,
    showDocsViewer: false,
    showAdminPortal: false,
    showBackgroundJobs: false,
    showTokenUsage: false,
    showTokenGraph: false,
    showPersonalTokenUsage: false,
    showPromptTechniques: false,
    showMCPTools: false,
    showImageAnalysis: false,
    canvasOpen: false,
    showMCPIndicators: true,
    showThinkingInline: true,
    showModelBadges: true,
    isSidebarExpanded: false,
    showDeleteConfirm: false,
    toggle: vi.fn(),
    set: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    setDeleteConfirm: vi.fn(),
  }),
}));

vi.mock('@/stores/useChatStreamingStore', () => ({
  useChatStreamingStore: () => ({
    streamingContent: '',
    streamingStatus: 'idle',
    realtimeCoTSteps: [],
    currentCoTData: null,
    thinkingTime: 0,
    thinkingStartTime: null,
    appendContent: vi.fn(),
    setContent: vi.fn(),
    startStreaming: vi.fn(),
    finishStreaming: vi.fn(),
    setStatus: vi.fn(),
    addCoTStep: vi.fn(),
    setCoTData: vi.fn(),
    clearCoTSteps: vi.fn(),
    startThinking: vi.fn(),
    stopThinking: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('@/stores/useModelStore', () => ({
  useModelStore: () => ({
    selectedModel: null,
    availableModels: [],
    isMultiModelEnabled: false,
    setSelectedModel: vi.fn(),
    setAvailableModels: vi.fn(),
    setMultiModelEnabled: vi.fn(),
    initializeModel: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Chat session + MCP + permissions hooks
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useChatSessions', () => ({
  useChatSessions: () => ({
    setActiveSession: vi.fn(),
    createNewSession: vi.fn(),
    loadSessions: vi.fn(),
    deleteSession: vi.fn(),
    loadSessionMessages: vi.fn(),
    updateSessionTitle: vi.fn(),
  }),
}));

vi.mock('../../hooks/useMCPTools', () => ({
  useMCPTools: () => ({
    availableMCPFunctions: [],
    enabledTools: new Set<string>(),
    activeMcpCalls: [],
    currentToolRound: 0,
    loadMCPFunctions: vi.fn(),
    handleToggleTool: vi.fn(),
    handleToolExecution: vi.fn(),
    setActiveMcpCalls: vi.fn(),
  }),
}));

vi.mock('@/hooks/useUserPermissions', () => ({
  useUserPermissions: () => ({ permissions: {} }),
}));

vi.mock('@/shared/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  KeyboardShortcutsHelp: () => null,
}));

// ---------------------------------------------------------------------------
// useSSEToAgentState — exported from UnifiedAgentActivity barrel
// ---------------------------------------------------------------------------
vi.mock('../UnifiedAgentActivity', () => ({
  useSSEToAgentState: () => ({
    state: {},
    handlers: {
      onToolExecution: vi.fn(),
      onStreamComplete: vi.fn(),
      onError: vi.fn(),
    },
    isActive: false,
    reset: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Code-mode WebSocket hook (used at top of Chat)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Heavy / lazy-loaded children — replace with stubs so render is cheap
// ---------------------------------------------------------------------------
vi.mock('../ChatSidebar', () => ({ default: () => null }));
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
  TopbarCostPill: () => null,
  Crumbs: () => null,
  ToolsPill: () => null,
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
vi.mock('@/components/ui/GlassmorphismContainer', () => ({ default: ({ children }: any) => children ?? null }));
vi.mock('@/shared/components/StreamErrorBoundary', () => ({ default: ({ children }: any) => children ?? null }));
vi.mock('@/shared/components/ErrorBoundary', () => ({ default: ({ children }: any) => children ?? null }));
vi.mock('@/shared/components/Dialogs/ToolApprovalDialog', () => ({ default: () => null }));
vi.mock('@/features/workflows', () => ({ WorkflowsPage: () => null }));
vi.mock('@/features/workflows/components/WorkspaceNavRail', () => ({
  WorkspaceNavRail: () => null,
}));

// ---------------------------------------------------------------------------
// Misc utility imports — keep lightweight
// ---------------------------------------------------------------------------
vi.mock('@/utils/api', () => ({
  apiEndpoint: (p: string) => `https://test.local${p}`,
  getDocsUrl: () => 'https://test.local/docs',
}));

vi.mock('@/utils/modelSync', () => ({
  onModelsChanged: vi.fn(() => () => {}),
}));

vi.mock('@/services/feedbackApi', () => ({
  submitFeedback: vi.fn(),
  FeedbackType: {},
}));

vi.mock('@/utils/validation', () => ({
  isValidChatMessage: () => true,
  validateChartData: (x: any) => x,
  ensureArray: (x: any) => (Array.isArray(x) ? x : []),
  safeArrayAccess: (arr: any[], i: number) => arr?.[i],
}));

vi.mock('@/config/constants', () => ({
  getDocsBaseUrl: () => 'https://test.local',
}));

// ---------------------------------------------------------------------------
// THE TWO MOCKS THAT MATTER:
//   - useChatStream returns a populated subAgents array
//   - ChatMessages is replaced with a spy that captures props
// ---------------------------------------------------------------------------
const SUB_AGENTS_FIXTURE = [
  {
    role: 'cost-analysis',
    description: 'right-size the fleet',
    model: 'sonnet-4',
    status: 'ok' as const,
    sessionId: 's1',
    stats: { turns: 5, tokens: 1247, wallMs: 3800 },
  },
];

vi.mock('../../hooks/useChatStream', () => ({
  useChatStream: () => ({
    sendMessage: vi.fn(),
    stopStreaming: vi.fn(),
    isStreaming: false,
    currentMessage: null,
    currentThinking: '',
    thinkingMetrics: undefined,
    thinkingProgress: undefined,
    pipelineState: undefined,
    cotSteps: [],
    contentBlocks: [],
    contextCompaction: null,
    normalizedEvents: [],
    runningCost: 0,
    artifactPanel: null,
    visualRenders: [],
    appRenders: [],
    tierHints: {},
    handoffOffers: {},
    subAgents: SUB_AGENTS_FIXTURE,
  }),
}));

const messagesSpy = vi.fn();
vi.mock('../ChatMessages', () => ({
  default: (props: any) => {
    messagesSpy(props);
    return React.createElement('div', { 'data-testid': 'chat-messages-mock' });
  },
}));

// IMPORTANT: import after all vi.mock() calls so the mocks are wired
// before module evaluation.
import Chat from '../ChatContainer';

describe('ChatContainer — subAgents prop wiring (#502 d8f5635a deviation)', () => {
  it('threads the useChatStream subAgents value into ChatMessages', () => {
    render(
      React.createElement(Chat, {
        theme: 'dark' as const,
      } as any),
    );

    // ChatMessages may be rendered multiple times in StrictMode; assert
    // that AT LEAST ONE call carried the populated subAgents array.
    const calls = messagesSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const latest = calls.at(-1)![0];
    expect(latest.subAgents).toBeDefined();
    expect(latest.subAgents).toHaveLength(1);
    expect(latest.subAgents[0]).toMatchObject({
      role: 'cost-analysis',
      status: 'ok',
      stats: { turns: 5, tokens: 1247, wallMs: 3800 },
    });
  });
});
