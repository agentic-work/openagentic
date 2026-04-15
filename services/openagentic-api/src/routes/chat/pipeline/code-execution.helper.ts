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
 * Code Execution Helper
 *
 * Routes code-related tool calls to openagentic-manager for execution.
 * This enables "invisible agent" functionality where chat conversations
 * can transparently trigger code execution through the openagentic system.
 *
 * Supports file operations, command execution, and code editing through
 * the same tool calling interface used by MCP tools.
 */

import axios from 'axios';
import type { Logger } from 'pino';
import type { ToolCall, ToolResult } from './tool-execution.helper.js';
import { getFeedbackIntegrationService } from '../../../services/FeedbackIntegrationService.js';

// AgenticCode Manager service URL
const OPENAGENTIC_MANAGER_URL = process.env.OPENAGENTIC_MANAGER_URL || 'http://openagentic-manager:3050';  // BUG-002 fix

/**
 * Code tool patterns - these indicate the LLM wants to perform code operations
 */
const CODE_TOOL_PATTERNS = [
  // File operations
  /^write_file$/i,
  /^create_file$/i,
  /^read_file$/i,
  /^edit_file$/i,
  /^delete_file$/i,
  /^list_files$/i,
  /^move_file$/i,
  /^copy_file$/i,

  // Directory operations
  /^create_directory$/i,
  /^list_directory$/i,
  /^delete_directory$/i,

  // Command execution
  /^execute_command$/i,
  /^run_command$/i,
  /^execute_script$/i,
  /^run_script$/i,
  /^bash$/i,
  /^shell$/i,

  // Code operations
  /^search_code$/i,
  /^find_in_files$/i,
  /^replace_in_file$/i,
  /^grep$/i,

  // Git operations
  /^git_.*$/i,
  /^clone_repository$/i,

  // Package/dependency operations
  /^npm_.*$/i,
  /^pip_.*$/i,
  /^install_package$/i,
];

/**
 * Code execution context for tracking session state
 */
export interface CodeExecutionContext {
  sessionId?: string;
  workspacePath?: string;
  executions: CodeExecution[];
  artifacts: CodeArtifact[];
}

export interface CodeExecution {
  toolCallId: string;
  toolName: string;
  command?: string;
  output: string;
  exitCode?: number;
  executionTimeMs: number;
  fileChanges?: string[];
  timestamp: Date;
}

export interface CodeArtifact {
  type: 'file' | 'directory' | 'script';
  path: string;
  language?: string;
  content?: string;
  createdAt: Date;
}

/**
 * Check if a tool name indicates a code-related operation
 */
export function isCodeTool(toolName: string): boolean {
  const normalizedName = toolName.toLowerCase().trim();
  return CODE_TOOL_PATTERNS.some(pattern => pattern.test(normalizedName));
}

/**
 * Get or create an openagentic session for a user
 */
export async function getOrCreateOpenagenticSession(
  userId: string,
  chatSessionId: string,
  logger: Logger,
  existingSessionId?: string
): Promise<{ sessionId: string; workspacePath: string }> {
  // If we already have a session, verify it's still valid
  if (existingSessionId) {
    try {
      const response = await axios.get(
        `${OPENAGENTIC_MANAGER_URL}/sessions/${existingSessionId}`,
        { timeout: 5000 }
      );

      if (response.data?.status === 'running') {
        logger.debug({
          sessionId: existingSessionId,
          userId
        }, '[CODE-EXEC] Reusing existing openagentic session');

        return {
          sessionId: existingSessionId,
          workspacePath: response.data.workspacePath
        };
      }
    } catch (error) {
      logger.debug({
        sessionId: existingSessionId,
        error
      }, '[CODE-EXEC] Existing session not available, creating new one');
    }
  }

  // Create a new session
  try {
    const response = await axios.post(
      `${OPENAGENTIC_MANAGER_URL}/sessions`,
      {
        userId,
        metadata: {
          chatSessionId,
          createdBy: 'invisible-agent'
        }
      },
      { timeout: 30000 }
    );

    const { id: sessionId, workspacePath } = response.data;

    logger.info({
      sessionId,
      workspacePath,
      userId,
      chatSessionId
    }, '[CODE-EXEC] Created new openagentic session for invisible agent');

    return { sessionId, workspacePath };
  } catch (error) {
    logger.error({
      error,
      userId,
      chatSessionId
    }, '[CODE-EXEC] Failed to create openagentic session');
    throw new Error('Failed to create code execution session');
  }
}

/**
 * Translate MCP-style tool call to openagentic command
 */
