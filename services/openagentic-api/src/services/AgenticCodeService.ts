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
 * Agentic Code Service
 * Handles the agentic coding loop for AI-assisted development
 *
 * This service provides:
 * - Session management for isolated coding slices (Landlock sandboxed)
 * - Agentic loop execution with file manipulation and shell commands
 * - Integration with OpenAgenticCode Runtime for slice lifecycle
 * - LLM-based code generation and modification
 * - Git operations and workspace management
 *
 * Updated for Landlock-based sandboxing (Option A architecture):
 * - Single runtime container with multiple user slices
 * - Slices use Landlock for filesystem isolation
 * - Slices use seccomp for syscall filtering
 */

import axios, { AxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';
import { ProviderManager } from './llm-providers/ProviderManager.js';
import { getGitHubCredentialService } from './GitHubCredentialService.js';

// SECURITY: Internal API key for code-manager authentication
// SECURITY: Internal API key required for code-manager authentication
const CODE_MANAGER_INTERNAL_KEY = process.env.CODE_MANAGER_INTERNAL_KEY;
if (!CODE_MANAGER_INTERNAL_KEY) {
  console.warn('[AgenticCodeService] WARNING: CODE_MANAGER_INTERNAL_KEY not set - code manager auth disabled');
}

/**
 * Code session interface
 */
interface CodeSession {
  id: string;
  userId: string;
  sliceId: string;  // Changed from containerId - now using Landlock slices
  model: string;
  workspacePath: string;
  securityLevel: 'strict' | 'permissive' | 'minimal';
  networkEnabled: boolean;
  createdAt: Date;
  lastActivity: Date;
}

/**
 * Agentic event types for streaming updates
 */
interface AgenticEvent {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'file_change' | 'error' | 'done';
  content?: string;
  tool?: string;
  toolId?: string;  // Tool call ID for UI matching
  params?: any;
  result?: any;
  path?: string;
}

/**
 * Tool definition interface
 */
interface AgenticTool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any, session: CodeSession) => Promise<any>;
}

/**
 * AgenticCodeService
 *
 * Manages code sessions and executes agentic coding loops
 */
export class AgenticCodeService {
  private logger: Logger;
  private runtimeUrl: string;  // Changed from managerUrl
  private providerManager: ProviderManager;
  private defaultModel: string;
  private defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
  private defaultNetworkEnabled: boolean;

  /**
   * Create axios config with internal authentication
   * SECURITY: All requests to code-manager must include the internal API key
   */
  private createInternalAuthConfig(timeout = 10000): AxiosRequestConfig {
    const config: AxiosRequestConfig = { timeout };
    if (CODE_MANAGER_INTERNAL_KEY) {
      config.headers = {
        'X-Internal-API-Key': CODE_MANAGER_INTERNAL_KEY,
      };
    }
    return config;
  }

  constructor(
    logger: Logger,
    providerManager: ProviderManager,
    config?: {
      managerUrl?: string;  // Kept for backwards compatibility
      runtimeUrl?: string;
      defaultModel?: string;
      defaultSecurityLevel?: 'strict' | 'permissive' | 'minimal';
      defaultNetworkEnabled?: boolean;
    }
  ) {
    this.logger = logger;
    this.providerManager = providerManager;
    // Use runtimeUrl if provided, fall back to managerUrl for backwards compatibility
    this.runtimeUrl = config?.runtimeUrl || config?.managerUrl ||
      process.env.CODE_RUNTIME_URL || process.env.CODE_MANAGER_URL ||
      'http://openagentic-manager:3050';  // BUG-002 fix: correct hostname
    // Note: defaultModel is now fetched from database in getAWCodeSettings()
    // This is just a fallback if database is unavailable - uses env vars only, no hardcoding
    this.defaultModel = config?.defaultModel || process.env.DEFAULT_CODE_MODEL || process.env.DEFAULT_MODEL || '';
    this.defaultSecurityLevel = config?.defaultSecurityLevel ||
      (process.env.DEFAULT_SECURITY_LEVEL as any) || 'permissive';
    this.defaultNetworkEnabled = config?.defaultNetworkEnabled ??
      (process.env.DEFAULT_NETWORK_ENABLED === 'true');
  }

