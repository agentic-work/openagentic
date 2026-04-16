/**
 * Anthropic Content Block Types
 *
 * Matches the exact streaming format from Anthropic API for tool_use, text, thinking.
 * These types drive the Code Mode UI rendering.
 *
 * See: https://docs.anthropic.com/en/docs/tool-use
 */

// ============================================
// Content Block Types (from assistant message)
// ============================================

/** Text content block - Openagentic's natural language response */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** Tool use content block - Openagentic requesting tool execution */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string; // e.g., "toolu_01A09q90qw90lq917835lq9"
  name: string; // e.g., "read_file", "bash", "web_search"
  input: Record<string, unknown>; // Tool arguments as JSON
}

/** Thinking content block - Extended thinking (if enabled) */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

/** Redacted thinking block - Encrypted thinking (safety-flagged) */
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}

/** Union of all assistant content blocks */
export type AssistantContentBlock =
  | TextBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock;

// ============================================
// Tool Result Types (from user message)
// ============================================

/** Tool result content block - Result of tool execution */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string; // Links back to the tool_use block
  content: string | ToolResultContent[];
  is_error?: boolean;
}

export interface ToolResultContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// ============================================
// Streaming Event Types
// ============================================

/** Message start event - Beginning of assistant message */
export interface MessageStartEvent {
  type: 'message_start';
  message: {
    id: string;
    type: 'message';
    role: 'assistant';
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

/** Content block start - New block beginning */
export interface ContentBlockStartEvent {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'tool_use' | 'thinking';
    id?: string; // For tool_use
    name?: string; // For tool_use
    text?: string; // For text (may be empty initially)
    thinking?: string; // For thinking (may be empty initially)
  };
}

/** Content block delta - Incremental streaming */
export interface ContentBlockDeltaEvent {
  type: 'content_block_delta';
  index: number;
  delta: TextDelta | ToolInputDelta | ThinkingDelta;
}

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface ToolInputDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

/** Content block stop - Block complete */
export interface ContentBlockStopEvent {
  type: 'content_block_stop';
  index: number;
}

/** Message delta - Contains stop_reason */
export interface MessageDeltaEvent {
  type: 'message_delta';
  delta: {
    stop_reason: StopReason;
    stop_sequence?: string;
  };
  usage: {
    output_tokens: number;
  };
}

/** Message stop - Turn complete */
export interface MessageStopEvent {
  type: 'message_stop';
}

/** Union of all streaming events */
export type StreamingEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// ============================================
// Stop Reasons (Drives the agentic loop)
// ============================================

export type StopReason =
  | 'tool_use' // Openagentic requesting tool execution - loop continues
  | 'end_turn' // Openagentic finished - display final response
  | 'pause_turn' // Server tool paused - resume with same content
  | 'max_tokens'; // Response truncated - may need retry

// ============================================
// UI State Machine
// ============================================

export type UIState =
  | 'IDLE'
  | 'THINKING'
  | 'STREAMING_TEXT'
  | 'TOOL_CALLING'
  | 'TOOL_EXECUTING'
  | 'TOOL_RESULT'
  | 'COMPLETE'
  | 'ERROR';

// ============================================
// Rendered Step Types (for UI display)
// ============================================

/** A single tool use step in the UI */
export interface ToolStep {
  id: string; // tool_use.id
  name: string; // tool_use.name
  displayName: string; // Human-readable name
  icon: ToolIcon; // Icon type for rendering
  input: Record<string, unknown>; // tool_use.input
  inputPreview: string; // Short preview of input for display
  status: ToolStepStatus;
  result?: {
    content: string;
    isError: boolean;
    preview?: string; // Short preview for collapsed view
  };
  startTime: number;
  endTime?: number;
  duration?: number;
  isCollapsed: boolean;
}

export type ToolStepStatus =
  | 'pending' // Received tool_use, waiting to execute
  | 'executing' // Tool is running
  | 'success' // Tool completed successfully
  | 'error'; // Tool failed

export type ToolIcon =
  | 'read' // Read file
  | 'write' // Write file
  | 'edit' // Edit file
  | 'bash' // Shell command
  | 'search' // Web search
  | 'fetch' // Web fetch
  | 'list' // List directory
  | 'find' // Find files
  | 'grep' // Search in files
  | 'git' // Git operations
  | 'default'; // Generic tool

/** Container of all steps in a conversation turn */
export interface StepsContainer {
  steps: ToolStep[];
  isCollapsed: boolean;
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  errorCount: number;
}

// ============================================
// Conversation Types
// ============================================

/** A message in the conversation */
export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  // Content can be text, steps, or both
  textContent?: string;
  thinkingContent?: string;
  steps?: StepsContainer;
  isStreaming?: boolean;
  // Token usage for this turn
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

// ============================================
// Tool Name Mapping
// ============================================

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // File operations
  read_file: 'Read',
  Read: 'Read',
  write_file: 'Write',
  Write: 'Write',
  edit_file: 'Edit',
  Edit: 'Edit',
  list_dir: 'List',
  Glob: 'Glob',
  // Shell
  bash: 'Bash',
  Bash: 'Bash',
  bash_background: 'Bash (bg)',
  // Search
  grep: 'Grep',
  Grep: 'Grep',
  find_files: 'Find',
  web_search: 'Search',
  WebSearch: 'Search',
  web_fetch: 'Fetch',
  WebFetch: 'Fetch',
  // Git
  git: 'Git',
  // MCP tools
  mcp__: 'MCP',
};

