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
 * Session Manager
 * Manages AWCode CLI processes with real PTY terminals
 */

import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import pidusage from 'pidusage';
import { Config } from './config';
import type { UserSession, SessionStatus } from './types';
import { getExecContainerClient, ExecContainerClient } from './execContainerClient';
import { getK8sSessionManager, K8sSessionManager, K8sSession } from './k8sSessionManager';
import {
  OutputMessageParser
} from './persistenceClient';
import {
  saveSession,
  updateSessionStatus,
  saveMessage,
  saveTerminalOutput,
} from './storageClient';
import {
  metricsService,
  EnhancedProcessMetrics,
  TokenUsage,
  StorageUsage,
  SessionMetrics,
} from './metricsService';
import {
  getWorkspaceStorageService,
  WorkspaceStorageService,
  FileChangeEvent,
} from './workspaceStorageService';
import {
  createSandboxUser,
  deleteSandboxUser,
  getSandboxEnv,
  initializeSandbox,
  canCreateUsers,
  SandboxUser,
} from './userSandbox';
import { getUlimitPrefix, checkCommand } from './securityPolicy';
import { loggers } from './logger.js';

// Process metrics interface (legacy - kept for backwards compatibility)
export interface ProcessMetrics {
  cpu: number;      // CPU usage percentage
  memory: number;   // Memory usage in bytes
  memoryMB: number; // Memory usage in MB (for display)
  elapsed: number;  // Process elapsed time in ms
}

// Enhanced session metrics
export interface EnhancedSessionMetrics extends ProcessMetrics {
  networkRx: number;
  networkTx: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  tokenUsage: TokenUsage;
  storageUsage: StorageUsage | null;
}

// Max lines to keep in output buffer per session
const MAX_OUTPUT_LINES = 100;

/**
 * OPENAGENTIC.md template - provides context to the LLM at session start
 * Similar to .cursorrules, .github/copilot-instructions.md
 */
function generateOpenagenticMd(userId: string, workspacePath: string): string {
  return `# OPENAGENTIC.md - Workspace Context

Edit this file to customize how OpenAgentic assists you.
Changes take effect on your next message.

## Workspace

- **User**: ${userId}
- **Path**: ${workspacePath}
- **Created**: ${new Date().toISOString()}

## Project Overview

<!-- Describe your project here — the AI reads this before every response -->

## Code Conventions

<!-- Your preferences: language, framework, style, testing approach -->

## Custom Instructions

<!-- Anything specific: "always use TypeScript strict mode", "prefer functional style", etc. -->

---
*This file is read by OpenAgentic before each response. Edit it anytime.*
`;
}

/**
 * Ensure OPENAGENTIC.md exists in the workspace
 * Creates it with default template if it doesn't exist
 */
async function ensureOpenagenticMd(workspacePath: string, userId: string): Promise<void> {
  const openagenticPath = join(workspacePath, 'OPENAGENTIC.md');

  if (!existsSync(openagenticPath)) {
    const content = generateOpenagenticMd(userId, workspacePath);
    await writeFile(openagenticPath, content, 'utf-8');
    loggers.sessions.info({ workspacePath }, "Created OPENAGENTIC.md");
  } else {
    loggers.sessions.debug({ workspacePath }, "OPENAGENTIC.md already exists");
  }
}

/**
 * Check workspace size and enforce 5GB limit
 */
async function getWorkspaceSize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const { execSync } = await import('child_process');
    // Use du for efficient directory size calculation
    const output = execSync(`du -sb "${dirPath}" 2>/dev/null || echo "0"`, { encoding: 'utf-8' });
    const size = parseInt(output.split('\t')[0], 10);
    return isNaN(size) ? 0 : size;
  } catch {
    return 0; // Return 0 if we can't determine size
  }
}

export class SessionManager {
  private config: Config;
  private sessions: Map<string, UserSession> = new Map();
  private ptys: Map<string, pty.IPty> = new Map();
  private userToSessions: Map<string, Set<string>> = new Map();
  // Output buffers for admin monitoring (last N lines per session)
  private outputBuffers: Map<string, string[]> = new Map();
  // Current activity indicator per session
  private currentActivity: Map<string, string> = new Map();
  // Message parsers for database persistence
  private messageParsers: Map<string, OutputMessageParser> = new Map();
  // Cloud-first workspace storage service
  private workspaceService: WorkspaceStorageService;
  // Sandbox users per session (for security isolation)
  private sandboxUsers: Map<string, SandboxUser> = new Map();
  // Whether sandboxing is enabled (requires root or CAP_SETUID)
  private sandboxEnabled: boolean = false;
  // Exec container client for remote execution mode
  private execClient: ExecContainerClient | null = null;
  // Kubernetes session manager for K8s mode
  private k8sManager: K8sSessionManager | null = null;
  // Track which sessions are running remotely in exec container or K8s
  private remoteSessions: Set<string> = new Set();

