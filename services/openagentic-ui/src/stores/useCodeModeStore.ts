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
 * Code Mode Store - Centralized State Management
 *
 * Handles:
 * - Session persistence across chat/code mode switching
 * - Streaming state (text, thinking, tools, todos)
 * - Connection management
 * - UI state (activity indicators, animations)
 *
 * The session stays ALIVE even when user switches to chat mode.
 * WebSocket connection is maintained, session ID preserved.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { NormalizedStreamEvent } from '../types/NormalizedStreamTypes';

// =============================================================================
// Types
// =============================================================================

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type ActivityState = 'idle' | 'thinking' | 'streaming' | 'responding' | 'tool_calling' | 'tool_executing' | 'complete' | 'error';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string; // Present continuous form ("Creating file...")
  completedAt?: number; // Timestamp for animation sequencing
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface ToolStep {
  id: string;
  name: string;
  displayName: string;
  icon?: string;
  status: 'pending' | 'executing' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;

  // Input/Output
  input?: Record<string, any>;
  inputPreview?: string;
  output?: string;
  error?: string;

  // File operations
  filePath?: string;
  diff?: DiffLine[];
  language?: string;

  // Command operations
  command?: string;
  exitCode?: number;

  // UI state
  isCollapsed: boolean;
  isStreaming: boolean;
}

// Content block types for ordered rendering
export type ContentBlockType = 'text' | 'tool' | 'thinking' | 'todo';

export interface TextBlock {
  type: 'text';
  id: string;
  content: string;
  isStreaming?: boolean;
}

export interface ToolBlock {
  type: 'tool';
  id: string;
  step: ToolStep;
}

export interface ThinkingBlock {
  type: 'thinking';
  id: string;
  content: string;
  isStreaming?: boolean;
}

export interface TodoBlock {
  type: 'todo';
  id: string;
  todos: TodoItem[];
}

export interface AgentTreeNode {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  duration?: number;
  toolsCalled: string[];
  currentTool?: string;
  background: boolean;
  children: string[];
  error?: string;
}

export interface AgentBlock {
  type: 'agent';
  id: string;
  taskId: string;
  agentName: string;
  nodes: AgentTreeNode[];
}

export type ContentBlock = TextBlock | ToolBlock | ThinkingBlock | TodoBlock | AgentBlock;

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: Date;

  // Ordered content blocks (for interspersed text/tools)
  contentBlocks?: ContentBlock[];

  // Legacy: kept for backward compatibility
  textContent?: string;
  thinkingContent?: string;

  // Tool calls
  steps?: ToolStep[];

  // Todos (when TodoWrite is called)
  todos?: TodoItem[];

  // Streaming state
  isStreaming: boolean;
  streamingState?: ActivityState;

  // Usage
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

export interface CodeSession {
  id?: string;
  sessionId: string;
  userId: string;
  workspacePath: string;
  model: string;
  createdAt: number;
  lastActiveAt: number;
  /** Hostname of the container/server */
  hostname?: string;
  /** CLI version string */
  cliVersion?: string;
  /** MinIO storage bucket name */
  storageBucket?: string;
  /** Storage type (s3fs = mounted, ephemeral = not persistent) */
  storageType?: string;
  /** Kubernetes pod name */
  podName?: string;
  /** CLI backend: 'openagentic-cli' or 'claude-code' */
  cliBackend?: 'openagentic-cli' | 'claude-code';
}

// Initialization step for the checklist UI
export interface InitStep {
  step: 'workspace' | 'vscode' | 'openagentic' | 'llm' | 'ready' | 'mode';
  status: 'pending' | 'running' | 'complete' | 'failed';
  message?: string;
  timestamp?: number;
}

// Initialization log entry for terminal-style display
export interface InitLogEntry {
  timestamp: number;
  type: 'info' | 'success' | 'error' | 'warning';
  source: 'workspace' | 'vscode' | 'openagentic' | 'llm' | 'system';
  message: string;
}

// =============================================================================
// Store State
// =============================================================================

interface CodeModeState {
  // Session
  activeSessionId: string | null;
  session: CodeSession | null;

  // Connection
  connectionState: ConnectionState;
  connectionError: string | null;
  reconnectAttempts: number;
  lastReconnectedAt: number | null; // Timestamp of last successful reconnect

  // Initialization checklist
  initSteps: InitStep[];
  isInitializing: boolean;

  // True once the ghostty-web terminal has painted real visible content
  // (not just alt-screen/clear/mouse-tracking setup escapes). TerminalPanel
  // flips this on when it observes any codepoint > 32 in the wasmTerm
  // buffer. The session-ready gate uses this as the FINAL green-light —
  // pod up + code-server up + openagentic cli_ready events all fire long
  // before Ink's first frame actually reaches the browser, and the user
  // has been burned by the gate dismissing on backend signals only.
  //
  // Reset on WS disconnect so every reconnect re-runs the validation.
  terminalContentReady: boolean;

  // Initialization logs (terminal-style real logs from backend)
  initLogs: InitLogEntry[];

