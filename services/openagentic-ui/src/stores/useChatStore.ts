import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { apiEndpoint } from '@/utils/api';

// Helper to get auth headers
const getAuthHeaders = async () => {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    'X-OpenAgentic-Frontend': 'true'
  };
  
  if (token) {
    return {
      ...headers,
      'Authorization': `Bearer ${token}`
    };
  }
  
  return headers;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date | string;
  model?: string; // Model used for this response (for badge display)
  metadata?: any;
  toolCalls?: any[];           // Function call requests from LLM
  toolCallId?: string;         // For tool result messages
  mcpCalls?: any[];            // MCP tool calls for this message (executed tools)
  thinkingSteps?: any[];       // Thinking/reasoning steps from LLM
  reasoningTrace?: any;        // Full reasoning trace content (string or ReasoningTrace object)
  toolResults?: any[];         // Results from tool executions
  attachedImages?: Array<{ name: string; data: string; mimeType: string }>; // Attached files
  streaming?: boolean;
  status?: 'sending' | 'sent' | 'error' | 'streaming' | 'completed';  // Message status
  attachments?: boolean;       // File attachment indicator
  tokens?: number;             // Token count for feedback tracking
  tokenUsage?: any;            // Token usage details
  imageUrl?: string;           // Image URL for image messages
  error?: string;              // Error message
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  messageCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  userId?: string;
  model?: string;
  temperature?: number;
  isLocal?: boolean;
}

interface ChatStore {
  // State
  sessions: Record<string, ChatSession>;
  activeSessionId: string | null;
  loading: boolean;
  error: string | null;
  streamingMessageId: string | null;
  
  // Actions
  setActiveSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, content: string, mcpCalls?: any[], metadata?: any, model?: string, thinkingSteps?: any[], reasoningTrace?: string, toolCalls?: any[], toolResults?: any[]) => void;
  updateStreamingMessage: (sessionId: string, messageId: string, content: string) => void;
  finishStreamingMessage: (sessionId: string, messageId: string) => void;
  loadSession: (sessionId: string) => Promise<void>;
  loadUserSessions: (userId?: string) => Promise<any[]>;
  createSession: (userId?: string, title?: string) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  clearError: () => void;
  clearMessages: (sessionId: string) => void;
}

