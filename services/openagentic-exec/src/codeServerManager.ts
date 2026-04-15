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
 * Code Server Manager for Exec Daemon
 *
 * Manages code-server (VS Code Web) instances for each user's exec environment.
 * Each user has a dedicated, permanent exec environment that they own.
 *
 * Security Model:
 * - Each user owns their dedicated exec environment (no sharing)
 * - Terminal ENABLED since users own their environment
 * - Extension marketplace disabled (use openagentic-cli instead)
 * - User data stored outside workspace to prevent pollution
 * - MinIO workspace isolation per user
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chownSync } from 'fs';
import { join } from 'path';
import { createServer, Server } from 'net';
import { config } from './config';
import { SandboxUser } from './userSandbox';
import { loggers } from './logger.js';

export interface CodeServerInstance {
  sessionId: string;
  userId: string;
  port: number;
  process: ChildProcess;
  status: 'starting' | 'running' | 'stopped' | 'error';
  workspacePath: string;
  userDataDir: string;
  url: string;
  startedAt: number;
}

/**
 * VS Code settings for user exec environments
 *
 * SECURITY: Terminal is DISABLED. Users cannot run commands directly.
 * Only the AI agent running in the PTY can execute commands.
 * Users can view and edit files in VS Code but have no shell access.
 */
const LOCKED_SETTINGS = {
  // ===========================================
  // TERMINAL DISABLED - Only AI agent can execute
  // ===========================================
  "terminal.integrated.enabled": false,
  "terminal.integrated.allowChords": false,

  // ===========================================
  // PANEL SETTINGS
  // ===========================================
  "workbench.panel.defaultLocation": "bottom",
  "panel.defaultLocation": "bottom",

  // Disable task running (could be used to execute commands)
  "task.allowAutomaticTasks": "off",
  "task.autoDetect": "off",

  // Disable debug console (could be used to execute code)
  "debug.console.acceptSuggestionOnEnter": "off",
  "debug.allowBreakpointsEverywhere": false,

  // DISABLE COPILOT & AI features (we use openagentic-cli instead)
  "github.copilot.enable": false,
  "github.copilot.editor.enableAutoCompletions": false,
  "github.copilot-chat.enabled": false,

  // DISABLE marketplace and extension installation
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "extensions.ignoreRecommendations": true,
  "extensions.showRecommendationsOnlyOnDemand": false,

  // Disable workspace trust prompts
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "security.workspace.trust.banner": "never",
  "security.workspace.trust.emptyWindow": true,

  // Disable telemetry
  "telemetry.telemetryLevel": "off",

  // Hide internal dot directories from the file explorer —
  // these are openagentic/system internals that users don't need
  // to see. The workspace should look like a clean git repo.
  "files.exclude": {
    "**/.claude": true,
    "**/.openagentic": true,
    "**/.openagentic-ready": true,
    "**/.openagentic.json": true,
    "**/.cache": true,
    "**/.config": true,
    "**/.local": true,
    "**/.npm": true,
    "**/.npm-global": true,
    "**/.bun": true,
    "**/.bashrc": true,
    "**/.npmrc": true,
    "**/.profile": true,
    "**/.ipython": true,
    "**/.jupyter": true,
    "**/.dotnet": true,
    "**/.azure": true,
    "**/.gitconfig": true,
    "**/node_modules": true,
    "**/__pycache__": true,
    "**/.pytest_cache": true,
  },
  "telemetry.enableTelemetry": false,
  "telemetry.enableCrashReporter": false,

  // Clean UI
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "update.mode": "none",
  "update.showReleaseNotes": false,

  // Disable remote features
  "remote.autoForwardPorts": false,
  "remote.restoreForwardedPorts": false,

  // Editor settings
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.minimap.enabled": true,
  "editor.formatOnSave": true,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,

  // UI theme
  "workbench.iconTheme": "material-icon-theme",
  "workbench.colorTheme": "Default Dark Modern",
};

/**
 * Keybindings for user exec environments
 *
 * SECURITY: Terminal shortcuts are DISABLED to prevent users from opening
 * a terminal. Only the AI agent has shell access via its PTY.
 */
