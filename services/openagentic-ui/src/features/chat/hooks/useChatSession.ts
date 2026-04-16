/**
 * useChatSession - Hook for managing the active chat session
 * Provides the current session state and derived values
 * Encapsulates session-specific logic from ChatContainer
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useChatSessions } from './useChatSessions';

export interface UseChatSessionOptions {
  onSessionChange?: (sessionId: string | null) => void;
}

export const useChatSession = (options: UseChatSessionOptions = {}) => {
  const { onSessionChange } = options;

  // Get session management from useChatSessions
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    createNewSession,
    loadSessions,
    deleteSession,
    loadSessionMessages,
    updateSessionTitle
  } = useChatSessions();

  // Get store actions for message operations
  const {
    addMessage,
    updateMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    clearMessages
  } = useChatStore();

  // Track previous session for detecting session changes
  const [previousActiveSessionId, setPreviousActiveSessionId] = useState<string | null>(activeSessionId);
  const hasScrolledToBottomRef = useRef(false);

  // Derive current session from store
  const currentSession = useMemo(() =>
    activeSessionId ? sessions[activeSessionId] : null,
    [activeSessionId, sessions]
  );

  // Derive messages from current session
  const messages = useMemo(() =>
    currentSession?.messages || [],
    [currentSession?.messages]
  );

  // Session metadata
  const sessionTitle = currentSession?.title || 'New Chat';
  const messageCount = currentSession?.messageCount || messages.length;
  const hasMessages = messageCount > 0;
  const isNewSession = !hasMessages && sessionTitle === 'New Chat';

  // Detect session changes
  useEffect(() => {
    if (activeSessionId !== previousActiveSessionId) {
      setPreviousActiveSessionId(activeSessionId);
      hasScrolledToBottomRef.current = false;
      onSessionChange?.(activeSessionId);
    }
  }, [activeSessionId, previousActiveSessionId, onSessionChange]);

  // Add message to current session
  const addSessionMessage = (message: any) => {
    if (!activeSessionId) {
      console.warn('[useChatSession] Cannot add message - no active session');
      return;
    }
    addMessage(activeSessionId, message);
  };

  // Update message in current session
  const updateSessionMessage = (
    messageId: string,
    content: string,
    mcpCalls?: any[],
    metadata?: any,
    model?: string
  ) => {
    if (!activeSessionId) {
      console.warn('[useChatSession] Cannot update message - no active session');
      return;
    }
    updateMessage(activeSessionId, messageId, content, mcpCalls, metadata, model);
  };

  // Update streaming message in current session
  const updateSessionStreamingMessage = (messageId: string, content: string) => {
    if (!activeSessionId) return;
    updateStreamingMessage(activeSessionId, messageId, content);
  };

  // Finish streaming message in current session
  const finishSessionStreamingMessage = (messageId: string) => {
    if (!activeSessionId) return;
    finishStreamingMessage(activeSessionId, messageId);
  };

  // Clear messages from current session
  const clearSessionMessages = () => {
    if (!activeSessionId) return;
    clearMessages(activeSessionId);
  };

  // Create new session and switch to it
  const createAndSwitchToNewSession = async (onReset?: () => void) => {
    try {
      const newSessionId = await createNewSession(onReset);
      return newSessionId;
    } catch (error) {
      console.error('[useChatSession] Failed to create session:', error);
      throw error;
    }
  };

  // Ensure we have an active session
  const ensureActiveSession = async (): Promise<string | null> => {
    if (activeSessionId) return activeSessionId;

    try {
      const newSessionId = await createAndSwitchToNewSession();
      return newSessionId;
    } catch (error) {
      console.error('[useChatSession] Failed to ensure active session:', error);
      return null;
    }
  };

  // Auto-generate session title from first message
  const autoGenerateTitle = (content: string) => {
    if (!activeSessionId) return;
    if (currentSession?.title !== 'New Chat') return; // Don't override existing title

    const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    updateSessionTitle(activeSessionId, title);
  };

  return {
    // Session state
    activeSessionId,
    currentSession,
    messages,
    sessionTitle,
    messageCount,
    hasMessages,
    isNewSession,
    hasScrolledToBottomRef,

    // All sessions (for sidebar)
    sessions,

    // Session navigation
    setActiveSession,
    loadSessions,
    deleteSession,
    loadSessionMessages,

    // Message operations
    addSessionMessage,
    updateSessionMessage,
    updateSessionStreamingMessage,
    finishSessionStreamingMessage,
    clearSessionMessages,

    // Session creation
    createNewSession: createAndSwitchToNewSession,
    ensureActiveSession,

    // Title management
    updateSessionTitle,
    autoGenerateTitle
  };
};

export default useChatSession;