  constructor(config: Config) {
    this.config = config;
    this.workspaceService = getWorkspaceStorageService(config.workspacesPath);
    // Initialize exec container client if in exec-container mode
    if (config.executionMode === 'exec-container') {
      this.execClient = getExecContainerClient();
      loggers.sessions.info({ url: config.execContainer.url }, "Exec container mode enabled");
    }
    // Initialize K8s session manager if in kubernetes mode
    if (config.executionMode === 'kubernetes') {
      this.k8sManager = getK8sSessionManager();
      loggers.sessions.info({ namespace: config.k8s.namespace }, "Kubernetes mode enabled");
    }
  }

  /**
   * Check if running in exec container mode
   */
  private isExecContainerMode(): boolean {
    return this.config.executionMode === 'exec-container' && this.execClient !== null;
  }

  /**
   * Check if running in kubernetes mode
   */
  private isKubernetesMode(): boolean {
    return this.config.executionMode === 'kubernetes' && this.k8sManager !== null;
  }

  /**
   * Initialize the session manager (must be called before creating sessions)
   */
  async initialize(): Promise<void> {
    await this.workspaceService.initialize();

    // Initialize user sandboxing (only for local mode)
    if (this.config.executionMode === 'local') {
      this.sandboxEnabled = await initializeSandbox();
      if (this.sandboxEnabled) {
        loggers.sessions.info('User sandboxing ENABLED - each session runs as isolated user');
      } else {
        loggers.sessions.warn('User sandboxing DISABLED - sessions share node user');
        loggers.sessions.warn('To enable: run container with --privileged or add CAP_SETUID,CAP_SETGID');
      }
    }

    // Sync with K8s cluster on startup (recover existing pods)
    if (this.k8sManager) {
      try {
        await this.k8sManager.syncWithCluster();
        // Recover local session records from K8s pods
        const k8sSessions = await this.k8sManager.listSessions();
        for (const k8sSession of k8sSessions) {
          if (!this.sessions.has(k8sSession.sessionId)) {
            const session: UserSession = {
              id: k8sSession.sessionId,
              userId: k8sSession.userId,
              pid: 0,
              workspacePath: k8sSession.workspacePath,
              model: this.config.defaultModel,
              createdAt: new Date(k8sSession.createdAt),
              lastActivity: new Date(k8sSession.lastActivity),
              status: k8sSession.status === 'running' ? 'running' : 'stopped',
            };
            this.sessions.set(k8sSession.sessionId, session);
            this.remoteSessions.add(k8sSession.sessionId);
            if (!this.userToSessions.has(k8sSession.userId)) {
              this.userToSessions.set(k8sSession.userId, new Set());
            }
            this.userToSessions.get(k8sSession.userId)!.add(k8sSession.sessionId);
          }
        }
      } catch (err) {
        loggers.sessions.error({ err }, 'Failed to sync with K8s cluster');
      }
    }

    loggers.sessions.info('Initialized with cloud-first workspace storage');
  }