  // Activity
  activityState: ActivityState;
  activityMessage: string | null; // "Pontificating...", "Booping...", etc.

  // Conversation
  messages: ConversationMessage[];
  streamingMessage: ConversationMessage | null;

  // Current streaming state
  streamingText: string;
  streamingThinking: string;
  currentSteps: ToolStep[];
  currentTodos: TodoItem[];
  currentContentBlocks: ContentBlock[]; // Ordered blocks for interleaved display
  currentTextBlockId: string | null; // Track current text block to append to
  currentThinkingBlockId: string | null; // Track current thinking block to append to

  // Normalized stream events for UnifiedActivityTree
  normalizedEvents: NormalizedStreamEvent[];

  // Agent tree state
  agentTree: AgentTreeNode[];
  activeAgents: Record<string, { taskId: string; agentName: string; background: boolean; startedAt: number }>;

  // Usage tracking
  totalInputTokens: number;
  totalOutputTokens: number;

  // Live thinking timer & per-request token counter
  thinkingStartTime: number | null;
  requestStartTime: number | null;
  requestTokensInput: number;
  requestTokensOutput: number;

  // UI preferences (persisted)
  isCodeModeActive: boolean;
  preferredModel: string;
  defaultWorkspace: string;
  showThinkingBlocks: boolean;
  autoExpandDiffs: boolean;
  maxDiffPreviewLines: number;

  // Interaction mode (Shift+Tab to cycle)
  interactionMode: 'normal' | 'plan' | 'yolo';

  // Terminal command bridge
  sendTerminalCommand: ((command: string) => void) | null;

  // Terminal refit bridge
  forceTerminalRefit: (() => void) | null;
}

interface CodeModeActions {
  // Session management
  setActiveSession: (sessionId: string, session: CodeSession) => void;
  clearSession: () => void;
  updateSessionActivity: () => void;
  updateSessionModel: (model: string) => void;

  // Connection
  setConnectionState: (state: ConnectionState, error?: string) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
  markReconnected: () => void;

  // Initialization
  setInitStep: (step: InitStep['step'], status: InitStep['status'], message?: string) => void;
  setTerminalContentReady: (ready: boolean) => void;
  addInitLog: (type: InitLogEntry['type'], source: InitLogEntry['source'], message: string) => void;
  resetInitSteps: () => void;

  // Activity
  setActivityState: (state: ActivityState, message?: string) => void;

  // Messages
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => void;
  updateStreamingText: (text: string) => void;
  updateStreamingThinking: (thinking: string, isNewBlock?: boolean) => void;
  startThinkingBlock: () => void;
  endThinkingBlock: () => void;
  appendToAssistantMessage: (text: string) => void;
  finalizeAssistantMessage: () => void;
  clearMessages: () => void;

  // Tool steps
  addToolStep: (step: Omit<ToolStep, 'isCollapsed' | 'isStreaming'>) => void;
  updateToolStep: (id: string, updates: Partial<ToolStep>) => void;
  setToolStepStreaming: (id: string, content: string) => void;
  finalizeToolStep: (id: string, output: string, isError?: boolean) => void;

  // Todos
  setTodos: (todos: TodoItem[]) => void;
  updateTodoStatus: (id: string, status: TodoItem['status']) => void;

  // Agent tree
  addAgent: (taskId: string, agentName: string, background: boolean) => void;
  updateAgentProgress: (taskId: string, progressType: string, tool?: { name: string }) => void;
  completeAgent: (taskId: string, agentName: string, success: boolean, durationMs: number, toolsCalled: string[], error?: string) => void;
  setAgentTree: (nodes: AgentTreeNode[]) => void;

  // Usage
  addUsage: (input: number, output: number, cacheRead?: number, cacheWrite?: number) => void;

  // Live thinking timer & per-request token counter
  startThinkingTimer: () => void;
  stopThinkingTimer: () => void;
  startRequestTimer: () => void;
  stopRequestTimer: () => void;
  updateRequestTokens: (input: number, output: number) => void;

  // Mode switching
  activateCodeMode: () => void;
  deactivateCodeMode: () => void;

  // Preferences
  setPreferredModel: (model: string) => void;
  setDefaultWorkspace: (path: string) => void;
  toggleThinkingBlocks: () => void;
  toggleAutoExpandDiffs: () => void;

  // Interaction mode
  cycleInteractionMode: () => void;
  setInteractionMode: (mode: 'normal' | 'plan' | 'yolo') => void;

  // Terminal command bridge — lets UI components send slash commands
  // (e.g. /model, /compact) to the openagentic CLI via the PTY WebSocket.
  // TerminalPanel registers its sender on mount; null when disconnected.
  sendTerminalCommand: ((command: string) => void) | null;
  setSendTerminalCommand: (fn: ((command: string) => void) | null) => void;