const LOCKED_KEYBINDINGS: Array<{ key: string; command: string; when?: string }> = [
  // Block all terminal keyboard shortcuts
  { key: "ctrl+`", command: "-workbench.action.terminal.toggleTerminal" },
  { key: "ctrl+shift+`", command: "-workbench.action.terminal.new" },
  { key: "ctrl+shift+c", command: "-workbench.action.terminal.openNativeConsole" },
  // Block task runner (could be used to execute commands)
  { key: "ctrl+shift+b", command: "-workbench.action.tasks.build" },
  { key: "ctrl+shift+t", command: "-workbench.action.tasks.test" },
];

// Port allocation pool
const allocatedPorts = new Set<number>();

export class CodeServerManager {
  private instances: Map<string, CodeServerInstance> = new Map();

  /**
   * Validate that workspace path is within the user's allowed directory
   * Users can ONLY access their own workspace from MinIO: /workspaces/{userId}/
   */
  private validateWorkspacePath(userId: string, workspacePath: string): void {
    const { normalize, resolve } = require('path');

    // Expected user workspace base: /workspaces/{userId}
    const userWorkspaceBase = resolve(config.workspacesPath, userId);
    const normalizedPath = resolve(normalize(workspacePath));

    // Path must start with user's workspace base (prevent path traversal)
    if (!normalizedPath.startsWith(userWorkspaceBase + '/') && normalizedPath !== userWorkspaceBase) {
      throw new Error(
        `SECURITY: Workspace path "${workspacePath}" is outside user's allowed directory. ` +
        `User ${userId} can only access paths under ${userWorkspaceBase}`
      );
    }

    // Extra check: prevent accessing other users' workspaces via symlinks or ..
    if (normalizedPath.includes('/../') || normalizedPath.includes('/..')) {
      throw new Error(`SECURITY: Path traversal detected in workspace path`);
    }
  }

  /**
   * Start a code-server instance for a session
   */
  async startInstance(
    sessionId: string,
    userId: string,
    workspacePath: string,
    sandboxUser?: SandboxUser,
    apiKey?: string,
    apiEndpoint?: string
  ): Promise<CodeServerInstance> {
    // Check if instance already exists or is starting up (race condition protection)
    const existing = this.instances.get(sessionId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      loggers.codeServer.info({ sessionId, status: existing.status }, 'Instance already exists, returning existing');
      return existing;
    }

    // SECURITY: Validate workspace path - users can only access their own workspace
    if (!workspacePath) {
      throw new Error('workspacePath is required - must be provided by openagentic-manager');
    }
    this.validateWorkspacePath(userId, workspacePath);

    // Allocate port (now checks OS-level availability)
    const port = await this.allocatePort();
    if (!port) {
      throw new Error('No available ports for code-server');
    }

    loggers.codeServer.info({ sessionId, port }, 'Starting instance');

    // Create user data directory path
    const userDataDir = join(config.codeServerUserDataDir || '/var/lib/code-server', sessionId);

    // IMPORTANT: Add instance to Map EARLY to prevent race conditions
    // This ensures concurrent calls see the instance is starting and return early
    const instance: CodeServerInstance = {
      sessionId,
      userId,
      port,
      process: null as any, // Will be set after spawn
      status: 'starting',
      workspacePath,
      userDataDir,
      url: `http://localhost:${port}`,
      startedAt: Date.now(),
    };
    this.instances.set(sessionId, instance);

    // Create user data directory OUTSIDE workspace to prevent pollution
    if (!existsSync(userDataDir)) {
      mkdirSync(userDataDir, { recursive: true, mode: 0o755 });
    }

    // Create User directory for VS Code settings
    const settingsDir = join(userDataDir, 'User');
    if (!existsSync(settingsDir)) {
      mkdirSync(settingsDir, { recursive: true, mode: 0o755 });
    }

    // Write locked-down settings.json
    writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(LOCKED_SETTINGS, null, 2), { mode: 0o644 });
    loggers.codeServer.info({ settingsDir }, 'Wrote locked-down settings');

    // Write locked-down keybindings.json
    writeFileSync(join(settingsDir, 'keybindings.json'), JSON.stringify(LOCKED_KEYBINDINGS, null, 2), { mode: 0o644 });
    loggers.codeServer.info({ settingsDir }, 'Wrote locked-down keybindings');

