/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * CodeModeLayout - Openagentic Web IDE
 *
 * Full React-based code mode interface featuring:
 * - 3-panel layout: Files | Conversation | Editor/Preview
 * - Inline tool blocks with git-style diffs
 * - Animated todos with strikethrough
 * - Fun status indicators ("Pontificating...", "Booping...")
 * - Embedded code-server (VS Code) per user
 * - Real-time file sync between AI and user edits
 *
 * Session persists when switching to chat mode and back.
 */

import React, { useRef, useEffect, useCallback, useState, useMemo, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// File attachments for file conversion (used in handleSubmit)
import { type FileWithPreview } from '@/features/chat/hooks/useFileAttachments';
import type { FileAttachment } from '../hooks/useCodeModeWebSocket';

// Store - Use individual selectors to prevent re-render loops
import {
  useCodeModeStore,
  useConnectionState,
  useActivityState,
  useActivityMessage,
  useMessages,
  useStreamingMessage,
  useActiveSessionId,
  useSession,
  useInitSteps,
  useReconnectAttempts,
  useTotalInputTokens,
  useTotalOutputTokens,
  useNormalizedEvents,
} from '@/stores/useCodeModeStore';

// Components
import { EditorPanel } from './EditorPanel';
import { CodeModeStatusBar } from './CodeModeStatusBar';
import { PreviewPanel, detectDevServerUrl } from './PreviewPanel';
import { TerminalPanel } from './TerminalPanel';
import { SessionBootScreen } from './SessionBootScreen';
import { CodeModeChatView } from './CodeModeChatView';
import { CodeModeInputToolbar } from './CodeModeInputToolbar';
import { TerminalActivityOverlay } from './TerminalActivityOverlay';
import { TerminalToolCardStack } from './TerminalToolCardStack';
// NativeTranscript + RenderModePill are intentionally NOT imported
// here. The dual-view toggle is pulled until Phase 3 ships — see the
// comment on the header bar below. The component file stays in tree
// so re-enabling is a one-line change.
import { useOpenagenticProgress } from '../hooks/useOpenagenticProgress';

// Utils
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';
// MonitorPlay moved to EditorPanel

// Model selection
import {
  useSelectedModel,
  useAvailableModels,
  useModelActions,
} from '@/stores/useModelStore';
import { useTTFT } from '../hooks/useTTFT';

// =============================================================================
// Global Expand/Collapse Context (Ctrl+O)
// =============================================================================

interface ExpandCollapseContextValue {
  allExpanded: boolean;
  toggleAll: () => void;
}

const ExpandCollapseContext = createContext<ExpandCollapseContextValue>({
  allExpanded: false,
  toggleAll: () => {},
});

export const useExpandCollapseContext = () => useContext(ExpandCollapseContext);

// =============================================================================
// Types
// =============================================================================

interface CodeModeLayoutV2Props {
  /** When true, renders inline (fills parent) vs fixed fullscreen */
  inline?: boolean;
  /** Called when user clicks exit */
  onExit?: () => void;
  /** Called when fullscreen toggles */
  onToggleFullscreen?: () => void;
  /** Theme override */
  theme?: 'light' | 'dark';
  /** User ID for session */
  userId?: string;
  /** Workspace path */
  workspacePath?: string;
  /** Callback to send message via WebSocket (provided by parent) */
  onSendMessage?: (message: string, files?: FileAttachment[]) => Promise<void>;
  /** Callback to stop execution (provided by parent) */
  onStopExecution?: () => void;
  /** Hostname of the container/server */
  hostname?: string;
  /** CLI version string */
  cliVersion?: string;
  /** MinIO storage bucket name */
  storageBucket?: string;
  /** Storage type (s3fs = mounted, ephemeral = not persistent) */
  storageType?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Infer provider from model ID when not found in available models
 * Handles common model ID patterns:
 * - Bedrock: us.anthropic.claude-*, us.meta.llama-*, amazon.titan-*
 * - Vertex/Gemini: gemini-*
 * - OpenAI: gpt-*, o1-*, o3-*
 * - Anthropic: claude-*
 * - Ollama: llama*, qwen*, mistral*, etc.
 */
function inferProviderFromModel(modelId: string): string {
  if (!modelId) return 'unknown';
  const lower = modelId.toLowerCase();

  // AWS Bedrock patterns
  if (lower.startsWith('us.anthropic.') || lower.startsWith('anthropic.')) return 'bedrock';
  if (lower.startsWith('us.meta.') || lower.startsWith('meta.')) return 'bedrock';
  if (lower.startsWith('amazon.') || lower.startsWith('us.amazon.')) return 'bedrock';
  if (lower.startsWith('ai21.') || lower.startsWith('cohere.')) return 'bedrock';

  // Vertex AI / Gemini
  if (lower.startsWith('gemini-')) return 'vertex-ai';
  if (lower.includes('gemini')) return 'vertex-ai';

  // Direct Anthropic (not via Bedrock)
  if (lower.startsWith('claude-') && !lower.includes('anthropic.')) return 'anthropic';

  // OpenAI (but NOT gpt-oss which is an Ollama model)
  if ((lower.startsWith('gpt-') && !lower.startsWith('gpt-oss')) || lower.startsWith('o1-') || lower.startsWith('o3-')) return 'openai';

  // Azure OpenAI (usually deployment names)
  if (lower.includes('azure')) return 'azure-openai';

  // Ollama (local models)
  if (lower.includes(':') && !lower.includes('anthropic')) return 'ollama'; // ollama uses model:tag format
  // gpt-oss is an Ollama model (GPT-OSS thinking model), devstral is Mistral's code model
  if (['llama', 'qwen', 'mistral', 'codellama', 'deepseek', 'phi', 'gemma', 'gpt-oss', 'devstral', 'yi-'].some(m => lower.startsWith(m))) return 'ollama';

  return 'unknown';
}

// =============================================================================
// Interaction Mode Pill (Normal / Plan / YOLO)
// =============================================================================

const MODE_CONFIG = {
  normal: { label: '>_', tooltip: 'Normal — AI asks before changes', color: 'var(--cm-text-muted)' },
  plan: { label: '\u{1F4CB}', tooltip: 'Plan — AI plans first, you approve', color: 'var(--cm-info, #60a5fa)' },
  yolo: { label: '\u26A1', tooltip: 'YOLO — Auto-approve all changes', color: 'var(--cm-warning, #f59e0b)' },
} as const;

// =============================================================================
// Code Mode Theme Selector — Catppuccin Mocha, Tokyo Night, Dracula, Default
// =============================================================================

const CM_THEMES = [
  { id: 'default', label: 'Default', dot: '#33FF33' },
  { id: 'catppuccin-latte', label: 'Latte', dot: '#dc8a78' },
  { id: 'catppuccin-frappe', label: 'Frappé', dot: '#eebebe' },
  { id: 'catppuccin-mocha', label: 'Mocha', dot: '#cba6f7' },
  { id: 'tokyo-night', label: 'Tokyo Night', dot: '#7aa2f7' },
  { id: 'dracula', label: 'Dracula', dot: '#bd93f9' },
  { id: 'terminal-green', label: 'Terminal', dot: '#00ff41' },
] as const;

type CMThemeId = typeof CM_THEMES[number]['id'];

function getStoredCMTheme(): CMThemeId {
  try { return (localStorage.getItem('cm-theme') as CMThemeId) || 'default'; }
  catch { return 'default'; }
}

const THEME_VARS: Record<string, Record<string, string>> = {
  'catppuccin-latte': {
    '--cm-bg': '#eff1f5', '--cm-bg-secondary': '#e6e9ef', '--cm-bg-tertiary': '#ccd0da',
    '--cm-text': '#4c4f69', '--cm-text-secondary': '#5c5f77', '--cm-text-muted': '#9ca0b0',
    '--cm-accent': '#1e66f5', '--cm-success': '#40a02b', '--cm-warning': '#df8e1d',
    '--cm-error': '#d20f39', '--cm-info': '#04a5e5', '--cm-border': '#bcc0cc',
    '--cm-prompt': '#8839ef', '--cm-muted': '#9ca0b0', '--cm-surface': '#dce0e8',
  },
  'catppuccin-frappe': {
    '--cm-bg': '#303446', '--cm-bg-secondary': '#292c3c', '--cm-bg-tertiary': '#414559',
    '--cm-text': '#c6d0f5', '--cm-text-secondary': '#b5bfe2', '--cm-text-muted': '#737994',
    '--cm-accent': '#8caaee', '--cm-success': '#a6d189', '--cm-warning': '#e5c890',
    '--cm-error': '#e78284', '--cm-info': '#85c1dc', '--cm-border': '#51576d',
    '--cm-prompt': '#ca9ee6', '--cm-muted': '#737994', '--cm-surface': '#414559',
  },
  'catppuccin-mocha': {
    '--cm-bg': '#1e1e2e', '--cm-bg-secondary': '#181825', '--cm-bg-tertiary': '#313244',
    '--cm-text': '#cdd6f4', '--cm-text-secondary': '#bac2de', '--cm-text-muted': '#6c7086',
    '--cm-accent': '#89b4fa', '--cm-success': '#a6e3a1', '--cm-warning': '#f9e2af',
    '--cm-error': '#f38ba8', '--cm-info': '#89dceb', '--cm-border': '#45475a',
    '--cm-prompt': '#cba6f7', '--cm-muted': '#6c7086', '--cm-surface': '#313244',
  },
  'tokyo-night': {
    '--cm-bg': '#1a1b26', '--cm-bg-secondary': '#16161e', '--cm-bg-tertiary': '#24283b',
    '--cm-text': '#c0caf5', '--cm-text-secondary': '#a9b1d6', '--cm-text-muted': '#565f89',
    '--cm-accent': '#7aa2f7', '--cm-success': '#9ece6a', '--cm-warning': '#e0af68',
    '--cm-error': '#f7768e', '--cm-info': '#7dcfff', '--cm-border': '#3b4261',
    '--cm-prompt': '#bb9af7', '--cm-muted': '#565f89', '--cm-surface': '#24283b',
  },
  'dracula': {
    '--cm-bg': '#282a36', '--cm-bg-secondary': '#21222c', '--cm-bg-tertiary': '#343746',
    '--cm-text': '#f8f8f2', '--cm-text-secondary': '#bfbfbf', '--cm-text-muted': '#6272a4',
    '--cm-accent': '#bd93f9', '--cm-success': '#50fa7b', '--cm-warning': '#f1fa8c',
    '--cm-error': '#ff5555', '--cm-info': '#8be9fd', '--cm-border': '#44475a',
    '--cm-prompt': '#ff79c6', '--cm-muted': '#6272a4', '--cm-surface': '#343746',
  },
  'terminal-green': {
    '--cm-bg': '#0a0a0a', '--cm-bg-secondary': '#111111', '--cm-bg-tertiary': '#050505',
    '--cm-text': '#00ff41', '--cm-text-secondary': '#00cc33', '--cm-text-muted': '#007722',
    '--cm-accent': '#00ff41', '--cm-success': '#00ff41', '--cm-warning': '#ffaa00',
    '--cm-error': '#ff3333', '--cm-info': '#00aaff', '--cm-border': '#003311',
    '--cm-prompt': '#00ff41', '--cm-muted': '#007722', '--cm-surface': '#1a1a1a',
  },
};

// All var keys for cleanup
const ALL_CM_VAR_KEYS = Object.keys(THEME_VARS['catppuccin-mocha']);

function applyCMThemeVars(el: HTMLElement, id: string) {
  // Clear all theme vars first
  ALL_CM_VAR_KEYS.forEach(k => el.style.removeProperty(k));
  if (id !== 'default' && THEME_VARS[id]) {
    el.setAttribute('data-cm-theme', id);
    Object.entries(THEME_VARS[id]).forEach(([k, v]) => el.style.setProperty(k, v));
  } else {
    el.removeAttribute('data-cm-theme');
  }
}

const ThemeSelectorPill: React.FC = () => {
  const [theme, setTheme] = useState<CMThemeId>(getStoredCMTheme);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const current = CM_THEMES.find(t => t.id === theme) || CM_THEMES[0];

  const apply = useCallback((id: CMThemeId) => {
    setTheme(id);
    setOpen(false);
    try { localStorage.setItem('cm-theme', id); } catch {}
    const el = document.querySelector('.code-mode') as HTMLElement;
    if (el) applyCMThemeVars(el, id);
  }, []);

  // Apply on mount
  useEffect(() => {
    const el = document.querySelector('.code-mode') as HTMLElement;
    if (el) applyCMThemeVars(el, theme);
  }, [theme]);

  // Position the portaled dropdown beneath the trigger button. Recompute
  // on open + on window resize/scroll so the menu stays anchored.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      if (!buttonRef.current) return;
      const r = buttonRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on outside click (since the menu is portaled out of the trigger's
  // DOM subtree, we can't rely on natural blur — listen for body clicks).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      // The menu has data-cm-theme-menu — don't close if click is inside it
      const menu = document.querySelector('[data-cm-theme-menu]');
      if (menu?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        title={`Theme: ${current.label}`}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono transition-all hover:bg-white/5"
        style={{ color: 'var(--cm-text-muted)' }}
      >
        <span className="w-2 h-2 rounded-full" style={{ background: current.dot }} />
        <span>{current.label}</span>
      </button>
      {open && menuPos && createPortal(
        <div
          // (#74) Portaled to document.body to escape parent overflow:hidden
          // clipping (the terminal pane container has overflow-hidden which
          // was clipping this dropdown when it appeared underneath the openagentic
          // terminal iframe). Position is computed from the trigger button's
          // bounding rect on open + window resize/scroll. z-50 is the highest
          // CodeMode layer per features/code/codeMode.css conventions.
          data-cm-theme-menu
          className="rounded-lg overflow-hidden shadow-lg py-1"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            zIndex: 50,
            background: 'var(--cm-bg-secondary, rgba(30,30,30,0.95))',
            border: '1px solid var(--cm-border, rgba(255,255,255,0.1))',
            backdropFilter: 'blur(12px)',
            minWidth: '160px',
          }}
        >
          {CM_THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => apply(t.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-mono transition-colors ${t.id === theme ? 'bg-white/10' : 'hover:bg-white/5'}`}
              style={{ color: t.id === theme ? 'var(--cm-text, #fff)' : 'var(--cm-text-muted, #999)' }}
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: t.dot }} />
              <span>{t.label}</span>
              {t.id === theme && <span className="ml-auto text-[10px] opacity-60">active</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

const InteractionModePill: React.FC = () => {
  const mode = useCodeModeStore((s) => s.interactionMode);
  const cycleMode = useCodeModeStore((s) => s.cycleInteractionMode);
  const config = MODE_CONFIG[mode];

  return (
    <button
      onClick={cycleMode}
      title={`${config.tooltip} (Shift+Tab to switch)`}
      className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 hover:opacity-80"
      style={{
        color: config.color,
        border: `1px solid ${config.color}`,
        background: 'transparent',
      }}
    >
      <span>{config.label}</span>
      <span className="uppercase text-[10px] tracking-wider">{mode}</span>
    </button>
  );
};

// Render mode toggle (Phase 4) was defined here but has been removed
// until the Phase 3 side channel is deployed. The transcript view has
// nothing to show without /ws/progress events flowing. NativeTranscript
// and useOpenagenticProgress stay in tree so re-enabling is cheap: add
// back a useRenderMode hook + RenderModePill component and wrap the
// terminal/transcript panes in a display:none toggle on the themeSlot.

// =============================================================================
// Main Layout Component
// =============================================================================

export const CodeModeLayoutV2: React.FC<CodeModeLayoutV2Props> = ({
  inline = false,
  onExit,
  onToggleFullscreen,
  theme = 'dark',
  userId,
  workspacePath = '~',
  onSendMessage,
  onStopExecution,
  hostname,
  cliVersion,
  storageBucket,
  storageType,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(true); // Auto-open VS Code
  // (Side panel removed — CodeMode uses VS Code editor panel for file browsing)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const ttft = useTTFT();
  const [selectedFile, setSelectedFile] = useState<string | undefined>();
  const [editorWidth, setEditorWidth] = useState(600); // Initial width in pixels
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Terminal-focus mode: ?terminal-focus=1 hides editor for a
  // full-viewport terminal experience (triggered by "Open in New Window").
  const isTerminalFocus = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('terminal-focus') === '1'; } catch { return false; }
  }, []);
  useEffect(() => {
    if (isTerminalFocus) {
      setEditorExpanded(false);
    }
  }, [isTerminalFocus]);

  // Global expand/collapse state for Ctrl+O
  const [allExpanded, setAllExpanded] = useState(false);
  const toggleAll = useCallback(() => {
    setAllExpanded(prev => !prev);
  }, []);

  // Global Ctrl+O keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+O - toggle expand/collapse all tool results
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        toggleAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAll]);

  // Context value for expand/collapse
  const expandCollapseValue = { allExpanded, toggleAll };

  // Use individual selectors to prevent re-render loops
  const messages = useMessages();
  const streamingMessage = useStreamingMessage();
  const connectionState = useConnectionState();
  const session = useSession();
  const activeSessionId = useActiveSessionId();
  // Phase 3: open the structured event side channel for the active
  // session. This hook idles when sessionId is null and auto-reconnects
  // with backoff. Tool events flow into useProgressStore, which
  // TerminalToolCardStack reads to render floating cards over the
  // terminal. Failure here is non-fatal: the terminal still works.
  useOpenagenticProgress({
    sessionId: activeSessionId,
    token: localStorage.getItem('auth_token') || '',
    userId: userId || 'anonymous',
  });
  const initSteps = useInitSteps();
  const reconnectAttempts = useReconnectAttempts();
  const totalInputTokens = useTotalInputTokens();
  const totalOutputTokens = useTotalOutputTokens();
  const activityState = useActivityState();
  const activityMessage = useActivityMessage();
  const normalizedEvents = useNormalizedEvents();

  // Model selection hooks
  const selectedModel = useSelectedModel();
  const availableModels = useAvailableModels();
  const { setSelectedModel, setAvailableModels } = useModelActions();
  const [showModelSelector, setShowModelSelector] = useState(false);
  const modelSelectorButtonRef = useRef<HTMLButtonElement>(null);

  // Session is ready when the backend has confirmed all init steps AND
  // the chat WebSocket is connected. The legacy terminal-content-ready
  // signal is no longer required — CodeMode uses the native chat view
  // (CodeModeChatView) and renders stream-json events directly, so
  // there's no ghostty-web wasmTerm to wait for.
  const backendInitComplete = initSteps.find(s => s.step === 'ready')?.status === 'complete';
  const allInitComplete = backendInitComplete && connectionState === 'connected';

  // Safety timeout: auto-dismiss init overlay after 45 seconds even if
  // the terminal never shows real content. 45s is long enough to cover
  // first-boot + openagentic cold-start + --continue rehydration of a
  // typical-size transcript; anything slower is almost certainly a real
  // hang and we'd rather let the user see whatever state the terminal
  // reached than block them forever on the gate.
  const [initTimedOut, setInitTimedOut] = useState(false);
  useEffect(() => {
    if (allInitComplete) {
      setInitTimedOut(false);
      return;
    }
    const timer = setTimeout(() => {
      console.warn('[CodeMode] Init overlay timed out after 45s, auto-dismissing');
      setInitTimedOut(true);
    }, 45000);
    return () => clearTimeout(timer);
  }, [allInitComplete]);

  // On reconnect, connectionState flips away from 'connected' — the
  // gate re-shows and should get a fresh 45s timeout window.
  useEffect(() => {
    if (connectionState !== 'connected') {
      setInitTimedOut(false);
    }
  }, [connectionState]);

  // Auth for API calls
  const { getAuthHeaders, user } = useAuth();
  const isAdmin = user?.isAdmin || false;

  // Context compaction handler - calls backend API
  const handleCompactContext = useCallback(async () => {
    if (!activeSessionId) {
      console.warn('[CodeMode] Cannot compact context: no active session');
      return;
    }

    // Show a user message indicating the command
    useCodeModeStore.getState().addUserMessage('/compact');

    try {
      const response = await fetch(
        apiEndpoint(`/openagentic/sessions/${activeSessionId}/compact`),
        {
          method: 'POST',
          headers: getAuthHeaders(),
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('[CodeMode] Context compacted:', data);
        // Start an assistant message with the result
        useCodeModeStore.getState().startAssistantMessage();
        useCodeModeStore.getState().updateStreamingText(
          `✓ Context compacted successfully\n\n` +
          `• Total tokens: ${data.totalTokens?.toLocaleString() || 'N/A'}\n` +
          `• Messages: ${data.messageCount || 'N/A'}\n` +
          `• Compacted: ${data.isCompacted ? 'Yes' : 'No'}`
        );
        useCodeModeStore.getState().finalizeAssistantMessage();
      } else {
        const error = await response.json();
        console.error('[CodeMode] Failed to compact context:', error);
        useCodeModeStore.getState().startAssistantMessage();
        useCodeModeStore.getState().updateStreamingText(
          `✗ Failed to compact context: ${error.message || 'Unknown error'}`
        );
        useCodeModeStore.getState().finalizeAssistantMessage();
      }
    } catch (err: any) {
      console.error('[CodeMode] Error compacting context:', err);
      useCodeModeStore.getState().startAssistantMessage();
      useCodeModeStore.getState().updateStreamingText(
        `✗ Error compacting context: ${err.message || 'Unknown error'}`
      );
      useCodeModeStore.getState().finalizeAssistantMessage();
    }
  }, [activeSessionId, getAuthHeaders]);

  // Auto-scroll to bottom on new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingMessage, userScrolledUp]);

  // Track user scroll position to show/hide "New output" button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setUserScrolledUp(distFromBottom > 100);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll-to-bottom handler for the "New output" button
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUserScrolledUp(false);
  }, []);

  // Detect dev server URLs from messages for live preview
  useEffect(() => {
    const allMsgs = streamingMessage ? [...messages, streamingMessage] : messages;
    for (let i = allMsgs.length - 1; i >= 0; i--) {
      const msg = allMsgs[i];
      if (msg.role === 'assistant') {
        const text = msg.textContent || '';
        const blocks = msg.contentBlocks || [];
        const allText = text + blocks.filter(b => b.type === 'text').map(b => b.content).join('\n');
        const detected = detectDevServerUrl(allText);
        if (detected && detected !== previewUrl) {
          setPreviewUrl(detected);
          setShowPreview(true);
          break;
        }
      }
    }
  }, [messages, streamingMessage]); // eslint-disable-line react-hooks/exhaustive-deps


  // Record TTFT when first streaming content arrives
  const prevStreamingRef = useRef<boolean>(false);
  useEffect(() => {
    const hasContent = streamingMessage && (
      streamingMessage.textContent ||
      (streamingMessage.contentBlocks && streamingMessage.contentBlocks.length > 0)
    );
    if (hasContent && !prevStreamingRef.current) {
      ttft.recordFirstToken();
    }
    prevStreamingRef.current = !!hasContent;
  }, [streamingMessage]); // eslint-disable-line react-hooks/exhaustive-deps


  // Fetch available models on mount (if not already loaded)
  useEffect(() => {
    const fetchModels = async () => {
      // Skip if models already loaded
      if (availableModels.length > 0) return;

      try {
        const response = await fetch(apiEndpoint('/chat/models'), {
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.models && Array.isArray(data.models)) {
            setAvailableModels(data.models);
          }
        }
      } catch (err) {
        console.error('[CodeMode] Failed to fetch models:', err);
      }
    };

    fetchModels();
  }, [getAuthHeaders, availableModels.length, setAvailableModels]);

  // Handle fullscreen toggle
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
    onToggleFullscreen?.();
  }, [onToggleFullscreen]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Resize handlers for editor panel
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: editorWidth };
  }, [editorWidth]);

  useEffect(() => {
    if (!isResizing) return;

    // Throttle to 60ms (~16fps) — reduces React re-renders from 60/sec
    // to 16/sec during drag, giving ResizeObserver + xterm.js breathing room.
    let lastMoveTime = 0;
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const now = Date.now();
      if (now - lastMoveTime < 60) return; // Throttle
      lastMoveTime = now;
      const delta = resizeRef.current.startX - e.clientX;
      const newWidth = Math.max(300, Math.min(1200, resizeRef.current.startWidth + delta));
      setEditorWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Convert files to base64 for transmission
  const convertFilesToAttachments = useCallback(async (files: FileWithPreview[]): Promise<FileAttachment[]> => {
    return Promise.all(
      files.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          type: file.type,
          content: base64.split(',')[1], // Remove data:image/jpeg;base64, prefix
        };
      })
    );
  }, []);

  // Handle message submission with optional files
  const handleSubmit = useCallback(
    async (text: string, files?: FileWithPreview[]) => {
      if (onSendMessage) {
        // Convert files to base64 if present
        const attachments = files && files.length > 0
          ? await convertFilesToAttachments(files)
          : undefined;
        // Start TTFT measurement before sending
        ttft.startMeasurement();
        // Use the WebSocket hook's sendMessage (handles store updates + WS send)
        await onSendMessage(text, attachments);
      } else {
        // Fallback: just add to store (for when not connected)
        useCodeModeStore.getState().addUserMessage(text);
      }
    },
    [onSendMessage, convertFilesToAttachments, ttft]
  );

  // All messages including streaming
  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  return (
    <ExpandCollapseContext.Provider value={expandCollapseValue}>
    <div
      ref={containerRef}
      className={`
        code-mode
        ${inline ? 'relative w-full h-full' : 'fixed inset-0 z-[1100]'}
        flex
      `}
      data-theme={theme}
      style={{
        backgroundColor: 'var(--cm-bg, #0d1117)',
      }}
    >
      {/* Session boot gate — validates workspace + code-server +
          openagentic CLI + chat channel before revealing the native
          chat view. Runs on every connect AND reconnect. See
          SessionBootScreen.tsx. */}
      {(!allInitComplete && !initTimedOut) && (
        <SessionBootScreen
          sessionId={activeSessionId}
          connectionState={connectionState}
          initSteps={initSteps}
          reconnectAttempts={reconnectAttempts}
          onSkip={() => setInitTimedOut(true)}
        />
      )}

      {/* Main content area (conversation) */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Single unified header lives inside CodeModeChatView now —
            see chat-messages/CodeModeHeaderStrip.tsx. Previously there
            were two stacked thin bars (TerminalHeaderBar + the strip);
            consolidated per request. Theme switching moved to the
            /theme slash command (ThemePicker modal). */}

        {/* Native React chat view — replaces terminal emulation.
            CodeModeChatView streams openagentic's stream-json output
            (POST /api/code/sessions/:id/chat → SSE) and renders each
            text / thinking / tool_use block as a real React component.
            No ghostty-web, no WASM VT parser, no canvas. Scrollback,
            copy-paste, theme inheritance, and resize all just work.
            The old TerminalPanel is kept in the codebase as a fallback
            for "raw view" but isn't mounted by default anymore. */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {activeSessionId ? (
            <CodeModeChatView
              sessionId={activeSessionId}
              authToken={localStorage.getItem('auth_token') || undefined}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--cm-text-muted, var(--color-textMuted))' }}>
              Waiting for session...
            </div>
          )}
        </div>

        {/* Live Preview Panel - shows when a dev server URL is detected */}
        <AnimatePresence>
          {showPreview && previewUrl && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 300, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <PreviewPanel
                url={previewUrl}
                onClose={() => setShowPreview(false)}
                theme={theme}
              />
            </motion.div>
          )}
        </AnimatePresence>


        {/* Status Bar — minimal: connection state + activity indicator.
            Identity (model, cwd, tokens) lives in the header bar.
            Input toolbar removed — folder picker was non-functional,
            permission/context chips duplicated header data. */}
        <CodeModeStatusBar
          connectionState={connectionState}
          reconnectAttempts={reconnectAttempts}
          theme={theme}
          sessionId={session?.id}
          token={localStorage.getItem('auth_token') || ''}
        />
      </div>

      {/* Right - Editor Panel (VS Code) with Resizable Divider */}
      <AnimatePresence>
        {editorExpanded && (
          <>
            {/* Resize Handle */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`
                w-1 flex-shrink-0 cursor-col-resize
                hover:bg-[var(--color-primary)]/30 active:bg-[var(--color-primary)]/50
                transition-colors group relative
                ${isResizing ? 'bg-[var(--color-primary)]/50' : 'bg-transparent'}
              `}
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            >
              {/* Visual indicator on hover */}
              <div className={`
                absolute inset-y-0 -left-1 -right-1
                group-hover:bg-[var(--color-primary)]/10
                ${isResizing ? 'bg-[var(--color-primary)]/10' : ''}
              `} />
              {/* Grip dots */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
                <div className="w-1 h-1 rounded-full bg-[var(--color-textMuted)]" />
              </div>
            </motion.div>

            {/* Editor Panel */}
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: editorWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: isResizing ? 0 : 0.2, ease: 'easeInOut' }}
              style={{ width: editorWidth }}
              className="code-mode flex-shrink-0 h-full"
            >
              <EditorPanel
                sessionId={activeSessionId}
                workspacePath={workspacePath}
                selectedFile={selectedFile}
                onFileSelect={(path) => setSelectedFile(path)}
                isCollapsed={false}
                onToggleCollapse={() => setEditorExpanded(false)}
                onOpenExternal={() => {}}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      </div>
    </ExpandCollapseContext.Provider>
  );
};

export default CodeModeLayoutV2;
