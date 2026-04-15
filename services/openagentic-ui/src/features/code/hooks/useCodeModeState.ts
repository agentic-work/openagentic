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
 * useCodeModeState - Main state management hook for Code Mode
 *
 * Connects to openagentic-manager via WebSocket and receives NDJSON events
 * from the openagentic CLI running in --output-format stream-json mode.
 *
 * This is the REAL openagentic - it executes tools (Read, Write, Bash, etc.)
 * not just a chatbot that gives instructions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ConversationMessage,
  UIState,
  ToolStep,
} from '../types/anthropic-blocks';
import {
  getToolDisplayName,
  getToolIcon,
  getInputPreview,
} from '../types/anthropic-blocks';
import type { TodoItem } from '../types/protocol';

// Connection state
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

// Session info from openagentic-manager
export interface SessionInfo {
  sessionId: string;
  workspacePath: string;
  model: string;
  tools?: string[];
}

interface CodeModeState {
  /** Connection state */
  connectionState: ConnectionState;
  /** Session info */
  session: SessionInfo | null;
  /** Full conversation history */
  messages: ConversationMessage[];
  /** Current UI state */
  uiState: UIState;
  /** Whether currently processing a turn */
  isProcessing: boolean;
  /** Current thinking duration in seconds */
  thinkingDuration: number;
  /** Thinking start time */
  thinkingStartTime: number | null;
  /** Current thinking step preview */
  thinkingStep?: string;
  /** Token usage totals */
  usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
  };
  /** Last error message */
  error?: string;
  /** Current todo list (Openagentic style) */
  todos: TodoItem[];
}

interface CodeModeActions {
  /** Send a user message */
  sendMessage: (content: string) => void;
  /** Stop current execution */
  stop: () => void;
  /** Clear conversation */
  clearConversation: () => void;
  /** Reconnect */
  reconnect: () => void;
}

interface UseCodeModeStateResult {
  state: CodeModeState;
  actions: CodeModeActions;
  /** Current streaming message (if any) */
  streamingMessage: ConversationMessage | null;
}

const initialState: CodeModeState = {
  connectionState: 'disconnected',
  session: null,
  messages: [],
  uiState: 'IDLE',
  isProcessing: false,
  thinkingDuration: 0,
  thinkingStartTime: null,
  usage: {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
  },
  todos: [],
};

// NDJSON Event types from openagentic-manager
interface NDJSONEvent {
  type: string;
  timestamp: number;
  sessionId: string;
  // session_init
  tools?: string[];
  cliSessionId?: string;
  workspacePath?: string;
  model?: string;
  // text_block / thinking_block
  text?: string;
  // tool_use_start
  toolId?: string;
  toolName?: string;
  input?: Record<string, any>;
  // tool_result
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  result?: string | Record<string, any>;
  // session_complete
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  // error
  message?: string;
  code?: string;
  // raw_output
  output?: string;
  // todo_update
  todos?: TodoItem[];
}

