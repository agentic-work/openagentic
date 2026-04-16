/**
 * Agent Tree Store - Centralized State for Multi-Agent Execution Trees
 *
 * Maps executionId → AgentTree state. Handles real-time updates from
 * SSE events during multi-agent workflow execution:
 * - Spawn plans, agent lifecycle, tool calls/results, execution completion
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// =============================================================================
// Types
// =============================================================================

export interface ToolCall {
  id: string;
  toolName: string;
  args: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  resultPreview?: string;
  timestamp: string;
}

export interface AgentNode {
  id: string;
  role: string;
  status: 'running' | 'completed' | 'error';
  model?: string;
  task?: string;
  thinking?: { tokens: number; durationMs: number };
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  error?: string;
  timestamp: string;
  currentActivity?: string; // Live status: "Searching: ...", "Generating image..."
}

export interface AgentTree {
  executionId: string;
  strategy: string;
  status: 'running' | 'completed' | 'error';
  agents: Record<string, AgentNode>;
  totalDurationMs?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  timestamp: string;
}

// =============================================================================
// State & Actions
// =============================================================================

interface AgentTreeState {
  trees: Record<string, AgentTree>;
}

interface AgentTreeActions {
  // Event handlers
  handleSpawnPlan: (executionId: string, data: {
    strategy: string;
    agents?: Array<{ id: string; role: string; model?: string; task?: string }>;
    timestamp?: string;
  }) => void;

  handleAgentStart: (executionId: string, data: {
    agentId: string;
    role: string;
    model?: string;
    task?: string;
    timestamp?: string;
  }) => void;

  handleAgentComplete: (executionId: string, data: {
    agentId: string;
    status?: 'completed' | 'error';
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
    timestamp?: string;
  }) => void;

  handleAgentThinking: (executionId: string, data: {
    agentId: string;
    tokens: number;
    durationMs: number;
    timestamp?: string;
  }) => void;

  handleToolCall: (executionId: string, data: {
    agentId: string;
    toolCallId: string;
    toolName: string;
    args: string;
    timestamp?: string;
  }) => void;

  handleToolResult: (executionId: string, data: {
    agentId: string;
    toolCallId: string;
    status?: 'completed' | 'error';
    durationMs?: number;
    resultPreview?: string;
    timestamp?: string;
  }) => void;

  handleExecutionComplete: (executionId: string, data: {
    totalDurationMs?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalToolCalls?: number;
    status?: 'completed' | 'error';
    timestamp?: string;
  }) => void;

  handleApprovalRequired: (executionId: string, data: {
    agentId: string;
    toolCallId: string;
    toolName: string;
    args: string;
    timestamp?: string;
  }) => void;

  // Helpers
  getTree: (executionId: string) => AgentTree | undefined;
  clearTree: (executionId: string) => void;
  clearAllTrees: () => void;
}

type AgentTreeStore = AgentTreeState & AgentTreeActions;

// =============================================================================
// Initial State
// =============================================================================

const initialState: AgentTreeState = {
  trees: {},
};

// =============================================================================
// Helpers
// =============================================================================

const now = (): string => new Date().toISOString();

const ensureTree = (
  trees: Record<string, AgentTree>,
  executionId: string
): AgentTree => {
  return (
    trees[executionId] ?? {
      executionId,
      strategy: 'unknown',
      status: 'running',
      agents: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalToolCalls: 0,
      timestamp: now(),
    }
  );
};

const ensureAgent = (
  agents: Record<string, AgentNode>,
  agentId: string,
  defaults?: Partial<AgentNode>
): AgentNode => {
  return (
    agents[agentId] ?? {
      id: agentId,
      role: defaults?.role ?? 'agent',
      status: 'running',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      timestamp: now(),
      ...defaults,
    }
  );
};

// =============================================================================
// Store
// =============================================================================

export const useAgentTreeStore = create<AgentTreeStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // -----------------------------------------------------------------------
      // handleSpawnPlan — create a new tree entry with strategy + initial agents
      // -----------------------------------------------------------------------
      handleSpawnPlan: (executionId, data) =>
        set(
          (state) => {
            const existing = state.trees[executionId];
            const agents: Record<string, AgentNode> = { ...existing?.agents };

            for (const agent of data.agents ?? []) {
              agents[agent.id] = {
                id: agent.id,
                role: agent.role,
                status: 'running',
                model: agent.model,
                task: agent.task,
                toolCalls: [],
                inputTokens: 0,
                outputTokens: 0,
                timestamp: data.timestamp ?? now(),
              };
            }

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  executionId,
                  strategy: data.strategy,
                  status: 'running',
                  agents,
                  totalInputTokens: existing?.totalInputTokens ?? 0,
                  totalOutputTokens: existing?.totalOutputTokens ?? 0,
                  totalToolCalls: existing?.totalToolCalls ?? 0,
                  timestamp: data.timestamp ?? now(),
                },
              },
            };
          },
          false,
          'handleSpawnPlan'
        ),

      // -----------------------------------------------------------------------
      // handleAgentStart — add/update agent node to running status
      // -----------------------------------------------------------------------
      handleAgentStart: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const existing = tree.agents[data.agentId];
            const agent: AgentNode = {
              ...ensureAgent(tree.agents, data.agentId, { role: data.role }),
              role: data.role,
              status: 'running',
              model: data.model ?? existing?.model,
              task: data.task ?? existing?.task,
              timestamp: data.timestamp ?? existing?.timestamp ?? now(),
              currentActivity: 'Starting...',
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: agent },
                },
              },
            };
          },
          false,
          'handleAgentStart'
        ),

      // -----------------------------------------------------------------------
      // handleAgentComplete — update agent to completed/error with duration + tokens
      // -----------------------------------------------------------------------
      handleAgentComplete: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const agent = ensureAgent(tree.agents, data.agentId);

            const updatedAgent: AgentNode = {
              ...agent,
              status: data.status ?? 'completed',
              durationMs: data.durationMs ?? agent.durationMs,
              inputTokens: data.inputTokens ?? agent.inputTokens,
              outputTokens: data.outputTokens ?? agent.outputTokens,
              error: data.error ?? agent.error,
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: updatedAgent },
                },
              },
            };
          },
          false,
          'handleAgentComplete'
        ),

      // -----------------------------------------------------------------------
      // handleAgentThinking — set thinking info on agent
      // -----------------------------------------------------------------------
      handleAgentThinking: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const agent = ensureAgent(tree.agents, data.agentId);

            const updatedAgent: AgentNode = {
              ...agent,
              thinking: { tokens: data.tokens, durationMs: data.durationMs },
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: updatedAgent },
                },
              },
            };
          },
          false,
          'handleAgentThinking'
        ),

      // -----------------------------------------------------------------------
      // handleToolCall — add a new tool call to an agent's list
      // -----------------------------------------------------------------------
      handleToolCall: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const agent = ensureAgent(tree.agents, data.agentId);

            const toolCall: ToolCall = {
              id: data.toolCallId,
              toolName: data.toolName,
              args: data.args,
              status: 'running',
              timestamp: data.timestamp ?? now(),
            };

            const updatedAgent: AgentNode = {
              ...agent,
              toolCalls: [...agent.toolCalls, toolCall],
              currentActivity: `Using ${data.toolName}...`,
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: updatedAgent },
                },
              },
            };
          },
          false,
          'handleToolCall'
        ),

      // -----------------------------------------------------------------------
      // handleToolResult — update existing tool call with result/duration/status
      // -----------------------------------------------------------------------
      handleToolResult: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const agent = ensureAgent(tree.agents, data.agentId);

            const updatedToolCalls = agent.toolCalls.map((tc) =>
              tc.id === data.toolCallId
                ? {
                    ...tc,
                    status: (data.status ?? 'completed') as ToolCall['status'],
                    durationMs: data.durationMs ?? tc.durationMs,
                    resultPreview: data.resultPreview ?? tc.resultPreview,
                  }
                : tc
            );

            const updatedAgent: AgentNode = {
              ...agent,
              toolCalls: updatedToolCalls,
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: updatedAgent },
                },
              },
            };
          },
          false,
          'handleToolResult'
        ),

      // -----------------------------------------------------------------------
      // handleExecutionComplete — mark tree as completed with totals
      // -----------------------------------------------------------------------
      handleExecutionComplete: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  status: data.status ?? 'completed',
                  totalDurationMs: data.totalDurationMs ?? tree.totalDurationMs,
                  totalInputTokens: data.totalInputTokens ?? tree.totalInputTokens,
                  totalOutputTokens: data.totalOutputTokens ?? tree.totalOutputTokens,
                  totalToolCalls: data.totalToolCalls ?? tree.totalToolCalls,
                },
              },
            };
          },
          false,
          'handleExecutionComplete'
        ),

      // -----------------------------------------------------------------------
      // handleApprovalRequired — add approval request as a special tool call
      // -----------------------------------------------------------------------
      handleApprovalRequired: (executionId, data) =>
        set(
          (state) => {
            const tree = ensureTree(state.trees, executionId);
            const agent = ensureAgent(tree.agents, data.agentId);

            const approvalToolCall: ToolCall = {
              id: data.toolCallId,
              toolName: `[APPROVAL] ${data.toolName}`,
              args: data.args,
              status: 'running',
              timestamp: data.timestamp ?? now(),
            };

            const updatedAgent: AgentNode = {
              ...agent,
              toolCalls: [...agent.toolCalls, approvalToolCall],
            };

            return {
              trees: {
                ...state.trees,
                [executionId]: {
                  ...tree,
                  agents: { ...tree.agents, [data.agentId]: updatedAgent },
                },
              },
            };
          },
          false,
          'handleApprovalRequired'
        ),

      // -----------------------------------------------------------------------
      // Helpers
      // -----------------------------------------------------------------------

      getTree: (executionId) => get().trees[executionId],

      clearTree: (executionId) =>
        set(
          (state) => {
            const { [executionId]: _removed, ...rest } = state.trees;
            return { trees: rest };
          },
          false,
          'clearTree'
        ),

      // Wipe all agent trees — called by useSSEChat when the chat session
      // changes, so previous-session orchestrations don't bleed into the new
      // one's UI (the "ghost agent cards" bug).
      clearAllTrees: () =>
        set({ trees: {} }, false, 'clearAllTrees'),
    }),
    { name: 'AgentTreeStore' }
  )
);