  // Terminal refit bridge — lets the header "Fit" button force a clean
  // resize + font repick + full repaint cycle, same recipe as the automatic
  // ResizeObserver path but bypassing the settling lock. Null when the
  // terminal panel hasn't mounted yet.
  forceTerminalRefit: (() => void) | null;
  setForceTerminalRefit: (fn: (() => void) | null) => void;

  // Normalized events
  pushNormalizedEvent: (event: NormalizedStreamEvent) => void;
  clearNormalizedEvents: () => void;

  // Reset
  reset: () => void;
}

type CodeModeStore = CodeModeState & CodeModeActions;

// =============================================================================
// Activity State Labels (simple, clean)
// =============================================================================

const STATE_LABELS: Record<ActivityState, string> = {
  idle: '',
  thinking: 'Thinking...',
  streaming: 'Writing...',
  responding: 'Responding...',
  tool_calling: 'Calling tool...',
  tool_executing: 'Executing...',
  complete: '',
  error: 'Error occurred',
};

export const getRandomMessage = (state: ActivityState): string => {
  return STATE_LABELS[state] || '';
};

// =============================================================================
// Initial State
// =============================================================================

const initialState: CodeModeState = {
  // Session
  activeSessionId: null,
  session: null,

  // Connection
  connectionState: 'disconnected',
  connectionError: null,
  reconnectAttempts: 0,
  lastReconnectedAt: null,

  // Initialization checklist
  initSteps: [
    { step: 'workspace', status: 'pending', message: 'Initializing workspace...' },
    { step: 'vscode', status: 'pending', message: 'Connecting to VS Code...' },
    { step: 'openagentic', status: 'pending', message: 'Starting AI assistant...' },
    { step: 'ready', status: 'pending', message: 'Finalizing...' },
    { step: 'llm', status: 'pending', message: 'LLM warming up...' },
  ],
  isInitializing: false,
  initLogs: [],
  terminalContentReady: false,

  // Activity
  activityState: 'idle',
  activityMessage: null,

  // Conversation
  messages: [],
  streamingMessage: null,

  // Streaming
  streamingText: '',
  streamingThinking: '',
  currentSteps: [],
  currentTodos: [],
  currentContentBlocks: [],
  currentTextBlockId: null,
  currentThinkingBlockId: null,

  // Normalized events
  normalizedEvents: [],

  // Agent tree
  agentTree: [],
  activeAgents: {},

  // Usage
  totalInputTokens: 0,
  totalOutputTokens: 0,
  thinkingStartTime: null,
  requestStartTime: null,
  requestTokensInput: 0,
  requestTokensOutput: 0,

  // UI preferences
  isCodeModeActive: false,
  preferredModel: '', // Empty = use system default model
  defaultWorkspace: '/workspace',
  showThinkingBlocks: true,
  autoExpandDiffs: false,
  maxDiffPreviewLines: 20,

  // Interaction mode
  interactionMode: 'normal',

  // Terminal command bridge
  sendTerminalCommand: null,

  // Terminal refit bridge
  forceTerminalRefit: null,
};

// Keys to persist
const PERSISTED_KEYS = [
  'activeSessionId',
  'isCodeModeActive',
  'preferredModel',
  'defaultWorkspace',
  'showThinkingBlocks',
  'autoExpandDiffs',
  'maxDiffPreviewLines',
  'interactionMode',
] as const;

// =============================================================================
// Store
// =============================================================================