    // If sandbox user provided, change ownership of data directory
    // NOTE: Workspace directory lives on s3fs FUSE mount (uid=0,gid=0,umask=0000)
    //       chown -R on s3fs hangs indefinitely — skip it. The mount is world-rwx.
    if (sandboxUser && config.sandboxEnabled) {
      try {
        const uid = sandboxUser.uid;
        const gid = sandboxUser.gid || uid;

        // Recursively chown the session data directory (local filesystem, fast)
        execSync(`chown -R ${uid}:${gid} "${userDataDir}"`, { timeout: 10000 });
        loggers.codeServer.info({ userDataDir, username: sandboxUser.username, uid, gid }, 'Changed ownership of data directory');

        // Skip workspace chown — s3fs mount uses umask=0000, chown hangs on FUSE
        loggers.codeServer.info('Skipping workspace chown (s3fs mount, world-rwx via umask=0000)');
      } catch (err) {
        loggers.codeServer.warn({ username: sandboxUser.username, err }, 'Failed to chown for sandbox user');
      }
    }

    // Build code-server command with comprehensive flags
    const args = [
      '--bind-addr', `0.0.0.0:${port}`,
      '--auth', 'none',  // Auth handled at nginx/ingress level
      '--disable-telemetry',
      '--disable-update-check',
      '--disable-workspace-trust',
      '--disable-getting-started-override',
      '--log', 'warn',  // Suppress verbose debug logging
      '--user-data-dir', userDataDir,
      '--extensions-dir', config.codeServerExtensionsDir,
      workspacePath,
    ];

    // Remove PORT from env - code-server uses $PORT to override --bind-addr
    const { PORT: _unused, ...envWithoutPort } = process.env;

    // Comprehensive environment for security lockdown
    const secureEnv = {
      ...envWithoutPort,
      // Disable VS Code telemetry
      VSCODE_CLI_TELEMETRY_OPTOUT: '1',
      // Set home directory to session data dir (NOT workspace)
      HOME: userDataDir,
      // XDG Base Directory Specification - keeps dotfiles out of workspace
      XDG_CONFIG_HOME: `${userDataDir}/.config`,
      XDG_CACHE_HOME: `${userDataDir}/.cache`,
      XDG_DATA_HOME: `${userDataDir}/.local/share`,
      XDG_STATE_HOME: `${userDataDir}/.local/state`,
      // Disable extension gallery (marketplace)
      VSCODE_GALLERY_SERVICE_URL: '',
      VSCODE_GALLERY_ITEM_URL: '',
      VSCODE_GALLERY_CACHE_URL: '',
      VSCODE_GALLERY_CONTROL_URL: '',
      // Terminal disabled for users - only AI agent has shell access
      SHELL: '/bin/false',
      TERM: 'dumb',
    };

    let codeServerProcess: ChildProcess;

