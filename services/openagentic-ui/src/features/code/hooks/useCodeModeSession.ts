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
import { useCodeModeStore, type ConversationMessage, type TodoItem } from '@/stores/useCodeModeStore';

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

        // Load messages into the store
        if (contextWindow.messages.length > 0) {
          // Clear existing messages first
          store.clearMessages();

          // Add each message to the store
          for (const msg of contextWindow.messages) {
            const content = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);

            if (msg.role === 'user') {
              store.addUserMessage(content);
            } else if (msg.role === 'assistant') {
              store.startAssistantMessage();
              store.updateStreamingText(content);
              store.finalizeAssistantMessage();
            }
            // System messages with summaries are handled internally
          }
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