export const TOOL_ICONS: Record<string, ToolIcon> = {
  read_file: 'read',
  Read: 'read',
  write_file: 'write',
  Write: 'write',
  edit_file: 'edit',
  Edit: 'edit',
  list_dir: 'list',
  Glob: 'find',
  bash: 'bash',
  Bash: 'bash',
  bash_background: 'bash',
  grep: 'grep',
  Grep: 'grep',
  find_files: 'find',
  web_search: 'search',
  WebSearch: 'search',
  web_fetch: 'fetch',
  WebFetch: 'fetch',
  git: 'git',
};

/** Get display name for a tool */
export function getToolDisplayName(name: string): string {
  // Check for exact match first
  if (TOOL_DISPLAY_NAMES[name]) {
    return TOOL_DISPLAY_NAMES[name];
  }
  // Check for MCP tools
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    if (parts.length >= 3) {
      return parts[2]; // Return the actual tool name
    }
  }
  // Fallback: capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Get icon type for a tool */
export function getToolIcon(name: string): ToolIcon {
  if (TOOL_ICONS[name]) {
    return TOOL_ICONS[name];
  }
  // Check for partial matches
  if (name.includes('read')) return 'read';
  if (name.includes('write')) return 'write';
  if (name.includes('edit')) return 'edit';
  if (name.includes('bash') || name.includes('shell')) return 'bash';
  if (name.includes('search')) return 'search';
  if (name.includes('fetch')) return 'fetch';
  if (name.includes('grep')) return 'grep';
  if (name.includes('find') || name.includes('glob') || name.includes('list')) return 'find';
  if (name.includes('git')) return 'git';
  return 'default';
}

/** Generate input preview from tool input */
export function getInputPreview(name: string, input: Record<string, unknown>): string {
  // File operations - show file path
  if (input.file_path || input.path) {
    return String(input.file_path || input.path);
  }
  // Bash - show command
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  // Search - show query
  if (input.query) {
    return String(input.query);
  }
  // Pattern search
  if (input.pattern) {
    return String(input.pattern);
  }
  // URL
  if (input.url) {
    return String(input.url);
  }
  // Fallback: first string value or JSON
  const firstValue = Object.values(input).find(v => typeof v === 'string');
  if (firstValue) {
    const val = String(firstValue);
    return val.length > 60 ? val.slice(0, 60) + '...' : val;
  }
  // Last resort: JSON
  const json = JSON.stringify(input);
  return json.length > 60 ? json.slice(0, 60) + '...' : json;
}
