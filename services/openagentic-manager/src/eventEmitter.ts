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
 * NDJSON Event Emitter
 *
 * Parses NDJSON (Newline-Delimited JSON) output from openagentic CLI
 * running in --output-format stream-json mode.
 *
 * Message Protocol (OpenAgentic NDJSON stream):
 * - system/init: Session initialization with tools list
 * - assistant: Text and tool_use content blocks
 * - user: Tool results
 * - result: Session complete with cost/duration
 */

import { EventEmitter } from 'events';

// ========================================
// NDJSON Message Types (OpenAgentic Protocol)
// ========================================

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
}

export interface StreamMessage {
  type: 'system' | 'assistant' | 'user' | 'result' | 'agent';
  subtype?: 'init' | 'success' | 'error' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'spawned' | 'progress' | 'completed' | 'tree';
  message?: {
    content: ContentBlock[];
  };
  // Flat format fields (from ndjson-stream.ts)
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  // Session fields
  session_id?: string;
  tools?: string[];
  model?: string;
  cwd?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  error?: string;
  // Agent event fields
  task_id?: string;
  agent_name?: string;
  background?: boolean;
  progress_type?: string;
  tool?: { name: string; args?: Record<string, any>; output?: string };
  success?: boolean;
  duration_ms_agent?: number;
  tools_called?: string[];
  nodes?: any[];
}

// ========================================
// Structured Events (for UI)
// These match the UI protocol.ts event types
// ========================================

export interface OpenagenticEvent {
  type: string;
  timestamp: number;
  sessionId: string;
}

// Session events
export interface SessionStartedEvent extends OpenagenticEvent {
  type: 'session_started';
  workspacePath: string;
  model: string;
  podName?: string;
}

// CLI Ready event - emitted when CLI is fully initialized and LLM confirms ready
export interface CLIReadyEvent extends OpenagenticEvent {
  type: 'cli_ready';
  message: string;
  model: string;
  workspacePath: string;
}

export interface SessionEndedEvent extends OpenagenticEvent {
  type: 'session_ended';
  reason: 'user' | 'timeout' | 'error';
}

// Thinking events
export interface ThinkingStartEvent extends OpenagenticEvent {
  type: 'thinking_start';
  context?: string;
}

export interface ThinkingUpdateEvent extends OpenagenticEvent {
  type: 'thinking_update';
  step: string;
  progress?: number;
}

export interface ThinkingEndEvent extends OpenagenticEvent {
  type: 'thinking_end';
}

// File writing events
export interface FileWriteStartEvent extends OpenagenticEvent {
  type: 'file_write_start';
  path: string;
  language: string;
  estimatedLines?: number;
}

export interface FileWriteChunkEvent extends OpenagenticEvent {
  type: 'file_write_chunk';
  path: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

export interface FileWriteEndEvent extends OpenagenticEvent {
  type: 'file_write_end';
  path: string;
  totalLines: number;
  totalBytes: number;
}

// File editing events
export interface FileEditStartEvent extends OpenagenticEvent {
  type: 'file_edit_start';
  path: string;
  description?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  removed: string[];
  added: string[];
}

export interface FileEditDiffEvent extends OpenagenticEvent {
  type: 'file_edit_diff';
  path: string;
  hunks: DiffHunk[];
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
  duration: number;
}

// Artifact events
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
  url?: string;
  port?: number;
  content?: string;
  entryPoint?: string;
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
  duration: number;
}

