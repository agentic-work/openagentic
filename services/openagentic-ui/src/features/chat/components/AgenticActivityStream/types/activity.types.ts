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
 * AgenticActivityStream Type Definitions
 *
 * Types for the agentic activity visualization system that transforms
 * monolithic thinking blocks into structured, progressive displays.
 */

// =============================================================================
// Content Blocks
// =============================================================================

export type ContentBlockType =
  | 'thinking'
  | 'text'
  | 'tool_call'
  | 'tool_use'     // Added for Anthropic API compatibility
  | 'tool_result'
  | 'task_update'
  | 'summary';

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  timestamp: number;
  content: string;
  metadata?: ContentBlockMetadata;
  // Extended properties for streaming/interleaved mode
  isComplete?: boolean;   // Whether the block has finished streaming
  toolId?: string;        // For tool_use blocks - the tool call ID
  toolName?: string;      // For tool_use blocks - the tool name
  agentId?: string;       // Sub-agent ID (for spawn_parallel_agents children)
  parentToolId?: string;  // Parent tool call ID (nesting)
  agentRole?: string;     // Agent role description
  startTime?: number;     // ms epoch when this block began streaming
  duration?: number;      // ms elapsed from startTime to isComplete
  result?: unknown;       // For tool_use — the resolved tool result JSON
  error?: string;         // For tool_use — error message if the tool failed
}

export interface ContentBlockMetadata {
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  taskId?: string;
  sectionTitle?: string;
  isRepetitive?: boolean;
  repetitionCount?: number;
  duration?: number;
  status?: 'pending' | 'executing' | 'success' | 'error';
}

// =============================================================================
// Activity Sections
// =============================================================================

export interface ActivitySection {
  id: string;
  title: string;
  content: string;
  type: 'thinking' | 'analysis' | 'planning' | 'executing';
  isCollapsed: boolean;
  isRepetitive: boolean;
  repetitionCount?: number;
  timestamp: number;
}

// =============================================================================
// Tasks
// =============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AgenticTask {
  id: string;
  title: string;
  status: TaskStatus;
  progress?: number; // 0-100 for partial progress
  subtasks?: AgenticTask[];
  startedAt?: number;
  completedAt?: number;
  activeForm?: string; // Present tense version shown when in progress
}

// =============================================================================
// Tool Calls
// =============================================================================

export type ToolCallStatus = 'calling' | 'success' | 'error' | 'abandoned';

export interface ToolCall {
  id: string;
  toolName: string;
  displayName: string;
  input: unknown;
  output?: unknown;
  status: ToolCallStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  progressMessage?: string;  // Live progress message from heartbeat
  isCollapsed: boolean;
  agentId?: string;       // Sub-agent ID (for spawn_parallel_agents children)
  parentToolId?: string;  // Parent tool call ID (nesting)
  agentRole?: string;     // Agent role description
}

// =============================================================================
// Response Summary
// =============================================================================

export interface KeyFinding {
  label: string;
  value: string;
  icon?: string;
}

export interface SuggestedAction {
  id: string;
  label: string;
  description?: string;
  prompt?: string; // Pre-filled prompt when clicked
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline';
}

export interface ResponseSummary {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
}

// =============================================================================
// Parsed Activity
// =============================================================================

export interface ParsedActivity {
  sections: ActivitySection[];
  tasks: AgenticTask[];
  toolCalls: ToolCall[];
  summary: ResponseSummary | null;
}

// =============================================================================
// Streaming State
// =============================================================================

export type StreamingState =
  | 'idle'
  | 'thinking'
  | 'tool_use'
  | 'streaming'
  | 'complete'
  | 'error';

// =============================================================================
// Component Props
// =============================================================================

// Thinking progress data for real progress indicator
export interface ThinkingProgress {
  tokensUsed: number;
  tokenBudget: number;
  percentage: number;
  phase: 'thinking' | 'tools' | 'generating';
}

export interface AgenticActivityStreamProps {
  // Streaming state
  isStreaming: boolean;
  streamingState: StreamingState;

  // Content blocks (thinking, text, etc.)
  contentBlocks: ContentBlock[];

  // Tasks/todos from the AI
  tasks?: AgenticTask[];

  // Tool calls
  toolCalls?: ToolCall[];

  // Theme
  theme?: 'light' | 'dark';

  // Thinking progress for real progress indicator
  thinkingProgress?: ThinkingProgress;

  // Callbacks
  onInterrupt?: () => void;
  onToggleSection?: (sectionId: string) => void;

  // Display options
  showTimestamps?: boolean;
  autoCollapseRepetitive?: boolean;
  maxVisibleLines?: number;

  // Additional class names
  className?: string;
}

export interface ThinkingSectionProps {
  content: string;
  isStreaming: boolean;
  autoCollapse?: boolean;
  maxVisibleLines?: number;
  onToggle?: () => void;
  isCollapsed?: boolean;
  className?: string;
  variant?: 'natural' | 'boxed';
}

export interface TaskProgressProps {
  tasks: AgenticTask[];
  animate?: boolean;
  showTimestamps?: boolean;
  collapsible?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export interface ToolCallCardProps {
  toolName: string;
  displayName?: string;
  toolInput: unknown;
  toolOutput?: unknown;
  status: ToolCallStatus;
  duration?: number;
  startTime?: number;
  progressMessage?: string;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  theme?: 'light' | 'dark';
  className?: string;
}

export interface ResponseSummaryProps {
  accomplishments: string[];
  keyFindings?: KeyFinding[];
  caveats?: string[];
  suggestedActions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}

export interface SuggestedActionsProps {
  actions: SuggestedAction[];
  onActionClick?: (action: SuggestedAction) => void;
  className?: string;
}

// =============================================================================
// Legacy InlineStep Type (migrated from InlineSteps.tsx)
// =============================================================================

/**
 * InlineStep represents a single step in the agent activity display.
 * Used by useInlineStepsAdapter to bridge legacy step data to ContentBlock format.
 */
export interface InlineStep {
  id: string;
  type: 'thinking' | 'tool' | 'search' | 'read' | 'write' | 'bash' | 'edit' | 'glob' | 'grep' | 'handoff' | 'web_search' | 'mcp';
  status: 'pending' | 'running' | 'complete' | 'completed' | 'error';
  content?: string;
  title?: string;
  summary?: string;
  detail?: string;
  request?: string;
  response?: string;
  details?: {
    args?: any;
    result?: any;
    command?: string;
    output?: string;
    content?: string;
  };
  model?: string;
  round?: number;
  duration?: number;
  startTime?: number;
  endTime?: number;
  // For web search results
  resultCount?: number;
  searchResults?: Array<{ title: string; url: string; favicon?: string }>;
  // For nested thinking
  thinkingContent?: string;
  // For live progress updates on running tools
  progressMessage?: string;
  // Agent delegation sub-results
  agentId?: string;
  agentRole?: string;
}

export type DisplayMode = 'verbose' | 'compact';