  /**
   * Register an existing K8s session with sessionManager (without creating a new pod)
   * This is used when k8sManager.getOrCreateSession is called directly
   * @param k8sSession - The K8s session to register
   */
  registerK8sSession(k8sSession: K8sSession): UserSession {
    // Check if already registered
    const existing = this.sessions.get(k8sSession.sessionId);
    if (existing) {
      // Update lastActivity and status on reconnect to prevent idle cleanup
      existing.lastActivity = new Date(k8sSession.lastActivity);
      existing.status = k8sSession.status === 'running' ? 'running' : 'stopped';
      // Ensure remoteSessions includes this session (may have been removed on previous disconnect)
      this.remoteSessions.add(k8sSession.sessionId);
      loggers.sessions.info({ sessionId: k8sSession.sessionId }, "Session already registered, updated lastActivity");
      return existing;
    }

    const session: UserSession = {
      id: k8sSession.sessionId,
      userId: k8sSession.userId,
      pid: 0, // No local PID in K8s mode
      workspacePath: k8sSession.workspacePath,
      model: this.config.defaultModel,
      createdAt: new Date(k8sSession.createdAt),
      lastActivity: new Date(k8sSession.lastActivity),
      status: k8sSession.status === 'running' ? 'running' : 'stopped',
    };

    // Register in all tracking structures
    this.sessions.set(k8sSession.sessionId, session);
    this.remoteSessions.add(k8sSession.sessionId);
    if (!this.userToSessions.has(k8sSession.userId)) {
      this.userToSessions.set(k8sSession.userId, new Set());
    }
    this.userToSessions.get(k8sSession.userId)!.add(k8sSession.sessionId);
    this.outputBuffers.set(k8sSession.sessionId, []);

    // Set up terminal data forwarding from K8s pod
    // Note: This is a simple buffer for output capture - no size limit
    // The main output is handled by the k8sManager's WebSocket connection
    if (this.k8sManager) {
      this.k8sManager.on('terminal:data', (sid: string, data: string) => {
        if (sid === k8sSession.sessionId) {
          const buffer = this.outputBuffers.get(k8sSession.sessionId) || [];
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              buffer.push(line);
              // Keep last 100 lines
              if (buffer.length > 100) {
                buffer.shift();
              }
            }
          }
          this.outputBuffers.set(k8sSession.sessionId, buffer);
        }
      });
    }

    loggers.sessions.info({ sessionId: k8sSession.sessionId, userId: k8sSession.userId }, "Registered K8s session");
    return session;
  }

  /**
   * Create a new AWCode session with PTY terminal
   * @param userId - The user ID for the session
   * @param workspacePath - Optional custom workspace path
   * @param model - Optional model override (defaults to smart router)
   * @param apiKey - Optional API key for OpenAgentic API mode
   * @param storageLimitMb - Optional storage limit override from admin settings
   * @param cliBackend - Optional CLI backend from admin settings
   * @param userEmail - Optional user email for Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
   */
  async createSession(
    userId: string,
    workspacePath?: string,
    model?: string,
    apiKey?: string,
    storageLimitMb?: number,
    cliBackend?: string,
    userEmail?: string,
    githubToken?: string
  ): Promise<UserSession> {
    // Check session limit
    const userSessions = this.userToSessions.get(userId) || new Set();
    if (userSessions.size >= this.config.maxSessionsPerUser) {
      throw new Error(`Maximum sessions (${this.config.maxSessionsPerUser}) reached for user`);
    }

    const sessionId = randomUUID();

    // ==============================================================
    // EXEC CONTAINER MODE: Delegate session creation to exec container
    // ==============================================================
    if (this.isExecContainerMode() && this.execClient) {
      loggers.sessions.info({ sessionId }, "Creating session in exec container");

      // Initialize workspace locally first (for cloud sync)
      let workspace: string;
      try {
        const result = await this.workspaceService.initializeWorkspace(userId, sessionId, model);
        workspace = result.localPath;
        loggers.sessions.info({ workspace }, "Workspace initialized for remote session");
      } catch (err) {
        loggers.sessions.error({ err }, "Workspace initialization failed");
        throw new Error(`Workspace initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Create session in exec container
      // Pass the API endpoint so the CLI knows where to connect
      const apiEndpoint = process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000';
      const remoteSession = await this.execClient.createSession({
        sessionId,
        userId,
        userEmail,  // For Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
        workspacePath: workspace,
        model,
        apiKey,
        apiEndpoint,
      });

      // Create local session record
      const session: UserSession = {
        id: sessionId,
        userId,
        pid: remoteSession.pid,
        workspacePath: workspace,
        model: model || this.config.defaultModel,
        createdAt: new Date(),
        lastActivity: new Date(),
        status: 'running',
      };

      // Track session locally
      this.sessions.set(sessionId, session);
      this.remoteSessions.add(sessionId);
      if (!this.userToSessions.has(userId)) {
        this.userToSessions.set(userId, new Set());
      }
      this.userToSessions.get(userId)!.add(sessionId);
      this.outputBuffers.set(sessionId, []);

      // Connect to remote PTY via WebSocket and forward data
      const terminalWs = this.execClient.connectTerminal(sessionId);
      this.execClient.on('terminal:data', (sid: string, data: string) => {
        if (sid === sessionId) {
          // Update output buffer
          const buffer = this.outputBuffers.get(sessionId) || [];
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              buffer.push(line);
              while (buffer.length > MAX_OUTPUT_LINES) {
                buffer.shift();
              }
            }
          }
          this.outputBuffers.set(sessionId, buffer);
        }
      });

      // Persist session to blob storage
      saveSession(session).catch(err => {
        loggers.sessions.error({ sessionId, err }, "Failed to persist session");
      });

      loggers.sessions.info({ sessionId, userId }, "Remote session created");
      return session;
    }

    // ==============================================================
    // KUBERNETES MODE: Spawn a runner pod per session
    // ==============================================================
    if (this.isKubernetesMode() && this.k8sManager) {
      loggers.sessions.info({ sessionId }, "Creating session in Kubernetes pod");

      // Initialize workspace locally first (for cloud sync)
      let workspace: string;
      try {
        const result = await this.workspaceService.initializeWorkspace(userId, sessionId, model);
        workspace = result.localPath;
        loggers.sessions.info({ workspace }, "Workspace initialized for K8s session");
      } catch (err) {
        loggers.sessions.error({ err }, "Workspace initialization failed");
        throw new Error(`Workspace initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Create session in Kubernetes (spawns a new pod)
      const k8sSession = await this.k8sManager.createSession({
        sessionId,
        userId,
        userEmail,  // For Linux username in sandbox (e.g., john.doe@company.com -> john-doe)
        workspacePath: workspace,
        model,
        apiKey,
        cliBackend: 'openagentic-cli',
        githubToken,
      });

      // Create local session record
      const session: UserSession = {
        id: sessionId,
        userId,
        pid: 0, // No local PID in K8s mode
        workspacePath: workspace,
        model: model || this.config.defaultModel,
        createdAt: new Date(),
        lastActivity: new Date(),
        status: 'running',
      };

      // Track session locally
      this.sessions.set(sessionId, session);
      this.remoteSessions.add(sessionId);
      if (!this.userToSessions.has(userId)) {
        this.userToSessions.set(userId, new Set());
      }
      this.userToSessions.get(userId)!.add(sessionId);
      this.outputBuffers.set(sessionId, []);

      // Forward terminal data from K8s pod
      this.k8sManager.on('terminal:data', (sid: string, data: string) => {
        if (sid === sessionId) {
          const buffer = this.outputBuffers.get(sessionId) || [];
          const lines = data.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              buffer.push(line);
              while (buffer.length > MAX_OUTPUT_LINES) {
                buffer.shift();
              }
            }
          }
          this.outputBuffers.set(sessionId, buffer);
        }
      });

      // Persist session to blob storage
      saveSession(session).catch(err => {
        loggers.sessions.error({ sessionId, err }, "Failed to persist session");
      });

      loggers.sessions.info({ sessionId, userId, podName: k8sSession.podName }, "K8s session created");
      return session;
    }

    // ==============================================================
    // LOCAL MODE: Create session with local PTY (existing logic)
    // ==============================================================

    // Cloud-first workspace initialization
    // 1. Creates workspace in cloud storage (MinIO/S3/Azure/GCS) first
    // 2. Downloads existing files to local cache (if resuming)
    // 3. Sets up real-time sync from local to cloud
    let workspace: string;
    let isNewWorkspace: boolean;
    let filesDownloaded: number;

    try {
      const result = await this.workspaceService.initializeWorkspace(userId, sessionId, model);
      workspace = result.localPath;
      isNewWorkspace = result.isNew;
      filesDownloaded = result.filesDownloaded;
      loggers.sessions.info({ isNewWorkspace, filesDownloaded }, "Workspace initialized");
    } catch (err) {
      // NO FALLBACK - Cloud storage MUST work in Kubernetes environments
      // With multiple replicas, local filesystem would be inconsistent across pods
      // Fail fast to force proper storage configuration
      loggers.sessions.error({ err }, "FATAL: Cloud storage initialization failed");
      throw new Error(`Cloud storage initialization failed. Storage must be properly configured (MinIO/S3/Azure/GCS). Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Check workspace size limit (admin settings override > config > default 5GB)
    const effectiveLimitMb = storageLimitMb || this.config.maxWorkspaceSizeMb;
    const maxWorkspaceSizeBytes = effectiveLimitMb * 1024 * 1024;
    const workspaceSize = await getWorkspaceSize(workspace);
    if (workspaceSize > maxWorkspaceSizeBytes) {
      const sizeMB = Math.round(workspaceSize / (1024 * 1024));
      throw new Error(`Workspace size (${sizeMB}MB) exceeds limit (${effectiveLimitMb}MB). Please delete some files or use GitHub for storage.`);
    }

    // Ensure OPENAGENTIC.md exists in workspace (provides AI context)
    // This file provides context to the AI about the workspace and user preferences
    try {
      await ensureOpenagenticMd(workspace, userId);
    } catch (err) {
      loggers.sessions.warn({ err }, "Failed to create OPENAGENTIC.md");
      // Don't fail session creation for this
    }

    // Create sandbox user for isolation (if sandboxing is enabled)
    let sandboxUser: SandboxUser | null = null;
    if (this.sandboxEnabled) {
      try {
        sandboxUser = await createSandboxUser(sessionId, workspace);
        this.sandboxUsers.set(sessionId, sandboxUser);
        loggers.sandbox.info({ sessionId, username: sandboxUser.username, uid: sandboxUser.uid }, "Session will run as sandbox user");
      } catch (err) {
        loggers.sandbox.error({ err }, "Failed to create sandbox user, falling back to shared user");
      }
    }

    // Use openagentic CLI
    const cliPath = this.config.openagenticPath;
    loggers.sessions.info({ cliPath }, "Using openagentic CLI");

    // Build CLI arguments
    const apiEndpoint = process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000';
    const cliArgs: string[] = [
      '--yolo',                           // Auto-approve all tool executions
      '--non-interactive',                // Skip setup wizard in container mode
      '--directory', workspace,           // Working directory
      '--output-format', 'stream-json',   // CRITICAL: Output NDJSON for UI parsing
      '--input-format', 'stream-json',    // CRITICAL: Input NDJSON from web UI
    ];

    // If API key is provided, use API mode for platform LLM providers
    // In API mode: CLI gets config from /api/openagentic/config, uses /api/openagentic/chat for LLM
    // In Ollama mode: CLI uses Ollama directly for LLM
    if (apiKey) {
      cliArgs.push('--provider', 'api');
      cliArgs.push('--api-endpoint', apiEndpoint);
      cliArgs.push('--api-key', apiKey);
      // Model will be fetched from /api/openagentic/config - don't hardcode here
    } else {
      // NO FALLBACK: API mode is REQUIRED - no hardcoded providers allowed
      // If no apiKey, still use API mode but the CLI will fail with auth error
      // This is intentional - prevents falling back to hardcoded Ollama
      loggers.sessions.warn('No apiKey provided - CLI will use API mode without auth (will likely fail)');
      cliArgs.push('--provider', 'api');
      cliArgs.push('--api-endpoint', apiEndpoint);
    }

    // Determine shell and args based on sandboxing
    let shell: string;
    let args: string[];

    if (sandboxUser) {
      // SANDBOXED: Run CLI as the sandbox user using 'su'
      // This ensures the CLI process runs with limited privileges
      // SECURITY: Apply resource limits (ulimits) to prevent DoS attacks
      shell = 'su';
      const cliCommand = [cliPath, ...cliArgs].join(' ');
      // Prepend ulimit commands to restrict resources (fork bombs, disk fill, etc.)
      const limitedCommand = `${getUlimitPrefix()}${cliCommand}`;
      args = ['-s', '/bin/bash', sandboxUser.username, '-c', limitedCommand];
      loggers.sandbox.info({ username: sandboxUser.username }, "Spawning with resource limits");
      loggers.sandbox.debug({ username: sandboxUser.username, command: limitedCommand.substring(0, 200) }, "Spawn command");
    } else {
      // NON-SANDBOXED: Run CLI directly (less secure, but works without privileges)
      shell = cliPath;
      args = cliArgs;
      loggers.sessions.info({ shell, args: args.join(' ') }, 'Spawning openagentic');
    }

    // Build clean environment for PTY - ensure NO_COLOR is completely removed
    let ptyEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      OPENAGENTIC_SESSION_ID: sessionId,
      OPENAGENTIC_USER_ID: userId,
      // Container mode - skip setup wizard
      CONTAINER_MODE: '1',
      // Force color output even in PTY
      FORCE_COLOR: '1',
      // Enable ANSI colors and 256 color support
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
    };

    // Apply sandbox environment restrictions if sandboxing is enabled
    if (sandboxUser) {
      ptyEnv = getSandboxEnv(sandboxUser, ptyEnv);
    }

    // Configure environment - ALWAYS use API mode, no hardcoded providers
    // OPENAGENTIC CLI - API MODE: CLI uses OpenAgentic API for LLM, MCP, storage
    // - Gets config from /api/openagentic/config (available models, MCP servers, etc.)
    // - Calls /api/openagentic/chat for LLM completions
    // - Uses platform's configured providers (Anthropic, OpenAI, Azure, Vertex, etc.)
    ptyEnv.LLM_PROVIDER = 'api';
    ptyEnv.OPENAGENTIC_API_ENDPOINT = apiEndpoint;
    if (apiKey) {
      ptyEnv.OPENAGENTIC_API_KEY = apiKey;
    }
    // Don't set OPENAGENTIC_MODEL - CLI will get default from /api/openagentic/config
    loggers.sessions.info({ apiEndpoint: ptyEnv.OPENAGENTIC_API_ENDPOINT }, "CLI will use platform LLM via API");

    // CRITICAL: Explicitly delete NO_COLOR to prevent color suppression
    // Setting to undefined doesn't work - must delete the key entirely
    delete ptyEnv.NO_COLOR;

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workspace,
      env: ptyEnv,
    });

    const session: UserSession = {
      id: sessionId,
      userId,
      pid: ptyProcess.pid,
      workspacePath: workspace,
      model: model || this.config.defaultModel,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'running',
    };

    // Track session
    this.sessions.set(sessionId, session);
    this.ptys.set(sessionId, ptyProcess);
    if (!this.userToSessions.has(userId)) {
      this.userToSessions.set(userId, new Set());
    }
    this.userToSessions.get(userId)!.add(sessionId);

    // Initialize output buffer for this session
    this.outputBuffers.set(sessionId, []);

    // Initialize message parser for database persistence
    const messageParser = new OutputMessageParser(sessionId);
    this.messageParsers.set(sessionId, messageParser);

    // Capture PTY output for admin monitoring and persistence
    ptyProcess.onData((data: string) => {
      const buffer = this.outputBuffers.get(sessionId) || [];

      // Split data into lines and add to buffer
      const lines = data.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          buffer.push(line);
          // Keep only last N lines
          while (buffer.length > MAX_OUTPUT_LINES) {
            buffer.shift();
          }
        }
      }
      this.outputBuffers.set(sessionId, buffer);

      // Update current activity based on output patterns
      if (data.includes('Thinking') || data.includes('...')) {
        this.currentActivity.set(sessionId, 'thinking');
      } else if (data.includes('Reading') || data.includes('Searching')) {
        this.currentActivity.set(sessionId, 'reading');
      } else if (data.includes('Writing') || data.includes('Editing')) {
        this.currentActivity.set(sessionId, 'writing');
      } else if (data.includes('Running') || data.includes('Executing')) {
        this.currentActivity.set(sessionId, 'executing');
      } else if (data.includes('$') || data.includes('>')) {
        this.currentActivity.set(sessionId, 'idle');
      }

      // Add output to message parser for database persistence
      messageParser.addOutput(data);
    });

    // Handle PTY events
    ptyProcess.onExit(({ exitCode }) => {
      loggers.sessions.info({ sessionId, exitCode }, "PTY exited");
      session.status = 'stopped';
      this.cleanup(sessionId);
    });

    // Persist session to blob storage (async, non-blocking)
    saveSession(session).catch(err => {
      loggers.sessions.error({ sessionId, err }, "Failed to persist session");
    });

    // Note: Workspace sync is now handled by WorkspaceStorageService (cloud-first)
    // Real-time sync to cloud is started automatically in initializeWorkspace()

    loggers.sessions.info({ sessionId, userId, pid: ptyProcess.pid }, "Created PTY session");
    return session;
  }

  /**
   * Get PTY process for a session (for WebSocket I/O)
   */
  getPty(sessionId: string): pty.IPty | null {
    return this.ptys.get(sessionId) || null;
  }

  /**
   * Write to PTY stdin
   */
  async write(sessionId: string, data: string): Promise<boolean> {
    loggers.sessions.debug({ sessionId, dataLength: data.length }, "write() called");
    loggers.sessions.debug({ sessionId, isRemote: this.remoteSessions.has(sessionId) }, "Remote session check");
    loggers.sessions.debug({ hasExecClient: !!this.execClient, hasK8sManager: !!this.k8sManager }, "Client availability");

    // Handle remote sessions via exec container
    if (this.remoteSessions.has(sessionId) && this.execClient) {
      loggers.sessions.debug({ sessionId }, "Using execClient");
      this.execClient.writeTerminal(sessionId, data);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastActivity = new Date();
      }
      return true;
    }

    // Handle K8s sessions (with auto-reconnect)
    if (this.remoteSessions.has(sessionId) && this.k8sManager) {
      loggers.sessions.debug({ sessionId }, "Using k8sManager");
      await this.k8sManager.writeTerminal(sessionId, data);
      const session = this.sessions.get(sessionId);
      if (session) {
        session.lastActivity = new Date();
      }
      return true;
    }

    // Handle local PTY sessions
    const ptyProcess = this.ptys.get(sessionId);
    loggers.sessions.debug({ sessionId, hasPty: !!ptyProcess }, "Local PTY check");
    if (!ptyProcess) {
      loggers.sessions.debug({ sessionId }, "No PTY found, returning false");
      return false;
    }

    ptyProcess.write(data);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    return true;
  }

  /**
   * Resize PTY
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    // Handle remote sessions via exec container
    if (this.remoteSessions.has(sessionId) && this.execClient) {
      this.execClient.resizeTerminal(sessionId, cols, rows);
      return true;
    }

    // Handle K8s sessions
    if (this.remoteSessions.has(sessionId) && this.k8sManager) {
      this.k8sManager.resizeTerminal(sessionId, cols, rows);
      return true;
    }

    // Handle local PTY sessions
    const ptyProcess = this.ptys.get(sessionId);
    if (!ptyProcess) return false;

    ptyProcess.resize(cols, rows);
    return true;
  }

  /**
   * Send a message and collect response (for REST API - legacy support)
   *
   * The CLI runs in interactive mode, so we send plain text messages.
   */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    const ptyProcess = this.ptys.get(sessionId);

    if (!session || !ptyProcess) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.status !== 'running') {
      throw new Error(`Session is not running: ${session.status}`);
    }

    session.lastActivity = new Date();

    return new Promise((resolve, reject) => {
      let output = '';
      const timeout = 120000; // 2 minute timeout

      const dataHandler = (data: string) => {
        output += data;
      };

      ptyProcess.onData(dataHandler);

      // Send plain text message to PTY (interactive mode)
      ptyProcess.write(message + '\n');

      // Wait for response with timeout
      const timeoutId = setTimeout(() => {
        resolve(output || 'No response');
      }, timeout);

      // Check for completion marker periodically
      // In interactive mode, look for the prompt returning
      const checkInterval = setInterval(() => {
        // CLI shows prompt like ">" or "$" when ready for input
        if (output.includes('\n>') || output.includes('\n$') || output.match(/\n.*\$\s*$/)) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(output);
        }
      }, 100);
    });
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): UserSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): SessionStatus | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      status: session.status,
      running: session.status === 'running',
      userId: session.userId,
      model: session.model,
      workspacePath: session.workspacePath,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    };
  }

  /**
   * Get session with buffered output
   * Used to replay CLI output that was generated before WebSocket connected
   */
  getSessionWithOutput(sessionId: string): { session: UserSession; lastOutput: string } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Get buffered output, joining all lines
    const outputBuffer = this.outputBuffers.get(sessionId) || [];
    const lastOutput = outputBuffer.join('\n');

    return {
      session,
      lastOutput,
    };
  }

  /**
   * Get sessions by user ID
   */
  getSessionsByUser(userId: string): UserSession[] {
    const sessionIds = this.userToSessions.get(userId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id)!)
      .filter(Boolean);
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Handle remote sessions via exec container
    if (this.remoteSessions.has(sessionId) && this.execClient) {
      loggers.sessions.info({ sessionId }, "Stopping remote session");
      await this.execClient.stopSession(sessionId);
      this.remoteSessions.delete(sessionId);
      await this.cleanup(sessionId);
      loggers.sessions.info({ sessionId }, "Stopped remote session");
      return;
    }

    // Handle K8s sessions - PERMANENT PODS: Only disconnect terminal, don't cleanup session
    // The session record stays in memory so reconnects work without re-registering
    if (this.remoteSessions.has(sessionId) && this.k8sManager) {
      loggers.sessions.info({ sessionId }, "Disconnecting K8s session (session stays in memory)");
      await this.k8sManager.stopSession(sessionId);
      this.remoteSessions.delete(sessionId);
      // NOTE: We do NOT call cleanup() for K8s sessions - the pod is permanent
      // and the session should be able to reconnect without re-registering
      loggers.sessions.info({ sessionId }, "Disconnected K8s session");
      return;
    }

    // Handle local PTY sessions
    const ptyProcess = this.ptys.get(sessionId);
    if (!ptyProcess) {
      throw new Error(`PTY not found for session: ${sessionId}`);
    }

    // Kill PTY process
    ptyProcess.kill();

    await this.cleanup(sessionId);
    loggers.sessions.info({ sessionId }, "Stopped PTY session");
  }

  /**
   * Restart a session - stops existing and creates new with same config
   */
  async restartSession(sessionId: string): Promise<UserSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Capture session config before stopping
    const { userId, workspacePath, model } = session;

    // Stop existing session
    await this.stopSession(sessionId);

    // Create new session with same config
    const newSession = await this.createSession(userId, workspacePath, model);
    loggers.sessions.info({ oldSessionId: sessionId, newSessionId: newSession.id }, "Restarted session");

    return newSession;
  }

  /**
   * Clean up session resources
   */
  private async cleanup(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      const userSessions = this.userToSessions.get(session.userId);
      userSessions?.delete(sessionId);

      // Clear metrics for this session
      metricsService.clearSession(sessionId, session.pid);

      // Stop workspace and sync final changes to cloud
      try {
        await this.workspaceService.stopWorkspace(sessionId);
      } catch (err) {
        loggers.sessions.error({ sessionId, err }, "Failed to stop workspace");
      }
    }

    // Clean up sandbox user (IMPORTANT: do this before deleting workspace)
    const sandboxUser = this.sandboxUsers.get(sessionId);
    if (sandboxUser) {
      try {
        // Keep workspace files - they're synced to cloud storage
        await deleteSandboxUser(sandboxUser, true);
        this.sandboxUsers.delete(sessionId);
        loggers.sandbox.info({ username: sandboxUser.username, sessionId }, "Deleted sandbox user");
      } catch (err) {
        loggers.sandbox.error({ sessionId, err }, "Failed to delete sandbox user");
      }
    }

    // Flush any pending messages before cleanup
    const messageParser = this.messageParsers.get(sessionId);
    if (messageParser) {
      await messageParser.cleanup();
      this.messageParsers.delete(sessionId);
    }

    // Mark session as stopped in blob storage
    if (session) {
      updateSessionStatus(session.userId, sessionId, 'stopped').catch(err => {
        loggers.sessions.error({ sessionId, err }, "Failed to persist session stop");
      });
    }

    this.sessions.delete(sessionId);
    this.ptys.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.currentActivity.delete(sessionId);
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    return Array.from(this.sessions.values())
      .filter(s => s.status === 'running')
      .length;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get process metrics for a session's PTY process
   */
  async getProcessMetrics(sessionId: string): Promise<ProcessMetrics | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pid) return null;

    try {
      const stats = await pidusage(session.pid);
      return {
        cpu: Math.round(stats.cpu * 100) / 100,
        memory: stats.memory,
        memoryMB: Math.round(stats.memory / (1024 * 1024) * 100) / 100,
        elapsed: stats.elapsed,
      };
    } catch (err) {
      // Process may have exited
      return null;
    }
  }


  /**
   * Get sandbox username for a session (used by code-server to run as correct user)
   */
  getSandboxUsername(sessionId: string): string | undefined {
    const sandboxUser = this.sandboxUsers.get(sessionId);
    return sandboxUser?.username;
  }

  /**
   * Get enhanced metrics including network I/O, disk I/O, tokens, and storage
   */
  async getEnhancedMetrics(sessionId: string): Promise<EnhancedSessionMetrics | null> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.pid) return null;

    try {
      // Get enhanced process metrics from metricsService
      const processMetrics = await metricsService.getProcessMetrics(session.pid);
      if (!processMetrics) return null;

      // Get token usage
      const tokenUsage = metricsService.getTokenUsage(sessionId);

      // Get storage usage
      const storageUsage = session.workspacePath
        ? await metricsService.getStorageUsage(session.workspacePath)
        : null;

      return {
        cpu: processMetrics.cpu,
        memory: processMetrics.memory,
        memoryMB: processMetrics.memoryMB,
        elapsed: processMetrics.elapsed,
        networkRx: processMetrics.networkRx,
        networkTx: processMetrics.networkTx,
        diskReadBytes: processMetrics.diskReadBytes,
        diskWriteBytes: processMetrics.diskWriteBytes,
        tokenUsage,
        storageUsage,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Record token usage for a session (called when NDJSON 'result' event is received)
   */
  recordTokenUsage(sessionId: string, inputTokens: number, outputTokens: number, model?: string): void {
    metricsService.recordTokenUsage(sessionId, inputTokens, outputTokens, model);
  }

  /**
   * Get all sessions with enhanced metrics for admin dashboard
   */
  async getAllSessionsWithEnhancedMetrics(): Promise<Array<UserSession & {
    lastOutput: string;
    currentActivity: string;
    enhancedMetrics: EnhancedSessionMetrics | null;
  }>> {
    const sessions = Array.from(this.sessions.values());
    const results = await Promise.all(
      sessions.map(async (session) => {
        const enhancedMetrics = await this.getEnhancedMetrics(session.id);
        return {
          ...session,
          lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
          currentActivity: this.currentActivity.get(session.id) || 'idle',
          enhancedMetrics,
        };
      })
    );
    return results;
  }

  /**
   * Get all sessions with output buffer for admin monitoring
   */
  getAllSessionsWithOutput(): Array<UserSession & { lastOutput: string; currentActivity: string }> {
    return Array.from(this.sessions.values()).map(session => ({
      ...session,
      lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
      currentActivity: this.currentActivity.get(session.id) || 'idle',
    }));
  }

  /**
   * Get all sessions with output buffer AND process metrics for admin monitoring
   */
  async getAllSessionsWithMetrics(): Promise<Array<UserSession & {
    lastOutput: string;
    currentActivity: string;
    metrics: ProcessMetrics | null;
  }>> {
    const sessions = Array.from(this.sessions.values());
    const results = await Promise.all(
      sessions.map(async (session) => {
        const metrics = await this.getProcessMetrics(session.id);
        return {
          ...session,
          lastOutput: (this.outputBuffers.get(session.id) || []).slice(-20).join('\n'),
          currentActivity: this.currentActivity.get(session.id) || 'idle',
          metrics,
        };
      })
    );
    return results;
  }

  /**
   * Clean up idle sessions
   * NOTE: In K8s mode with permanent pods, sessions are NEVER cleaned up
   * The pods stay running and sessions can reconnect at any time
   */
  async cleanupIdleSessions(): Promise<number> {
    // K8s mode with permanent pods: no automatic cleanup
    // Pods stay running forever, sessions reconnect automatically
    if (this.config.executionMode === 'kubernetes' && this.k8sManager) {
      return 0;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const session of this.sessions.values()) {
      const idleTime = (now - session.lastActivity.getTime()) / 1000;
      const lifetime = (now - session.createdAt.getTime()) / 1000;

      if (idleTime > this.config.sessionIdleTimeout || lifetime > this.config.sessionMaxLifetime) {
        await this.stopSession(session.id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