export const useCodeModeStore = create<CodeModeStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ---------------------------------------------------------------------
        // Session Management
        // ---------------------------------------------------------------------

        setActiveSession: (sessionId, session) =>
          set(
            { activeSessionId: sessionId, session },
            false,
            'setActiveSession'
          ),

        updateSessionModel: (model) =>
          set(
            (state) => ({
              session: state.session ? { ...state.session, model } : state.session,
            }),
            false,
            'updateSessionModel'
          ),

        clearSession: () =>
          set(
            {
              activeSessionId: null,
              session: null,
              messages: [],
              streamingMessage: null,
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentTodos: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
              currentThinkingBlockId: null,
            },
            false,
            'clearSession'
          ),

        updateSessionActivity: () =>
          set(
            (state) => ({
              session: state.session
                ? { ...state.session, lastActiveAt: Date.now() }
                : null,
            }),
            false,
            'updateSessionActivity'
          ),

        // ---------------------------------------------------------------------
        // Connection
        // ---------------------------------------------------------------------

        setConnectionState: (connectionState, connectionError) =>
          set(
            (state) => ({
              connectionState,
              connectionError,
              // When the WS drops, the terminal canvas might still be
              // holding stale content. Clear the ready flag so the
              // session-ready gate re-runs its validation on reconnect
              // and the user sees the loading UI instead of a frozen
              // terminal pretending to still work.
              terminalContentReady:
                connectionState === 'connected' ? state.terminalContentReady : false,
            }),
            false,
            'setConnectionState',
          ),

        setTerminalContentReady: (terminalContentReady) =>
          set({ terminalContentReady }, false, 'setTerminalContentReady'),

        incrementReconnectAttempts: () =>
          set(
            (state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }),
            false,
            'incrementReconnectAttempts'
          ),

        resetReconnectAttempts: () =>
          set({ reconnectAttempts: 0 }, false, 'resetReconnectAttempts'),

        markReconnected: () =>
          set({ lastReconnectedAt: Date.now() }, false, 'markReconnected'),

        // ---------------------------------------------------------------------
        // Initialization
        // ---------------------------------------------------------------------

        setInitStep: (step, status, message) =>
          set(
            (state) => {
              // Determine log type based on status
              const logType = status === 'complete' ? 'success' as const :
                             status === 'failed' ? 'error' as const :
                             status === 'running' ? 'info' as const : 'info' as const;

              // Map step to source
              const source = step === 'ready' ? 'system' as const : step === 'mode' ? 'workspace' as const : step;

              // Create log entry from the message
              const newLog: InitLogEntry = {
                timestamp: Date.now(),
                type: logType,
                source,
                message: message || `${step} ${status}`,
              };

              return {
                initSteps: state.initSteps.map((s) =>
                  s.step === step
                    ? { ...s, status, message: message || s.message, timestamp: Date.now() }
                    : s
                ),
                isInitializing: status === 'running' || state.initSteps.some(
                  (s) => s.step !== step && (s.status === 'running' || s.status === 'pending')
                ),
                // Only add log if there's a message (skip generic status updates)
                initLogs: message ? [...state.initLogs, newLog] : state.initLogs,
              };
            },
            false,
            'setInitStep'
          ),

        addInitLog: (type, source, message) =>
          set(
            (state) => ({
              initLogs: [...state.initLogs, { timestamp: Date.now(), type, source, message }],
            }),
            false,
            'addInitLog'
          ),

        resetInitSteps: () =>
          set(
            {
              initSteps: [
                { step: 'workspace', status: 'pending', message: 'Initializing workspace...' },
                { step: 'vscode', status: 'pending', message: 'Connecting to VS Code...' },
                { step: 'openagentic', status: 'pending', message: 'Starting AI assistant...' },
                { step: 'llm', status: 'pending', message: 'Verifying LLM connectivity...' },
                { step: 'ready', status: 'pending', message: 'Finalizing...' },
              ],
              isInitializing: false,
              initLogs: [],
            },
            false,
            'resetInitSteps'
          ),

        // ---------------------------------------------------------------------
        // Activity
        // ---------------------------------------------------------------------

        setActivityState: (activityState, message) =>
          set(
            {
              activityState,
              activityMessage: message || (activityState !== 'idle' ? getRandomMessage(activityState) : null),
            },
            false,
            'setActivityState'
          ),

        // ---------------------------------------------------------------------
        // Messages
        // ---------------------------------------------------------------------

        addUserMessage: (content) =>
          set(
            (state) => ({
              messages: [
                ...state.messages,
                {
                  id: `user-${Date.now()}`,
                  role: 'user',
                  timestamp: new Date(),
                  textContent: content,
                  isStreaming: false,
                },
              ],
            }),
            false,
            'addUserMessage'
          ),

        startAssistantMessage: () =>
          set(
            {
              streamingMessage: {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                timestamp: new Date(),
                isStreaming: true,
                streamingState: 'thinking',
                contentBlocks: [],
              },
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
              currentThinkingBlockId: null,
              normalizedEvents: [],
              activityState: 'thinking',
              activityMessage: getRandomMessage('thinking'),
            },
            false,
            'startAssistantMessage'
          ),

        updateStreamingText: (text) =>
          set(
            (state) => {
              const newText = state.streamingText + text;
              let newBlocks = [...state.currentContentBlocks];
              let newTextBlockId = state.currentTextBlockId;

              // If we have a current text block, append to it
              if (newTextBlockId) {
                const existingIndex = newBlocks.findIndex(
                  (b) => b.type === 'text' && b.id === newTextBlockId
                );
                if (existingIndex >= 0) {
                  newBlocks[existingIndex] = {
                    ...newBlocks[existingIndex],
                    content: (newBlocks[existingIndex] as TextBlock).content + text,
                    isStreaming: true,
                  } as TextBlock;
                }
              } else {
                // Create new text block — close any previous streaming text blocks first
                newBlocks = newBlocks.map((b) =>
                  b.type === 'text' && b.isStreaming ? { ...b, isStreaming: false } : b
                );
                newTextBlockId = `text-${Date.now()}`;
                newBlocks.push({
                  type: 'text',
                  id: newTextBlockId,
                  content: text,
                  isStreaming: true,
                });
              }

              return {
                streamingText: newText,
                currentContentBlocks: newBlocks,
                currentTextBlockId: newTextBlockId,
                activityState: 'streaming',
                activityMessage: null,
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      textContent: newText,
                      contentBlocks: newBlocks,
                      streamingState: 'streaming',
                    }
                  : null,
              };
            },
            false,
            'updateStreamingText'
          ),

        updateStreamingThinking: (thinking, isNewBlock = false) =>
          set(
            (state) => {
              const newThinking = state.streamingThinking + thinking;
              let newBlocks = [...state.currentContentBlocks];
              let newThinkingBlockId = state.currentThinkingBlockId;
              let newTextBlockId = state.currentTextBlockId;

              // Create new thinking block if:
              // 1. Explicitly requested (isNewBlock)
              // 2. No current thinking block exists
              if (isNewBlock || !newThinkingBlockId) {
                newThinkingBlockId = `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                newBlocks.push({
                  type: 'thinking',
                  id: newThinkingBlockId,
                  content: thinking,
                  isStreaming: true,
                });
                // Reset text block ID so next text creates a new block after thinking
                newTextBlockId = null;
              } else {
                // Append to existing thinking block
                const existingIndex = newBlocks.findIndex(
                  (b) => b.type === 'thinking' && b.id === newThinkingBlockId
                );
                if (existingIndex >= 0) {
                  newBlocks[existingIndex] = {
                    ...newBlocks[existingIndex],
                    content: (newBlocks[existingIndex] as ThinkingBlock).content + thinking,
                    isStreaming: true,
                  } as ThinkingBlock;
                }
              }

              return {
                streamingThinking: newThinking,
                currentContentBlocks: newBlocks,
                currentThinkingBlockId: newThinkingBlockId,
                currentTextBlockId: newTextBlockId,
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      thinkingContent: newThinking,
                      contentBlocks: newBlocks,
                      streamingState: 'thinking',
                    }
                  : null,
              };
            },
            false,
            'updateStreamingThinking'
          ),

        // Start a new thinking block (called on thinking_start event)
        startThinkingBlock: () =>
          set(
            (state) => {
              // If a thinking block already exists and is streaming, don't create another one
              // This prevents duplicate blocks when thinking_block arrives before thinking_start
              if (state.currentThinkingBlockId) {
                const existingBlock = state.currentContentBlocks.find(
                  b => b.id === state.currentThinkingBlockId
                );
                if (existingBlock && 'isStreaming' in existingBlock && existingBlock.isStreaming) {
                  // Block already exists, just update activity state
                  return {
                    activityState: 'thinking' as ActivityState,
                    activityMessage: getRandomMessage('thinking'),
                  };
                }
              }

              // Create a new thinking block — mark any previous streaming thinking as complete first
              const newThinkingBlockId = `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              const closedBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'thinking' && block.isStreaming
                  ? { ...block, isStreaming: false }
                  : block
              );
              const newBlocks = [
                ...closedBlocks,
                {
                  type: 'thinking' as const,
                  id: newThinkingBlockId,
                  content: '',
                  isStreaming: true,
                },
              ];

              return {
                currentThinkingBlockId: newThinkingBlockId,
                currentTextBlockId: null, // Reset text block so next text creates new block
                currentContentBlocks: newBlocks,
                activityState: 'thinking' as ActivityState,
                activityMessage: getRandomMessage('thinking'),
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      contentBlocks: newBlocks,
                      streamingState: 'thinking',
                    }
                  : null,
              };
            },
            false,
            'startThinkingBlock'
          ),

        // End the current thinking block (called on thinking_end event)
        endThinkingBlock: () =>
          set(
            (state) => {
              // Mark current thinking block as not streaming
              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'thinking' && block.id === state.currentThinkingBlockId
                  ? { ...block, isStreaming: false }
                  : block
              );

              return {
                currentThinkingBlockId: null, // Clear so next thinking creates new block
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      contentBlocks: newBlocks,
                    }
                  : null,
              };
            },
            false,
            'endThinkingBlock'
          ),

        // Append raw text to the current assistant message. Used by
        // raw_output events from the terminal — the CLI's PTY output
        // stripped of ANSI escapes.
        appendToAssistantMessage: (text) => {
          const store = get();
          // Reuse updateStreamingText if we already have a streaming message;
          // otherwise start one first.
          if (!store.streamingMessage) {
            store.startAssistantMessage();
          }
          store.updateStreamingText(text);
        },

        finalizeAssistantMessage: () =>
          set(
            (state) => {
              if (!state.streamingMessage) return state;

              // Finalize all blocks (mark as not streaming)
              const finalBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'text' || block.type === 'thinking'
                  ? { ...block, isStreaming: false }
                  : block
              );

              // DEBUG: Trace thinking block persistence
              const thinkingBlocks = finalBlocks.filter(b => b.type === 'thinking');
              if (thinkingBlocks.length > 0) {
                console.log('[CodeMode] finalizeAssistantMessage — thinking blocks:', thinkingBlocks.map(b => ({
                  id: b.id,
                  contentLen: b.content?.length ?? 0,
                  preview: b.content?.slice(0, 60) ?? '(empty)',
                })));
              }

              const finalMessage: ConversationMessage = {
                ...state.streamingMessage,
                textContent: state.streamingText || undefined,
                thinkingContent: state.streamingThinking || undefined,
                steps: state.currentSteps.length > 0 ? [...state.currentSteps] : undefined,
                todos: state.currentTodos.length > 0 ? [...state.currentTodos] : undefined,
                contentBlocks: finalBlocks.length > 0 ? finalBlocks : undefined,
                isStreaming: false,
                streamingState: 'complete',
              };

              return {
                messages: [...state.messages, finalMessage],
                streamingMessage: null,
                streamingText: '',
                streamingThinking: '',
                currentSteps: [],
                currentContentBlocks: [],
                currentTextBlockId: null,
                currentThinkingBlockId: null,
                activityState: 'idle',
                activityMessage: null,
              };
            },
            false,
            'finalizeAssistantMessage'
          ),

        clearMessages: () =>
          set(
            {
              messages: [],
              streamingMessage: null,
              streamingText: '',
              streamingThinking: '',
              currentSteps: [],
              currentContentBlocks: [],
              currentTextBlockId: null,
              currentThinkingBlockId: null,
            },
            false,
            'clearMessages'
          ),

        // ---------------------------------------------------------------------
        // Tool Steps
        // ---------------------------------------------------------------------

        addToolStep: (step) =>
          set(
            (state) => {
              const newStep = { ...step, isCollapsed: true, isStreaming: true };
              const newSteps = [...state.currentSteps, newStep];

              // Mark current thinking block as complete before adding tool
              let newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'thinking' && block.id === state.currentThinkingBlockId
                  ? { ...block, isStreaming: false }
                  : block
              );

              // Add tool block to content blocks (for interleaved display)
              newBlocks = [
                ...newBlocks,
                {
                  type: 'tool' as const,
                  id: step.id,
                  step: newStep,
                },
              ];

              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                // Reset BOTH block IDs so next content creates a new block after this tool
                currentTextBlockId: null,
                currentThinkingBlockId: null,
                activityState: 'tool_calling',
                activityMessage: getRandomMessage('tool_calling'),
                // Keep streamingMessage in sync
                streamingMessage: state.streamingMessage
                  ? {
                      ...state.streamingMessage,
                      steps: newSteps,
                      contentBlocks: newBlocks,
                    }
                  : null,
              };
            },
            false,
            'addToolStep'
          ),

        updateToolStep: (id, updates) =>
          set(
            (state) => {
              const newSteps = state.currentSteps.map((step) =>
                step.id === id ? { ...step, ...updates } : step
              );
              // Also update in content blocks
              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? { ...block, step: { ...block.step, ...updates } }
                  : block
              );
              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'updateToolStep'
          ),

        setToolStepStreaming: (id, content) =>
          set(
            (state) => {
              const updates = { inputPreview: content, isStreaming: true };
              const newSteps = state.currentSteps.map((step) =>
                step.id === id ? { ...step, ...updates } : step
              );
              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? { ...block, step: { ...block.step, ...updates } }
                  : block
              );
              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'setToolStepStreaming'
          ),

        finalizeToolStep: (id, output, isError = false) =>
          set(
            (state) => {
              const stepUpdates = {
                output,
                error: isError ? output : undefined,
                status: (isError ? 'error' : 'success') as ToolStep['status'],
                endTime: Date.now(),
                isStreaming: false,
              };

              const newSteps: ToolStep[] = state.currentSteps.map((step) =>
                step.id === id
                  ? {
                      ...step,
                      ...stepUpdates,
                      duration: Date.now() - step.startTime,
                    }
                  : step
              );

              const newBlocks = state.currentContentBlocks.map((block) =>
                block.type === 'tool' && block.id === id
                  ? {
                      ...block,
                      step: {
                        ...block.step,
                        ...stepUpdates,
                        duration: Date.now() - block.step.startTime,
                      },
                    }
                  : block
              );

              return {
                currentSteps: newSteps,
                currentContentBlocks: newBlocks,
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, steps: newSteps, contentBlocks: newBlocks }
                  : null,
              };
            },
            false,
            'finalizeToolStep'
          ),

        // ---------------------------------------------------------------------
        // Todos
        // ---------------------------------------------------------------------

        setTodos: (todos) =>
          set(
            (state) => {
              // Mark newly completed todos with timestamp for animation
              const updatedTodos = todos.map((todo) => {
                const existing = state.currentTodos.find((t) => t.id === todo.id);
                if (todo.status === 'completed' && existing?.status !== 'completed') {
                  return { ...todo, completedAt: Date.now() };
                }
                return existing ? { ...existing, ...todo } : todo;
              });
              return {
                currentTodos: updatedTodos,
                // Keep streamingMessage.todos in sync for live UI updates
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, todos: updatedTodos }
                  : null,
              };
            },
            false,
            'setTodos'
          ),

        updateTodoStatus: (id, status) =>
          set(
            (state) => {
              const updatedTodos = state.currentTodos.map((todo) =>
                todo.id === id
                  ? {
                      ...todo,
                      status,
                      completedAt: status === 'completed' ? Date.now() : undefined,
                    }
                  : todo
              );
              return {
                currentTodos: updatedTodos,
                // Keep streamingMessage.todos in sync for live UI updates
                streamingMessage: state.streamingMessage
                  ? { ...state.streamingMessage, todos: updatedTodos }
                  : null,
              };
            },
            false,
            'updateTodoStatus'
          ),

        // ---------------------------------------------------------------------
        // Agent Tree
        // ---------------------------------------------------------------------

        addAgent: (taskId, agentName, background) => set((state) => ({
          activeAgents: {
            ...state.activeAgents,
            [taskId]: { taskId, agentName, background, startedAt: Date.now() },
          },
          agentTree: [
            ...state.agentTree,
            { id: taskId, name: agentName, status: 'running', toolsCalled: [], background, children: [] },
          ],
        })),

        updateAgentProgress: (taskId, progressType, tool) => set((state) => ({
          agentTree: state.agentTree.map(n =>
            n.id === taskId
              ? {
                  ...n,
                  currentTool: tool?.name || n.currentTool,
                  toolsCalled: tool?.name && !n.toolsCalled.includes(tool.name)
                    ? [...n.toolsCalled, tool.name]
                    : n.toolsCalled,
                }
              : n
          ),
        })),

        completeAgent: (taskId, agentName, success, durationMs, toolsCalled, error) => set((state) => {
          const { [taskId]: _, ...remainingAgents } = state.activeAgents;
          return {
            activeAgents: remainingAgents,
            agentTree: state.agentTree.map(n =>
              n.id === taskId
                ? { ...n, status: success ? 'completed' : 'failed', duration: durationMs, toolsCalled, error, currentTool: undefined }
                : n
            ),
          };
        }),

        setAgentTree: (nodes) => set({ agentTree: nodes }),

        // ---------------------------------------------------------------------
        // Usage
        // ---------------------------------------------------------------------

        addUsage: (input, output, cacheRead, cacheWrite) =>
          set(
            (state) => ({
              totalInputTokens: state.totalInputTokens + input,
              totalOutputTokens: state.totalOutputTokens + output,
              streamingMessage: state.streamingMessage
                ? {
                    ...state.streamingMessage,
                    usage: {
                      inputTokens: input,
                      outputTokens: output,
                      cacheRead,
                      cacheWrite,
                    },
                  }
                : null,
            }),
            false,
            'addUsage'
          ),

        // ---------------------------------------------------------------------
        // Live Thinking Timer & Per-Request Token Counter
        // ---------------------------------------------------------------------

        startThinkingTimer: () => set({ thinkingStartTime: Date.now() }, false, 'startThinkingTimer'),
        stopThinkingTimer: () => set({ thinkingStartTime: null }, false, 'stopThinkingTimer'),
        startRequestTimer: () => set({ requestStartTime: Date.now(), requestTokensInput: 0, requestTokensOutput: 0 }, false, 'startRequestTimer'),
        stopRequestTimer: () => set({ requestStartTime: null }, false, 'stopRequestTimer'),
        updateRequestTokens: (input: number, output: number) => set({ requestTokensInput: input, requestTokensOutput: output }, false, 'updateRequestTokens'),

        // ---------------------------------------------------------------------
        // Mode Switching
        // ---------------------------------------------------------------------

        activateCodeMode: () =>
          set({ isCodeModeActive: true }, false, 'activateCodeMode'),

        deactivateCodeMode: () =>
          set({ isCodeModeActive: false }, false, 'deactivateCodeMode'),

        // ---------------------------------------------------------------------
        // Preferences
        // ---------------------------------------------------------------------

        setPreferredModel: (model) =>
          set({ preferredModel: model }, false, 'setPreferredModel'),

        setSendTerminalCommand: (fn) =>
          set({ sendTerminalCommand: fn }, false, 'setSendTerminalCommand'),

        setForceTerminalRefit: (fn) =>
          set({ forceTerminalRefit: fn }, false, 'setForceTerminalRefit'),

        setDefaultWorkspace: (path) =>
          set({ defaultWorkspace: path }, false, 'setDefaultWorkspace'),

        toggleThinkingBlocks: () =>
          set(
            (state) => ({ showThinkingBlocks: !state.showThinkingBlocks }),
            false,
            'toggleThinkingBlocks'
          ),

        toggleAutoExpandDiffs: () =>
          set(
            (state) => ({ autoExpandDiffs: !state.autoExpandDiffs }),
            false,
            'toggleAutoExpandDiffs'
          ),

        // ---------------------------------------------------------------------
        // Interaction Mode (Normal → Plan → YOLO → Normal)
        // ---------------------------------------------------------------------

        cycleInteractionMode: () =>
          set(
            (state) => {
              const order: Array<'normal' | 'plan' | 'yolo'> = ['normal', 'plan', 'yolo'];
              const idx = order.indexOf(state.interactionMode);
              const next = order[(idx + 1) % order.length];
              return { interactionMode: next };
            },
            false,
            'cycleInteractionMode'
          ),

        setInteractionMode: (mode) =>
          set({ interactionMode: mode }, false, 'setInteractionMode'),

        // ---------------------------------------------------------------------
        // Normalized Events (for UnifiedActivityTree)
        // ---------------------------------------------------------------------

        pushNormalizedEvent: (event) =>
          set(
            (state) => ({ normalizedEvents: [...state.normalizedEvents, event] }),
            false,
            'pushNormalizedEvent'
          ),

        clearNormalizedEvents: () =>
          set({ normalizedEvents: [] }, false, 'clearNormalizedEvents'),

        // ---------------------------------------------------------------------
        // Reset
        // ---------------------------------------------------------------------

        reset: () =>
          set(
            {
              ...initialState,
              // Keep preferences
              preferredModel: get().preferredModel,
              defaultWorkspace: get().defaultWorkspace,
              showThinkingBlocks: get().showThinkingBlocks,
              autoExpandDiffs: get().autoExpandDiffs,
              maxDiffPreviewLines: get().maxDiffPreviewLines,
              interactionMode: get().interactionMode,
            },
            false,
            'reset'
          ),
      }),
      {
        name: 'code-mode-store',
        partialize: (state) =>
          Object.fromEntries(
            PERSISTED_KEYS.map((key) => [key, state[key]])
          ) as Pick<CodeModeState, (typeof PERSISTED_KEYS)[number]>,
      }
    ),
    { name: 'CodeMode' }
  )
);

