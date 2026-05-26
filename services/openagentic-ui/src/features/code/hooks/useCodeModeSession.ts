/**
 * useCodeModeSession - Session Persistence Hook for Code Mode
 *
 * Manages persisted code mode sessions with full message history.
 * Provides:
 * - Session creation and loading
 * - Message history persistence
 * - Context window management
 * - Session resumption with context reconstruction
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import {
  useCodeModeStore,
  type ConversationMessage,
  type ContentBlock,
  type TextBlock,
  type ToolBlock,
  type ThinkingBlock,
  type ToolStep,
  type TodoItem,
} from '@/stores/useCodeModeStore';

// ─── Hydration helpers ─────────────────────────────────────────────────────
//
// Convert API-shaped PersistedMessage rows into the store's
// ConversationMessage / ContentBlock shape so resumed transcripts render
// with the same fidelity as live ones (tool cards, thinking blocks,
// interleaved text).
//
// API row shape (AWCodeMessage, see AWCodeStorageService.AWCodeMessageData):
// role, content, raw_output, tool_calls, tool_results, thinking, tool_name,
// files_*, etc. Different rows populate different subsets depending on
// what the persistence pipeline captured at write time.

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stringifyContent(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  // Some rows store an array of {type, text} blocks (Anthropic message
  // shape); join the text segments. Fall back to JSON for anything else
  // so we never lose information silently.
  if (Array.isArray(content)) {
    const textParts = content
      .map((b: any) =>
        typeof b === 'string'
          ? b
          : typeof b?.text === 'string'
            ? b.text
            : '',
      )
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join('');
    return JSON.stringify(content);
  }
  return JSON.stringify(content);
}

function toolCallToToolStep(call: any, fallbackId: string): ToolStep {
  // PersistedMessage.toolCalls comes from the openagentic stream-json
  // tool_use shape: { id, name, input, ... }. Map onto ToolStep so the
  // store's tool-card renderer accepts it.
  return {
    id: typeof call?.id === 'string' && call.id ? call.id : fallbackId,
    name: typeof call?.name === 'string' ? call.name : 'unknown',
    input: call?.input ?? {},
    output: '',
    isCollapsed: true,
    isStreaming: false,
  } as unknown as ToolStep;
}

function persistedToConversationMessageUser(
  msg: PersistedMessage,
): ConversationMessage {
  return {
    id: msg.id ?? makeId('user'),
    role: 'user',
    timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    textContent: stringifyContent(msg.content),
    isStreaming: false,
  };
}

function persistedToConversationMessageAssistant(
  msg: PersistedMessage,
): ConversationMessage {
  const blocks: ContentBlock[] = [];

  // Thinking first — matches the live order where thinking blocks are
  // emitted before the assistant's user-visible text.
  if (typeof msg.thinking === 'string' && msg.thinking.trim().length > 0) {
    const tb: ThinkingBlock = {
      type: 'thinking',
      id: makeId('thinking'),
      content: msg.thinking,
      isStreaming: false,
    };
    blocks.push(tb);
  }

  // Then tool calls — each becomes a tool card in the rendered transcript.
  if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
    for (const call of msg.toolCalls) {
      const tb: ToolBlock = {
        type: 'tool',
        id: makeId('tool'),
        step: toolCallToToolStep(call, makeId('toolstep')),
      };
      blocks.push(tb);
    }
  }

  // Finally the assistant text. Only emit a text block if there is actual
  // content; otherwise an assistant turn that was purely tool calls would
  // get a phantom empty block.
  const text = stringifyContent(msg.content);
  if (text.length > 0) {
    const tb: TextBlock = {
      type: 'text',
      id: makeId('text'),
      content: text,
      isStreaming: false,
    };
    blocks.push(tb);
  }

  return {
    id: msg.id ?? makeId('assistant'),
    role: 'assistant',
    timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    contentBlocks: blocks,
    textContent: text,
    thinkingContent: msg.thinking,
    isStreaming: false,
    usage:
      msg.tokensInput || msg.tokensOutput
        ? {
            inputTokens: msg.tokensInput ?? 0,
            outputTokens: msg.tokensOutput ?? 0,
          }
        : undefined,
  };
}
// ──────────────────────────────────────────────────────────────────────────

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || '';

export interface PersistedSession {
  id: string;
  userId: string;
  model: string;
  workspacePath: string;
  title?: string;
  status: 'active' | 'idle' | 'stopped' | 'error';
  messageCount: number;
  totalTokens: number;
  createdAt: string;
  lastActivity: string;
}

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | any[];
  toolCalls?: any[];
  toolCallId?: string;
  thinking?: string;
  tokensInput?: number;
  tokensOutput?: number;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface ContextWindow {
  messages: PersistedMessage[];
  totalTokens: number;
  isCompacted: boolean;
  summaryIncluded: boolean;
}

export interface UseCodeModeSessionOptions {
  authToken: string;
  persistMessages?: boolean;
  autoLoadHistory?: boolean;
}

export interface UseCodeModeSessionReturn {
  // State
  persistedSessions: PersistedSession[];
  activePersistedSession: PersistedSession | null;
  isLoading: boolean;
  error: string | null;
  isPersistenceEnabled: boolean;

  // Actions
  createPersistedSession: (options?: {
    model?: string;
    workspacePath?: string;
    title?: string;
  }) => Promise<PersistedSession | null>;

  loadPersistedSessions: () => Promise<void>;

  loadSessionHistory: (sessionId: string) => Promise<PersistedMessage[]>;

  resumeSession: (sessionId: string) => Promise<{
    session: PersistedSession;
    contextWindow: ContextWindow;
  } | null>;

  saveMessage: (
    sessionId: string,
    message: Omit<PersistedMessage, 'id' | 'createdAt'>
  ) => Promise<void>;

  compactSession: (sessionId: string) => Promise<{
    isCompacted: boolean;
    totalTokens: number;
    messageCount: number;
  } | null>;

  setActivePersistedSession: (session: PersistedSession | null) => void;

  clearError: () => void;
}

export function useCodeModeSession({
  authToken,
  persistMessages = true,
  autoLoadHistory = false,
}: UseCodeModeSessionOptions): UseCodeModeSessionReturn {
  const [persistedSessions, setPersistedSessions] = useState<PersistedSession[]>([]);
  const [activePersistedSession, setActivePersistedSession] = useState<PersistedSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPersistenceEnabled] = useState(persistMessages);

  // Track if sessions have been loaded
  const sessionsLoadedRef = useRef(false);

  // API helper with auth
  const apiCall = useCallback(
    async <T>(
      endpoint: string,
      options?: RequestInit
    ): Promise<T> => {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      return response.json();
    },
    [authToken]
  );

  // Load user's persisted sessions
  const loadPersistedSessions = useCallback(async () => {
    if (!authToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await apiCall<{ sessions: PersistedSession[]; total: number }>(
        '/api/openagentic/sessions/persisted'
      );
      setPersistedSessions(data.sessions || []);
      sessionsLoadedRef.current = true;
    } catch (err: any) {
      console.error('[CodeModeSession] Failed to load sessions:', err);
      setError(err.message || 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  }, [apiCall, authToken]);

  // Create a new persisted session
  const createPersistedSession = useCallback(
    async (options?: {
      model?: string;
      workspacePath?: string;
      title?: string;
    }): Promise<PersistedSession | null> => {
      if (!authToken) return null;

      setIsLoading(true);
      setError(null);

      try {
        const data = await apiCall<{ session: PersistedSession }>(
          '/api/openagentic/sessions/persisted',
          {
            method: 'POST',
            body: JSON.stringify({
              model: options?.model || '', // Empty = use system default model
              workspacePath: options?.workspacePath || '/workspace',
              title: options?.title,
            }),
          }
        );

        const session = data.session;
        setActivePersistedSession(session);

        // Update sessions list
        setPersistedSessions((prev) => [session, ...prev]);

        // Update the Zustand store with the new session
        const store = useCodeModeStore.getState();
        store.setActiveSession(session.id, {
          sessionId: session.id,
          userId: session.userId,
          workspacePath: session.workspacePath,
          model: session.model,
          createdAt: new Date(session.createdAt).getTime(),
          lastActiveAt: new Date(session.lastActivity).getTime(),
        });

        return session;
      } catch (err: any) {
        console.error('[CodeModeSession] Failed to create session:', err);
        setError(err.message || 'Failed to create session');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [apiCall, authToken]
  );

  // Load session message history
  const loadSessionHistory = useCallback(
    async (sessionId: string): Promise<PersistedMessage[]> => {
      if (!authToken) return [];

      try {
        const data = await apiCall<{ messages: PersistedMessage[]; count: number }>(
          `/api/openagentic/sessions/${sessionId}/messages?limit=100`
        );

        return data.messages || [];
      } catch (err: any) {
        console.error('[CodeModeSession] Failed to load session history:', err);
        setError(err.message || 'Failed to load session history');
        return [];
      }
    },
    [apiCall, authToken]
  );

  // Resume a session with context window
  const resumeSession = useCallback(
    async (sessionId: string): Promise<{
      session: PersistedSession;
      contextWindow: ContextWindow;
    } | null> => {
      if (!authToken) return null;

      setIsLoading(true);
      setError(null);

      try {
        const data = await apiCall<{
          session: PersistedSession;
          contextWindow: ContextWindow;
        }>(`/api/openagentic/sessions/${sessionId}/resume`);

        const { session, contextWindow } = data;
        setActivePersistedSession(session);

        // Update the Zustand store with the resumed session
        const store = useCodeModeStore.getState();
        store.setActiveSession(session.id, {
          sessionId: session.id,
          userId: session.userId,
          workspacePath: session.workspacePath,
          model: session.model,
          createdAt: new Date(session.createdAt).getTime(),
          lastActiveAt: new Date(session.lastActivity).getTime(),
        });

        // Load messages into the store, preserving rich block structure.
        // Each PersistedMessage may carry tool_calls, thinking, and (for
        // assistant rows) text content. We translate to ConversationMessage
        // with proper ContentBlocks so the resumed transcript renders
        // identically to a live one — tool cards as tool cards, thinking
        // blocks as thinking blocks, not flattened to text.
        if (contextWindow.messages.length > 0) {
          const hydrated: ConversationMessage[] = [];

          for (const msg of contextWindow.messages) {
            if (msg.role === 'user') {
              hydrated.push(persistedToConversationMessageUser(msg));
            } else if (msg.role === 'assistant') {
              hydrated.push(persistedToConversationMessageAssistant(msg));
            }
            // Skip 'system' and 'tool' rows — they're either summaries
            // (handled by the API's contextWindow.summaryIncluded flag)
            // or already attached to an assistant turn's tool blocks.
          }

          store.hydrateMessages(hydrated);
        }

        return { session, contextWindow };
      } catch (err: any) {
        console.error('[CodeModeSession] Failed to resume session:', err);
        setError(err.message || 'Failed to resume session');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [apiCall, authToken]
  );

  // Save a message to the session
  const saveMessage = useCallback(
    async (
      sessionId: string,
      message: Omit<PersistedMessage, 'id' | 'createdAt'>
    ): Promise<void> => {
      if (!authToken || !isPersistenceEnabled) return;

      try {
        await apiCall<{ message: PersistedMessage }>(
          `/api/openagentic/sessions/${sessionId}/messages`,
          {
            method: 'POST',
            body: JSON.stringify(message),
          }
        );
      } catch (err: any) {
        console.error('[CodeModeSession] Failed to save message:', err);
        // Don't set error state for message saves - non-critical
      }
    },
    [apiCall, authToken, isPersistenceEnabled]
  );

  // Compact a session's context
  const compactSession = useCallback(
    async (sessionId: string): Promise<{
      isCompacted: boolean;
      totalTokens: number;
      messageCount: number;
    } | null> => {
      if (!authToken) return null;

      setIsLoading(true);

      try {
        const data = await apiCall<{
          success: boolean;
          isCompacted: boolean;
          totalTokens: number;
          messageCount: number;
        }>(`/api/openagentic/sessions/${sessionId}/compact`, {
          method: 'POST',
        });

        return {
          isCompacted: data.isCompacted,
          totalTokens: data.totalTokens,
          messageCount: data.messageCount,
        };
      } catch (err: any) {
        console.error('[CodeModeSession] Failed to compact session:', err);
        setError(err.message || 'Failed to compact session');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [apiCall, authToken]
  );

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-load sessions on mount if enabled
  useEffect(() => {
    if (autoLoadHistory && authToken && !sessionsLoadedRef.current) {
      loadPersistedSessions();
    }
  }, [autoLoadHistory, authToken, loadPersistedSessions]);

  return {
    // State
    persistedSessions,
    activePersistedSession,
    isLoading,
    error,
    isPersistenceEnabled,

    // Actions
    createPersistedSession,
    loadPersistedSessions,
    loadSessionHistory,
    resumeSession,
    saveMessage,
    compactSession,
    setActivePersistedSession,
    clearError,
  };
}

export default useCodeModeSession;