function translateToolToCommand(toolName: string, args: Record<string, any>): string {
  const normalizedTool = toolName.toLowerCase();

  switch (normalizedTool) {
    // File operations
    case 'write_file':
    case 'create_file':
      // Use heredoc for content to preserve special characters
      const content = args.content || '';
      const filePath = args.path || args.filename;
      return `cat > ${escapeShellArg(filePath)} << 'AGENTICEOF'\n${content}\nAGENTICEOF`;

    case 'read_file':
      return `cat ${escapeShellArg(args.path || args.filename)}`;

    case 'delete_file':
      return `rm -f ${escapeShellArg(args.path || args.filename)}`;

    case 'list_files':
    case 'list_directory':
      const dir = args.path || args.directory || '.';
      return args.recursive ? `find ${escapeShellArg(dir)} -type f` : `ls -la ${escapeShellArg(dir)}`;

    case 'create_directory':
      return `mkdir -p ${escapeShellArg(args.path || args.directory)}`;

    case 'delete_directory':
      return `rm -rf ${escapeShellArg(args.path || args.directory)}`;

    case 'move_file':
      return `mv ${escapeShellArg(args.source || args.from)} ${escapeShellArg(args.destination || args.to)}`;

    case 'copy_file':
      return `cp ${escapeShellArg(args.source || args.from)} ${escapeShellArg(args.destination || args.to)}`;

    // Command execution
    case 'execute_command':
    case 'run_command':
    case 'bash':
    case 'shell':
      return args.command || args.cmd || '';

    case 'execute_script':
    case 'run_script':
      const scriptPath = args.path || args.script;
      const scriptArgs = args.args || args.arguments || '';
      return `${scriptPath} ${scriptArgs}`.trim();

    // Search operations
    case 'search_code':
    case 'find_in_files':
    case 'grep':
      const pattern = args.pattern || args.search || args.query;
      const searchPath = args.path || args.directory || '.';
      return `grep -rn ${escapeShellArg(pattern)} ${escapeShellArg(searchPath)}`;

    case 'replace_in_file':
      const find = args.find || args.pattern;
      const replace = args.replace || args.replacement;
      const replaceFile = args.path || args.filename;
      return `sed -i 's/${escapeForSed(find)}/${escapeForSed(replace)}/g' ${escapeShellArg(replaceFile)}`;

    // Git operations
    case 'git_status':
      return 'git status';
    case 'git_diff':
      return `git diff ${args.file || ''}`.trim();
    case 'git_log':
      const count = args.count || args.n || 10;
      return `git log --oneline -n ${count}`;
    case 'git_add':
      return `git add ${args.files || args.path || '.'}`;
    case 'git_commit':
      return `git commit -m ${escapeShellArg(args.message || 'Automated commit')}`;
    case 'git_push':
      return 'git push';
    case 'git_pull':
      return 'git pull';
    case 'clone_repository':
      return `git clone ${escapeShellArg(args.url)} ${args.directory || ''}`.trim();

    // Package operations
    case 'npm_install':
      return `npm install ${args.package || ''}`.trim();
    case 'npm_run':
      return `npm run ${args.script || ''}`;
    case 'pip_install':
      return `pip install ${args.package || ''}`.trim();
    case 'install_package':
      const pkg = args.package || args.name;
      const manager = args.manager || 'npm';
      return `${manager} install ${pkg}`;

    default:
      // Generic: assume it's a command-like tool
      if (args.command) return args.command;
      if (args.cmd) return args.cmd;
      return `echo "Unknown tool: ${toolName}"`;
  }
}

/**
 * Escape string for shell argument
 */