// =============================================================================
// Selectors - Use shallow equality to prevent infinite re-renders
// =============================================================================

// Individual primitive selectors - these are stable and won't cause re-renders unless the value changes
export const useConnectionState = () => useCodeModeStore((state) => state.connectionState);
export const useTerminalContentReady = () =>
  useCodeModeStore((state) => state.terminalContentReady);
export const useConnectionError = () => useCodeModeStore((state) => state.connectionError);
export const useReconnectAttempts = () => useCodeModeStore((state) => state.reconnectAttempts);
export const useInitSteps = () => useCodeModeStore(useShallow((state) => state.initSteps));
export const useInitLogs = () => useCodeModeStore(useShallow((state) => state.initLogs));
export const useIsInitializing = () => useCodeModeStore((state) => state.isInitializing);
export const useActivityState = () => useCodeModeStore((state) => state.activityState);
export const useActivityMessage = () => useCodeModeStore((state) => state.activityMessage);
export const useActiveSessionId = () => useCodeModeStore((state) => state.activeSessionId);
export const useSession = () => useCodeModeStore((state) => state.session);
export const useIsCodeModeActive = () => useCodeModeStore((state) => state.isCodeModeActive);
export const useMessages = () => useCodeModeStore(useShallow((state) => state.messages));
export const useStreamingMessage = () => useCodeModeStore((state) => state.streamingMessage);
export const useTotalInputTokens = () => useCodeModeStore((state) => state.totalInputTokens);
export const useTotalOutputTokens = () => useCodeModeStore((state) => state.totalOutputTokens);
export const useNormalizedEvents = () => useCodeModeStore(useShallow((state) => state.normalizedEvents));
export const useSendTerminalCommand = () => useCodeModeStore((state) => state.sendTerminalCommand);