// Usage event
export interface UsageEvent extends OpenagenticEvent {
  type: 'usage';
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Message event (for conversation display)
export interface MessageEvent extends OpenagenticEvent {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

// Error event
export interface ErrorEvent extends OpenagenticEvent {
  type: 'error';
  message: string;
  code?: string;
  recoverable: boolean;
}

// Raw output for terminal display
export interface RawOutputEvent extends OpenagenticEvent {
  type: 'raw_output';
  output: string;
}

// Legacy events (for backwards compatibility)
export interface SessionInitEvent extends OpenagenticEvent {
  type: 'session_init';
  tools: string[];
  cliSessionId?: string;
  workspacePath?: string;
  model?: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

export interface TodoUpdateEvent extends OpenagenticEvent {
  type: 'todo_update';
  todos: TodoItem[];
}

export interface SessionCompleteEvent extends OpenagenticEvent {
  type: 'session_complete';
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  isError?: boolean;
}

// Result event from CLI indicating request completion
export interface ResultEvent extends OpenagenticEvent {
  type: 'result';
  subtype?: 'success' | 'error';
  model?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
}

export type OpenagenticStreamEvent =
  | SessionStartedEvent
  | CLIReadyEvent
  | SessionEndedEvent
  | ThinkingStartEvent
  | ThinkingUpdateEvent
  | ThinkingEndEvent
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
  | ToolEndEvent
  | UsageEvent
  | MessageEvent
  | ErrorEvent
  | RawOutputEvent
  | SessionInitEvent
  | SessionCompleteEvent
  | ResultEvent
  | TodoUpdateEvent;

// Activity states for UI
export type ActivityState =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'editing'
  | 'executing'
  | 'artifact'
  | 'error';

/**
 * NDJSON Event Emitter
 * Parses NDJSON stream from openagentic CLI and emits UI-compatible events
 */
export class OpenagenticEventEmitter extends EventEmitter {
  private sessionId: string;
  private currentState: ActivityState = 'idle';
  private buffer: string = '';
  private cliSessionId: string | null = null;
  private tools: string[] = [];
  private workspacePath: string = '';
  private model: string = '';
  
  // Track active tool calls for proper start/end events
  private activeTools: Map<string, { name: string; input: Record<string, any>; startTime: number }> = new Map();
  
  // Track thinking state
  private isThinking = false;
  private thinkingSteps: string[] = [];

  // Track if text has been emitted in current turn (for synthetic text generation)
  private hasEmittedTextThisTurn = false;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  /**
   * Process raw output from CLI stdout
   * Each line should be a JSON object (NDJSON format)
   */
  processOutput(data: string): void {
    // Emit raw output for terminal display
    this.emit('event', this.createEvent<RawOutputEvent>({
      type: 'raw_output',
      output: data,
    }));

    // Add to buffer and process complete lines
    this.buffer += data;
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as StreamMessage;
        this.handleMessage(msg);
      } catch (e) {
        // Not valid JSON - might be stderr or other output (ignore silently)
      }
    }
  }

  /**
   * Handle a parsed NDJSON message
   * Translates CLI events to UI-compatible events
   */
  private handleMessage(msg: StreamMessage): void {
    // Reset turn tracking when we see a new human message (new turn starting)
    if ((msg as any).type === 'human') {
      this.hasEmittedTextThisTurn = false;
    }

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.cliSessionId = msg.session_id || null;
          this.tools = msg.tools || [];
          this.workspacePath = msg.cwd || '';
          this.model = msg.model || 'unknown';
          this.currentState = 'idle';

          // Emit session_started (UI-compatible)
          this.emit('event', this.createEvent<SessionStartedEvent>({
            type: 'session_started',
            workspacePath: this.workspacePath,
            model: this.model,
          }));
          
          // Also emit legacy session_init for backwards compatibility
          this.emit('event', this.createEvent<SessionInitEvent>({
            type: 'session_init',
            tools: this.tools,
            cliSessionId: this.cliSessionId || undefined,
            workspacePath: this.workspacePath,
            model: this.model,
          }));
        }
        break;