export function useCodeModeState(userId: string): UseCodeModeStateResult {
  const [state, setState] = useState<CodeModeState>(initialState);
  const [streamingMessage, setStreamingMessage] = useState<ConversationMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const thinkingIntervalRef = useRef<number | null>(null);
  const messageIdRef = useRef(0);
  const currentStepsRef = useRef<ToolStep[]>([]);
  const currentTextRef = useRef<string>('');
  const currentThinkingRef = useRef<string>('');

  // Generate unique message IDs
  const getMessageId = useCallback(() => {
    return `msg-${++messageIdRef.current}-${Date.now()}`;
  }, []);

  // Update thinking duration
  useEffect(() => {
    if (state.thinkingStartTime) {
      thinkingIntervalRef.current = window.setInterval(() => {
        setState((prev) => ({
          ...prev,
          thinkingDuration: Math.floor((Date.now() - (prev.thinkingStartTime || 0)) / 1000),
        }));
      }, 100);
    } else {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
    }

    return () => {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
      }
    };
  }, [state.thinkingStartTime]);

  // Handle NDJSON event from WebSocket
  const handleEvent = useCallback((event: NDJSONEvent) => {
    console.log('[CodeMode] Event:', event.type, event);

    switch (event.type) {
      case 'session_init':
        setState((prev) => ({
          ...prev,
          connectionState: 'connected',
          session: {
            sessionId: event.sessionId,
            workspacePath: event.workspacePath || '/workspace',
            model: event.model || 'openagentic',
            tools: event.tools,
          },
        }));
        break;

      case 'text_block':
        if (event.text) {
          currentTextRef.current += event.text;
          setState((prev) => ({
            ...prev,
            uiState: 'STREAMING_TEXT',
            thinkingStartTime: null,
          }));
          setStreamingMessage((prev) => prev ? {
            ...prev,
            textContent: currentTextRef.current,
            thinkingContent: currentThinkingRef.current || undefined,
          } : null);
        }
        break;

      case 'thinking_block':
        if (event.text) {
          currentThinkingRef.current += event.text;
          setState((prev) => ({
            ...prev,
            uiState: 'THINKING',
            thinkingStep: event.text.slice(-100).replace(/\n/g, ' ').trim(),
          }));
          setStreamingMessage((prev) => prev ? {
            ...prev,
            thinkingContent: currentThinkingRef.current,
          } : null);
        }
        break;

      case 'tool_use_start':
        if (event.toolName && event.toolId) {
          const step: ToolStep = {
            id: event.toolId,
            name: event.toolName,
            displayName: getToolDisplayName(event.toolName),
            icon: getToolIcon(event.toolName),
            input: event.input || {},
            inputPreview: getInputPreview(event.toolName, event.input || {}),
            status: 'executing',
            startTime: Date.now(),
            isCollapsed: false,
          };
          currentStepsRef.current.push(step);

          setState((prev) => ({
            ...prev,
            uiState: 'TOOL_CALLING',
            thinkingStartTime: null,
          }));

          setStreamingMessage((prev) => prev ? {
            ...prev,
            textContent: currentTextRef.current || undefined,
            thinkingContent: currentThinkingRef.current || undefined,
            steps: {
              steps: [...currentStepsRef.current],
              isCollapsed: false,
              totalCount: currentStepsRef.current.length,
              completedCount: currentStepsRef.current.filter(s => s.status === 'success').length,
              pendingCount: currentStepsRef.current.filter(s => s.status === 'pending' || s.status === 'executing').length,
              errorCount: currentStepsRef.current.filter(s => s.status === 'error').length,
            },
          } : null);
        }
        break;

      case 'tool_result':
        if (event.toolUseId) {
          // Update the step with result - support multiple field names
          const rawOutput = event.result || event.output || event.content || '';
          const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);
          currentStepsRef.current = currentStepsRef.current.map((step) =>
            step.id === event.toolUseId
              ? {
                  ...step,
                  status: event.isError ? 'error' : 'success',
                  output: outputStr,
                  endTime: Date.now(),
                  duration: step.startTime ? Date.now() - step.startTime : 0,
                }
              : step
          );

          setStreamingMessage((prev) => prev ? {
            ...prev,
            steps: {
              steps: [...currentStepsRef.current],
              isCollapsed: false,
              totalCount: currentStepsRef.current.length,
              completedCount: currentStepsRef.current.filter(s => s.status === 'success').length,
              pendingCount: currentStepsRef.current.filter(s => s.status === 'pending' || s.status === 'executing').length,
              errorCount: currentStepsRef.current.filter(s => s.status === 'error').length,
            },
          } : null);
        }
        break;

      case 'session_complete':
        // Finalize the current message
        if (currentTextRef.current || currentThinkingRef.current || currentStepsRef.current.length > 0) {
          const finalMessage: ConversationMessage = {
            id: getMessageId(),
            role: 'assistant',
            timestamp: new Date(),
            textContent: currentTextRef.current || undefined,
            thinkingContent: currentThinkingRef.current || undefined,
            steps: currentStepsRef.current.length > 0 ? {
              steps: [...currentStepsRef.current],
              isCollapsed: false,
              totalCount: currentStepsRef.current.length,
              completedCount: currentStepsRef.current.filter(s => s.status === 'success').length,
              pendingCount: 0,
              errorCount: currentStepsRef.current.filter(s => s.status === 'error').length,
            } : undefined,
            isStreaming: false,
          };

          setState((prev) => ({
            ...prev,
            messages: [...prev.messages, finalMessage],
            uiState: 'IDLE',
            isProcessing: false,
            thinkingStartTime: null,
            usage: {
              ...prev.usage,
              totalCostUsd: prev.usage.totalCostUsd + (event.costUsd || 0),
            },
          }));
        } else {
          setState((prev) => ({
            ...prev,
            uiState: 'IDLE',
            isProcessing: false,
            thinkingStartTime: null,
          }));
        }

        // Reset streaming state
        currentTextRef.current = '';
        currentThinkingRef.current = '';
        currentStepsRef.current = [];
        setStreamingMessage(null);
        break;

      case 'error':
        setState((prev) => ({
          ...prev,
          uiState: 'ERROR',
          isProcessing: false,
          thinkingStartTime: null,
          error: event.message || 'An error occurred',
        }));
        setStreamingMessage(null);
        break;

      case 'raw_output':
        // Raw output for debugging - could be shown in terminal panel
        console.log('[CodeMode] Raw:', event.output);
        break;

      case 'todo_update':
        // Update todo list (Openagentic CLI style)
        if (event.todos) {
          console.log('[CodeMode] Todo update:', event.todos.length, 'items');
          setState((prev) => ({
            ...prev,
            todos: event.todos || [],
          }));
        }
        break;
    }
  }, [getMessageId]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setState((prev) => ({ ...prev, connectionState: 'connecting' }));

    const authToken = localStorage.getItem('auth_token');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/code/ws/events?userId=${userId}&token=${authToken}`;

    console.log('[CodeMode] Connecting to WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CodeMode] WebSocket connected');
      setState((prev) => ({ ...prev, connectionState: 'connected' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as NDJSONEvent;
        handleEvent(data);
      } catch (err) {
        console.error('[CodeMode] Failed to parse message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('[CodeMode] WebSocket error:', error);
      setState((prev) => ({ ...prev, connectionState: 'error' }));
    };

    ws.onclose = () => {
      console.log('[CodeMode] WebSocket closed');
      setState((prev) => ({ ...prev, connectionState: 'disconnected' }));
      wsRef.current = null;
    };
  }, [userId, handleEvent]);

  // Initialize connection
  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Send a user message via WebSocket
  const sendMessage = useCallback((content: string) => {
    if (!content.trim() || state.isProcessing) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setState((prev) => ({ ...prev, error: 'Not connected' }));
      return;
    }

    // Add user message to conversation
    const userMessage: ConversationMessage = {
      id: getMessageId(),
      role: 'user',
      timestamp: new Date(),
      textContent: content,
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isProcessing: true,
      uiState: 'THINKING',
      thinkingStartTime: Date.now(),
      thinkingDuration: 0,
      error: undefined,
    }));

    // Reset streaming state
    currentTextRef.current = '';
    currentThinkingRef.current = '';
    currentStepsRef.current = [];

    // Initialize streaming message
    setStreamingMessage({
      id: getMessageId(),
      role: 'assistant',
      timestamp: new Date(),
      isStreaming: true,
    });

    // Send message to WebSocket (will be converted to NDJSON by server)
    wsRef.current.send(JSON.stringify({
      type: 'user_message',
      content: content,
    }));
  }, [state.isProcessing, getMessageId]);

  // Stop current execution
  const stop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop_execution' }));
    }
    setState((prev) => ({
      ...prev,
      isProcessing: false,
      uiState: 'IDLE',
      thinkingStartTime: null,
    }));
    setStreamingMessage(null);
  }, []);

  // Clear conversation
  const clearConversation = useCallback(() => {
    setState((prev) => ({
      ...prev,
      messages: [],
      usage: { totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 },
    }));
    currentTextRef.current = '';
    currentThinkingRef.current = '';
    currentStepsRef.current = [];
    setStreamingMessage(null);
  }, []);

  // Reconnect
  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  return {
    state,
    actions: {
      sendMessage,
      stop,
      clearConversation,
      reconnect,
    },
    streamingMessage,
  };
}

export default useCodeModeState;