export const useChatStore = create<ChatStore>()(
  devtools(
    immer((set, get) => ({
      sessions: {},
      activeSessionId: null,
      loading: false,
      error: null,
      streamingMessageId: null,

      setActiveSession: (sessionId) => set((state) => {
        // Ensure the session exists before setting as active
        if (sessionId && !state.sessions[sessionId]) {
          // console.warn(`[useChatStore] Attempted to set non-existent session as active: ${sessionId}`);
          return;
        }
        state.activeSessionId = sessionId;
      }),

      addMessage: (sessionId, message) => set((state) => {
        if (!state.sessions[sessionId]) {
          // Create session if it doesn't exist
          state.sessions[sessionId] = {
            id: sessionId,
            title: 'New Chat',
            messages: [],
            messageCount: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          };
        }

        // CRITICAL FIX: Check for existing message and MERGE step data if present
        // This preserves inline steps (mcpCalls, thinkingSteps, toolCalls, etc.)
        // that come with the final message after streaming
        const existingIndex = state.sessions[sessionId].messages.findIndex(m => m.id === message.id);
        if (existingIndex !== -1) {
          // Message exists - MERGE step data from incoming message
          const existing = state.sessions[sessionId].messages[existingIndex];
          state.sessions[sessionId].messages[existingIndex] = {
            ...existing,
            ...message,
            // Prefer new data if provided, otherwise keep existing
            mcpCalls: message.mcpCalls || existing.mcpCalls,
            thinkingSteps: message.thinkingSteps || existing.thinkingSteps,
            reasoningTrace: message.reasoningTrace || existing.reasoningTrace,
            toolCalls: message.toolCalls || existing.toolCalls,
            toolResults: message.toolResults || existing.toolResults,
            model: message.model || existing.model,
            metadata: { ...existing.metadata, ...message.metadata },
          };
        } else {
          // New message - append to end
          // Sorting is handled by normalizeMessages in ChatMessages component
          state.sessions[sessionId].messages.push(message);

          // Only count user/assistant messages
          if (message.role === 'user' || message.role === 'assistant') {
            state.sessions[sessionId].messageCount++;
          }
        }
        state.sessions[sessionId].updatedAt = new Date();
      }),

      updateMessage: (sessionId, messageId, content, mcpCalls, metadata, model, thinkingSteps, reasoningTrace, toolCalls, toolResults) => set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return;

        const message = session.messages.find(m => m.id === messageId);
        if (message) {
          message.content = content;
          // Update mcpCalls and metadata when provided
          // This preserves MCP tool execution data during streaming-to-final transition
          if (mcpCalls !== undefined) {
            message.mcpCalls = mcpCalls;
          }
          if (metadata !== undefined) {
            message.metadata = metadata;
          }
          // Update model for badge display
          if (model !== undefined) {
            message.model = model;
          }
          // CRITICAL: Update thinking/reasoning steps for inline display
          if (thinkingSteps !== undefined) {
            message.thinkingSteps = thinkingSteps;
          }
          if (reasoningTrace !== undefined) {
            message.reasoningTrace = reasoningTrace;
          }
          // Update tool calls and results
          if (toolCalls !== undefined) {
            message.toolCalls = toolCalls;
          }
          if (toolResults !== undefined) {
            message.toolResults = toolResults;
          }
          session.updatedAt = new Date();
        }
      }),

      updateStreamingMessage: (sessionId, messageId, content) => set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return;
        
        const message = session.messages.find(m => m.id === messageId);
        if (message) {
          message.content = content;
          message.streaming = true;
          state.streamingMessageId = messageId;
          session.updatedAt = new Date();
        }
      }),

      finishStreamingMessage: (sessionId, messageId) => set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return;

        const message = session.messages.find(m => m.id === messageId);
        if (message) {
          message.streaming = false;
          delete message.status;
        }

        if (state.streamingMessageId === messageId) {
          state.streamingMessageId = null;
        }
      }),

      loadSession: async (sessionId) => {
        set({ loading: true, error: null });
        try {
          const headers = await getAuthHeaders();
          const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}`), {
            credentials: 'include',
            headers
          });

          if (!response.ok) {
            throw new Error(`Failed to load session: ${response.statusText}`);
          }

          const data = await response.json();
          const session = data.session || data;

          set((state) => {
            // Map and sort messages chronologically
            // CRITICAL: Extract thinkingSteps and reasoningTrace from metadata for inline display
            const messages = session.messages
              .map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp),
                // Clear streaming status from persisted messages
                status: msg.status === 'streaming' ? undefined : msg.status,
                streaming: false,
                // CRITICAL FIX: Extract thinking content from metadata for inline step display
                // The backend saves thinkingContent in metadata - extract to reasoningTrace
                // DEFENSIVE: Ensure proper types to prevent render errors
                reasoningTrace: typeof msg.reasoningTrace === 'string' ? msg.reasoningTrace
                  : typeof msg.metadata?.thinkingContent === 'string' ? msg.metadata.thinkingContent
                  : undefined,
                // thinkingSteps from metadata if saved (structured COT steps)
                thinkingSteps: Array.isArray(msg.thinkingSteps) ? msg.thinkingSteps
                  : Array.isArray(msg.metadata?.thinkingSteps) ? msg.metadata.thinkingSteps
                  : undefined,
                // toolCalls and toolResults should already be in msg from backend
                toolCalls: Array.isArray(msg.toolCalls) ? msg.toolCalls
                  : Array.isArray(msg.metadata?.toolCalls) ? msg.metadata.toolCalls
                  : undefined,
                toolResults: Array.isArray(msg.toolResults) ? msg.toolResults
                  : Array.isArray(msg.metadata?.toolResults) ? msg.metadata.toolResults
                  : undefined,
              }))
              .sort((a: any, b: any) => {
                const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp.getTime();
                const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp.getTime();
                return aTime - bTime; // Chronological order (oldest first)
              });

            state.sessions[sessionId] = {
              ...session,
              createdAt: new Date(session.createdAt),
              updatedAt: new Date(session.updatedAt),
              messages
            };
            state.loading = false;
          });
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      loadUserSessions: async (userId) => {
        set({ loading: true, error: null });
        try {
          const headers = await getAuthHeaders();
          const response = await fetch(apiEndpoint('/chat/sessions'), {
            credentials: 'include',
            headers
          });
          
          if (!response.ok) {
            throw new Error(`Failed to load sessions: ${response.statusText}`);
          }
          
          const data = await response.json();
          const sessions = data.sessions || data || [];

          set((state) => {
            // CRITICAL FIX: Preserve existing messages BEFORE deleting/updating sessions
            // This prevents message loss when API is called during active conversation
            const existingSessionData = new Map<string, { messages: any[]; messageCount: number }>();

            Object.keys(state.sessions).forEach(sessionId => {
              if (state.sessions[sessionId].userId === userId) {
                // Save existing messages and count before updating
                existingSessionData.set(sessionId, {
                  messages: state.sessions[sessionId].messages || [],
                  messageCount: state.sessions[sessionId].messageCount || 0
                });
              }
            });

            // Add/update loaded sessions
            (Array.isArray(sessions) ? sessions : []).forEach((session: any) => {
              // Get preserved messages from BEFORE deletion
              const preserved = existingSessionData.get(session.id);
              const existingMessages = preserved?.messages || [];
              const existingMessageCount = preserved?.messageCount || 0;

              // Merge API messages with local messages
              // CRITICAL: Extract thinkingSteps and reasoningTrace from metadata
              // DEFENSIVE: Ensure proper types to prevent render errors
              const apiMessages = (session.messages && session.messages.length > 0)
                ? session.messages.map((msg: any) => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp),
                    // Extract thinking content from metadata for inline step display
                    reasoningTrace: typeof msg.reasoningTrace === 'string' ? msg.reasoningTrace
                      : typeof msg.metadata?.thinkingContent === 'string' ? msg.metadata.thinkingContent
                      : undefined,
                    thinkingSteps: Array.isArray(msg.thinkingSteps) ? msg.thinkingSteps
                      : Array.isArray(msg.metadata?.thinkingSteps) ? msg.metadata.thinkingSteps
                      : undefined,
                    toolCalls: Array.isArray(msg.toolCalls) ? msg.toolCalls
                      : Array.isArray(msg.metadata?.toolCalls) ? msg.metadata.toolCalls
                      : undefined,
                    toolResults: Array.isArray(msg.toolResults) ? msg.toolResults
                      : Array.isArray(msg.metadata?.toolResults) ? msg.metadata.toolResults
                      : undefined,
                  }))
                : [];

              // If we have local messages not in API, keep them
              // This handles the case where messages are still in transit to backend
              let finalMessages = apiMessages;
              if (existingMessages.length > apiMessages.length) {
                // console.log(`[STORE] Preserving ${existingMessages.length - apiMessages.length} local messages not yet in API`);
                finalMessages = existingMessages;
              }

              // CRITICAL FIX: Sort messages chronologically by timestamp
              // Ensures user messages ALWAYS appear after AI responses in correct order
              finalMessages.sort((a, b) => {
                const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp.getTime();
                const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp.getTime();
                return aTime - bTime; // Ascending order (oldest first)
              });

              state.sessions[session.id] = {
                ...session,
                createdAt: new Date(session.createdAt),
                updatedAt: new Date(session.updatedAt),
                messages: finalMessages,
                messageCount: Math.max(session.messageCount || 0, existingMessageCount)
              };
            });

            // Remove sessions that no longer exist in API (deleted sessions)
            Object.keys(state.sessions).forEach(sessionId => {
              if (state.sessions[sessionId].userId === userId) {
                const stillExists = (Array.isArray(sessions) ? sessions : []).some((s: any) => s.id === sessionId);
                if (!stillExists) {
                  delete state.sessions[sessionId];
                }
              }
            });

            state.loading = false;
          });
          
          // Return the loaded sessions for immediate use
          return Array.isArray(sessions) ? sessions : [];
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
          throw error;
        }
      },

      createSession: async (userId, title = 'New Chat') => {
        set({ loading: true, error: null });
        try {
          const headers = await getAuthHeaders();
          const response = await fetch(apiEndpoint('/chat/sessions'), { 
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ userId, title })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to create session: ${response.statusText}`);
          }
          
          const data = await response.json();
          const session = data.session || data;
          
          set((state) => {
            state.sessions[session.id] = {
              ...session,
              createdAt: new Date(session.createdAt),
              updatedAt: new Date(session.updatedAt),
              messages: []
            };
            state.activeSessionId = session.id;
            state.loading = false;
          });
          
          return session.id;
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
          throw error;
        }
      },

      deleteSession: async (sessionId) => {
        set({ loading: true, error: null });
        try {
          const headers = await getAuthHeaders();
          const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}`), {
            method: 'DELETE',
            credentials: 'include',
            headers
          });
          
          if (!response.ok) {
            throw new Error(`Failed to delete session: ${response.statusText}`);
          }
          
          set((state) => {
            delete state.sessions[sessionId];
            if (state.activeSessionId === sessionId) {
              state.activeSessionId = null;
            }
            state.loading = false;
          });
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      updateSessionTitle: async (sessionId, title) => {
        set({ loading: true, error: null });
        try {
          const headers = await getAuthHeaders();
          const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}`), {
            method: 'PUT',
            credentials: 'include',
            headers,
            body: JSON.stringify({ title })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to update session title: ${response.statusText}`);
          }
          
          set((state) => {
            if (state.sessions[sessionId]) {
              state.sessions[sessionId].title = title;
              state.sessions[sessionId].updatedAt = new Date();
            }
            state.loading = false;
          });
        } catch (error) {
          set({ loading: false, error: (error as Error).message });
        }
      },

      clearError: () => set({ error: null }),

      clearMessages: (sessionId) => set((state) => {
        if (state.sessions[sessionId]) {
          state.sessions[sessionId].messages = [];
          state.sessions[sessionId].messageCount = 0;
          state.sessions[sessionId].updatedAt = new Date();
        }
      })
    }))
  )
);

// Selectors for optimized re-renders
export const selectActiveSession = (state: ChatStore) => 
  state.activeSessionId ? state.sessions[state.activeSessionId] : null;

export const selectSessionMessages = (sessionId: string) => (state: ChatStore) =>
  state.sessions[sessionId]?.messages || [];

export const selectUserSessions = (userId: string) => (state: ChatStore) =>
  Object.values(state.sessions).filter(session => session.userId === userId);