      case 'assistant':
        // Handle text output
        if (msg.subtype === 'text' && msg.text) {
          // End thinking if active
          if (this.isThinking) {
            this.endThinking();
          }

          this.currentState = 'idle';
          this.hasEmittedTextThisTurn = true;

          // Emit text_block (what UI expects)
          // NOTE: Do NOT emit legacy 'message' event - it causes duplicate text display
          // because the UI handles both text_block (appends) and message (appends+finalizes)
          this.emit('event', {
            type: 'text_block',
            timestamp: Date.now(),
            sessionId: this.sessionId,
            text: msg.text,
          });
        }
        // Handle thinking
        else if (msg.subtype === 'thinking' && msg.text) {
          if (!this.isThinking) {
            this.startThinking(msg.text);
          } else {
            this.updateThinking(msg.text);
          }
        }
        // Handle tool_use - translate to specific events
        else if (msg.subtype === 'tool_use' && msg.id && msg.name) {
          // End thinking if active
          if (this.isThinking) {
            this.endThinking();
          }

          // If no text has been emitted this turn, generate synthetic explanatory text
          // This ensures UI always shows context before tool calls
          if (!this.hasEmittedTextThisTurn) {
            const syntheticText = this.generateSyntheticText(msg.name, msg.input || {});
            this.emit('event', {
              type: 'text_block',
              timestamp: Date.now(),
              sessionId: this.sessionId,
              text: syntheticText,
            });
            this.hasEmittedTextThisTurn = true;
          }

          this.handleToolStart(msg.id, msg.name, msg.input || {});
        }
        // Handle nested format (msg.message.content)
        else if (msg.message?.content) {
          for (const block of msg.message.content) {
            this.handleContentBlock(block);
          }
        }
        break;