  /**
   * Get AWCode settings from the database
   * Settings are stored in SystemConfiguration with 'awcode.' prefix
   */
  private async getAWCodeSettings(): Promise<{
    defaultModel: string;
    defaultSecurityLevel: 'strict' | 'permissive' | 'minimal';
    defaultNetworkEnabled: boolean;
    maxSessionsPerUser: number;
    storageQuotaEnabled: boolean;
    defaultStorageLimitMb: number;
    cliBackend: 'openagentic-cli' | 'claude-code';
  }> {
    try {
      const settings = await prisma.systemConfiguration.findMany({
        where: {
          key: {
            startsWith: 'awcode.',
          },
        },
      });

      // Build settings map
      const settingsMap: Record<string, any> = {};
      for (const setting of settings) {
        const key = setting.key.replace('awcode.', '');
        const val = setting.value;
        if (typeof val === 'string') {
          try {
            settingsMap[key] = JSON.parse(val);
          } catch {
            settingsMap[key] = val;
          }
        } else {
          settingsMap[key] = val;
        }
      }

      // Use the configured model from database, or fall back to env var default
      // No validation here - the openagentic config endpoint handles model availability
      return {
        defaultModel: settingsMap.defaultModel || this.defaultModel,
        defaultSecurityLevel: settingsMap.defaultSecurityLevel || this.defaultSecurityLevel,
        defaultNetworkEnabled: settingsMap.defaultNetworkEnabled ?? this.defaultNetworkEnabled,
        maxSessionsPerUser: settingsMap.maxSessionsPerUser || 3,
        storageQuotaEnabled: settingsMap.storageQuotaEnabled ?? true,
        defaultStorageLimitMb: settingsMap.defaultStorageLimitMb || 5120, // 5GB default
        cliBackend: settingsMap.cliBackend || 'claude-code',
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to fetch AWCode settings from database, using defaults');
      return {
        defaultModel: this.defaultModel,
        defaultSecurityLevel: this.defaultSecurityLevel,
        defaultNetworkEnabled: this.defaultNetworkEnabled,
        maxSessionsPerUser: 3,
        storageQuotaEnabled: true,
        defaultStorageLimitMb: 5120, // 5GB default
        cliBackend: 'claude-code',
      };
    }
  }

  /**
   * Get or create a code session for a user
   *
   * This method ensures users always connect to their existing session/container:
   * 1. Check Postgres for existing active session
   * 2. If found, verify it's still valid with the manager
   * 3. Return existing session if valid
   * 4. Only create new session if none exists or existing is invalid
   *
   * This guarantees consistent session management - users ALWAYS connect to
   * their exact container every time they open Code Mode.
   */
  async createSession(
    userId: string,
    model?: string,
    options?: {
      securityLevel?: 'strict' | 'permissive' | 'minimal';
      networkEnabled?: boolean;
      apiKey?: string;  // API key for managed mode (routes LLM calls through OpenAgentic API)
      userEmail?: string;  // User's email for Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
    }
  ): Promise<CodeSession> {
    this.logger.info({ userId, model, options: { ...options, apiKey: options?.apiKey ? '[redacted]' : undefined } }, 'Getting or creating code session');

    // Fetch settings from database (includes admin-configured defaults)
    const dbSettings = await this.getAWCodeSettings();

    // Use provided values, fall back to database settings
    const securityLevel = options?.securityLevel || dbSettings.defaultSecurityLevel;
    const networkEnabled = options?.networkEnabled ?? dbSettings.defaultNetworkEnabled;
    const effectiveModel = model || dbSettings.defaultModel;

    // Storage limit (only if quota enforcement is enabled)
    const storageLimitMb = dbSettings.storageQuotaEnabled ? dbSettings.defaultStorageLimitMb : undefined;

    // CLI backend from admin settings (openagentic-cli or claude-code)
    const cliBackend = dbSettings.cliBackend || 'openagentic-cli';

    this.logger.info({
      userId,
      model: effectiveModel,
      securityLevel,
      networkEnabled,
      storageLimitMb,
      source: model ? 'user' : 'database'
    }, 'Using session configuration');

    try {
      // STEP 1: Check for existing active session in Postgres
      const existingDbSession = await prisma.codeSession.findFirst({
        where: {
          user_id: userId,
          status: 'active'
        },
        orderBy: {
          last_activity: 'desc'
        }
      });

      if (existingDbSession) {
        this.logger.info({
          sessionId: existingDbSession.id,
          sliceId: existingDbSession.slice_id,
          userId
        }, 'Found existing active session in database');

        // STEP 2: Verify session is still valid with the manager
        try {
          const verifyResponse = await axios.get(
            `${this.runtimeUrl}/sessions/${existingDbSession.slice_id || existingDbSession.id}`,
            this.createInternalAuthConfig()
          );

          if (verifyResponse.data && verifyResponse.data.status === 'running') {
            // Session is valid and running - trigger token refresh via manager
            // CRITICAL: Always call POST /sessions so manager can refresh the CLI's JWT.
            // Without this, the CLI keeps an expired token and all LLM calls fail.
            this.logger.info({
              sessionId: existingDbSession.id,
              sliceId: existingDbSession.slice_id
            }, 'Existing session verified as running, refreshing token');

            try {
              // Fetch user's GitHub token for reconnect (may have connected after pod creation)
              let reconnectGithubToken: string | undefined;
              try {
                const ghService = getGitHubCredentialService(this.logger);
                const token = await ghService.getValidTokenString(userId);
                if (token) reconnectGithubToken = token;
              } catch { /* non-fatal */ }

              await axios.post(
                `${this.runtimeUrl}/sessions`,
                {
                  userId: existingDbSession.user_id,
                  userEmail: options?.userEmail,
                  model: effectiveModel,
                  apiKey: options?.apiKey,
                  cliBackend,
                  githubToken: reconnectGithubToken,
                },
                this.createInternalAuthConfig()
              );
              this.logger.info({ sessionId: existingDbSession.id }, 'Token refresh triggered via manager');
            } catch (refreshErr: any) {
              this.logger.warn({ error: refreshErr.message }, 'Token refresh via manager failed (non-fatal)');
            }

            // Update last activity
            await prisma.codeSession.update({
              where: { id: existingDbSession.id },
              data: { last_activity: new Date() }
            });

            return {
              id: existingDbSession.id,
              userId: existingDbSession.user_id,
              sliceId: existingDbSession.slice_id || existingDbSession.container_id || '',
              model: existingDbSession.model,
              workspacePath: existingDbSession.workspace_path,
              securityLevel: (existingDbSession.security_level as any) || securityLevel,
              networkEnabled: existingDbSession.network_enabled || networkEnabled,
              createdAt: existingDbSession.created_at,
              lastActivity: new Date()
            };
          }
        } catch (verifyError: any) {
          // Session not found in manager or error - mark as stale
          this.logger.warn({
            sessionId: existingDbSession.id,
            error: verifyError.message
          }, 'Existing session not valid in manager, marking as stale');

          await prisma.codeSession.update({
            where: { id: existingDbSession.id },
            data: { status: 'stale' }
          });
        }
      }

      // Fetch user's GitHub token (if connected via Device Flow OAuth)
      let githubToken: string | undefined;
      try {
        const ghService = getGitHubCredentialService(this.logger);
        const token = await ghService.getValidTokenString(userId);
        if (token) {
          githubToken = token;
          this.logger.info({ userId }, 'Found user GitHub token for code session');
        }
      } catch (err: any) {
        this.logger.warn({ userId, error: err.message }, 'Failed to fetch GitHub token (non-fatal)');
      }

      // STEP 3: Request session from openagentic-manager service
      // Manager will return existing session if pod exists, or create new one
      const response = await axios.post(
        `${this.runtimeUrl}/sessions`,
        {
          userId,
          userEmail: options?.userEmail,  // For Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
          model: effectiveModel,
          apiKey: options?.apiKey,
          storageLimitMb,
          cliBackend,  // CLI backend: 'openagentic-cli' or 'claude-code'
          githubToken,  // Per-user GitHub token from Device Flow OAuth
        },
        this.createInternalAuthConfig()
      );

      // Manager returns: { sessionId, status: 'existing' | 'created', session: { ... } }
      const managerStatus = response.data.status; // 'existing' or 'created'
      const managerSessionId = response.data.sessionId;
      const sessionData = response.data.session || response.data;

      this.logger.info({
        managerStatus,
        managerSessionId,
        userId
      }, 'Manager session response');

      // STEP 4: Handle based on manager response
      if (managerStatus === 'existing') {
        // Manager found existing running session - check if we have a matching DB record
        const existingForSlice = await prisma.codeSession.findFirst({
          where: {
            user_id: userId,
            slice_id: managerSessionId,
            status: 'active'
          }
        });

        if (existingForSlice) {
          // Update and return existing record
          await prisma.codeSession.update({
            where: { id: existingForSlice.id },
            data: { last_activity: new Date() }
          });

          this.logger.info({
            sessionId: existingForSlice.id,
            sliceId: managerSessionId
          }, 'Returning existing session (manager confirmed)');

          return {
            id: existingForSlice.id,
            userId: existingForSlice.user_id,
            sliceId: managerSessionId,
            model: existingForSlice.model,
            workspacePath: existingForSlice.workspace_path,
            securityLevel: (existingForSlice.security_level as any) || securityLevel,
            networkEnabled: existingForSlice.network_enabled || networkEnabled,
            createdAt: existingForSlice.created_at,
            lastActivity: new Date()
          };
        }

        // Manager has session but we don't have DB record - create one
        this.logger.info({ managerSessionId, userId }, 'Creating DB record for existing manager session');
      }

      // STEP 5: Create new database record
      // Use manager's sessionId as the primary ID for consistency
      const newSessionId = managerSessionId || uuidv4();

      const session: CodeSession = {
        id: newSessionId,
        userId,
        sliceId: managerSessionId || sessionData.id,
        model: sessionData.model || effectiveModel,
        workspacePath: sessionData.workspacePath || `/workspaces/${userId}`,
        securityLevel,
        networkEnabled,
        createdAt: new Date(),
        lastActivity: new Date()
      };

      // Use upsert to handle race conditions
      await prisma.codeSession.upsert({
        where: { id: session.id },
        create: {
          id: session.id,
          user_id: session.userId,
          slice_id: session.sliceId,
          container_id: null,
          model: session.model,
          workspace_path: session.workspacePath,
          security_level: session.securityLevel,
          network_enabled: session.networkEnabled,
          created_at: session.createdAt,
          last_activity: session.lastActivity,
          status: 'active'
        },
        update: {
          last_activity: session.lastActivity,
          status: 'active'
        }
      });

      this.logger.info({
        sessionId: session.id,
        sliceId: session.sliceId,
        status: managerStatus
      }, 'Code session ready');

      return session;

    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to create code session');
      throw new Error('Failed to create code session');
    }
  }

  /**
   * Get an existing session by sessionId
   */
  async getSession(sessionId: string, userId: string): Promise<CodeSession | null> {
    try {
      const result = await prisma.codeSession.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
          status: 'active'
        }
      });

