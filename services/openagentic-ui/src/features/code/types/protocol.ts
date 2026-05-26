/**
 * Openagentic Streaming Protocol
 *
 * Defines structured events for real-time UI updates from openagentic-manager.
 * These events drive the Code Mode UI visualization and inline tool displays.
 */

// Activity states for the canvas
export type ActivityState =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'editing'
  | 'executing'
  | 'artifact'
  | 'error';

// Base event interface
export interface OpenagenticEvent {
  type: OpenagenticEventType;
  timestamp: number;
  sessionId: string;
}

// All possible event types
export type OpenagenticEventType =
  | 'session_started'
  | 'session_ended'
  | 'session_complete'
  | 'thinking_start'
  | 'thinking_update'
  | 'thinking_end'
  | 'thinking_block'  // Legacy thinking event
  | 'text_block'      // Text response event
  | 'text_delta'      // Incremental text update
  | 'file_write_start'
  | 'file_write_chunk'
  | 'file_write_end'
  | 'file_edit_start'
  | 'file_edit_diff'
  | 'file_edit_end'
  | 'command_start'
  | 'command_output'
  | 'command_end'
  | 'command_complete'
  | 'artifact_detected'
  | 'artifact_ready'
  | 'artifact_start'
  | 'artifact_created'
  | 'artifact_presented'
  | 'init_status'
  | 'llm_warmup_complete'
  | 'tool_start'
  | 'tool_use_start'  // Legacy tool start event
  | 'tool_call'       // Tool call event from AgenticCodeService
  | 'tool_executing'  // Tool executing event from SSE/chat stream
  | 'tool_end'
  | 'tool_result'     // Legacy tool result event
  | 'todo_update'     // Todo list update
  | 'step_start'      // Agentic workflow step start
  | 'step_complete'   // Agentic workflow step complete
  | 'task_start'      // Agentic task start
  | 'task_progress'   // Agentic task progress
  | 'task_complete'   // Agentic task complete
  | 'raw_output'      // Raw NDJSON output from CLI
  | 'message_end'     // End of message
  | 'response_complete' // Full response complete
  | 'result'          // CLI result event (success/error)
  | 'usage'
  | 'error'
  | 'message'
  // Agent tree events (multi-agent execution via openagentic-proxy)
  | 'agent_spawn_plan'
  | 'agent_start'
  | 'agent_complete'
  | 'agent_thinking'
  | 'agent_tool_call'
  | 'agent_tool_result'
  | 'execution_complete'
  | 'approval_required';

// Todo item status (like Openagentic CLI)
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

// Todo item structure
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm?: string; // Present continuous form shown during execution
  createdAt: number;
  completedAt?: number;
}

// Todo update event
export interface TodoUpdateEvent extends OpenagenticEvent {
  type: 'todo_update';
  todos: TodoItem[];
}

// Session events
export interface SessionStartedEvent extends OpenagenticEvent {
  type: 'session_started';
  workspacePath: string;
  model: string;
}

export interface SessionEndedEvent extends OpenagenticEvent {
  type: 'session_ended';
  reason: 'user' | 'timeout' | 'error';
}

// Thinking events
export interface ThinkingStartEvent extends OpenagenticEvent {
  type: 'thinking_start';
  context?: string; // e.g., "Analyzing request", "Planning architecture"
}

export interface ThinkingUpdateEvent extends OpenagenticEvent {
  type: 'thinking_update';
  step: string; // Current thinking step
  progress?: number; // 0-100 if estimable
}

export interface ThinkingEndEvent extends OpenagenticEvent {
  type: 'thinking_end';
}

// File writing events (new file creation)
export interface FileWriteStartEvent extends OpenagenticEvent {
  type: 'file_write_start';
  path: string;
  language: string;
  estimatedLines?: number;
}

export interface FileWriteChunkEvent extends OpenagenticEvent {
  type: 'file_write_chunk';
  path: string;
  content: string; // Chunk of code to append
  lineStart: number;
  lineEnd: number;
}

export interface FileWriteEndEvent extends OpenagenticEvent {
  type: 'file_write_end';
  path: string;
  totalLines: number;
  totalBytes: number;
}

// File editing events (modifications)
export interface FileEditStartEvent extends OpenagenticEvent {
  type: 'file_edit_start';
  path: string;
  description?: string; // What's being changed
}

export interface FileEditDiffEvent extends OpenagenticEvent {
  type: 'file_edit_diff';
  path: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  added: string[];
}