// Compound selectors with shallow comparison - use sparingly
// WARNING: These return new objects on every call. Use individual selectors when possible.
export const useCodeModeConnection = () =>
  useCodeModeStore(
    useShallow((state) => ({
      connectionState: state.connectionState,
      connectionError: state.connectionError,
      reconnectAttempts: state.reconnectAttempts,
    }))
  );

export const useCodeModeActivity = () =>
  useCodeModeStore(
    useShallow((state) => ({
      activityState: state.activityState,
      activityMessage: state.activityMessage,
    }))
  );

export const useCodeModeMessages = () =>
  useCodeModeStore(
    useShallow((state) => ({
      messages: state.messages,
      streamingMessage: state.streamingMessage,
    }))
  );

export const useCodeModeTodos = () =>
  useCodeModeStore(useShallow((state) => state.currentTodos));

export const useCodeModeSteps = () =>
  useCodeModeStore(useShallow((state) => state.currentSteps));

export const useCodeModeSession = () =>
  useCodeModeStore(
    useShallow((state) => ({
      sessionId: state.activeSessionId,
      session: state.session,
      isActive: state.isCodeModeActive,
    }))
  );

export const useCodeModeUsage = () =>
  useCodeModeStore(
    useShallow((state) => ({
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
    }))
  );

export const useAgentTree = () => useCodeModeStore((state) => state.agentTree);
export const useActiveAgents = () => useCodeModeStore((state) => state.activeAgents);

// Live thinking timer & per-request token selectors
export const useThinkingStartTime = () => useCodeModeStore((state) => state.thinkingStartTime);
export const useRequestStartTime = () => useCodeModeStore((state) => state.requestStartTime);
export const useRequestTokens = () =>
  useCodeModeStore(
    useShallow((state) => ({ input: state.requestTokensInput, output: state.requestTokensOutput }))
  );