      case 'user':
        // Handle tool_result
        if (msg.subtype === 'tool_result' && msg.tool_use_id) {
          this.handleToolEnd(msg.tool_use_id, msg.content || '', msg.is_error || false);
        }
        // Handle nested format
        else if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_result') {
              this.handleToolEnd(
                block.tool_use_id || '',
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                false
              );
            }
          }
        }
        break;

      case 'result':
        // End thinking if still active
        if (this.isThinking) {
          this.endThinking();
        }

        this.currentState = 'idle';

        // Check if this is an error result
        const isErrorResult = msg.is_error || msg.subtype === 'error';

        // If error, emit error event BEFORE message_end so UI can display the error
        if (isErrorResult && msg.error) {
          this.emit('event', this.createEvent<ErrorEvent>({
            type: 'error',
            message: msg.error,
            recoverable: true,
          }));
        }

        // Emit message_end so UI finalizes the assistant message
        this.emit('event', {
          type: 'message_end',
          timestamp: Date.now(),
          sessionId: this.sessionId,
        });

        this.emit('event', this.createEvent<SessionEndedEvent>({
          type: 'session_ended',
          reason: isErrorResult ? 'error' : 'user',
        }));
        
        // Emit usage if available
        if (msg.cost_usd !== undefined || msg.total_cost_usd !== undefined) {
          this.emit('event', this.createEvent<UsageEvent>({
            type: 'usage',
            inputTokens: 0, // Not available in result
            outputTokens: 0,
            totalTokens: 0,
          }));
        }
        
        // Also emit legacy session_complete
        this.emit('event', this.createEvent<SessionCompleteEvent>({
          type: 'session_complete',
          costUsd: msg.cost_usd || msg.total_cost_usd,
          durationMs: msg.duration_ms || msg.duration_api_ms,
          numTurns: msg.num_turns,
          isError: isErrorResult,
        }));
        break;

      case 'agent':
        this.handleAgentMessage(msg);
        break;
    }
  }

  /**
   * Handle agent NDJSON events → forward as WebSocket events for UI
   */
  private handleAgentMessage(msg: StreamMessage): void {
    switch (msg.subtype) {
      case 'spawned':
        this.emit('event', {
          type: 'agent_spawned',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          taskId: msg.task_id,
          agentName: msg.agent_name,
          background: msg.background || false,
          model: msg.model,
        });
        break;

      case 'progress':
        this.emit('event', {
          type: 'agent_progress',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          taskId: msg.task_id,
          progressType: msg.progress_type,
          content: msg.content || msg.text,
          tool: msg.tool,
        });
        break;

      case 'completed':
        this.emit('event', {
          type: 'agent_completed',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          taskId: msg.task_id,
          agentName: msg.agent_name,
          success: msg.success !== false,
          durationMs: msg.duration_ms || msg.duration_ms_agent || 0,
          toolsCalled: msg.tools_called || [],
          error: msg.error,
        });
        break;

      case 'tree':
        this.emit('event', {
          type: 'agent_tree',
          timestamp: Date.now(),
          sessionId: this.sessionId,
          nodes: msg.nodes || [],
        });
        break;
    }
  }

  /**
   * Handle a content block from assistant message
   */
  private handleContentBlock(block: ContentBlock): void {
    switch (block.type) {
      case 'text':
        if (block.text) {
          if (this.isThinking) {
            this.endThinking();
          }

          this.currentState = 'idle';

          // Emit text_block (what UI expects)
          // NOTE: Do NOT emit legacy 'message' event - it causes duplicate text display
          this.emit('event', {
            type: 'text_block',
            timestamp: Date.now(),
            sessionId: this.sessionId,
            text: block.text,
          });
        }
        break;

      case 'thinking':
        if (block.text) {
          if (!this.isThinking) {
            this.startThinking(block.text);
          } else {
            this.updateThinking(block.text);
          }
        }
        break;

      case 'tool_use':
        if (block.name && block.id) {
          if (this.isThinking) {
            this.endThinking();
          }
          
          this.handleToolStart(block.id, block.name, block.input || {});
        }
        break;
    }
  }

  // ========================================
  // Thinking Events
  // ========================================

  private startThinking(text: string): void {
    this.isThinking = true;
    this.thinkingSteps = [text];
    this.currentState = 'thinking';

    // Emit thinking_block (what UI expects)
    this.emit('event', {
      type: 'thinking_block',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      text: text,
    });

    // Also emit new-style thinking_start for future UI
    this.emit('event', this.createEvent<ThinkingStartEvent>({
      type: 'thinking_start',
      context: text.substring(0, 100),
    }));
  }

  private updateThinking(text: string): void {
    this.thinkingSteps.push(text);

    // Emit thinking_block (what UI expects)
    // NOTE: Only emit one event type to avoid duplication in UI
    this.emit('event', {
      type: 'thinking_block',
      timestamp: Date.now(),
      sessionId: this.sessionId,
      text: text,
    });
  }

  private endThinking(): void {
    this.isThinking = false;
    this.thinkingSteps = [];

    this.emit('event', this.createEvent<ThinkingEndEvent>({
      type: 'thinking_end',
    }));
  }

  // ========================================
  // Tool Events - Translate to specific event types
  // ========================================

  private handleToolStart(toolId: string, toolName: string, input: Record<string, any>): void {
    // Deduplicate - if we've already seen this tool_use ID, skip to prevent duplicate UI blocks
    if (this.activeTools.has(toolId)) {
      return;
    }

    const startTime = Date.now();
    this.activeTools.set(toolId, { name: toolName, input, startTime });

    const nameLower = toolName.toLowerCase();

    // Determine if this is a specialized tool that gets its own event type
    // For specialized tools, we emit ONLY the specialized event to avoid duplicate steps in UI
    const isBashTool = nameLower.includes('bash') || nameLower.includes('exec') || nameLower.includes('shell') || nameLower === 'run';
    // Be specific about file write tools - exclude todo_write and similar non-file tools
    const isWriteTool = (nameLower === 'write' || nameLower === 'file_write' || nameLower === 'write_file' || nameLower === 'create_file') && !nameLower.includes('todo');
    const isEditTool = nameLower.includes('edit') || nameLower.includes('replace') || nameLower === 'str_replace';
    const isSpecializedTool = isBashTool || isWriteTool || isEditTool;

    // Only emit generic tool events for non-specialized tools
    // This prevents duplicate steps in the UI
    if (!isSpecializedTool) {
      // Emit tool_start for generic tools
      this.emit('event', this.createEvent<ToolStartEvent>({
        type: 'tool_start',
        toolId,
        toolName,
        args: input,
      }));
    }

    // Translate to specific event types based on tool name
    if (isWriteTool) {
      this.currentState = 'writing';
      const path = input.path || input.file_path || 'unknown';
      const content = input.content || '';

      this.emit('event', this.createEvent<FileWriteStartEvent>({
        type: 'file_write_start',
        path,
        language: this.detectLanguage(path),
        estimatedLines: content ? content.split('\n').length : undefined,
      }));

      // Emit content in chunks for animation
      if (content) {
        const lines = content.split('\n');
        this.emit('event', this.createEvent<FileWriteChunkEvent>({
          type: 'file_write_chunk',
          path,
          content,
          lineStart: 1,
          lineEnd: lines.length,
        }));
      }
    }
    else if (isEditTool) {
      this.currentState = 'editing';
      const path = input.path || input.file_path || 'unknown';

      this.emit('event', this.createEvent<FileEditStartEvent>({
        type: 'file_edit_start',
        path,
        description: input.description || `Editing ${path}`,
      }));
    }
    else if (isBashTool) {
      this.currentState = 'executing';
      const command = input.command || input.cmd || '';

      this.emit('event', this.createEvent<CommandStartEvent>({
        type: 'command_start',
        command,
        cwd: input.cwd || this.workspacePath,
      }));
    }
    else if (nameLower.includes('read') || nameLower.includes('glob') || nameLower.includes('grep') || nameLower.includes('search')) {
      // Reading tools don't change the visual state much
      this.currentState = 'thinking';
    }
    else {
      // Generic tool
      this.currentState = 'executing';
    }
  }

  private handleToolEnd(toolId: string, content: string, isError: boolean): void {
    const toolInfo = this.activeTools.get(toolId);

    // Deduplicate - if we've already processed this tool_result (tool not in activeTools), skip
    if (!toolInfo) {
      return;
    }

    const duration = Date.now() - toolInfo.startTime;
    const toolName = toolInfo.name;
    const input = toolInfo.input;

    this.activeTools.delete(toolId);
    this.currentState = 'idle';

    const nameLower = toolName.toLowerCase();

    // Determine if this is a specialized tool
    // For specialized tools, we emit ONLY the specialized events to avoid duplicate output in UI
    const isBashTool = nameLower.includes('bash') || nameLower.includes('exec') || nameLower.includes('shell') || nameLower === 'run';
    // Be specific about file write tools - exclude todo_write and similar non-file tools
    const isWriteTool = (nameLower === 'write' || nameLower === 'file_write' || nameLower === 'write_file' || nameLower === 'create_file') && !nameLower.includes('todo');
    const isEditTool = nameLower.includes('edit') || nameLower.includes('replace') || nameLower === 'str_replace';
    const isSpecializedTool = isBashTool || isWriteTool || isEditTool;

    // Only emit generic tool_end for non-specialized tools
    if (!isSpecializedTool) {
      this.emit('event', this.createEvent<ToolEndEvent>({
        type: 'tool_end',
        toolId,
        toolName,
        status: isError ? 'error' : 'success',
        output: content,
        error: isError ? content : undefined,
        duration,
      }));
    }

    // Emit specific end events for specialized tools
    if (isWriteTool) {
      const path = input.path || input.file_path || 'unknown';
      const writtenContent = input.content || '';
      const lines = writtenContent.split('\n');

      this.emit('event', this.createEvent<FileWriteEndEvent>({
        type: 'file_write_end',
        path,
        totalLines: lines.length,
        totalBytes: writtenContent.length,
      }));
    }
    else if (isEditTool) {
      const path = input.path || input.file_path || 'unknown';
      const oldStr = input.old_str || input.old_string || '';
      const newStr = input.new_str || input.new_string || '';
      const removedLines = oldStr ? oldStr.split('\n') : [];
      const addedLines = newStr ? newStr.split('\n') : [];

      // Emit file_edit_diff with hunk data so the UI can render inline diffs
      this.emit('event', this.createEvent<FileEditDiffEvent>({
        type: 'file_edit_diff',
        path,
        hunks: [{
          oldStart: 0,
          oldLines: removedLines.length,
          newStart: 0,
          newLines: addedLines.length,
          removed: removedLines,
          added: addedLines,
        }],
      }));

      this.emit('event', this.createEvent<FileEditEndEvent>({
        type: 'file_edit_end',
        path,
        linesAdded: addedLines.length,
        linesRemoved: removedLines.length,
      }));
    }
    else if (isBashTool) {
      // Emit command output
      if (content) {
        this.emit('event', this.createEvent<CommandOutputEvent>({
          type: 'command_output',
          output: content,
          stream: isError ? 'stderr' : 'stdout',
        }));
      }

      // Extract exit code from content if available
      const exitCodeMatch = content.match(/Exit code: (\d+)/);
      const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : (isError ? 1 : 0);

      this.emit('event', this.createEvent<CommandEndEvent>({
        type: 'command_end',
        exitCode,
        duration,
      }));

      // Check for artifact detection (server started)
      this.detectArtifact(content, input.command || '');
    }

    // Emit todo_update when a TodoWrite tool completes
    if (nameLower.includes('todo')) {
      try {
        const parsedTodos = JSON.parse(content);
        const todos = Array.isArray(parsedTodos) ? parsedTodos : (parsedTodos.todos || []);
        this.emit('event', this.createEvent<TodoUpdateEvent>({
          type: 'todo_update',
          todos,
        }));
      } catch {
        // Content wasn't valid JSON - emit with raw content as single todo
        if (content && !isError) {
          this.emit('event', this.createEvent<TodoUpdateEvent>({
            type: 'todo_update',
            todos: [{ id: toolId, content, status: 'pending' as const }],
          }));
        }
      }
    }
  }

  // ========================================
  // Artifact Detection
  // ========================================

  private detectArtifact(output: string, command: string): void {
    // Detect dev server URLs
    const serverPatterns = [
      /Local:\s*(https?:\/\/localhost:\d+)/i,
      /Server running at (https?:\/\/localhost:\d+)/i,
      /Listening on port (\d+)/i,
      /Started server on (https?:\/\/[^:\s]+:\d+)/i,
      /http:\/\/localhost:(\d+)/i,
      /http:\/\/127\.0\.0\.1:(\d+)/i,
      /http:\/\/0\.0\.0\.0:(\d+)/i,
    ];

    for (const pattern of serverPatterns) {
      const match = output.match(pattern);
      if (match) {
        let url = match[1];
        let port: number | undefined;
        
        // If just a port number, construct URL
        if (/^\d+$/.test(url)) {
          port = parseInt(url, 10);
          url = `http://localhost:${port}`;
        } else {
          // Extract port from URL
          const portMatch = url.match(/:(\d+)/);
          port = portMatch ? parseInt(portMatch[1], 10) : undefined;
        }

        // Determine artifact type
        let artifactType: ArtifactType = 'web-app';
        const cmdLower = command.toLowerCase();
        
        if (cmdLower.includes('vite') || cmdLower.includes('react')) {
          artifactType = 'react-app';
        } else if (cmdLower.includes('next')) {
          artifactType = 'web-app';
        } else if (cmdLower.includes('go run') || cmdLower.includes('python') || cmdLower.includes('node')) {
          artifactType = 'web-app';
        }

        // Emit artifact_detected
        this.emit('event', this.createEvent<ArtifactDetectedEvent>({
          type: 'artifact_detected',
          artifactType,
          name: 'Development Server',
          description: `Server started on port ${port}`,
        }));

        // Emit artifact_ready
        this.emit('event', this.createEvent<ArtifactReadyEvent>({
          type: 'artifact_ready',
          artifactType,
          name: 'Development Server',
          url,
          port,
        }));

        this.currentState = 'artifact';
        break;
      }
    }
  }

  // ========================================
  // Helper Methods
  // ========================================

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript',
      py: 'python', go: 'go', rs: 'rust',
      java: 'java', cpp: 'cpp', c: 'c',
      cs: 'csharp', rb: 'ruby', php: 'php',
      swift: 'swift', kt: 'kotlin',
      json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'markdown', css: 'css', scss: 'scss',
      html: 'html', sql: 'sql',
      sh: 'bash', bash: 'bash', zsh: 'bash',
      ps1: 'powershell', dockerfile: 'dockerfile',
    };
    return langMap[ext || ''] || 'plaintext';
  }

  /**
   * Generate synthetic explanatory text when model doesn't provide any
   * This ensures the UI always shows context before tool calls
   */
  private generateSyntheticText(toolName: string, input: Record<string, any>): string {
    const nameLower = toolName.toLowerCase();

    // Todo/task operations (check BEFORE write to prevent 'todo_write' matching 'write')
    if (nameLower.includes('todo')) {
      return `I'll update the task list.`;
    }

    // File write operations (exclude todo_write)
    if ((nameLower.includes('write') || nameLower === 'file_write' || nameLower === 'write_file') && !nameLower.includes('todo')) {
      const path = input.path || input.file_path || input.filePath || 'the file';
      return `I'll create ${path}.`;
    }

    // File edit operations
    if (nameLower.includes('edit') || nameLower.includes('replace') || nameLower === 'str_replace') {
      const path = input.path || input.file_path || input.filePath || 'the file';
      return `I'll modify ${path}.`;
    }

    // File read operations
    if (nameLower.includes('read') || nameLower === 'file_read' || nameLower === 'read_file') {
      const path = input.path || input.file_path || input.filePath || 'the file';
      return `Let me read ${path}.`;
    }

    // Shell/command execution
    if (nameLower.includes('bash') || nameLower.includes('shell') || nameLower.includes('exec') || nameLower === 'run') {
      const cmd = input.command || input.cmd || '';
      const cmdPreview = cmd.length > 50 ? cmd.substring(0, 50) + '...' : cmd;
      return cmdPreview ? `I'll run: \`${cmdPreview}\`` : `I'll execute a command.`;
    }

    // Directory/file listing
    if (nameLower.includes('list') || nameLower === 'ls' || nameLower === 'dir') {
      const path = input.path || input.directory || '.';
      return `Let me list the contents of ${path}.`;
    }

    // Search operations
    if (nameLower.includes('search') || nameLower.includes('grep') || nameLower.includes('find')) {
      const pattern = input.pattern || input.query || '';
      return pattern ? `I'll search for "${pattern}".` : `I'll search the codebase.`;
    }

    // Generic fallback
    return `Let me use ${toolName}.`;
  }

  /**
   * Send a user message to the CLI via stdin
   */
  createUserMessage(content: string): string {
    const msg = { type: 'human', content: content };
    return JSON.stringify(msg) + '\n';
  }

  /**
   * Emit session started event (called externally when PTY starts)
   */
  emitSessionStarted(workspacePath: string, model: string, podName?: string): void {
    this.workspacePath = workspacePath;
    this.model = model;

    this.emit('event', this.createEvent<SessionStartedEvent>({
      type: 'session_started',
      workspacePath,
      model,
      podName,
    }));
  }

  /**
   * Emit CLI ready event (called when LLM confirms it's ready)
   */
  emitCLIReady(message: string): void {
    this.emit('event', this.createEvent<CLIReadyEvent>({
      type: 'cli_ready',
      message,
      model: this.model,
      workspacePath: this.workspacePath,
    }));
  }

  /**
   * Emit error event
   */
  emitError(message: string, code?: string): void {
    this.currentState = 'error';

    this.emit('event', this.createEvent<ErrorEvent>({
      type: 'error',
      message,
      code,
      recoverable: true,
    }));
  }

  /**
   * Create an event with common fields
   */
  private createEvent<T extends OpenagenticEvent>(partial: Omit<T, 'timestamp' | 'sessionId'>): T {
    return {
      ...partial,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    } as T;
  }

  /**
   * Get current activity state
   */
  getState(): ActivityState {
    return this.currentState;
  }

  /**
   * Get available tools
   */
  getTools(): string[] {
    return this.tools;
  }

  /**
   * Get workspace path
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.currentState = 'idle';
    this.buffer = '';
    this.cliSessionId = null;
    this.tools = [];
    this.activeTools.clear();
    this.isThinking = false;
    this.thinkingSteps = [];
  }
}

export default OpenagenticEventEmitter;