      if (!result) return null;

      return {
        id: result.id,
        userId: result.user_id,
        sliceId: result.slice_id || result.container_id || '',
        model: result.model,
        workspacePath: result.workspace_path,
        securityLevel: (result.security_level as any) || 'permissive',
        networkEnabled: result.network_enabled || false,
        createdAt: result.created_at,
        lastActivity: result.last_activity
      };
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to get session');
      return null;
    }
  }

  /**
   * Get user's active session (by userId only)
   * This is the primary method for connecting users to their container
   */
  async getUserActiveSession(userId: string): Promise<CodeSession | null> {
    try {
      const result = await prisma.codeSession.findFirst({
        where: {
          user_id: userId,
          status: 'active'
        },
        orderBy: {
          last_activity: 'desc'
        }
      });

      if (!result) return null;

      // Verify session is still valid with manager
      try {
        const verifyResponse = await axios.get(
          `${this.runtimeUrl}/sessions/${result.slice_id || result.id}`,
          this.createInternalAuthConfig()
        );

        if (verifyResponse.data && verifyResponse.data.status === 'running') {
          return {
            id: result.id,
            userId: result.user_id,
            sliceId: result.slice_id || result.container_id || '',
            model: result.model,
            workspacePath: result.workspace_path,
            securityLevel: (result.security_level as any) || 'permissive',
            networkEnabled: result.network_enabled || false,
            createdAt: result.created_at,
            lastActivity: result.last_activity
          };
        }
      } catch {
        // Session not running in manager
        this.logger.warn({ sessionId: result.id, userId }, 'Session not running in manager');
      }

      return null;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to get user active session');
      return null;
    }
  }

  /**
   * Cleanup stale sessions for a user
   * Marks sessions as 'stale' if they're no longer valid in the manager
   */
  async cleanupStaleSessions(userId: string): Promise<number> {
    try {
      const sessions = await prisma.codeSession.findMany({
        where: {
          user_id: userId,
          status: 'active'
        }
      });

      let cleanedCount = 0;

      for (const session of sessions) {
        try {
          const response = await axios.get(
            `${this.runtimeUrl}/sessions/${session.slice_id || session.id}`,
            this.createInternalAuthConfig()
          );

          if (!response.data || response.data.status !== 'running') {
            await prisma.codeSession.update({
              where: { id: session.id },
              data: { status: 'stale' }
            });
            cleanedCount++;
          }
        } catch {
          // Session not found in manager
          await prisma.codeSession.update({
            where: { id: session.id },
            data: { status: 'stale' }
          });
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        this.logger.info({ userId, cleanedCount }, 'Cleaned up stale sessions');
      }

      return cleanedCount;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to cleanup stale sessions');
      return 0;
    }
  }

  /**
   * Delete a session and cleanup slice
   */
  async deleteSession(sessionId: string, userId: string, options?: { createSnapshot?: boolean }): Promise<void> {
    this.logger.info({ sessionId, userId }, 'Deleting code session');

    try {
      const session = await this.getSession(sessionId, userId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Remove slice from runtime
      // SECURITY: Include internal API key for authentication
      const snapshotParam = options?.createSnapshot !== false ? '?snapshot=true' : '?snapshot=false';
      await axios.delete(`${this.runtimeUrl}/slices/${session.sliceId}${snapshotParam}`, this.createInternalAuthConfig());

      // Mark session as deleted in database
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: {
          status: 'deleted',
          last_activity: new Date()
        }
      });

      this.logger.info({ sessionId, sliceId: session.sliceId }, 'Code session deleted');
    } catch (error) {
      this.logger.error({ error, sessionId, userId }, 'Failed to delete session');
      throw error;
    }
  }

  /**
   * Execute agentic loop
   *
   * This is the core agentic coding loop that:
   * 1. Takes user prompt
   * 2. Calls LLM with tools
   * 3. Executes tool calls
   * 4. Continues until task is complete
   */
  async executeAgentLoop(
    sessionId: string,
    userId: string,
    prompt: string,
    model: string | undefined,
    onEvent: (event: AgenticEvent) => void
  ): Promise<void> {
    this.logger.info({ sessionId, userId, prompt: prompt.substring(0, 100) }, 'Starting agentic loop');

    const session = await this.getSession(sessionId, userId);
    if (!session) {
      throw new Error('Session not found');
    }

    const activeModel = model || session.model;

    // Build system prompt (fetches from database if configured)
    const systemPrompt = await this.buildSystemPrompt();

    // Define available tools
    const tools = this.getAgenticTools(session);

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 50;

    try {
      while (iterations < MAX_ITERATIONS) {
        iterations++;

        this.logger.debug({ iteration: iterations, sessionId }, 'Agentic loop iteration');

        // Call LLM via ProviderManager
        const response = await this.providerManager.createCompletion({
          messages,
          model: activeModel,
          tools: tools.map(t => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }
          })),
          stream: false
        }) as any;

        // Stream text content
        if (response.choices?.[0]?.message?.content) {
          onEvent({
            type: 'text',
            content: response.choices[0].message.content
          });
        }

        // Check if done
        const finishReason = response.choices?.[0]?.finish_reason;
        const toolCalls = response.choices?.[0]?.message?.tool_calls;

        if (finishReason === 'stop' || !toolCalls?.length) {
          this.logger.debug({ finishReason, iterations }, 'Agentic loop complete');
          break;
        }

        // Execute tool calls
        const toolResults = [];
        for (const toolCall of toolCalls) {
          const tool = tools.find(t => t.name === toolCall.function.name);
          if (!tool) {
            this.logger.warn({ toolName: toolCall.function.name }, 'Unknown tool requested');
            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: `Unknown tool: ${toolCall.function.name}`
            });
            continue;
          }

          const params = JSON.parse(toolCall.function.arguments);

          onEvent({
            type: 'tool_call',
            tool: toolCall.function.name,
            toolId: toolCall.id,  // Include tool ID for UI matching
            params
          });

          try {
            const result = await tool.execute(params, session);

            onEvent({
              type: 'tool_result',
              tool: toolCall.function.name,
              toolId: toolCall.id,  // Include tool ID for UI matching
              result
            });

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: typeof result === 'string' ? result : JSON.stringify(result)
            });

          } catch (error: any) {
            this.logger.error({ error, tool: toolCall.function.name }, 'Tool execution failed');

            onEvent({
              type: 'error',
              content: `Tool ${toolCall.function.name} failed: ${error.message}`
            });

            toolResults.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              content: `Error: ${error.message}`
            });
          }
        }

        // Add assistant message and tool results to conversation
        messages.push({
          role: 'assistant',
          content: response.choices[0].message.content || '',
          tool_calls: toolCalls
        });

        // Add tool results
        for (const toolResult of toolResults) {
          messages.push(toolResult);
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        this.logger.warn({ sessionId, iterations }, 'Agentic loop reached max iterations');
        onEvent({
          type: 'error',
          content: 'Maximum iterations reached. Task may be incomplete.'
        });
      }

      // Update session activity
      await prisma.codeSession.update({
        where: { id: sessionId },
        data: { last_activity: new Date() }
      });

    } catch (error) {
      this.logger.error({ error, sessionId }, 'Agentic loop failed');
      throw error;
    }
  }

  // Default system prompt (fallback if not configured in database)
  private static readonly DEFAULT_SYSTEM_PROMPT = `You are OpenAgentic, an autonomous coding agent running in a sandboxed Linux workspace.
You have a persistent filesystem, bash shell, and full tool access.

EXECUTION MODEL:
- Execute actions directly using your tools. Do NOT suggest commands — run them yourself.
- Do NOT ask permission to read files. Just read them.
- Do NOT describe what you would do. DO it.
- When given a multi-step task, create a task list with TodoWrite and work through it step by step.
- Show your thinking briefly, then act. Minimize narration between tool calls.

AVAILABLE TOOLS:
- Read: read file contents (use instead of cat/head/tail)
- Write: create or replace files (use instead of echo/cat heredoc)
- Edit: surgical edits to existing files (use instead of sed/awk)
- Bash: execute shell commands — npm, pip, python, go, cargo, kubectl, git, etc.
- Glob: find files by pattern (use instead of find/ls)
- Grep: search file contents (use instead of grep/rg)
- TodoWrite: create/update visible task progress list — use proactively for multi-step tasks

TOOL PREFERENCES:
- Prefer Read/Write/Edit/Grep/Glob over their bash equivalents
- Reserve Bash for: running scripts, installing packages, builds, git, tests, deploys
- When modifying files, use Edit for small changes, Write for full rewrites

WORKSPACE:
- Persistent Linux workspace assigned to you
- Languages: Python, Node.js, Go, Rust, Bash, PowerShell
- Package managers: pip, npm, cargo, brew
- Cloud CLIs: aws, gcloud, az, kubectl, helm, terraform
- Tools: git, ripgrep, jq, yq, gh (GitHub CLI)
- Install packages freely: brew install, pip install, npm install, cargo install

TASK TRACKING:
- For tasks with 3+ steps, create a TodoWrite task list BEFORE starting
- Update each task to in_progress when you start it, completed when done
- Only have ONE task in_progress at a time
- The task list is visible to the user above the input — keep it updated

SECURITY:
- Workspace is isolated from other users
- All actions are logged and auditable
- Do not store secrets in plain text files`;

  /**
   * Build system prompt for agentic coding
   * Fetches configurable prompt from database, falls back to default
   */
  private async buildSystemPrompt(): Promise<string> {
    try {
      const config = await prisma.systemConfiguration.findUnique({
        where: { key: 'codemode.system_prompt' },
      });

      if (config?.value && typeof config.value === 'string') {
        this.logger.debug('Using custom system prompt from database');
        return config.value;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Failed to fetch system prompt from database, using default');
    }

    return AgenticCodeService.DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * Get available agentic tools
   */
  private getAgenticTools(session: CodeSession): AgenticTool[] {
    return [
      {
        name: 'file_read',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file relative to workspace root' }
          },
          required: ['path']
        },
        execute: async (params: { path: string }, session: CodeSession) => {
          return this.execInContainer(session, `cat "${params.path}"`);
        }
      },
      {
        name: 'file_write',
        description: 'Write content to a file (creates or overwrites)',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' }
          },
          required: ['path', 'content']
        },
        execute: async (params: { path: string; content: string }, session: CodeSession) => {
          // Ensure directory exists
          const dir = params.path.split('/').slice(0, -1).join('/');
          if (dir) {
            await this.execInContainer(session, `mkdir -p "${dir}"`);
          }
          // Write file using base64 encoding to prevent heredoc injection
          const encoded = Buffer.from(params.content).toString('base64');
          await this.execInContainer(
            session,
            `echo '${encoded}' | base64 -d > "${params.path.replace(/"/g, '\\"')}"`
          );
          return `File written: ${params.path}`;
        }
      },
      {
        name: 'file_patch',
        description: 'Apply a surgical edit to a file by replacing specific text',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            search: { type: 'string', description: 'Exact text to find (must be unique in file)' },
            replace: { type: 'string', description: 'Text to replace with' }
          },
          required: ['path', 'search', 'replace']
        },
        execute: async (params: { path: string; search: string; replace: string }, session: CodeSession) => {
          // Read current content
          const content = await this.execInContainer(session, `cat "${params.path}"`);

          // Check if search text exists and is unique
          const occurrences = content.split(params.search).length - 1;
          if (occurrences === 0) {
            throw new Error('Search text not found in file');
          }
          if (occurrences > 1) {
            throw new Error(`Search text found ${occurrences} times, must be unique`);
          }

          // Apply patch
          const newContent = content.replace(params.search, params.replace);
          await this.execInContainer(
            session,
            `cat > "${params.path}" << 'AGENTICEOF'\n${newContent}\nAGENTICEOF`
          );
          return `File patched: ${params.path}`;
        }
      },
      {
        name: 'file_delete',
        description: 'Delete a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' }
          },
          required: ['path']
        },
        execute: async (params: { path: string }, session: CodeSession) => {
          await this.execInContainer(session, `rm -f "${params.path}"`);
          return `File deleted: ${params.path}`;
        }
      },
      {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default: current directory)' },
            recursive: { type: 'boolean', description: 'List recursively' }
          }
        },
        execute: async (params: { path?: string; recursive?: boolean }, session: CodeSession) => {
          const path = params.path || '.';
          const cmd = params.recursive
            ? `find "${path}" -type f | head -100`
            : `ls -la "${path}"`;
          return this.execInContainer(session, cmd);
        }
      },
      {
        name: 'shell_exec',
        description: 'Execute a shell command in the workspace',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            workDir: { type: 'string', description: 'Working directory (optional)' }
          },
          required: ['command']
        },
        execute: async (params: { command: string; workDir?: string }, session: CodeSession) => {
          return this.execInContainer(session, params.command, params.workDir);
        }
      },
      {
        name: 'git_status',
        description: 'Get git status of the workspace',
        parameters: { type: 'object', properties: {} },
        execute: async (_params: any, session: CodeSession) => {
          return this.execInContainer(session, 'git status');
        }
      },
      {
        name: 'git_diff',
        description: 'Show git diff of changes',
        parameters: {
          type: 'object',
          properties: {
            staged: { type: 'boolean', description: 'Show staged changes only' }
          }
        },
        execute: async (params: { staged?: boolean }, session: CodeSession) => {
          const cmd = params.staged ? 'git diff --staged' : 'git diff';
          return this.execInContainer(session, cmd);
        }
      },
      {
        name: 'git_commit',
        description: 'Stage all changes and commit',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['message']
        },
        execute: async (params: { message: string }, session: CodeSession) => {
          await this.execInContainer(session, 'git add -A');
          // SECURITY: Use base64 encoding to prevent shell metacharacter injection in commit messages
          const encodedMsg = Buffer.from(params.message).toString('base64');
          return this.execInContainer(session, `echo '${encodedMsg}' | base64 -d | git commit -F -`);
        }
      },
      {
        name: 'search_code',
        description: 'Search for text/patterns in the codebase',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern (regex supported)' },
            path: { type: 'string', description: 'Path to search in (default: .)' }
          },
          required: ['pattern']
        },
        execute: async (params: { pattern: string; path?: string }, session: CodeSession) => {
          const searchPath = (params.path || '.').replace(/"/g, '');
          // SECURITY: Use base64 + grep -f to prevent shell injection via pattern
          const encodedPattern = Buffer.from(params.pattern).toString('base64');
          return this.execInContainer(
            session,
            `echo '${encodedPattern}' | base64 -d | grep -rnf - "${searchPath}" | head -50`
          );
        }
      }
    ];
  }

  /**
   * Execute command in sandboxed slice
   */
  private async execInSlice(
    session: CodeSession,
    command: string,
    workDir?: string
  ): Promise<string> {
    try {
      // SECURITY: Include internal API key for authentication
      const config = this.createInternalAuthConfig(35000);
      const response = await axios.post(
        `${this.runtimeUrl}/slices/${session.sliceId}/exec`,
        { command, workDir, timeout: 30000 },
        config
      );

      if (response.data.exitCode !== 0 && response.data.stderr) {
        throw new Error(response.data.stderr);
      }

      return response.data.stdout || response.data.stderr || '';
    } catch (error: any) {
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      }
      throw error;
    }
  }

  /**
   * @deprecated Use execInSlice instead
   */
  private async execInContainer(
    session: CodeSession,
    command: string,
    workDir?: string
  ): Promise<string> {
    return this.execInSlice(session, command, workDir);
  }

  /**
   * List files in workspace
   */
  async listFiles(sessionId: string, userId: string, path: string): Promise<any[]> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const output = await this.execInContainer(
      session,
      `find "${path}" -maxdepth 1 -printf '%y %s %f\\n' | tail -n +2`
    );

    return output.split('\n').filter(Boolean).map(line => {
      const [type, size, name] = line.split(' ');
      return {
        name,
        type: type === 'd' ? 'directory' : 'file',
        size: parseInt(size)
      };
    });
  }

  /**
   * Read file from workspace
   */
  async readFile(sessionId: string, userId: string, path: string): Promise<string> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');
    return this.execInContainer(session, `cat "${path}"`);
  }

  /**
   * Write file to workspace
   */
  async writeFile(sessionId: string, userId: string, path: string, content: string): Promise<void> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) {
      await this.execInContainer(session, `mkdir -p "${dir}"`);
    }
    // SECURITY: Use base64 encoding to prevent heredoc injection
    const encoded = Buffer.from(content).toString('base64');
    await this.execInContainer(session, `echo '${encoded}' | base64 -d > "${path.replace(/"/g, '\\"')}"`);
  }

  /**
   * Delete file from workspace
   */
  async deleteFile(sessionId: string, userId: string, path: string): Promise<void> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');
    // SECURITY: Use rm -f (not -rf) to prevent recursive deletion; validate path is within workspace
    const sanitizedPath = path.replace(/"/g, '').replace(/\.\./g, '');
    await this.execInContainer(session, `rm -f "${sanitizedPath}"`);
  }
}