export interface FileEditEndEvent extends OpenagenticEvent {
  type: 'file_edit_end';
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

// Command execution events
export interface CommandStartEvent extends OpenagenticEvent {
  type: 'command_start';
  command: string;
  cwd?: string;
}

export interface CommandOutputEvent extends OpenagenticEvent {
  type: 'command_output';
  output: string;
  stream: 'stdout' | 'stderr';
}

export interface CommandEndEvent extends OpenagenticEvent {
  type: 'command_end';
  exitCode: number;
  duration: number; // ms
}

// Artifact events
export interface ArtifactDetectedEvent extends OpenagenticEvent {
  type: 'artifact_detected';
  artifactType: ArtifactType;
  name: string;
  description?: string;
}

export interface ArtifactReadyEvent extends OpenagenticEvent {
  type: 'artifact_ready';
  artifactType: ArtifactType;
  name: string;
  url?: string; // For running apps
  port?: number;
  content?: string; // For inline artifacts (HTML, SVG)
  entryPoint?: string; // Main file path
}

export type ArtifactType =
  | 'react-app'
  | 'web-app'
  | 'html-page'
  | 'diagram'
  | 'chart'
  | 'game'
  | 'api-response'
  | 'document'
  | 'image'
  | 'script-output';

// Error event
export interface ErrorEvent extends OpenagenticEvent {
  type: 'error';
  message: string;
  code?: string;
  recoverable: boolean;
}

// Generic message (for conversation)
export interface MessageEvent extends OpenagenticEvent {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

// Tool execution events
export interface ToolStartEvent extends OpenagenticEvent {
  type: 'tool_start';
  toolId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent extends OpenagenticEvent {
  type: 'tool_end';
  toolId: string;
  toolName: string;
  status: 'success' | 'error';
  output?: string;
  error?: string;
  duration: number; // ms
}

// Token usage event
export interface UsageEvent extends OpenagenticEvent {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheRead?: number;
  cacheWrite?: number;
}

// Legacy thinking block event (from eventEmitter)
export interface ThinkingBlockEvent extends OpenagenticEvent {
  type: 'thinking_block';
  text: string;
}

// Text block event (from eventEmitter)
export interface TextBlockEvent extends OpenagenticEvent {
  type: 'text_block';
  text: string;
}

// Legacy tool use start event
export interface ToolUseStartEvent extends OpenagenticEvent {
  type: 'tool_use_start';
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

// Legacy tool result event
export interface ToolResultEvent extends OpenagenticEvent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// Generic event for extended event types that share a common shape
// Used for events like init_status, llm_warmup_complete, tool_call, tool_executing, etc.
export interface GenericOpenagenticEvent extends OpenagenticEvent {
  type: OpenagenticEventType;
  [key: string]: unknown;
}

// Union type for all events
export type OpenagenticStreamEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | ThinkingStartEvent
  | ThinkingUpdateEvent
  | ThinkingEndEvent
  | ThinkingBlockEvent
  | TextBlockEvent
  | FileWriteStartEvent
  | FileWriteChunkEvent
  | FileWriteEndEvent
  | FileEditStartEvent
  | FileEditDiffEvent
  | FileEditEndEvent
  | CommandStartEvent
  | CommandOutputEvent
  | CommandEndEvent
  | ArtifactDetectedEvent
  | ArtifactReadyEvent
  | ToolStartEvent
  | ToolUseStartEvent
  | ToolEndEvent
  | ToolResultEvent
  | UsageEvent
  | ErrorEvent
  | MessageEvent
  | GenericOpenagenticEvent;

// Activity canvas state
export interface ActivityCanvasState {
  state: ActivityState;
  // Thinking state data
  thinkingContext?: string;
  thinkingSteps?: string[];
  // Writing state data
  writingFile?: string;
  writingLanguage?: string;
  writingContent?: string;
  writingLines?: number;
  writingProgress?: number;
  // Editing state data
  editingFile?: string;
  editingDiff?: DiffHunk[];
  // Executing state data
  executingCommand?: string;
  executingOutput?: string[];
  executingExitCode?: number | null;
  // Artifact state data
  artifact?: {
    type: ArtifactType;
    name: string;
    url?: string;
    content?: string;
    port?: number;
  };
  // Error state data
  error?: {
    message: string;
    recoverable: boolean;
  };
}

// Helper to detect language from file extension
export function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    ps1: 'powershell',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    cs: 'csharp',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    r: 'r',
    dockerfile: 'dockerfile',
  };
  return langMap[ext || ''] || 'plaintext';
}