    if (sandboxUser && config.sandboxEnabled) {
      // Run code-server as the sandbox user using 'su'
      const codeServerCmd = `${config.codeServerBinary} ${args.map(a => `'${a}'`).join(' ')}`;
      loggers.codeServer.info({ username: sandboxUser.username }, 'Running as sandbox user');

      codeServerProcess = spawn('su', ['-s', '/bin/sh', sandboxUser.username, '-c', codeServerCmd], {
        env: secureEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
    } else {
      // Run directly (development mode - not recommended for production)
      loggers.codeServer.warn('No sandbox user provided, running as current user');
      codeServerProcess = spawn(config.codeServerBinary, args, {
        env: secureEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
    }

    // Update the instance with the process (instance was added to Map early for race condition protection)
    instance.process = codeServerProcess;

    // Handle stdout
    codeServerProcess.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('HTTP server listening')) {
        instance.status = 'running';
        loggers.codeServer.info({ sessionId, port }, 'Instance running');
      }
    });

    // Handle stderr
    codeServerProcess.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      // Filter out noisy logs
      if (!msg.includes('Extension host') && !msg.includes('Telemetry')) {
        loggers.codeServer.debug({ sessionId }, msg.trim());
      }
    });

    // Handle exit
    codeServerProcess.on('exit', (code, signal) => {
      loggers.codeServer.info({ sessionId, exitCode: code, signal }, 'Instance exited');
      instance.status = 'stopped';
      this.releasePort(port);
      this.instances.delete(sessionId);
    });

    // Handle error
    codeServerProcess.on('error', (error) => {
      loggers.codeServer.error({ sessionId, err: error }, 'Instance error');
      instance.status = 'error';
      this.releasePort(port);
    });

    // Wait for startup
    await this.waitForReady(instance);

    return instance;
  }

  /**
   * Wait for code-server to be ready (process started)
   */
  private async waitForReady(instance: CodeServerInstance, timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (instance.status === 'running') {
        return;
      }
      if (instance.status === 'error' || instance.status === 'stopped') {
        throw new Error(`code-server failed to start: ${instance.status}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Timeout - check if process is at least alive
    if (instance.process.exitCode === null) {
      instance.status = 'running';
      loggers.codeServer.info({ sessionId: instance.sessionId }, 'Instance assumed running after timeout');
    } else {
      throw new Error('code-server startup timeout');
    }
  }

  /**
   * Check if code-server is actually responding to HTTP requests
   * This is the TRUE readiness check - not just process running, but actually serving
   */
  async isCodeServerReady(sessionId: string): Promise<{ ready: boolean; url?: string; error?: string }> {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      return { ready: false, error: 'No code-server instance found' };
    }

    if (instance.status !== 'running') {
      return { ready: false, error: `Instance status: ${instance.status}` };
    }

    // Actually try to connect to code-server's HTTP endpoint
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://localhost:${instance.port}/healthz`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return { ready: true, url: instance.url };
      } else {
        return { ready: false, error: `HTTP ${response.status}` };
      }
    } catch (error: any) {
      // If /healthz doesn't exist, try the root path
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`http://localhost:${instance.port}/`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // code-server returns 200 or 302 (redirect to login) when ready
        if (response.ok || response.status === 302) {
          return { ready: true, url: instance.url };
        } else {
          return { ready: false, error: `HTTP ${response.status}` };
        }
      } catch (innerError: any) {
        return { ready: false, error: innerError.message || 'Connection failed' };
      }
    }
  }

  /**
   * Wait for code-server to be HTTP-ready (actually serving requests)
   * This is called after waitForReady() to ensure VS Code is actually accessible
   */
  async waitForHttpReady(sessionId: string, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    let lastError = '';

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.isCodeServerReady(sessionId);
      if (result.ready) {
        loggers.codeServer.info({ sessionId, url: result.url }, 'Instance HTTP-ready');
        return true;
      }
      lastError = result.error || 'Unknown error';
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    loggers.codeServer.warn({ sessionId, lastError }, 'Instance HTTP ready timeout');
    return false;
  }

  /**
   * Get an instance by session ID
   */
  getInstance(sessionId: string): CodeServerInstance | undefined {
    return this.instances.get(sessionId);
  }

  /**
   * Get all instances
   */
  getAllInstances(): CodeServerInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Stop an instance
   */
  async stopInstance(sessionId: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      return;
    }

    loggers.codeServer.info({ sessionId }, 'Stopping instance');

    try {
      instance.process.kill('SIGTERM');
    } catch {
      // Process might already be dead
    }

    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Force kill if needed
    if (instance.process.exitCode === null) {
      try {
        instance.process.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }

    this.releasePort(instance.port);
    this.instances.delete(sessionId);
  }

  /**
   * Check if a port is actually available at the OS level
   * This catches TIME_WAIT ports and zombie processes
   */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false); // Any error means port is not usable
        }
      });
      server.once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      });
      server.listen(port, '0.0.0.0');
    });
  }

  /**
   * Allocate an available port
   * Now checks BOTH in-memory allocation AND OS-level availability
   */
  private async allocatePort(): Promise<number | null> {
    const basePort = config.codeServerBasePort;
    const maxInstances = config.codeServerMaxInstances;

    for (let i = 0; i < maxInstances; i++) {
      const port = basePort + i;
      if (!allocatedPorts.has(port)) {
        // Check if port is actually available at OS level
        const available = await this.isPortAvailable(port);
        if (available) {
          allocatedPorts.add(port);
          loggers.codeServer.info({ port }, 'Allocated port (verified available)');
          return port;
        } else {
          loggers.codeServer.warn({ port }, 'Port not in allocatedPorts but is in use at OS level, skipping');
        }
      }
    }

    return null;
  }

  /**
   * Release a port back to the pool
   */
  private releasePort(port: number): void {
    allocatedPorts.delete(port);
  }

  /**
   * Check if code-server binary exists
   */
  async checkHealth(): Promise<boolean> {
    return existsSync(config.codeServerBinary);
  }
}
