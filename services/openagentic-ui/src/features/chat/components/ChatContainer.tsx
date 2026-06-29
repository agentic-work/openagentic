/**
 * Chat Container Component
 * Main chat interface that orchestrates all chat functionality
 * Features: Session management, message streaming, MCP tool integration, file uploads
 * Handles: SSE streaming, WebSocket fallback, token usage tracking, AI model routing
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send, Plus, Bot, User, CheckCircle, XCircle, Wrench, DollarSign, Activity,
  X, LineChart, HelpCircle, Settings as SettingsIcon, ChevronRight, Square,
  Trash2, Shield, Zap, Brain, ChevronDown, Check, Paperclip
} from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
// ReactMarkdown and remarkGfm removed - not used in this component
import { nanoid } from 'nanoid';
// Recharts imports removed - charts handled by sub-components
import MessageContent from './MessageContent';
import { useChatStream } from '../hooks/useChatStream';
// Track B Phase 3 — `currentMessage` flat-string was ripped from the
// useChatStream return shape; ChatContainer derives it from canonical
// `contentBlocks` via deriveFlatMessage (joins type='text' blocks in order).
import { deriveFlatMessage } from '../hooks/streamReducer/deriveFlatMessage';
import { isValidChatMessage, validateChartData, ensureArray, safeArrayAccess } from '@/utils/validation';
import { useAuth } from '@/app/providers/AuthContext';
// Removed conflicting useTheme - using settings from API as source of truth
import { apiEndpoint } from '@/utils/api';
import { onModelsChanged } from '@/utils/modelSync';
import { getDocsBaseUrl } from '@/config/constants';
import { submitFeedback, FeedbackType } from '@/services/feedbackApi';
// Token operations handled by AuthContext - pure frontend architecture
import ToolCallDisplay from './ToolCallDisplay';
import GlassmorphismContainer from '@/components/ui/GlassmorphismContainer';
import { InlineToolCallDisplay } from './InlineToolCallDisplay';
// Model selector removed - backend handles model selection
// TokenUsagePanel removed - analytics feature deleted
import { SettingsModal } from '@/features/settings/components/SettingsModal';
import SettingsDropdown from './SettingsDropdown';
import { useSettings } from '@/features/settings/hooks/useSettings';
// import { useTextToSpeech } from '../hooks/useTextToSpeech'; // DISABLED
import CanvasPanel, { type CanvasContent } from '@/shared/components/CanvasPanel';
import { DocsViewer } from '@/features/docs/DocsViewer';
import { getDocsUrl } from '@/utils/api';
// MovableTokenGraph removed - analytics feature deleted
import { useKeyboardShortcuts, KeyboardShortcutsHelp } from '@/shared/hooks/useKeyboardShortcuts';
import { useHotkeys } from 'react-hotkeys-hook';
import { useChatStore } from '@/stores/useChatStore';
import { useUIVisibilityStore } from '@/stores/useUIVisibilityStore';
import { useChatStreamingStore } from '@/stores/useChatStreamingStore';
import { useModelStore } from '@/stores/useModelStore';
import { useChatSessions } from '../hooks/useChatSessions';
import { useMCPTools } from '../hooks/useMCPTools';
import { useFollowupChipListener } from '../hooks/useFollowupChipListener';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { useFirstSessionWelcome } from '../welcome/useFirstSessionWelcome';
import { WelcomeRouteBar } from '../welcome/WelcomeRouteBar';
import { WELCOME_ROUTE_EVENT, type WelcomeRouteAction } from '../welcome/welcomeRoutes';

// Import sub-components
import ChatSidebar from './ChatSidebar';
import ChatMessages from './ChatMessages';
import { storeMessagesToChatMessages } from '../utils/messageNormalizer';
import ChatInputBar from './ChatInputBar';
import SSEErrorBoundary from '@/shared/components/SSEErrorBoundary';
import MetricsPanel from './MetricsPanel';
// StaticSidebar removed - using ChatSidebar only
import ImageAnalysis from './ImageAnalysis';
// Lazy load AdminPortal for better initial load performance - only loaded when admin opens portal.
// Route through AdminPortalHost so the V3 admin shell (TopBar + CommandPalette + NotificationsBell)
// is rendered. Importing AdminPortal.tsx directly bypasses the V3 router and falls back to v2.
const AdminPortal = lazy(() => import('@/features/admin/components/Shell/AdminPortalHost'));
// ScrollToBottomButton removed - auto-scroll handles this now
import BackgroundJobsPanel from './BackgroundJobsPanel';
// ExportButton removed - not working
import { WorkflowsPage } from '@/features/workflows';
import ErrorBoundary from '@/shared/components/ErrorBoundary';
import CodemodeDownloadPage from '@/features/codemode/CodemodeDownloadPage';
import HITLPanel, { type HITLMode, type HITLLogEntry } from './HITLPanel';
import ToolApprovalDialog from '@/shared/components/Dialogs/ToolApprovalDialog';
import ApprovalModal, { type AuditApprovalRequest } from './ApprovalModal';
import AdminToolInspector from './AdminToolInspector';
import type { McpApprovalRequest } from '../hooks/useChatStream';

// App mode type.
type AppMode = 'chat' | 'flows' | 'codemode';

// Personality type for AI response styling
interface Personality {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

// Personalities are now fetched from the pipeline config API (admin portal is SOT)
// Built-in personalities with full system prompts are defined in the backend:
// services/openagentic-api/src/routes/chat/pipeline/pipeline-config.schema.ts
// Legacy activity components - replaced by UnifiedAgentActivity
// import { LiveActivityFeed, useActivityFeed, type ActivityItem } from './LiveActivityFeed';
// import { ActivityOrb, useOrbState } from './ActivityOrb';

// Agent state hook - activity is now displayed inline in message bubbles
import { useSSEToAgentState } from './UnifiedAgentActivity';

// Import types
import type { 
  ChatMessage, TokenUsage, PrometheusData, VisualizationData, 
  ChatSession, TokenStats 
} from '@/types/index';

// Additional type interfaces to replace 'any' types
interface MCPFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface MCPToolsResponse {
  tools: {
    functions: MCPFunction[];
  };
}

interface SessionApiResponse {
  sessions: Array<{
    id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount?: number;
    messages?: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
    }>;
  }>;
  lastActiveSessionId?: string;
}

interface UsageDataPoint {
  date: string;
  tokens: number;
  cost: number;
}

interface ImageAnalysisResult {
  text?: string;
  description?: string;
  objects?: Array<{
    name: string;
    confidence: number;
  }>;
  tags?: string[];
}

interface FileWithPreview extends File {
  previewUrl?: string;
}

interface ChatProps {
  // `theme` prop removed: the parent no longer feeds a JS color palette. The
  // app theme is the CSS SOT (theme.css flips every --color-* off [data-theme]);
  // Chat reads settings.theme (a 'light' | 'dark' string) internally and the
  // CSS vars do the rest. onThemeChange persists the user's light/dark choice.
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onFunctionsReady?: (functions: {
    createNewSession: () => void;
    toggleMetrics: () => void;
    openMonitor: () => void;
    toggleSidebar: () => void;
  }) => void;
  showMetricsPanel?: boolean;
}

const Chat: React.FC<ChatProps> = ({ onFunctionsReady, onThemeChange, showMetricsPanel: propShowMetricsPanel }) => {
  // Navigation hook
  const navigate = useNavigate();

  // Auth state
  const { isAuthenticated: authIsAuthenticated, user, getAccessToken, getAuthHeaders, logout } = useAuth();
  
  // Settings state - theme comes from API settings
  const { settings, updateSettings } = useSettings();
  // Aliases for backward compatibility
  const saveSettings = updateSettings;
  const updateTheme = (theme: 'light' | 'dark') => updateSettings({ theme });
  // TTS completely removed - no longer supported
  const isSpeaking = false;
  const stopSpeaking = () => {};
  
  // Use actual authentication state
  const isAuthenticated = authIsAuthenticated;

  // Chat store
  const {
    sessions,
    activeSessionId,
    addMessage,
    updateMessage,
    updateStreamingMessage,
    finishStreamingMessage
  } = useChatStore();
  
  // Session management hook
  const {
    setActiveSession,
    createNewSession,
    loadSessions,
    deleteSession,
    loadSessionMessages,
    updateSessionTitle
  } = useChatSessions();
  
  // MCP Tools hook
  const {
    availableMCPFunctions,
    enabledTools,
    activeMcpCalls,
    currentToolRound, // Track agentic loop round for visual indicator
    loadMCPFunctions,
    handleToggleTool,
    handleToolExecution,
    setActiveMcpCalls
  } = useMCPTools();

  // Code execution handler - placeholder for MCP-based code execution
  const handleExecuteCode = useCallback((code: string, language: string) => {
    console.log('[CHAT] Execute code:', language);
    // Code execution is handled through MCP tool calls
  }, []);

  // User permissions hook - for feature access control
  const { permissions: userPermissions } = useUserPermissions();

  // UI Visibility store - centralized panel visibility state
  const {
    showChatSessions,
    showMetricsPanel,
    showSettings,
    showKeyboardHelp,
    showDocsViewer,
    showAdminPortal,
    showBackgroundJobs,
    showTokenUsage,
    showTokenGraph,
    showPersonalTokenUsage,
    showPromptTechniques,
    showMCPTools,
    showImageAnalysis,
    canvasOpen,
    showMCPIndicators,
    showThinkingInline,
    showModelBadges,
    isSidebarExpanded,
    showDeleteConfirm,
    toggle: toggleUI,
    set: setUI,
    open: openUI,
    close: closeUI,
    closeAll: closeAllUI,
    setDeleteConfirm,
  } = useUIVisibilityStore();

  // Chat streaming store - streaming and thinking state
  const {
    streamingContent,
    streamingStatus,
    realtimeCoTSteps,
    currentCoTData,
    thinkingTime,
    thinkingStartTime,
    appendContent: appendStreamingContent,
    setContent: setStreamingContent,
    startStreaming,
    finishStreaming,
    setStatus: setStreamingStatus,
    addCoTStep,
    setCoTData: setCurrentCoTData,
    clearCoTSteps,
    startThinking,
    stopThinking,
    reset: resetStreaming,
  } = useChatStreamingStore();

  // Unified Agent Activity state - single source of truth for all agentic activity
  const {
    state: agentState,
    handlers: agentHandlers,
    isActive: agentIsActive,
    reset: resetAgentState
  } = useSSEToAgentState();

  // Model store - model selection, available models, multi-model mode
  const {
    selectedModel,
    availableModels,
    isMultiModelEnabled,
    setSelectedModel,
    setAvailableModels,
    setMultiModelEnabled,
    initializeModel,
  } = useModelStore();

  // Holds the id created by the current first-send, set SYNCHRONOUSLY inside
  // sendMessage (before the first delta can land) so the render path can resolve
  // the live session id on the very first-delta render — see the renderSessionId
  // note below. Declared FIRST so both the retire effect and renderSessionId read it.
  const firstSendSessionIdRef = useRef<string | null>(null);

  // First-send render bridge (state, so the render reacts): holds the id created by
  // the in-flight first send until the closure `activeSessionId` catches up. See the
  // note on firstSendSessionIdRef / resolveSessionId below.
  const [firstSendStreamSessionId, setFirstSendStreamSessionId] = useState<string>('');

  // Once the closure `activeSessionId` has caught up to the bridged first-send id,
  // retire the bridge so it can't shadow a later "new chat" (when activeSessionId
  // momentarily becomes '' again).
  useEffect(() => {
    if (firstSendStreamSessionId && activeSessionId === firstSendStreamSessionId) {
      setFirstSendStreamSessionId('');
      firstSendSessionIdRef.current = null;
    }
  }, [activeSessionId, firstSendStreamSessionId]);

  // Get current session messages from store - memoized for performance.
  // Resolve the render session id LIVE: on the first send of a brand-new chat the
  // closure `activeSessionId` is still '' until createNewSession()'s store update
  // re-renders, so we fall back to the captured first-send id. Without this, the
  // freshly-created session's placeholder + streamed content (written under the
  // REAL id) would not appear in the rendered list until reload.
  //
  // UPSTREAM-PARITY FIX (mirrors the upstream ChatContainer keying the in-flight
  // mirror on a render-synchronous session id): the prior chain ended in
  // `firstSendStreamSessionId` — a useState set via setFirstSendStreamSessionId,
  // which flushes ONE render too late. The first `content_delta` frames arrive and
  // update `currentMessage` BEFORE that state has flushed, so the streaming-writer
  // effect ran with renderSessionId === '' and silently bailed on its
  // `!renderSessionId` guard — the first message's content never mirrored into the
  // placeholder until reload. The synchronously-set `firstSendSessionIdRef.current`
  // (assigned in sendMessage before the stream starts) makes renderSessionId
  // non-empty on the very first-delta render. The useState is retained AFTER the ref
  // so flushing it still triggers a re-render (the ref alone does not).
  const renderSessionId =
    activeSessionId || firstSendSessionIdRef.current || firstSendStreamSessionId || '';
  const currentSession = useMemo(() =>
    renderSessionId ? sessions[renderSessionId] : null,
    [renderSessionId, sessions]
  );
  // Convert the store-internal `Message[]` into the canonical `ChatMessage[]`
  // render contract (string timestamps, typed visualizations) up front, so the
  // whole component tree consumes a single typed shape. Replaces the prior
  // double-cast (store Message -> any -> ChatMessage[]) at the ChatMessages call site.
  const messages = useMemo(() =>
    storeMessagesToChatMessages(currentSession?.messages || []),
    [currentSession?.messages]
  );

  // Message history for up/down arrow navigation (user messages only)
  const messageHistory = useMemo(() =>
    messages
      .filter(m => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content as string),
    [messages]
  );

  // Chat state - only truly local state remains
  const [inputMessage, setInputMessage] = useState('');
  
  // Tool state - minimal remaining state
  const [pendingToolCalls, setPendingToolCalls] = useState<unknown[]>([]);
  const [executedToolCalls, setExecutedToolCalls] = useState<unknown[]>([]);
  const [mcpCalls, setMcpCalls] = useState<unknown[]>([]);
  
  // Track previous session for scroll behavior
  const [previousActiveSessionId, setPreviousActiveSessionId] = useState<string | null>(activeSessionId);

  // Track if we've scrolled for the current session's messages (to handle initial load)
  const hasScrolledForSession = useRef<string | null>(null);

  // "Go to latest" floating chip — shown when the user scrolls up away from the
  // bottom of the chat. Click scrolls back smoothly. Mirrors the openagentic UX.
  const [isAtBottom, setIsAtBottom] = useState(true);
  useEffect(() => {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    const onScroll = () => {
      // Within 120px of the bottom counts as "at bottom" — gives a comfortable
      // dead zone so the chip doesn't flicker on and off when the user is
      // mostly-but-not-quite at the latest message.
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setIsAtBottom(distFromBottom < 120);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll(); // initial state
    return () => container.removeEventListener('scroll', onScroll);
    // Re-bind on session/messages change so the listener attaches to the
    // right element after re-renders.
  }, [activeSessionId, messages.length]);

  const scrollToLatest = useCallback(() => {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, []);

  // UI state
  // selectedModel, availableModels, isMultiModelEnabled now provided by useModelStore
  // showChatSessions, showMetricsPanel, showDeleteConfirm, showSettings, isSidebarExpanded, streamingStatus
  // now provided by useUIVisibilityStore and useChatStreamingStore
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  // Remove redundant currentTheme state - use settings.theme directly
  const [tokenStats, setTokenStats] = useState<TokenStats>({
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    chartData: []
  });
  const [userUsageData, setUserUsageData] = useState<unknown>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [canvasContent, setCanvasContent] = useState<CanvasContent | null>(() => {
    // Restore last artifact from sessionStorage so closing the canvas doesn't lose it
    try {
      const saved = sessionStorage.getItem('openagentic:lastArtifact');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  // canvasOpen, currentCoTData, showKeyboardHelp, showDocsViewer, showImageAnalysis,
  // showAdminPortal, showBackgroundJobs now provided by stores
  const [currentImageForAnalysis, setCurrentImageForAnalysis] = useState<File | null>(null);

  // App Mode state - Chat vs Code mode
  const [appMode, setAppMode] = useState<AppMode>('chat');

  const handleAppModeChange = useCallback((next: AppMode) => {
    setAppMode(next);
  }, []);

  // Post-login WELCOME experience. On a fresh / magic-link landing this seeds a
  // system-status summary + an access-aware AI greeting into the (empty) active
  // session and exposes the access-filtered route shortcuts. Returning users
  // with existing history are NOT re-welcomed, so chat-at-/ is unchanged.
  const {
    routes: welcomeRoutes,
    routeBarVisible: welcomeBarVisible,
    dismissRouteBar: dismissWelcomeBar,
  } = useFirstSessionWelcome({
    isAuthenticated,
    activeSessionId,
    addMessage,
    displayName: user?.displayName || user?.name || null,
  });

  // Bridge a Welcome route-chip click into the right app-mode / panel action.
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<WelcomeRouteAction>).detail;
      if (!action) return;
      switch (action.kind) {
        case 'chat':
          setAppMode('chat');
          break;
        case 'flows':
          setAppMode('flows');
          break;
        case 'admin':
          // Guard at the action layer too — never open admin for a non-admin.
          if (userPermissions.isAdmin) openUI('showAdminPortal');
          break;
        case 'tools':
          openUI('showMCPTools');
          break;
        case 'docs':
          openUI('showDocsViewer');
          break;
      }
    };
    window.addEventListener(WELCOME_ROUTE_EVENT, handler);
    return () => window.removeEventListener(WELCOME_ROUTE_EVENT, handler);
  }, [openUI, userPermissions.isAdmin]);

  // Current workflow state for Flows Agent context (set by WorkflowsPage callback)
  const currentWorkflowRef = useRef<{ workflowId: string; workflowName: string; nodes: unknown[]; edges: unknown[] } | null>(null);

  // Skills are now configured in Admin Portal > Pipeline Settings (not user-facing)

  // Comprehensive cleanup for memory leaks when component unmounts
  useEffect(() => {
    return () => {
      // Clean up all preview URLs on unmount
      selectedFiles.forEach(file => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
      
      // TTS removed - no longer stopping speech
      
      // Clear any pending timeouts/intervals (covered by individual useEffect cleanup)
      // AbortController cleanup is handled in individual functions
      
      // Clear streaming content via store
      resetStreaming();
      setActiveMcpCalls([]);
      
      // Note: SSE cleanup is handled by the useChatStream hook
    };
  }, []);

  // showTokenUsage, showTokenGraph, showPersonalTokenUsage, showPromptTechniques, showMCPTools
  // showMCPIndicators, showThinkingInline, showModelBadges now provided by useUIVisibilityStore
  // with automatic localStorage persistence

  const [textToSpeechEnabled, setTextToSpeechEnabled] = useState(settings.audio?.enableTextToSpeech || false);

  // Prompt techniques and MCP state - remaining local state
  const [enabledPromptTechniques, setEnabledPromptTechniques] = useState<Set<string>>(new Set());
  const [alwaysApprovedTools, setAlwaysApprovedTools] = useState<Set<string>>(new Set());
  const [mcpApproval, setMcpApproval] = useState<McpApprovalRequest | null>(null);

  // Mutating-tool approval gate (backend commit 7e6637539). One-at-a-time
  // queue: the head is shown; resolving pops it to reveal the next.
  const [auditApprovals, setAuditApprovals] = useState<AuditApprovalRequest[]>([]);
  const [auditApprovalPending, setAuditApprovalPending] = useState(false);
  const auditApproval = auditApprovals[0] ?? null; // one-at-a-time head

  // HITL dialog auto-dismiss: when the backend gate times out (default 10s),
  // the popup must vanish so the user isn't tricked into clicking on a stale
  // request. The backend sends `timeoutMs` with the approval event — set a
  // matching client-side timer + a small grace buffer so the UI stays in sync.
  useEffect(() => {
    if (!mcpApproval) return;
    const ms = (mcpApproval.timeoutMs || 10000) + 500; // small grace buffer
    const t = setTimeout(() => {
      // Only clear if the same request is still active (the user hasn't already acted)
      setMcpApproval(curr => {
        if (curr?.requestId !== mcpApproval.requestId) return curr;
        // GAP-#286: inject a visible inline notice so the user knows the auto-dismiss
        // happened. Without this they might briefly still see the popup, click Approve
        // mid-render, and silently get nothing because the backend has already denied.
        if (activeSessionId) {
          try {
            const noticeId = `hitl-timeout-${mcpApproval.requestId}`;
            addMessage(activeSessionId, {
              id: noticeId,
              role: 'assistant',
              content: `⏱ **Tool approval timed out** — \`${mcpApproval.toolName}\` was automatically denied because the approval window (${Math.round((mcpApproval.timeoutMs || 10000) / 1000)}s) expired. Re-prompt to retry and approve more quickly.`,
              timestamp: new Date().toISOString(),
              metadata: { source: 'hitl-timeout-notice' },
              status: 'completed',
            });
          } catch (e) { console.warn('[HITL] Failed to inject timeout notice', e); }
        }
        return null;
      });
    }, ms);
    return () => clearTimeout(t);
  }, [mcpApproval, activeSessionId, addMessage]);

  // Backend auto-denies the mutating-tool gate after ~300s; clear the head
  // client-side a touch later so a stale modal can't be approved into a 404.
  useEffect(() => {
    if (!auditApproval) return;
    const t = setTimeout(() => {
      setAuditApprovals(prev =>
        prev[0]?.auditId === auditApproval.auditId ? prev.slice(1) : prev);
    }, 300_000 + 1_000);
    return () => clearTimeout(t);
  }, [auditApproval]);

  const [showToolInspector, setShowToolInspector] = useState(false);
  // HITL panel state
  const [hitlPanelVisible, setHitlPanelVisible] = useState(false);
  const [hitlMode, setHitlMode] = useState<HITLMode>('standard');
  const [hitlLog, setHitlLog] = useState<HITLLogEntry[]>([]);
  // HITM enforced - tools always require approval (no YOLO mode)

  // Check if user is admin (needed early for model logic)
  const isAdminUser = user?.is_admin || user?.groups?.includes('OpenAgenticAdmins') || user?.groups?.includes('admin') || false;

  // Model selection persistence handled by useModelStore with persist middleware
  // Initialize model on mount - clears for non-admins, validates for admins
  useEffect(() => {
    if (!isAdminUser && selectedModel) {
      // Non-admin has a model selected - clear it
      console.log('[MODEL] Non-admin user, clearing model selection to use default');
      setSelectedModel('');
    }
  }, [isAdminUser]); // Only run when admin status changes

  const [currentPrompt, setCurrentPrompt] = useState<string>(''); // Current prompt being used
  const [globalTokenUsage, setGlobalTokenUsage] = useState<{
    total: number;
    sessions: number;
    users: number;
    cost: number;
  } | null>(null);

  // Use the isAdminUser variable defined earlier for model selection logic
  const isAdmin = isAdminUser;


  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // thinkingStartTime, thinkingTime now provided by useChatStreamingStore
  const streamingPlaceholderIdRef = useRef<string | null>(null); // Track current streaming message ID

  // First-message race fix (mirrors the same guard in useChatStream): on the FIRST send of
  // a brand-new chat, createNewSession() sets the store's activeSessionId + returns
  // the new id, but this component's `activeSessionId` closure is still '' until the
  // store update re-renders. Every render/callback surface that keys on the closure
  // (the rendered messages list, the streaming-content writer effect, onMessage/onError)
  // would then target '' and the freshly-created session's placeholder + streamed
  // content (written under the REAL id) would not render until reload. We capture the
  // freshly-created id here and resolve the LIVE id (closure → store → captured) so
  // the render path binds to the new session immediately.
  // (firstSendSessionIdRef is declared above, next to renderSessionId, so the render
  // derivation can read it synchronously on the first-delta render.)
  const resolveSessionId = useCallback((): string => {
    if (activeSessionId && activeSessionId.trim()) return activeSessionId;
    const storeId = useChatStore.getState().activeSessionId;
    if (storeId && storeId.trim()) return storeId;
    return firstSendSessionIdRef.current || '';
  }, [activeSessionId]);

  // Initialize SSE chat hook with pipeline awareness
  const {
    sendMessage: sendSSEMessage,
    stopStreaming,
    isStreaming,
    // Track B Phase 3 — `currentMessage` flat-string state ripped from
    // useChatStream's return shape; derived below from `contentBlocks`.
    currentThinking,
    thinkingMetrics,
    thinkingProgress, // Real progress indicator (tokens vs budget)
    pipelineState,
    cotSteps, // Chain of Thought steps for COT UI display
    contentBlocks, // Interleaved content blocks for thinking/text display
    canonicalContentBlocks, // Pure-reducer ContentBlock[] (applyCanonicalFrame SoT)
    contextCompaction, // Context compaction notification (auto-dismisses)
    normalizedEvents, // Normalized stream events for UnifiedActivityTree (UNIFIED_STREAM=true)
    hitlApprovalsByMessageId, // #109 — pending inline tool-approval cards, keyed by message id
    setHitlApprovalsByMessageId, // #109 — flip a card out of "pending" once resolved
  } = useChatStream({
    sessionId: activeSessionId || '',
    onMessage: (message) => {
      // Resolve the live session id (closure may still be '' on the first send;
      // the freshly-created session lives in the store / firstSendSessionIdRef).
      const targetSessionId = resolveSessionId();
      // Prevent duplicate messages by checking if message ID already exists
      if (!targetSessionId) return;

      // If there's a streaming placeholder, update it instead of adding new message
      if (streamingPlaceholderIdRef.current && message.role === 'assistant') {
        // console.log('[CHAT] Finalizing streaming placeholder with complete message');
        // CRITICAL FIX: Update with full message object to preserve mcpCalls, metadata, model, AND step data
        // This ensures thinkingSteps, reasoningTrace, toolCalls, toolResults persist for inline display
        // DEFENSIVE: Ensure reasoningTrace is always a string for the store
        const reasoningTraceStr = typeof message.reasoningTrace === 'string'
          ? message.reasoningTrace
          : message.reasoningTrace?.reasoning || undefined;

        updateMessage(
          targetSessionId,
          streamingPlaceholderIdRef.current,
          message.content,
          message.mcpCalls,
          message.metadata,
          message.model,
          message.thinkingSteps,    // Structured thinking steps from COT
          reasoningTraceStr,         // Full reasoning text (ensured to be string)
          message.toolCalls,         // Tool calls made during response
          message.toolResults        // Results from tool executions
        );
        finishStreamingMessage(targetSessionId, streamingPlaceholderIdRef.current);
        streamingPlaceholderIdRef.current = null; // Clear placeholder tracking
        return;
      }

      // Check if message already exists to prevent duplicates
      const existingMessage = messages.find(m => m.id === message.id);
      if (existingMessage) {
        // console.log('Duplicate message detected, skipping:', message.id);
        return;
      }

      // Add message to store which handles session metadata updates
      addMessage(targetSessionId, message);

      // NOTE: Session title is now auto-generated server-side via AI
      // The onSessionTitleUpdated callback handles updating the sidebar

      // Clear streaming status after message completes
      setStreamingStatus('idle');

      // Complete unified agent activity tracking
      const metrics = message.metadata?.pipelineMetrics || message.metadata;
      agentHandlers.onStreamComplete(metrics);

      // Message count is handled by the store automatically
      
      // Stop thinking timer
      if (thinkingStartTime) {
        stopThinking();
      }
      
      // Update token stats
      if (message.tokenUsage || message.metadata?.tokenUsage) {
        const usage = message.tokenUsage || message.metadata?.tokenUsage;
        setTokenStats(prev => ({
          totalPromptTokens: prev.totalPromptTokens + (usage.promptTokens || 0),
          totalCompletionTokens: prev.totalCompletionTokens + (usage.completionTokens || 0),
          totalTokens: prev.totalTokens + (usage.totalTokens || 0),
          chartData: [...prev.chartData, {
            timestamp: new Date().toISOString(),
            promptTokens: usage.promptTokens || 0,
            completionTokens: usage.completionTokens || 0,
            tokens: usage.totalTokens || 0
          }]
        }));
      }
      
      // Don't reload sessions here - it causes messages to disappear
      // The title update is already handled locally via updateSessionTitle
      // Reloading from API would overwrite the local state with stale data
    },
    onToolExecution: (event) => {
      // `event` is the broad stream firehose (typed `unknown` on the hook
      // contract because useChatStream emits tool/stream event shapes that
      // are a superset of ToolExecutionEvent). Narrow to the handler's
      // expected param at the boundary — type-only, no runtime effect.
      agentHandlers.onToolExecution(event as Parameters<typeof agentHandlers.onToolExecution>[0]);
      // Also call the MCP tools handler for backwards compatibility
      handleToolExecution(event);
    },
    onError: (error) => {
      // Update unified agent state
      agentHandlers.onError(error);
      console.error('Chat error:', error);
      setStreamingStatus('error');

      // Clear streaming content on error

      // Differentiate error messages for admin vs regular users
      const isAdmin = user?.isAdmin || user?.is_admin || false;
      let errorContent: string;

      if (isAdmin) {
        // Admin users get detailed error information
        errorContent = `**Error Details**\n\n${error.message}`;

        // Add code and stage info if available from enhanced errors
        if (error.name && error.name !== 'Error') {
          errorContent += `\n\n**Error Code:** \`${error.name}\``;
        }
      } else {
        // Non-admin users get a simple, user-friendly message
        const message = error.message?.toLowerCase() || '';
        if (message.includes('timeout') || message.includes('timed out')) {
          errorContent = 'The request took too long. Please try again.';
        } else if (message.includes('401') || message.includes('unauthorized')) {
          errorContent = 'Your session may have expired. Please refresh the page or log in again.';
        } else if (message.includes('connection') || message.includes('connect')) {
          errorContent = 'Unable to reach the server. Please check your connection and try again.';
        } else {
          errorContent = 'Something went wrong. Please try again or contact support.';
        }
      }

      // Add error message to chat
      const errorMessage: ChatMessage = {
        id: `error_${nanoid()}`,
        role: 'assistant',
        content: errorContent,
        timestamp: new Date(Date.now() + 2).toISOString(), // Ensure proper ordering after user and placeholder
        metadata: {
          isError: true,
          errorDetails: isAdmin ? {
            message: error.message,
            name: error.name,
            stack: error.stack
          } : undefined
        }
      };

      // Add error message to current session. Resolve the live id so a first-send
      // error (closure still '') lands on the freshly-created session, not nowhere.
      const targetSessionId = resolveSessionId();
      if (targetSessionId) {
        addMessage(targetSessionId, errorMessage);
      }

      // Reset status after error
      setTimeout(() => setStreamingStatus('idle'), 3000);
    },
    onThinking: (status) => {
      // Start thinking phase in unified agent state
      agentHandlers.onThinking(status);
      if (!thinkingStartTime) {
        startThinking();
      }
    },
    onThinkingContent: (content, tokens) => {
      // Update unified agent state with actual thinking content and token count
      agentHandlers.onThinkingContent(content, tokens);
    },
    onThinkingComplete: () => {
      // Mark thinking as complete in unified agent state
      agentHandlers.onThinkingComplete();
    },
    onMultiModel: (event) => {
      // Forward multi-model events to unified agent state
      agentHandlers.onMultiModel(event);
    },
    onStream: (content) => {
      setStreamingStatus('streaming');
      // Update unified agent state
      agentHandlers.onContentDelta(content);
      // Don't accumulate here - currentMessage from useChatStream already has the full content
      // This callback is just for status updates
    },
    onPipelineStage: (stage, data) => {
      // Update unified agent state with pipeline stage
      agentHandlers.onPipelineStage(stage, data);
    },
    onToolRound: (round, maxRounds) => {
      // Tool round logging disabled to reduce console noise
      // if (import.meta.env.DEV) {
      //   console.log(`[Pipeline] Tool round ${round} of ${maxRounds}`);
      // }
      // Update tool round indicators if needed
    },
    onSessionTitleUpdated: (sessionId, title) => {
      // AI-generated title from server - update sidebar immediately
      console.log('[CHAT] AI-generated session title:', { sessionId, title });
      updateSessionTitle(sessionId, title);
    },
    onMcpApprovalRequest: (data) => {
      // HITL: Server-side ToolApprovalGate requests approval for CRUD/destructive tool
      console.log('[HITL] MCP approval required:', data.toolName, data.riskLevel);
      setMcpApproval(data);
    },
    onAuditApprovalRequired: (data) => {
      // Mutating-tool approval gate (backend commit 7e6637539). Queue
      // de-dupes on auditId so a re-emitted frame doesn't double-stack.
      console.log('[APPROVAL] mutating tool gate:', data.toolName, data.auditId);
      setAuditApprovals(prev =>
        prev.some(a => a.auditId === data.auditId) ? prev : [...prev, data]);
    },
    autoApproveTools: false, // HITM enforced: tools always require user approval
  });

  // Track B Phase 3 (2026-05-22) — derive the legacy `currentMessage`
  // flat string from canonical `contentBlocks`. The pre-rip code received
  // a `currentMessage: string` directly from useChatStream and used it for
  // three things: (a) auto-scroll trigger, (b) updating the streaming-
  // placeholder message in the messages store, (c) passing as
  // `streamingContent` to ChatMessages. All three still work with a
  // derived flat string (deriveFlatMessage joins type='text' blocks in
  // chronological order — identical content shape to the old accumulator).
  const currentMessage = useMemo(
    () => deriveFlatMessage(contentBlocks),
    [contentBlocks],
  );

  // Agent activity state is now managed by useSSEToAgentState hook
  // The unified agentState replaces the old feedActivities and orbState

  // Live thinking timer - calculated from thinkingStartTime during streaming
  // Uses a local state for live updates during streaming, falls back to store's thinkingTime when complete
  const [liveThinkingTime, setLiveThinkingTime] = useState(0);

  useEffect(() => {
    if (!isStreaming || !thinkingStartTime) {
      return;
    }

    // Update timer immediately
    setLiveThinkingTime(Date.now() - thinkingStartTime);

    // Update timer every 100ms for smooth animation
    const interval = setInterval(() => {
      if (thinkingStartTime) {
        setLiveThinkingTime(Date.now() - thinkingStartTime);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, thinkingStartTime]);

  // Use live time during streaming, store's thinkingTime when complete
  const displayThinkingTime = isStreaming && thinkingStartTime ? liveThinkingTime : thinkingTime;

  // Session creation logic moved to useChatSessions hook

  // Session loading logic moved to useChatSessions hook
  
  // Message loading logic moved to useChatSessions hook
  // Token stats are computed locally when messages are loaded

  // MCP functions loading logic moved to useMCPTools hook

  // Fetch user usage data
  const fetchUserUsage = useCallback(async () => {
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint('/admin/my-usage'), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-OpenAgentic-Frontend': 'true'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Update token stats with real data
        setTokenStats({
          totalPromptTokens: data.totals?.prompt_tokens || 0,
          totalCompletionTokens: data.totals?.completion_tokens || 0,
          totalTokens: data.totals?.total_tokens || 0,
          chartData: data.dailyUsage?.map((day: UsageDataPoint) => ({
            timestamp: day.date,
            promptTokens: 0, // API doesn't split prompt/completion per day
            completionTokens: 0,
            totalTokens: day.tokens || 0
          })) || []
        });
        
        // Store full usage data for the panel
        setUserUsageData(data);
      }
    } catch (error) {
      console.error('Failed to fetch user usage:', error);
    }
  }, [getAccessToken]);

  // Fetch global token usage data for admin users
  const fetchGlobalTokenUsage = useCallback(async () => {
    if (!isAdmin) return;
    
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint('/admin/global-usage'), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-OpenAgentic-Frontend': 'true'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setGlobalTokenUsage({
          total: data.totalTokens || 0,
          sessions: data.totalSessions || 0,
          users: data.activeUsers || 0,
          cost: data.totalCost || 0
        });
      }
    } catch (error) {
      console.error('Failed to fetch global token usage:', error);
    }
  }, [getAccessToken, isAdmin]);

  // Session deletion logic moved to useChatSessions hook

  // Tool toggling logic moved to useMCPTools hook

  // Multimedia component handlers
  const handleImageAnalysisComplete = useCallback((result: ImageAnalysisResult) => {
    // Add the analysis result as a message to the chat
    const analysisMessage: ChatMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `## Image Analysis Results\n\n**Extracted Text:** ${result.text || 'No text detected'}\n\n**Description:** ${result.description || 'No description available'}\n\n**Detected Objects:** ${result.objects?.map((obj) => `${obj.name} (${Math.round(obj.confidence * 100)}%)`).join(', ') || 'None'}\n\n**Tags:** ${result.tags?.join(', ') || 'None'}`,
      timestamp: new Date().toISOString(),
      tokenUsage: null,
      metadata: { imageAnalysis: result }
    };
    
    // Add analysis result to current session
    if (activeSessionId) {
      addMessage(activeSessionId, analysisMessage);
    }
    closeUI('showImageAnalysis');
    setCurrentImageForAnalysis(null);
  }, [closeUI]);

  const handleExportFilesSelect = useCallback((files: unknown[]) => {
    // Handle exported files if needed
    // console.log('Exported files:', files);
  }, []);

  // Stable callback for admin portal close - prevents re-renders during streaming
  const handleCloseAdminPortal = useCallback(() => {
    closeUI('showAdminPortal');
  }, [closeUI]);

  // Stable callback for docs viewer close
  const handleCloseDocsViewer = useCallback(() => {
    closeUI('showDocsViewer');
  }, [closeUI]);

  const handleUploadFilesSelect = useCallback((files: Array<{ file?: FileWithPreview }>) => {
    // Convert uploaded files to the expected format and add to selected files
    const convertedFiles = files.map(f => f.file).filter((f): f is FileWithPreview => Boolean(f));
    setSelectedFiles(prev => [...prev, ...convertedFiles]);
    
    // Don't auto-trigger image analysis - images will be sent with message
  }, [currentImageForAnalysis]);


  // MCP tool approval handlers (HITL for CRUD/destructive MCP operations)
  const handleApproveMcpTool = useCallback(async () => {
    if (!mcpApproval?.requestId) return;
    try {
      let token;
      try { token = await getAccessToken(['User.Read']); } catch { token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'); }
      if (!token) return;
      await fetch(apiEndpoint(`/chat/tool-approval/${mcpApproval.requestId}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      // Log to HITL panel
      const entry: HITLLogEntry = {
        id: mcpApproval.requestId,
        timestamp: new Date(),
        toolName: mcpApproval.toolName,
        riskLevel: mcpApproval.riskLevel,
        action: 'approved',
        intent: mcpApproval.reason,
      };
      setHitlLog(prev => [...prev, entry]);
      setMcpApproval(null);
    } catch (err) {
      console.error('[HITL] Failed to approve MCP tool:', err);
    }
  }, [mcpApproval, getAccessToken]);

  const handleDenyMcpTool = useCallback(async () => {
    if (!mcpApproval?.requestId) return;
    try {
      let token;
      try { token = await getAccessToken(['User.Read']); } catch { token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'); }
      if (!token) return;
      await fetch(apiEndpoint(`/chat/tool-approval/${mcpApproval.requestId}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      });
      const entry: HITLLogEntry = {
        id: mcpApproval.requestId,
        timestamp: new Date(),
        toolName: mcpApproval.toolName,
        riskLevel: mcpApproval.riskLevel,
        action: 'denied',
        intent: mcpApproval.reason,
      };
      setHitlLog(prev => [...prev, entry]);
      setMcpApproval(null);
    } catch (err) {
      console.error('[HITL] Failed to deny MCP tool:', err);
    }
  }, [mcpApproval, getAccessToken]);

  // #109 — inline HITL approval card resolution. The chat stream parks pending
  // approvals in hitlApprovalsByMessageId (keyed by message id); the inline
  // card's Approve/Deny buttons call these. POST the OSS resolution endpoint
  // (/api/chat/tool-approval/:id) with a Bearer token, then flip the matching
  // card out of "pending" so the buttons disappear and the gated tool unblocks
  // (instead of the chat hanging at "Running…" to the 120s timeout).
  const resolveHitlApproval = useCallback(async (requestId: string, approved: boolean) => {
    if (!requestId) return;
    try {
      let token;
      try { token = await getAccessToken(['User.Read']); } catch { token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'); }
      if (!token) return;
      const res = await fetch(apiEndpoint(`/chat/tool-approval/${requestId}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (!res.ok) {
        console.error('[HITL] tool-approval POST failed:', res.status);
        return;
      }
      // Flip the resolved card (status drives the card UI; pending → resolved
      // hides the buttons). Scan every message slot for the matching requestId.
      setHitlApprovalsByMessageId((prev) => {
        const next: typeof prev = {};
        for (const [mid, arr] of Object.entries(prev)) {
          next[mid] = arr.map((a) =>
            a.requestId === requestId ? { ...a, status: approved ? 'approved' : 'denied' } : a,
          );
        }
        return next;
      });
    } catch (err) {
      console.error('[HITL] Failed to resolve tool approval:', err);
    }
  }, [getAccessToken, setHitlApprovalsByMessageId]);

  const handleApproveHitl = useCallback((requestId: string) => { void resolveHitlApproval(requestId, true); }, [resolveHitlApproval]);
  const handleDenyHitl = useCallback((requestId: string) => { void resolveHitlApproval(requestId, false); }, [resolveHitlApproval]);

  // Mutating-tool approval gate (backend commit 7e6637539).
  // Resolve the head of the queue: POST /api/approvals/:auditId/{approve,deny}.
  // Bearer auth (this deployment's AAD is Bearer, not cookie). No body needed.
  const resolveAudit = useCallback(async (verb: 'approve' | 'deny') => {
    const head = auditApprovals[0];
    if (!head?.auditId) return;
    setAuditApprovalPending(true);
    try {
      let token;
      try { token = await getAccessToken(['User.Read']); }
      catch { token = localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken'); }
      if (!token) return;
      await fetch(apiEndpoint(`/approvals/${head.auditId}/${verb}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error(`[APPROVAL] Failed to ${verb} tool:`, err);
    } finally {
      setAuditApprovalPending(false);
      setAuditApprovals(prev => prev.slice(1)); // pop the head, reveal next queued
    }
  }, [auditApprovals, getAccessToken]);

  const handleApproveAudit = useCallback(() => resolveAudit('approve'), [resolveAudit]);
  const handleDenyAudit = useCallback(() => resolveAudit('deny'), [resolveAudit]);

  // Send message - updated to use SSE
  const sendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isStreaming) {
      return;
    }

    // Handle slash commands — intercept before sending to backend
    const trimmedCmd = inputMessage.trim().toLowerCase();
    if (trimmedCmd.startsWith('/')) {
      // /hitl — open HITL approval panel
      if (trimmedCmd === '/hitl') {
        setInputMessage('');
        setHitlPanelVisible(true);
        return;
      }
      // /clear — clear current session messages
      if (trimmedCmd === '/clear') {
        setInputMessage('');
        if (activeSessionId) {
          useChatStore.getState().clearMessages(activeSessionId);
        }
        return;
      }
      // /new — create new session
      if (trimmedCmd === '/new') {
        setInputMessage('');
        await createNewSession();
        return;
      }
      // /help — show help message inline
      if (trimmedCmd === '/help') {
        setInputMessage('');
        // Ensure session exists
        let sid = activeSessionId;
        if (!sid) { sid = await createNewSession(); }
        if (sid) {
          addMessage(sid, {
            id: `help-${Date.now()}`,
            role: 'assistant',
            content: '## Available Commands\n\n| Command | Description |\n|---------|-------------|\n| `/help` | Show this help |\n| `/clear` | Clear chat history |\n| `/new` | Start new session |\n| `/hitl` | Open approval panel |\n\nSwitch models using the **Smart Router** dropdown in the toolbar.',
            timestamp: new Date().toISOString(),
          });
        }
        return;
      }
    }

    // Auto-create session if none exists
    let sessionId = activeSessionId;
    if (!sessionId) {
      // console.log('[CHAT] No active session, creating new session...');
      try {
        sessionId = await createNewSession();
        // console.log('[CHAT] Created new session:', sessionId);
        // FIRST-MESSAGE LIVE-RENDER FIX: thread the freshly-created id explicitly.
        // createNewSession() sets the store's activeSessionId, but this component's
        // `activeSessionId` closure is still '' for the rest of THIS render. Capture
        // the new id so (a) the render binds messages to it immediately
        // (firstSendStreamSessionId state → renderSessionId) and (b) the
        // onMessage/onError/streaming-writer surfaces resolve it (firstSendSessionIdRef).
        if (sessionId) {
          firstSendSessionIdRef.current = sessionId;
          setFirstSendStreamSessionId(sessionId);
        }
      } catch (error) {
        console.error('[CHAT] Failed to create session:', error);
        return;
      }
    }

    // Prepare files if any - do this FIRST so we can attach to user message
    let base64Images: Array<{ name: string; type: string; content: string }> = [];
    if (selectedFiles.length > 0) {
      base64Images = await Promise.all(
        selectedFiles.map(async (file) => {
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          return {
            name: file.name,
            type: file.type,
            content: base64.split(',')[1] // Remove data:image/jpeg;base64, prefix
          };
        })
      );
    }

    // Add user message to UI immediately (optimistic update)
    const baseTimestamp = Date.now();
    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(baseTimestamp).toISOString(),
      status: 'sending', // Visual indicator that message is being sent
      // Include attached files so they display as thumbnails with the message
      attachedImages: base64Images.length > 0 ? base64Images.map(img => ({
        name: img.name,
        data: img.content, // Already base64 without prefix
        mimeType: img.type
      })) : undefined
    };

    // Add user message to store
    if (sessionId) {
      addMessage(sessionId, userMessage);
    }

    // Smooth scroll to show user's message - use requestAnimationFrame for smooth timing
    requestAnimationFrame(() => {
      const container = document.getElementById('chat-messages-container');
      if (container) {
        // Scroll to bottom to show user's message, then let them scroll naturally
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    });

    // Clear input and files
    const message = inputMessage;
    setInputMessage('');

    // Clean up preview URLs before clearing files
    selectedFiles.forEach(file => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setSelectedFiles([]);

    // CRITICAL: Reset ALL streaming state to prevent old content from bleeding into new responses
    setStreamingContent(''); // Clear streaming content
    setActiveMcpCalls([]); // Clear MCP calls

    // Clear placeholder ref to prevent updates to old placeholders
    const oldPlaceholderId = streamingPlaceholderIdRef.current;
    if (oldPlaceholderId) {
      // console.log('[CHAT] Clearing old placeholder ref:', oldPlaceholderId);
      // Mark old placeholder as completed to stop any further updates
      if (sessionId) {
        finishStreamingMessage(sessionId, oldPlaceholderId);
      }
      streamingPlaceholderIdRef.current = null;
    }

    // CRITICAL FIX: Add placeholder assistant message IMMEDIATELY to preserve message order
    // This prevents second user messages from appearing above first assistant responses
    const assistantPlaceholderId = `assistant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '', // Will be filled as streaming progresses
      timestamp: new Date(baseTimestamp + 1).toISOString(), // Ensure it comes after user message
      status: 'streaming'
    };

    // console.log('[CHAT] Creating new placeholder for new message:', assistantPlaceholderId);

    if (sessionId) {
      addMessage(sessionId, assistantPlaceholder);
      streamingPlaceholderIdRef.current = assistantPlaceholderId; // Track this ID for updates
    }

    // Send message using SSE - admins can override model selection
    // console.log('[CHAT] About to call sendSSEMessage with:', {
    //   message,
    //   sessionId,
    //   selectedModel,
    //   enabledToolsCount: Array.from(enabledTools).length,
    //   enabledTools: Array.from(enabledTools),
    //   hasFiles: base64Images.length > 0,
    //   filesCount: base64Images.length,
    //   enabledPromptTechniques: Array.from(enabledPromptTechniques),
    //   sendSSEMessageType: typeof sendSSEMessage,
    //   sendSSEMessageExists: !!sendSSEMessage
    // });

    if (!sendSSEMessage) {
      console.error('[CHAT] CRITICAL ERROR: sendSSEMessage is null/undefined!');
      return;
    }

    // console.log('[CHAT] CALLING sendSSEMessage NOW...');
    lastMessageSentRef.current = Date.now(); // Track when message was sent to prevent race conditions

    // Start unified agent activity tracking
    agentHandlers.onStreamStart(assistantPlaceholderId, selectedModel || undefined);

    try {
      // If canvas is open with an artifact, include it so the LLM can edit in-place
      const artifactCtx = canvasOpen && canvasContent?.content && typeof canvasContent.content === 'string'
        ? { content: canvasContent.content, title: canvasContent.title || '', type: canvasContent.type || 'html' }
        : undefined;

      const result = await sendSSEMessage(message, {
        // Pass selected model — empty string means Smart Router (auto-select)
        // CRITICAL: Do NOT use `|| undefined` — empty string IS intentional (Smart Router)
        model: selectedModel !== null && selectedModel !== undefined ? selectedModel : undefined,
        enabledTools: Array.from(enabledTools),
        files: base64Images.length > 0 ? base64Images : undefined,
        // Pass enabled prompt techniques
        promptTechniques: Array.from(enabledPromptTechniques),
        // Enable extended thinking for supported models (Claude 3.5+, o1-preview, etc.)
        enableExtendedThinking: showThinkingInline,
        // Pass current workflow context when in flows mode (for Flows Agent)
        flowContext: appMode === 'flows' ? currentWorkflowRef.current : undefined,
        // Artifact iteration — LLM can edit the open artifact in-place
        artifactContext: artifactCtx,
      });
      // console.log('[CHAT] sendSSEMessage completed successfully:', result);
    } catch (error) {
      console.error('[CHAT] CRITICAL ERROR - Failed to send message');
      // Error is already handled by the SSE hook's onError callback
    }
  }, [inputMessage, activeSessionId, isStreaming, sendSSEMessage, selectedFiles, enabledTools, selectedModel, enabledPromptTechniques, agentHandlers.onStreamStart]);

  // Wire the end-of-message follow-up suggestion chips. Clicking a chip
  // dispatches a 'followup-chip-clicked' window event (AgenticActivityStream /
  // ChipsRow). The listener hook existed + was unit-tested but was never
  // mounted, so chips fired into the void and did nothing. We fill the composer
  // with the chip's prompt and auto-submit on the next render once the input
  // state has flushed (sendMessage reads inputMessage, which is async).
  const followupPendingRef = useRef(false);
  useFollowupChipListener((prompt: string) => {
    if (isStreaming) return;
    setInputMessage(prompt);
    followupPendingRef.current = true;
  });
  useEffect(() => {
    if (followupPendingRef.current && inputMessage.trim() && !isStreaming) {
      followupPendingRef.current = false;
      void sendMessage();
    }
  }, [inputMessage, isStreaming, sendMessage]);

  // Load sessions on mount
  useEffect(() => {
    if (isAuthenticated) {
      loadSessions();
      // Auto-create first session if no sessions exist (handled in loadSessions)
    }
  }, [isAuthenticated]); // loadSessions is stable from zustand, no need in deps
  
  // Load messages when current session changes
  useEffect(() => {
    if (activeSessionId && isAuthenticated) {
      loadSessionMessages(activeSessionId);
    }
  }, [activeSessionId, isAuthenticated, loadSessionMessages]);

  // Track when messages are sent to avoid race conditions
  const lastMessageSentRef = useRef<number>(0);
  
  // DISABLED: Do not stop streaming when session changes - this was causing abort race condition
  // The original intent was to prevent input from remaining disabled, but it was aborting active streams
  // Instead, let the stream complete naturally and the UI will update accordingly
  useEffect(() => {
    // console.log('[SESSION] Session change detected:', { activeSessionId, isStreaming, isAuthenticated });
    // Do not automatically stop streaming on session changes - let streams complete naturally
    if (isStreaming) {
      // console.log('[SESSION] Stream active during session change - allowing to continue');
    }
  }, [activeSessionId, isStreaming, isAuthenticated]);

  // Load MCP functions (only once)
  const mcpLoadedRef = useRef(false);
  useEffect(() => {
    // Load MCP functions when authenticated
    const isLocalMode = import.meta.env.DEV && import.meta.env.VITE_LOCAL_MODE === 'true';
    if ((isAuthenticated || isLocalMode) && !mcpLoadedRef.current) {
      mcpLoadedRef.current = true;
      loadMCPFunctions();
    }
  }, [isAuthenticated, loadMCPFunctions]);

  // Fetch available models and current prompt on mount
  useEffect(() => {
    const fetchModelsAndPrompt = async () => {
      try {
        // Get auth token
        const token = await getAccessToken();
        const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
        
        // Fetch available models from API
        // Use /chat/models endpoint which returns ALL individual models (including all Claude variants)
        // The /models endpoint only returns one model per provider
        const modelsResponse = await fetch(apiEndpoint('/chat/models'), {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders  // FIX: Pass auth token for authenticated endpoint
          }
        });
        
        if (modelsResponse.ok) {
          const data = await modelsResponse.json();
          if (data.models && data.models.length > 0) {
            // Chat dropdown only shows READY models (configured + available)
            // Unpulled/catalog models are managed in Admin Console Model Garden only
            const readyModels = data.models.filter((m: { id: string; isAvailable?: boolean }) => m.isAvailable !== false);
            setAvailableModels(readyModels);

            // Model selection is ADMIN ONLY
            // Non-admins always use empty string which defaults to auto-routing on backend
            if (isAdminUser) {
              // Validate stored model against available models
              const storedModel = localStorage.getItem('selectedModel');
              const modelIds = data.models.map((m: { id: string; isAvailable?: boolean }) => m.id);

              if (storedModel && modelIds.includes(storedModel)) {
                // Stored model is valid - use it
                console.log('[MODEL] Admin using stored model from localStorage:', storedModel);
                setSelectedModel(storedModel);
              } else {
                // No valid stored model - use Smart Router (empty string)
                // This lets the model router choose the best model based on query complexity
                console.log('[MODEL] Admin no stored model, using Smart Router');
                setSelectedModel('');
              }
            } else {
              // Non-admin - always use default auto-routing (empty string)
              console.log('[MODEL] Non-admin user, using default auto-routing');
              setSelectedModel('');
              localStorage.removeItem('selectedModel');
            }
          }
        }

        // Fetch current user's assigned prompt template
        try {
          const promptResponse = await fetch(apiEndpoint('/admin/prompts/my-template'), {
            headers: {
              'X-OpenAgentic-Frontend': 'true',
              ...authHeaders
            }
          });

          if (promptResponse.ok) {
            const promptData = await promptResponse.json();
            if (promptData.template?.name) {
              setCurrentPrompt(promptData.template.name);
            }
          } else {
            // Fall back to default if no specific template assigned
            setCurrentPrompt('Default Assistant');
          }
        } catch (promptError) {
          console.error('Could not fetch current prompt template:', promptError);
          // Fall back to default - this is normal if no template is assigned
          setCurrentPrompt('Default Assistant');
        }

        // Fetch multi-model config (admin only) to check if multi-model mode is enabled
        if (isAdminUser) {
          try {
            const multiModelResponse = await fetch(apiEndpoint('/admin/multi-model/config'), {
              headers: {
                'X-OpenAgentic-Frontend': 'true',
                ...authHeaders
              }
            });

            if (multiModelResponse.ok) {
              const multiModelData = await multiModelResponse.json();
              const isEnabled = multiModelData.config?.enabled ?? false;
              setMultiModelEnabled(isEnabled);
              console.log('[MULTI-MODEL] Mode enabled:', isEnabled);
            }
          } catch (multiModelError) {
            console.warn('Could not fetch multi-model config:', multiModelError);
            setMultiModelEnabled(false);
          }
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      }
    };

    fetchModelsAndPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminUser]); // Re-run when admin status changes (e.g., after user loads)

  // Listen for multi-model config changes (dispatched from Admin Portal)
  useEffect(() => {
    const handleMultiModelChange = async (event: CustomEvent<{ enabled: boolean }>) => {
      console.log('[MULTI-MODEL] Config changed via event:', event.detail);
      setMultiModelEnabled(event.detail.enabled);
    };

    window.addEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    return () => {
      window.removeEventListener('multimodel-config-changed', handleMultiModelChange as EventListener);
    };
  }, []);

  // SEV0 FIX (2026-04-08): Keep chat model selector in sync with admin console
  // CRUD operations. Previously /chat/models was fetched once on mount, so
  // any add/delete/toggle/edit in Model Registry stayed invisible to open
  // chat tabs until hard-refresh. onModelsChanged hooks a same-tab CustomEvent
  // plus a cross-tab BroadcastChannel so admin changes propagate immediately.
  useEffect(() => {
    const refetchModels = async () => {
      try {
        const token = await getAccessToken();
        const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(apiEndpoint('/chat/models'), {
          headers: { 'Content-Type': 'application/json', ...authHeaders },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          const readyModels = data.models.filter((m: { id: string; isAvailable?: boolean }) => m.isAvailable !== false);
          setAvailableModels(readyModels);
          // If the currently selected model was deleted, fall back to Smart Router
          const modelIds = readyModels.map((m: { id: string; isAvailable?: boolean }) => m.id);
          if (selectedModel && !modelIds.includes(selectedModel)) {
            console.log('[MODEL-SYNC] Selected model no longer available, reverting to Smart Router');
            setSelectedModel('');
          }
          console.log('[MODEL-SYNC] Chat model list refreshed from admin signal:', readyModels.length, 'models');
        }
      } catch (err) {
        console.warn('[MODEL-SYNC] Refetch failed:', err);
      }
    };
    const unsubscribe = onModelsChanged((reason) => {
      console.log('[MODEL-SYNC] Received models-changed signal, reason:', reason);
      refetchModels();
    });

    // Polling fallback: refresh every 30s so admin changes in other tabs/windows
    // are always picked up even if CustomEvent/BroadcastChannel fails.
    const pollInterval = setInterval(() => refetchModels(), 30000);

    return () => { unsubscribe(); clearInterval(pollInterval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModel]);

  // REMOVED: This useEffect was causing infinite loops
  // The theme is already managed by ThemeContext - no need to notify parent on every change

  // Expose functions to parent component
  useEffect(() => {
    if (onFunctionsReady) {
      onFunctionsReady({
        createNewSession: () => {
          // CRITICAL: Abort any ongoing stream before creating new session
          if (isStreaming) {
            stopStreaming();
          }
          resetAgentState();
          createNewSession(() => {
            // Reset session-specific state when creating new session via parent
            clearCoTSteps();
            setAlwaysApprovedTools(new Set<string>());
          });
        },
        toggleMetrics: () => toggleUI('showMetricsPanel'),
        openMonitor: () => {
          // Monitor feature placeholder
        },
        toggleSidebar: () => toggleUI('showChatSessions')
      });
    }
  }, [onFunctionsReady, createNewSession, showMetricsPanel, showChatSessions, isStreaming, stopStreaming, resetAgentState]);

  // Track message count - auto-scroll disabled to let users control their view
  // Users can use the ScrollToBottomButton when they want to jump to the latest message
  const lastMessageCountRef = useRef<number>(0);

  useEffect(() => {
    // Just track message count for reference, no auto-scroll
    if (messages.length > lastMessageCountRef.current) {
      lastMessageCountRef.current = messages.length;
    }
  }, [messages.length]);

  // Auto-save conversations if enabled
  useEffect(() => {
    // Auto-save is always enabled - backend handles persistence
    if (activeSessionId && messages.length > 0) {
      // Messages are automatically persisted by the backend through the SSE stream
      // console.log('Messages are persisted by the backend');
    }
  }, [messages, activeSessionId, getAccessToken]);

  // Update streaming placeholder content as it streams in
  // CRITICAL: Only update if content is actually new (not stale from previous message)
  // Resolves the target session id render-SYNCHRONOUSLY via resolveSessionId()
  // (closure → store → firstSendSessionIdRef), NOT via the late-flushing
  // firstSendStreamSessionId useState. On the FIRST message of a new chat the live
  // tokens then mirror into the placeholder under the freshly-created session on the
  // very first-delta render instead of bailing on a stale '' (which is why it used to
  // need a reload). renderSessionId stays in the dep list so the effect re-runs once
  // the closure/state catch up. Mirrors the upstream ChatContainer, which keys this
  // mirror on the live active session id.
  useEffect(() => {
    const writeSessionId = resolveSessionId();
    if (!streamingPlaceholderIdRef.current || !currentMessage || !writeSessionId) {
      return;
    }

    // Find the placeholder message to verify it's still streaming
    const placeholder = messages.find(m => m.id === streamingPlaceholderIdRef.current);
    if (!placeholder || placeholder.status !== 'streaming') {
      // console.log('[CHAT] Skipping update - placeholder not found or not streaming');
      return;
    }

    // Only update if content is different (prevents stale updates)
    if (placeholder.content !== currentMessage) {
      updateStreamingMessage(writeSessionId, streamingPlaceholderIdRef.current, currentMessage);
    }
  }, [currentMessage, renderSessionId, messages, updateStreamingMessage, resolveSessionId]);

  // Auto-scroll to bottom during streaming to keep user focused on response
  // Triggers on currentMessage OR contentBlocks changes to follow thinking/tool outputs
  // Uses requestAnimationFrame for smooth, non-blocking scrolling
  useEffect(() => {
    if (isStreaming && (currentMessage || contentBlocks.length > 0)) {
      requestAnimationFrame(() => {
        const container = document.getElementById('chat-messages-container');
        if (container) {
          // Only auto-scroll if user is near the bottom (within 300px for better UX)
          const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 300;
          if (isNearBottom) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'auto' // Use 'auto' for instant scroll during streaming to avoid jitter
            });
          }
        }
      });
    }
  }, [isStreaming, currentMessage, contentBlocks.length]);

  // Auto-open canvas panel when streaming completes and response contains an artifact
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
    } else if (wasStreamingRef.current) {
      wasStreamingRef.current = false;
      // Streaming just ended — check recent messages for artifacts
      const lastMsg = messages[messages.length - 1];
      const lastContent = lastMsg?.content || '';

      // Helper to open an artifact in the canvas panel
      const openArtifact = (type: string, artifactContent: string, title?: string) => {
        const lang = type === 'html' ? 'html' : type === 'react' ? 'tsx' : type === 'svg' ? 'svg' : type;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
            detail: {
              content: artifactContent,
              type: lang,
              title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} Artifact`,
              language: lang,
            }
          }));
        }, 500);
      };

      // 1. Check direct message content for artifact fences
      const artifactMatch = lastContent.match(/```artifact:(html|react|svg|mermaid|chart|csv|latex|canvas)\n([\s\S]*?)```/);
      if (artifactMatch) {
        openArtifact(artifactMatch[1], artifactMatch[2]);
      } else {
        // 2. Check tool results (orchestration agents may embed artifacts in their output)
        // Scan toolResults and aggregated tool messages for artifact fences
        const toolOutputs: string[] = [];
        if (lastMsg?.toolResults) {
          for (const tr of lastMsg.toolResults) {
            const s = typeof tr === 'string' ? tr : JSON.stringify(tr);
            toolOutputs.push(s);
          }
        }
        // Also check aggregated messages for tool results
        if (lastMsg?.toolCalls) {
          for (const msg of messages) {
            if (msg.role === 'tool' && msg.content) {
              toolOutputs.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
            }
          }
        }
        // Search all collected tool outputs for artifact fences
        for (const output of toolOutputs) {
          // Artifact fences may be escaped inside JSON strings — handle both raw and escaped newlines
          const unescaped = output.replace(/\\n/g, '\n').replace(/\\"/g, '"');
          const toolArtifactMatch = unescaped.match(/```artifact:(html|react|svg|mermaid|chart|csv|latex|canvas)\n([\s\S]*?)```/);
          if (toolArtifactMatch) {
            // Try to extract a title from the HTML content
            const titleMatch = unescaped.match(/<title>([^<]+)<\/title>/i);
            openArtifact(toolArtifactMatch[1], toolArtifactMatch[2], titleMatch?.[1]);
            break;
          }
        }
      }
    }
  }, [isStreaming, messages]);

  // Load user usage data on mount and periodically
  useEffect(() => {
    if (isAuthenticated) {
      fetchUserUsage();
      
      // Refresh usage data every 5 minutes
      const interval = setInterval(fetchUserUsage, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchUserUsage]);

  // Auto-scroll to bottom when loading any chat session (new or existing)
  // This ensures the user sees the latest messages when switching sessions OR on initial load
  useEffect(() => {
    // Scroll if:
    // 1. Session changed and has messages, OR
    // 2. Messages just loaded for a session we haven't scrolled for yet
    const sessionChanged = activeSessionId !== previousActiveSessionId;
    const needsInitialScroll = activeSessionId &&
      messages.length > 0 &&
      hasScrolledForSession.current !== activeSessionId;

    if ((sessionChanged && messages.length > 0) || needsInitialScroll) {
      // Mark this session as scrolled
      hasScrolledForSession.current = activeSessionId;

      // Use setTimeout to ensure DOM has updated with messages
      setTimeout(() => {
        requestAnimationFrame(() => {
          const container = document.getElementById('chat-messages-container');
          if (container) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'auto' // Instant scroll when loading a session
            });
          }
        });
      }, 50);
    }
  }, [activeSessionId, previousActiveSessionId, messages.length]);

  // Track session changes for proper scroll behavior
  useEffect(() => {
    setPreviousActiveSessionId(activeSessionId);
    // Reset scroll tracking and agent state when session changes
    if (activeSessionId !== previousActiveSessionId) {
      hasScrolledForSession.current = null;
      // Reset unified agent activity state for the new session
      resetAgentState();
    }
  }, [activeSessionId, resetAgentState]);

  // Auto-focus input when new session starts
  useEffect(() => {
    if (activeSessionId && messages.length === 0) {
      // Focus the chat input when starting a new session
      const inputElement = document.querySelector('[data-chat-input]') as HTMLTextAreaElement;
      if (inputElement) {
        setTimeout(() => inputElement.focus(), 100);
      }
    }
  }, [activeSessionId, messages.length]);

  // Cleanup memory leaks on unmount
  useEffect(() => {
    return () => {
      // Clean up any remaining file preview URLs
      selectedFiles.forEach(file => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
    };
  }, [selectedFiles]);

  // Load global token usage data for admin users
  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      fetchGlobalTokenUsage();
      
      // Refresh global usage data every 5 minutes for admins
      const interval = setInterval(fetchGlobalTokenUsage, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, isAdmin, fetchGlobalTokenUsage]);

  // Handle canvas expansion
  const handleExpandToCanvas = useCallback((content: unknown, type: string, title: string, language?: string) => {
    const canvasItem = {
      id: Math.random().toString(36).substring(2, 15),
      type: type as CanvasContent['type'],
      title,
      content,
      language,
      timestamp: new Date().toISOString()
    };

    setCanvasContent(canvasItem);
    // Persist so closing the panel doesn't lose the artifact
    try { sessionStorage.setItem('openagentic:lastArtifact', JSON.stringify(canvasItem)); } catch {}
    openUI('canvasOpen');
  }, [openUI]);

  // Listen for canvas open events from ArtifactRenderer (avoids prop drilling)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        handleExpandToCanvas(detail.content, detail.type, detail.title, detail.language);
      }
    };
    window.addEventListener('openagentic:open-canvas', handler);
    return () => window.removeEventListener('openagentic:open-canvas', handler);
  }, [handleExpandToCanvas]);

  // Code execution is handled by the handleExecuteCode from useMCPTools hook

  // Handle message update
  const handleMessageUpdate = useCallback(async (messageId: string, newContent: string) => {
    if (!activeSessionId) return;

    // Store original content for revert if needed
    const originalMessage = messages.find(m => m.id === messageId);
    if (!originalMessage) return;

    // Update message in store
    const updatedMessage = { ...originalMessage, content: newContent };
    // Note: This would require a new store method updateMessage
    // For now, we'll just send the update to backend and rely on re-fetch

    // Send update to backend
    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint(`/chat/messages/${messageId}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: newContent })
      });

      if (!response.ok) {
        console.error('Failed to update message:', response.status);
        // In a proper implementation, we'd need updateMessage in the store to revert
      }
    } catch (error) {
      console.error('Error updating message:', error);
    }
  }, [messages, getAccessToken]);

  // Handle feedback submission (thumbs up/down, copy tracking)
  const handleFeedback = useCallback(async (messageId: string, feedbackType: 'thumbs_up' | 'thumbs_down' | 'copy') => {
    if (!activeSessionId) return;

    // Find the message to get model info
    const message = messages.find(m => m.id === messageId);

    try {
      const result = await submitFeedback({
        messageId,
        sessionId: activeSessionId,
        feedbackType,
        model: message?.model,
        tokenCount: message?.tokens,
      });

      if (result.success) {
        console.log('[Feedback] Submitted:', feedbackType, 'for message:', messageId);
      } else {
        console.error('[Feedback] Failed to submit:', result.error);
      }
    } catch (error) {
      console.error('[Feedback] Error submitting feedback:', error);
    }
  }, [activeSessionId, messages]);

  // Handle text-to-speech - DISABLED
  // const handleTextToSpeech = useCallback((message: ChatMessage) => {
  //   if (isSpeaking) {
  //     stopSpeaking();
  //   } else {
  //     speak(message.content);
  //   }
  // }, [speak, stopSpeaking, isSpeaking]);

  // Handle prompt technique toggling
  const handleTogglePromptTechnique = useCallback((techniqueId: string) => {
    setEnabledPromptTechniques(prev => {
      const newSet = new Set(prev);
      if (newSet.has(techniqueId)) {
        newSet.delete(techniqueId);
      } else {
        newSet.add(techniqueId);
      }
      return newSet;
    });
  }, []);

  // addDemoCoTMessage removed - CoT functionality replaced with sequential-thinking MCP

  // Keyboard shortcut actions
  const keyboardActions = {
    createNewSession: () => {
      // CRITICAL: Abort any ongoing stream before creating new session
      if (isStreaming) {
        stopStreaming();
      }
      resetAgentState();
      createNewSession(() => {
        // Reset session-specific state when creating new session via keyboard
        clearCoTSteps();
        setAlwaysApprovedTools(new Set<string>());
      });
    },
    toggleMetrics: () => toggleUI('showMetricsPanel'),
    toggleZenMode: () => {
      // Implement zen mode - hide all panels except chat
      closeUI('showChatSessions');
      closeUI('showMetricsPanel');
      closeUI('showTokenUsage');
    },
    openChatSettings: () => openUI('showSettings'),
    regenerateMessage: () => {
      // Find last assistant message and regenerate
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMessage) {
        // console.log('Regenerating message:', lastAssistantMessage.id);
      }
    },
    toggleLeftPanel: () => toggleUI('showChatSessions'),
    toggleRightPanel: () => toggleUI('showMetricsPanel'),
    addUserMessage: () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    clearCurrentMessages: () => {
      if (activeSessionId) {
        // Messages are managed by the store, no local state to clear
        setTokenStats({
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalTokens: 0,
          chartData: []
        });
      }
    },
    saveTopic: () => {
      // console.log('Saving topic for session:', activeSessionId);
    },
    focusInput: () => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    },
    searchMessages: () => {
      // console.log('Opening message search');
    },
    exportChat: () => {
      // console.log('Exporting chat');
    },
    toggleTools: () => toggleUI('showSettings'),
    setLightTheme: () => {
      if (onThemeChange) {
        onThemeChange('light');
      }
      updateTheme('light');
    },
    setDarkTheme: () => {
      if (onThemeChange) {
        onThemeChange('dark');
      }
      updateTheme('dark');
    },
    openAdminPortal: () => {
      if (isAdmin) {
        openUI('showAdminPortal');
      } else {
        // console.log('Admin portal access denied - user is not an admin');
      }
    },
    openDocs: () => {
      openUI('showDocsViewer');
    }
  };

  // Register keyboard shortcuts (respecting settings)
  // KEYBOARD SHORTCUTS DISABLED PER USER REQUEST
  const enableKeyboardShortcuts = false;
  const shortcuts = useKeyboardShortcuts(keyboardActions, enableKeyboardShortcuts);

  // Show help with ? key - DISABLED
  // useHotkeys('shift+?', () => {
  //   setShowKeyboardHelp(true);
  // });

  // Demo CoT message removed - replaced with sequential-thinking MCP

  return (
    <div className="flex h-screen relative overflow-hidden">
      {/* Background is now global in App.tsx via WebGLBackground */}

      {/* New Hamburger Sidebar - Hidden when fullscreen overlays are open */}
      {!showAdminPortal && !showDocsViewer && (
      <ChatSidebar
        currentTheme={settings.theme || 'dark'}
        onThemeChange={onThemeChange}
        sessions={Object.values(sessions)}
        currentSessionId={activeSessionId}
        showDeleteConfirm={showDeleteConfirm}
        isExpanded={isSidebarExpanded}
        onExpandedChange={(expanded: boolean) => setUI('isSidebarExpanded', expanded)}
        onSessionSelect={async (sessionId: string) => {
          // CRITICAL: Abort any ongoing stream before switching sessions
          // This prevents the old stream from bleeding into the new session
          if (isStreaming) {
            stopStreaming();
          }
          setActiveSession(sessionId);
          // Clear messages first for instant UI feedback
          // Messages are managed by the store, no local state to clear
          setStreamingContent('');
          setActiveMcpCalls([]);
          // Reset agent activity state for clean session
          resetAgentState();
          // console.log('Switched to session:', sessionId);
          // Load the session's message history
          await loadSessionMessages(sessionId);
        }}
        onSessionDelete={(sessionId) => deleteSession(sessionId, setDeleteConfirm)}
        onNewSession={async () => {
          try {
            // CRITICAL: Abort any ongoing stream before creating new session
            // This prevents the old stream from bleeding into the new session
            if (isStreaming) {
              stopStreaming();
            }
            // Reset agent activity state for clean session
            resetAgentState();
            // console.log('[NEW SESSION] User clicked New Chat button');
            await createNewSession(() => {
              // Reset session-specific state when creating new session
              setInputMessage('');
              setStreamingContent('');
              clearCoTSteps();
              setPendingToolCalls([]);
              setExecutedToolCalls([]);
              setMcpCalls([]);
              setStreamingStatus('idle');
              setAlwaysApprovedTools(new Set<string>());
              // Reset any streaming state
              stopThinking();
              // console.log('[NEW SESSION] Reset all UI state for clean session');
            });
            // console.log('[NEW SESSION] Successfully created new session');
          } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error('[NEW SESSION] Failed to create new session:', err);

            // Differentiate error messages for admin vs regular users
            const isAdmin = user?.isAdmin || user?.is_admin || false;
            const errorContent = isAdmin
              ? `**Failed to create session**\n\n${err.message || 'Unknown error'}`
              : 'Something went wrong. Please try again later or contact support.';

            // Show error message
            const errorMessage: ChatMessage = {
              id: `error_new_session_${Date.now()}`,
              role: 'assistant',
              content: errorContent,
              timestamp: new Date().toISOString(),
              metadata: {
                isError: true,
                errorDetails: isAdmin ? { message: err.message, stack: err.stack } : undefined
              }
            };

            // Add error message to current session if one exists
            if (activeSessionId) {
              addMessage(activeSessionId, errorMessage);
            }
          }
        }}
        onShowDeleteConfirm={setDeleteConfirm}
        onSettingsClick={() => openUI('showSettings')}
        userName={user?.name || user?.email || 'User'}
        userEmail={user?.email}
        isAdmin={isAdmin}
        onAdminPanelClick={() => {
          openUI('showAdminPortal');
        }}
        onLogout={async () => {
          await logout();
        }}
        onHelpClick={() => {
          // Open documentation as overlay modal
          openUI('showDocsViewer');
        }}
        // App Mode toggle (Chat / Flows)
        appMode={appMode}
        onAppModeChange={handleAppModeChange}
        canUseFlows={true}
      />
      )}
      {/* Full-screen Admin Portal - renders over everything including sidebar (lazy loaded) */}
      {showAdminPortal && (
        <div className="fixed inset-0 z-50">
          <Suspense fallback={
            <div className="h-full w-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-background)' }}>
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto" />
                <p className="mt-4 text-sm" style={{ color: 'var(--color-textMuted)' }}>Loading Admin Portal...</p>
              </div>
            </div>
          }>
            <AdminPortal
              theme={settings.theme || 'dark'}
              embedded={false}
              onClose={handleCloseAdminPortal}
            />
          </Suspense>
        </div>
      )}

      {/* Full-screen Docs Viewer - renders over everything including sidebar */}
      {showDocsViewer && (
        <div className="fixed inset-0 z-50">
          <DocsViewer
            isOpen={true}
            onClose={handleCloseDocsViewer}
            theme={settings.theme || 'dark'}
          />
        </div>
      )}

      {/* Main chat area — TERMINAL GLASS (elevated): a floating frosted glass
          panel (.glass) that the living orange aurora blurs THROUGH for real
          depth, matching the reference main column. Inset from the viewport
          edges so it reads as a panel (the sidebar is likewise floating), with
          the staggered rise load-in. Hidden when fullscreen overlays are open. */}
      {!showAdminPortal && !showDocsViewer && (
      <div
        className="flex flex-col transition-all duration-150"
        style={{
          position: 'fixed',
          top: 12,
          bottom: 12,
          right: 12,
          left: isSidebarExpanded ? '320px' : '64px',
        }}
      >
        <div className="glass rise rise-d2 flex flex-col h-full w-full overflow-hidden">
          {/* Conditional rendering: Chat Mode vs Flows Mode vs Code Mode */}
          {appMode === 'codemode' ? (
            /* Code Mode — agenticode desktop download page (OSS ships the links, not the IDE) */
            <ErrorBoundary>
              <CodemodeDownloadPage />
            </ErrorBoundary>
          ) : appMode === 'flows' ? (
            /* Flows Mode - OpenAgenticflow Builder (embedded=true: sidebar managed by ChatSidebar) */
            <ErrorBoundary>
              <WorkflowsPage embedded onWorkflowStateChange={(ws) => { currentWorkflowRef.current = ws; }} />
            </ErrorBoundary>
          ) : (
          /* Chat Mode - Normal chat interface */
          <>
          {/* Main content area - Chat messages */}
          <div
            id="chat-messages-container"
            className="flex-1 overflow-y-auto bg-transparent relative"
            style={{
              // Optimize scroll performance
              overscrollBehavior: 'contain',
              scrollBehavior: 'auto', // Use auto for instant scroll updates during streaming
              willChange: 'scroll-position',
              contain: 'strict',
              width: '100%',
              height: '100%'
            }}
          >
            {/* Context Compaction Notification Banner */}
            <AnimatePresence>
              {contextCompaction && (
                <motion.div
                  initial={{ opacity: 0, y: -20, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -20, height: 0 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="sticky top-0 z-10 flex items-center justify-center px-4 py-2"
                >
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm border"
                    style={{
                      background: 'var(--color-bg-secondary)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <Brain size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                    <span>
                      Optimized conversation context &mdash; {contextCompaction.freedPercent}% freed
                    </span>
                    <button
                      onClick={() => {/* contextCompaction auto-dismisses */}}
                      className="ml-2 p-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Export Button - DISABLED (not working) */}
            <ChatMessages
              theme={settings.theme || 'dark'}
              messages={messages}
              streamingContent={currentMessage}
              smoothStreaming={true}
              isLoading={isStreaming}
              thinkingTime={thinkingTime}
              thinkingMessage={currentThinking}
              thinkingContent={currentThinking}
              thinkingMetrics={thinkingMetrics}
              messagesEndRef={messagesEndRef}
              activeMcpCalls={activeMcpCalls}
              currentToolRound={currentToolRound}
              pipelineState={pipelineState}
              showTypingIndicators={true}
              showMCPIndicators={showMCPIndicators}
              showModelBadges={showModelBadges}
              showThinkingInline={showThinkingInline}
              cotSteps={cotSteps}
              agentState={agentState}
              contentBlocks={contentBlocks}
              canonicalContentBlocks={canonicalContentBlocks}
              thinkingProgress={thinkingProgress}
              normalizedEvents={normalizedEvents}
              onExpandToCanvas={handleExpandToCanvas}
              onExecuteCode={handleExecuteCode}
              onMessageUpdate={handleMessageUpdate}
              onFeedback={handleFeedback}
              hitlApprovalsByMessageId={hitlApprovalsByMessageId}
              onApproveHitl={handleApproveHitl}
              onDenyHitl={handleDenyHitl}
            />

            {/* Floating "Go to latest" chip — appears when user has scrolled
                up from the bottom. Click scrolls smoothly to the latest message.
                Mirrors the openagentic terminal chip UX. */}
            <AnimatePresence>
              {!isAtBottom && messages.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.15 }}
                  onClick={scrollToLatest}
                  aria-label="Go to latest message"
                  className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium shadow-lg backdrop-blur-sm hover:scale-105 transition-transform"
                  style={{
                    bottom: '20px',
                    background: 'var(--color-primary, var(--user-accent-primary))',
                    color: 'white',
                    border: '1px solid var(--color-primary-border, rgba(255,255,255,0.2))',
                  }}
                >
                  <span>Go to latest</span>
                  <ChevronDown size={16} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Input area - FIXED at bottom, NO BORDER - Hidden when admin portal or docs viewer is active */}
          {!showAdminPortal && !showDocsViewer && (
          <div className="flex-shrink-0">
            {/* Post-login WELCOME route shortcuts — access-aware, shown only on
                the fresh/magic-link welcome turn, above the always-live composer. */}
            {welcomeBarVisible && (
              <WelcomeRouteBar routes={welcomeRoutes} onDismiss={dismissWelcomeBar} />
            )}
            {/* Input area */}
            <div className="relative">
              {/* REMOVED: UnifiedAgentActivity - thinking/steps now displayed INLINE in message bubbles */}

              {/* Selected files display */}
              {selectedFiles.length > 0 && (
                <div className="px-4 pt-3 pb-1 bg-theme-bg-secondary">
                  <div className="flex flex-wrap gap-2">
                    {selectedFiles.map((file, index) => (
                      <motion.div
                        key={`${file.name}-${index}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-theme-bg-tertiary text-theme-text-secondary"
                      >
                        <Paperclip size={12} />
                        <span className="max-w-[150px] truncate">{file.name}</span>
                        <button
                          onClick={() => {
                            setSelectedFiles(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="ml-1 p-0.5 rounded hover:bg-opacity-20 hover:bg-theme-text-primary"
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Modern Chat Input Bar with integrated toolbar */}
              <SSEErrorBoundary onRetry={() => {
                // Reset streaming state on retry
                setStreamingContent('');
                setActiveMcpCalls([]);
              }}>
                <ChatInputBar
                  value={inputMessage}
                  onChange={setInputMessage}
                  onSend={sendMessage}
                  onStopGeneration={stopStreaming}
                  messageHistory={messageHistory}
                  onFileSelect={(files) => {
                    // Create file objects with preview URLs for images
                    const filesWithPreviews: FileWithPreview[] = files.map((file: FileWithPreview) => {
                      if (file.type.startsWith('image/') && !file.type.includes('svg')) {
                        // Create a preview URL for the image
                        const previewUrl = URL.createObjectURL(file);
                        // Store the preview URL on the file object
                        file.previewUrl = previewUrl;
                      }
                      return file;
                    });
                    setSelectedFiles([...selectedFiles, ...filesWithPreviews]);
                  }}
                  onFileRemove={(fileId) => {
                    // Clean up preview URLs when removing files
                    const fileToRemove = selectedFiles.find(f => f.name === fileId);
                    if (fileToRemove && fileToRemove.previewUrl) {
                      URL.revokeObjectURL(fileToRemove.previewUrl);
                    }
                    setSelectedFiles(selectedFiles.filter(f => f.name !== fileId));
                  }}
                  isLoading={isStreaming}
                  isStreaming={isStreaming}
                  disabled={!isAuthenticated}
                  attachments={selectedFiles.map(file => {
                    // Determine file type for proper icon display
                    const extension = file.name.split('.').pop()?.toLowerCase();
                    const mimeType = file.type.toLowerCase();

                    let fileType: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other' = 'other';

                    if (mimeType.startsWith('image/')) {
                      fileType = 'image';
                    } else if (mimeType === 'application/pdf' || extension === 'pdf') {
                      fileType = 'pdf';
                    } else if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'sql'].includes(extension || '')) {
                      fileType = 'code';
                    } else if (['xls', 'xlsx', 'csv'].includes(extension || '') || mimeType.includes('spreadsheet')) {
                      fileType = 'spreadsheet';
                    } else if (extension === 'json' || mimeType === 'application/json') {
                      fileType = 'json';
                    } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '') || mimeType.includes('zip') || mimeType.includes('compressed')) {
                      fileType = 'archive';
                    } else if (['doc', 'docx', 'txt', 'md', 'rtf', 'odt'].includes(extension || '') || mimeType.includes('document') || mimeType.includes('text')) {
                      fileType = 'document';
                    }

                    return {
                      id: file.name,
                      file,
                      type: fileType,
                      preview: file.previewUrl
                    };
                  })}
                  // Toolbar props
                  showTokenUsage={showPersonalTokenUsage}
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={(model) => {
                    // Only update local state for this session, not global settings
                    setSelectedModel(model);
                  }}
                  onToggleTokenUsage={() => {
                    // console.log('[TOOLBAR DEBUG] Personal Token Usage clicked, current:', showPersonalTokenUsage);
                    toggleUI('showPersonalTokenUsage');
                  }}
                  // Pass MCP functions for toolbar display
                  availableMcpFunctions={availableMCPFunctions}
                  enabledTools={enabledTools}
                  onToggleTool={handleToggleTool}
                  // Token count from API
                  tokenCount={tokenStats.totalTokens}
                  // Active MCP calls for centered display
                  activeMcpCalls={activeMcpCalls}
                  // MCP Indicators display toggle
                  showMCPIndicators={showMCPIndicators}
                  onToggleMCPIndicators={() => toggleUI('showMCPIndicators')}
                  // Model Badges display toggle
                  showModelBadges={showModelBadges}
                  onToggleModelBadges={() => toggleUI('showModelBadges')}
                  // Thinking mode toggle - only show for models that support it
                  isThinkingEnabled={showThinkingInline}
                  onThinkingToggle={() => toggleUI('showThinkingInline')}
                  // Determine if selected model supports thinking (Claude Sonnet 4+, Opus, etc.)
                  modelSupportsThinking={(() => {
                    const model = (selectedModel || '').toLowerCase();
                    // Models that support extended thinking
                    return model.includes('sonnet-4') ||
                           model.includes('opus-4') ||
                           model.includes('claude-3-7') ||
                           model.includes('claude-3.7') ||
                           (model.includes('claude') && (model.includes('sonnet') || model.includes('opus')) && !model.includes('haiku'));
                  })()}
                  // Multi-model mode (disables model selector when enabled)
                  isMultiModelEnabled={isMultiModelEnabled}
                  onToggleToolInspector={() => setShowToolInspector(prev => !prev)}
                  showToolInspector={showToolInspector}
                  className="pb-0"
                />
              </SSEErrorBoundary>
            </div>
          </div>
          )}
          </>
          )}
        </div>
      </div>
      )}

      {/* Side panels */}
      <AnimatePresence>
        {showMetricsPanel && (
          <MetricsPanel
            tokenStats={tokenStats}
            onClose={() => closeUI('showMetricsPanel')}
            onShowMovableGraph={() => openUI('showTokenGraph')}
          />
        )}
      </AnimatePresence>
      
      {/* Settings Dropdown removed - no longer needed */}
      
      
      {/* Canvas Panel */}
      <CanvasPanel
        isOpen={canvasOpen}
        onClose={() => closeUI('canvasOpen')}
        content={canvasContent}
        theme={settings.theme || 'dark'}
        onExecute={handleExecuteCode}
        onSave={async (artifact) => {
          try {
            const response = await fetch('/api/workflows/executions/canvas/artifacts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({
                content: typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content),
                title: artifact.title,
                format: artifact.type,
              }),
            });
            if (response.ok) {
              console.log('[Canvas] Artifact saved to knowledge base');
            }
          } catch (err) {
            console.error('[Canvas] Failed to save artifact:', err);
          }
        }}
      />

      {/* Admin Portal is now embedded in main content area - modal removed */}

      {/* Token Graph removed - analytics feature deleted */}
      
      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        isOpen={showKeyboardHelp}
        onClose={() => closeUI('showKeyboardHelp')}
      />

      {/* HITL Panel — triggered by /hitl command */}
      <HITLPanel
        visible={hitlPanelVisible}
        onClose={() => setHitlPanelVisible(false)}
        mode={hitlMode}
        onModeChange={setHitlMode}
        log={hitlLog}
      />

      {/* MCP Tool Approval Dialog — HITL popup for CRUD/destructive MCP operations */}
      {mcpApproval && (
        <ToolApprovalDialog
          tools={[{
            id: mcpApproval.requestId,
            name: mcpApproval.toolName,
            arguments: JSON.stringify(mcpApproval.arguments, null, 2),
          }]}
          toolCallRound={1}
          onApprove={handleApproveMcpTool}
          onReject={handleDenyMcpTool}
        />
      )}

      {/* Mutating-tool approval gate — append-only audit-backed HITL */}
      {auditApproval && (
        <ApprovalModal
          approval={auditApproval}
          queuedCount={Math.max(0, auditApprovals.length - 1)}
          pending={auditApprovalPending}
          onApprove={handleApproveAudit}
          onDeny={handleDenyAudit}
        />
      )}

      {/* Admin Tool Call Inspector Panel */}
      <AdminToolInspector
        visible={showToolInspector && isAdminUser}
        onClose={() => setShowToolInspector(false)}
        messages={messages}
      />

      {/* Admin Portal is now embedded in main content area */}

      {/* Documentation Viewer */}
      {/* {showDocsViewer && (
        <DocsViewer onClose={() => closeUI('showDocsViewer')} />
      )} */}

      {/* Image Analysis Modal */}
      <AnimatePresence>
        {showImageAnalysis && currentImageForAnalysis && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-background)' }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                closeUI('showImageAnalysis');
                setCurrentImageForAnalysis(null);
              }
            }}
          >
            <div className="w-full max-w-4xl mx-4 h-[80vh]">
              <ImageAnalysis
                file={currentImageForAnalysis}
                onAnalysisComplete={handleImageAnalysisComplete}
                onClose={() => {
                  closeUI('showImageAnalysis');
                  setCurrentImageForAnalysis(null);
                }}
                theme={settings.theme || 'dark'}
                className="w-full h-full"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Portal and Documentation Viewer now rendered inline - modal overlays removed */}

      {/* Background Jobs Panel */}
      <BackgroundJobsPanel
        isOpen={showBackgroundJobs}
        onClose={() => closeUI('showBackgroundJobs')}
      />

      {/* Activity Orb replaced by UnifiedAgentActivity component with integrated ThinkingSphere */}

    </div>
  );
};

export default Chat;