function escapeShellArg(arg: string): string {
  if (!arg) return "''";
  // Use single quotes and escape any single quotes in the string
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape string for sed pattern
 */
function escapeForSed(str: string): string {
  if (!str) return '';
  return str.replace(/[/&\\]/g, '\\$&');
}

/**
 * Execute a code tool call via openagentic-manager
 */
export async function executeCodeToolCall(
  toolCall: ToolCall,
  sessionId: string,
  logger: Logger,
  emitEvent?: (event: string, data: any) => void
): Promise<ToolResult> {
  const startTime = Date.now();
  const toolName = toolCall.function.name;

  let args: Record<string, any> = {};
  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch (e) {
    logger.warn({
      toolCallId: toolCall.id,
      arguments: toolCall.function.arguments
    }, '[CODE-EXEC] Failed to parse tool arguments');
  }

  // Translate to command
  const command = translateToolToCommand(toolName, args);

  logger.info({
    toolCallId: toolCall.id,
    toolName,
    command: command.substring(0, 200), // Truncate for logging
    sessionId
  }, '[CODE-EXEC] Executing code tool call');

  // Emit start event
  if (emitEvent) {
    emitEvent('code_execution_start', {
      toolCallId: toolCall.id,
      toolName,
      sessionId
    });
  }

  try {
    // Send command to openagentic session
    const response = await axios.post(
      `${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}/messages`,
      { message: command },
      { timeout: 120000 } // 2 minute timeout for command execution
    );

    const output = response.data?.output || response.data || '';
    const executionTimeMs = Date.now() - startTime;

    logger.info({
      toolCallId: toolCall.id,
      toolName,
      executionTimeMs,
      outputLength: typeof output === 'string' ? output.length : JSON.stringify(output).length
    }, '[CODE-EXEC] Code tool execution completed');

    // Emit completion event
    if (emitEvent) {
      emitEvent('code_execution_complete', {
        toolCallId: toolCall.id,
        toolName,
        executionTimeMs,
        success: true
      });
    }

    // =================================================================
    // 📊 FEEDBACK LOOP - Score code execution
    // =================================================================
    // Score the code execution for quality tracking and learning
    try {
      const feedbackService = getFeedbackIntegrationService();
      const outputStr = typeof output === 'string' ? output : JSON.stringify(output);

      const feedbackResult = await feedbackService.processToolResult({
        toolCallId: toolCall.id,
        toolName,
        serverName: 'openagentic',
        httpStatus: 200,
        responseTimeMs: executionTimeMs,
        rawResult: JSON.stringify({
          success: true,
          output: outputStr.substring(0, 10000),  // Limit for scoring
          command: command.substring(0, 500)
        }),
        userQuery: command,
        userId: 'code-mode',
        sessionId
      });

      logger.debug({
        toolCallId: toolCall.id,
        toolName,
        finalScore: feedbackResult.scoring.finalScore.toFixed(3),
        executionScore: feedbackResult.scoring.executionScore.score.toFixed(3)
      }, '[CODE-FEEDBACK] Code execution scored');
    } catch (feedbackError) {
      logger.debug({ error: feedbackError }, '[CODE-FEEDBACK] Feedback processing failed (non-fatal)');
    }

    return {
      toolCallId: toolCall.id,
      toolName,
      result: {
        success: true,
        output: typeof output === 'string' ? output : JSON.stringify(output, null, 2),
        executionTimeMs
      },
      executionTimeMs
    };

  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
    const errorStatusCode = error.response?.status || 500;

    logger.error({
      toolCallId: toolCall.id,
      toolName,
      error: errorMessage,
      executionTimeMs
    }, '[CODE-EXEC] Code tool execution failed');

    // =================================================================
    // 📉 ERROR FEEDBACK - Learn from code execution failures
    // =================================================================
    try {
      const feedbackService = getFeedbackIntegrationService();

      await feedbackService.processToolResult({
        toolCallId: toolCall.id,
        toolName,
        serverName: 'openagentic',
        httpStatus: errorStatusCode,
        responseTimeMs: executionTimeMs,
        rawResult: JSON.stringify({
          success: false,
          error: errorMessage,
          command: command.substring(0, 500)
        }),
        userQuery: command,
        userId: 'code-mode',
        sessionId
      });

      logger.warn({
        event: 'CODE_EXECUTION_FAILURE',
        toolCallId: toolCall.id,
        toolName,
        errorMessage,
        statusCode: errorStatusCode,
        timestamp: new Date().toISOString()
      }, '[CODE-FEEDBACK] 📉 Code failure recorded for learning');
    } catch (feedbackError) {
      logger.debug({ error: feedbackError }, '[CODE-FEEDBACK] Error feedback failed (non-fatal)');
    }

    // Emit error event
    if (emitEvent) {
      emitEvent('code_execution_complete', {
        toolCallId: toolCall.id,
        toolName,
        executionTimeMs,
        success: false,
        error: errorMessage
      });
    }

    return {
      toolCallId: toolCall.id,
      toolName,
      result: {
        success: false,
        error: errorMessage,
        executionTimeMs
      },
      error: errorMessage,
      executionTimeMs
    };
  }
}

/**
 * Execute multiple code tool calls
 */
export async function executeCodeToolCalls(
  toolCalls: ToolCall[],
  sessionId: string,
  logger: Logger,
  emitEvent?: (event: string, data: any) => void
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const toolCall of toolCalls) {
    const result = await executeCodeToolCall(toolCall, sessionId, logger, emitEvent);
    results.push(result);
  }

  return results;
}

/**
 * Clean up an openagentic session
 */
export async function cleanupOpenagenticSession(
  sessionId: string,
  logger: Logger
): Promise<void> {
  try {
    await axios.delete(
      `${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}`,
      { timeout: 10000 }
    );

    logger.info({ sessionId }, '[CODE-EXEC] Cleaned up openagentic session');
  } catch (error) {
    logger.warn({
      sessionId,
      error
    }, '[CODE-EXEC] Failed to cleanup openagentic session (may already be stopped)');
  }
}

/**
 * Get workspace files from openagentic session
 */
export async function getWorkspaceFiles(
  sessionId: string,
  logger: Logger
): Promise<string[]> {
  try {
    const response = await axios.get(
      `${OPENAGENTIC_MANAGER_URL}/sessions/${sessionId}/files`,
      { timeout: 10000 }
    );

    return response.data?.files || [];
  } catch (error) {
    logger.warn({
      sessionId,
      error
    }, '[CODE-EXEC] Failed to list workspace files');
    return [];
  }
}
