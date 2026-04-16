/**
 * Unified Agent Activity Types
 *
 * Single source of truth for all agentic activity state.
 * Consolidates thinking, tool calls, multi-model handoffs, and streaming.
 *
 * @copyright 2025 Openagentic LLC
 */

// Activity types that can appear in the unified stream
export type ActivityType =
  | 'thinking'      // Model reasoning/CoT
  | 'tool_call'     // Tool being called
  | 'tool_result'   // Tool execution result
  | 'text'          // Streamed text content
  | 'handoff'       // Multi-model handoff
  | 'error';        // Error occurred

// Activity status
export type ActivityStatus =
  | 'pending'       // Queued but not started
  | 'executing'     // Currently running
  | 'complete'      // Finished successfully
  | 'error'         // Failed
  | 'abandoned';    // Stream died before result received

// Overall agent state machine
export type AgentPhase =
  | 'idle'          // Not doing anything
  | 'thinking'      // Model is reasoning
  | 'tool_calling'  // Preparing tool calls
  | 'tool_executing'// Tools are running
  | 'streaming'     // Text is streaming
  | 'synthesizing'  // Multi-model synthesis phase
  | 'complete';     // Done

// Single activity item in the unified stream
export interface AgentActivity {
  id: string;
  type: ActivityType;
  status: ActivityStatus;

  // Content varies by type
  content: string;           // Main content (thinking text, tool name, result, etc.)
  details?: string;          // Additional details (tool args, error message)

  // Timing
  timestamp: number;
  duration?: number;         // ms, set when complete

  // Context
  model?: string;            // Which model produced this
  round?: number;            // Agentic loop round (1, 2, 3...)
  serverId?: string;         // MCP server ID for tool calls
  serverName?: string;       // MCP server display name

  // Tool-specific
  toolCallId?: string;       // For linking tool_call to tool_result
  arguments?: Record<string, unknown>;
  result?: unknown;

  // Progress tracking (heartbeat)
  progressMessage?: string;  // Live progress message from heartbeat events
  progressElapsed?: number;  // Elapsed time from last heartbeat
}

// Grouped activities by round
export interface ActivityRound {
  round: number;
  activities: AgentActivity[];
  status: 'pending' | 'executing' | 'complete';
  startTime: number;
  endTime?: number;
}

// Full agent state
export interface AgentState {
  // Current phase in state machine
  phase: AgentPhase;

  // Current active model (for multi-model)
  currentModel?: string;
  currentModelRole?: 'reasoning' | 'tool_execution' | 'synthesis' | 'fallback';

  // Agentic loop tracking
  currentRound: number;
  maxRounds: number;

  // All activities in chronological order
  activities: AgentActivity[];

  // Currently streaming thinking content
  thinkingContent?: string;
  thinkingTokens?: number;

  // Multi-model orchestration
  orchestrationId?: string;
  rolesExecuted?: string[];

  // Metrics
  totalDuration?: number;
  totalCost?: number;
}

// Events that can update agent state
export type AgentEvent =
  | { type: 'STREAM_START'; messageId: string; model?: string }
  | { type: 'THINKING_START'; content?: string }
  | { type: 'THINKING_UPDATE'; content: string; tokens?: number }
  | { type: 'THINKING_COMPLETE' }
  | { type: 'TOOL_CALLS_REQUIRED'; tools: Array<{ name: string; arguments?: unknown }> }
  | { type: 'TOOL_EXECUTION_START'; tools: Array<{ name: string; arguments?: unknown }>; round: number }
  | { type: 'TOOL_EXECUTING'; name: string; arguments?: unknown; serverId?: string; serverName?: string }
  | { type: 'TOOL_RESULT'; name: string; result?: unknown; error?: string; duration?: number }
  | { type: 'TOOL_EXECUTION_COMPLETE'; round: number; successCount: number; errorCount: number }
  | { type: 'MODEL_HANDOFF'; fromModel: string; toModel: string; role: string }
  | { type: 'MULTI_MODEL_START'; orchestrationId: string; executionPlan: string[] }
  | { type: 'MULTI_MODEL_COMPLETE'; rolesExecuted: string[]; totalCost?: number }
  | { type: 'CONTENT_DELTA'; content: string }
  | { type: 'ERROR'; message: string; code?: string }
  | { type: 'STREAM_COMPLETE'; metrics?: Record<string, unknown> }
  | { type: 'RESET' };

// Display configuration
export interface UnifiedActivityConfig {
  // Show/hide sections
  showThinking: boolean;
  showTools: boolean;
  showMultiModel: boolean;

  // Collapse states
  defaultThinkingCollapsed: boolean;
  defaultToolsCollapsed: boolean;

  // Limits
  maxVisibleThinkingLines: number;
  maxVisibleTools: number;

  // Animation
  enableAnimations: boolean;

  // Theme
  theme: 'light' | 'dark';
}

// Default configuration - collapsed by default for cleaner UX
export const DEFAULT_CONFIG: UnifiedActivityConfig = {
  showThinking: true,
  showTools: true,
  showMultiModel: true,
  defaultThinkingCollapsed: true,  // Collapsed by default for cleaner UX
  defaultToolsCollapsed: true,     // Collapsed "pill" mode (Tab to expand)
  maxVisibleThinkingLines: 10,
  maxVisibleTools: 20,
  enableAnimations: true,
  theme: 'dark'
};
