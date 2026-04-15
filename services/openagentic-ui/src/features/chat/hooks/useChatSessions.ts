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
 * Session Management Hook
 * Handles chat session operations and state management
 */

import { useCallback, useRef } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

// Module-level ref to prevent duplicate session creation across hook instances
// This handles React StrictMode double-mounting and concurrent calls
let sessionCreationInProgress: Promise<string> | null = null;

export const useChatSessions = () => {
  const { getAuthHeaders, getAccessToken } = useAuth();
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    createSession,
    updateSessionTitle,
    loadUserSessions,
    clearMessages
  } = useChatStore();

  // Create new session with deduplication guard
  const createNewSession = useCallback(async (onSessionReset?: () => void) => {
    // If a session creation is already in progress, wait for it
    // This prevents duplicate sessions from React StrictMode double-mounting
    if (sessionCreationInProgress) {
      // console.log('[SESSION] Session creation already in progress, waiting...');
      const existingSessionId = await sessionCreationInProgress;
      // Reset session-specific state for the waiting caller too
      if (onSessionReset) {
        onSessionReset();
      }
      return existingSessionId;
    }

    // Get fresh session data to check for empty sessions
    const { sessions: currentSessions } = useChatStore.getState();

    // Check if we already have an empty session
    const existingEmptySession = Object.values(currentSessions).find(s =>
      s.messageCount === 0 && s.title === 'New Chat'
    );

    if (existingEmptySession) {
      // console.log('[SESSION] Using existing empty session:', existingEmptySession.id);
      setActiveSession(existingEmptySession.id);
      // Clear any existing messages from the empty session
      clearMessages(existingEmptySession.id);
      // Reset session-specific state
      if (onSessionReset) {
        onSessionReset();
      }
      return existingEmptySession.id;
    }

    // Create the session with deduplication guard
    const createSession = async (): Promise<string> => {
      try {
        // console.log('[SESSION] Creating new session on backend...');
        const token = await getAccessToken(['User.Read']);

        // Create session on backend
        const response = await fetch(apiEndpoint('/chat/sessions'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: 'New Chat'
          })
        });

        if (response.ok) {
          const data = await response.json();
          const newSession = data.session;

          // console.log('[SESSION] Backend created session:', newSession.id);

          // Add session to store manually to ensure immediate availability
          useChatStore.setState((state) => ({
            sessions: {
              ...state.sessions,
              [newSession.id]: {
                id: newSession.id,
                title: newSession.title || 'New Chat',
                messages: [],
                messageCount: 0,
                createdAt: new Date(newSession.createdAt),
                updatedAt: new Date(newSession.updatedAt),
                userId: newSession.userId
              }
            }
          }));

          // Set as active session
          setActiveSession(newSession.id);

          // Reset session-specific state
          if (onSessionReset) {
            onSessionReset();
          }

          // console.log('[SESSION] Successfully created and activated new session:', newSession.id);
          return newSession.id;
        } else {
          const errorText = await response.text();
          console.error('[SESSION] Failed to create session:', response.status, errorText);
          throw new Error(`Failed to create session: ${response.status} - ${errorText}`);
        }
      } catch (error) {
        console.error('[SESSION] Failed to create new session:', error);
        throw error;
      }
    };

    // Set the in-progress promise and execute
    sessionCreationInProgress = createSession();
    try {
      const sessionId = await sessionCreationInProgress;
      return sessionId;
    } finally {
      // Clear the guard after completion (success or failure)
      sessionCreationInProgress = null;
    }
  }, [getAccessToken, setActiveSession, clearMessages]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      // console.log('[SESSION] Loading user sessions...');
      // Use the store's loadUserSessions which fetches from API and returns the loaded sessions
      const loadedSessions = await loadUserSessions();

      // Get fresh state after the load operation
      const { sessions: updatedSessions, activeSessionId: currentActiveSessionId } = useChatStore.getState();

      // console.log(`[SESSION] Loaded ${loadedSessions.length} sessions, current active: ${currentActiveSessionId}`);

      // Check if current active session still exists after reload
      if (currentActiveSessionId && !updatedSessions[currentActiveSessionId]) {
        // console.warn(`[SESSION] Active session ${currentActiveSessionId} no longer exists, clearing`);
        setActiveSession(null);
      }

      // If no active session, or active session doesn't exist, set one
      const hasValidActiveSession = currentActiveSessionId && updatedSessions[currentActiveSessionId];

      if (!hasValidActiveSession) {
        if (loadedSessions.length > 0) {
          // Use most recent session (API should auto-create first session for new users)
          const mostRecentSession = loadedSessions.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
          // console.log('[SESSION] Setting active session to most recent:', mostRecentSession.id);
          setActiveSession(mostRecentSession.id);
        } else {
          // No sessions exist at all - this handles Issue #135 (new users with no sessions)
          // console.log('[SESSION] No sessions found, creating initial session for new user');
          try {
            const newSessionId = await createNewSession();
            // console.log('[SESSION] Created initial session for new user:', newSessionId);
          } catch (error) {
            console.error('[SESSION] Failed to create initial session:', error);
          }
        }
      }
    } catch (error) {
      console.error('[SESSION] Failed to load sessions:', error);
    }
  }, [loadUserSessions, setActiveSession, createNewSession]);

  // Delete session
  const deleteSession = useCallback(async (sessionId: string, setShowDeleteConfirm?: (value: string | null) => void) => {
    try {
      const authHeaders = await getAuthHeaders();

      // Close the delete confirmation modal immediately
      if (setShowDeleteConfirm) {
        setShowDeleteConfirm(null);
      }

      // Immediately remove from local state (optimistic update)
      const { sessions: currentSessions } = useChatStore.getState();
      const updatedSessions = { ...currentSessions };
      delete updatedSessions[sessionId];

      useChatStore.setState({
        sessions: updatedSessions
      });

      // If the deleted session was active, switch to another session immediately
      if (activeSessionId === sessionId) {
        const remainingSessions = Object.values(updatedSessions);

        if (remainingSessions.length > 0) {
          // Switch to the most recent session
          const mostRecent = remainingSessions.sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )[0];
          setActiveSession(mostRecent.id);
        } else {
          // No sessions left, create a new one
          const newSessionId = await createNewSession();
          setActiveSession(newSessionId);
        }
      }

      // Make the API call in the background
      const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}`), {
        method: 'DELETE',
        headers: authHeaders
      });

      if (!response.ok) {
        // If API call failed, revert the optimistic update by reloading sessions
        const errorText = await response.text();
        console.error('Failed to delete session:', response.status, errorText);
        await loadUserSessions();
        throw new Error(`Failed to delete session: ${errorText || response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      // Reload sessions to get the correct state from server
      await loadUserSessions();
      throw error;
    }
  }, [getAuthHeaders, activeSessionId, setActiveSession, loadUserSessions, createNewSession]);

  // Load messages for a session
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      // console.log('[LOAD_MESSAGES] Loading messages for session:', sessionId);

      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}/messages`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        let apiMessages = data.messages || [];

        // console.log('[LOAD_MESSAGES] API returned', apiMessages.length, 'messages for session:', sessionId);

        // FILTER OUT synthesis instructions that were incorrectly saved before bug fix
        // These messages contain "synthesize all the tool results" or similar patterns
        const synthesisPatterns = [
          'synthesize all the tool results',
          'Do NOT request any more tools',
          'provide a comprehensive final response',
          'You have executed'
        ];

        // Agent internal message patterns — ReAct loop progress, tool tracking
        const agentInternalPatterns = [
          '[Progress: Round',
          'OBSERVE results',
          'tool_calls_count',
          'Gathered:',
          'What did you learn?',
          'What remains?',
          'IMPORTANT: First write a brief text summary',
          'Processing complete',
          'Processing request',
          'Do NOT present partial results',
          'include the visualization as an artifact',
        ];

        apiMessages = apiMessages.filter((msg: any) => {
          // Skip user messages with synthesis instruction patterns
          if (msg.role === 'user' && msg.content) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            const isSynthesisInstruction = synthesisPatterns.some(pattern =>
              content.toLowerCase().includes(pattern.toLowerCase())
            );
            if (isSynthesisInstruction) {
              return false;
            }
            // Skip agent internal progress messages stored as user messages
            const isAgentInternal = agentInternalPatterns.some(pattern =>
              content.includes(pattern)
            );
            if (isAgentInternal) {
              return false;
            }
          }
          // Skip system messages entirely (they should never render)
          if (msg.role === 'system') {
            return false;
          }
          return true;
        });

        // Get current messages from store to preserve any local messages not yet in API
        const { sessions, addMessage } = useChatStore.getState();
        const currentSession = sessions[sessionId];
        const localMessages = currentSession?.messages || [];

        // console.log('[LOAD_MESSAGES] Store currently has', localMessages.length, 'messages for session:', sessionId);

        // Add messages from API to store (duplicate prevention will skip existing ones)
        if (apiMessages.length > 0) {
          apiMessages.forEach((msg: any) => {
            addMessage(sessionId, {
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
              metadata: msg.metadata,
              mcpCalls: msg.mcpCalls,
              model: msg.model,  // CRITICAL: Pass model for InlineModelBadge display
              // CRITICAL: Pass all step data for proper history rendering
              toolCalls: Array.isArray(msg.toolCalls) ? msg.toolCalls
                : Array.isArray(msg.metadata?.toolCalls) ? msg.metadata.toolCalls
                : undefined,
              toolResults: Array.isArray(msg.toolResults) ? msg.toolResults
                : Array.isArray(msg.metadata?.toolResults) ? msg.metadata.toolResults
                : undefined,
              reasoningTrace: typeof msg.reasoningTrace === 'string' ? msg.reasoningTrace
                : typeof msg.metadata?.thinkingContent === 'string' ? msg.metadata.thinkingContent
                : undefined,
              thinkingSteps: Array.isArray(msg.thinkingSteps) ? msg.thinkingSteps
                : Array.isArray(msg.metadata?.thinkingSteps) ? msg.metadata.thinkingSteps
                : undefined,
              tokenUsage: msg.tokenUsage,
              toolCallId: msg.toolCallId,  // For tool result messages — links to parent tool call
            } as any);
          });
        }

        // Get updated message count after API merge
        const updatedSession = useChatStore.getState().sessions[sessionId];
        const finalMessageCount = updatedSession?.messages?.length || 0;

        // console.log('[LOAD_MESSAGES] After merge, store has', finalMessageCount, 'messages for session:', sessionId);

        // Warn if local messages were lost (shouldn't happen with duplicate prevention)
        if (localMessages.length > 0 && finalMessageCount < localMessages.length) {
          // console.warn('[LOAD_MESSAGES] WARNING: Message count decreased from', localMessages.length, 'to', finalMessageCount);
          // console.warn('[LOAD_MESSAGES] This may indicate lost messages. Local messages:', localMessages.map(m => ({id: m.id, role: m.role})));
          // console.warn('[LOAD_MESSAGES] API messages:', apiMessages.map((m: any) => ({id: m.id, role: m.role})));
        }

        return apiMessages;
      }
    } catch (error) {
      console.error('[LOAD_MESSAGES] Failed to load session messages:', error);
      throw error;
    }
  }, [getAccessToken]);

  return {
    sessions,
    activeSessionId,
    setActiveSession,
    createNewSession,
    loadSessions,
    deleteSession,
    loadSessionMessages,
    updateSessionTitle
  };
};