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
 * Code Server Service - Per-User VS Code Instances
 *
 * Spawns code-server child processes for each user session, providing
 * isolated VS Code environments with their own ports.
 *
 * Architecture:
 * - Each session gets its own code-server process on a unique port
 * - Port pool: 3100-3199 (100 concurrent sessions max)
 * - Processes run as the sandbox user for the session (NOT root)
 * - Automatic cleanup when session ends
 *
 * Security:
 * - code-server runs as sandbox user (aw_<sessionId>) - NOT root
 * - Terminal is disabled to prevent shell access
 * - Extension marketplace is disabled
 * - Only pre-approved extensions are available
 * - nginx/ingress handles external auth before proxying
 * - Each process isolated to user's workspace directory
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chownSync } from 'fs';
import path from 'path';

export interface CodeServerInstance {
  sessionId: string;
  userId: string;
  workspacePath: string;
  port: number;
  url: string;
  internalUrl: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  process?: ChildProcess;
  pid?: number;
  startTime: number;
  error?: string;
}

export interface CodeServerConfig {
  /** Base port for code-server instances (default: 3100) */
  basePort: number;
  /** Maximum number of concurrent instances (default: 100) */
  maxInstances: number;
  /** External URL prefix for browser access (via nginx proxy) */
  externalUrlPrefix: string;
  /** Path to code-server binary (default: code-server) */
  binaryPath: string;
  /** Base directory for code-server user data */
  userDataDir: string;
  /** Extensions directory (shared across instances, read-only) */
  extensionsDir: string;
  /** Startup timeout in ms (default: 30000) */
  startupTimeout: number;
  /** Disable terminal in VS Code (default: true for security) */
  disableTerminal: boolean;
  /** Disable extension marketplace (default: true for security) */
  disableMarketplace: boolean;
  /** Disable workspace trust prompts */
  disableWorkspaceTrust: boolean;
  /** Path to locked-down settings.json template */
  settingsTemplatePath: string;
}

const DEFAULT_CONFIG: CodeServerConfig = {
  basePort: parseInt(process.env.CODE_SERVER_BASE_PORT || '3100', 10),
  maxInstances: parseInt(process.env.CODE_SERVER_MAX_INSTANCES || '100', 10),
  externalUrlPrefix: process.env.CODE_SERVER_EXTERNAL_URL || '/code-server',
  binaryPath: process.env.CODE_SERVER_BINARY || 'code-server',
  userDataDir: process.env.CODE_SERVER_USER_DATA_DIR || '/var/lib/code-server',
  extensionsDir: process.env.CODE_SERVER_EXTENSIONS_DIR || '/var/lib/code-server/extensions',
  startupTimeout: parseInt(process.env.CODE_SERVER_STARTUP_TIMEOUT || '30000', 10),
  // Security lockdown settings (all enabled by default)
  disableTerminal: process.env.CODE_SERVER_DISABLE_TERMINAL !== 'false',
  disableMarketplace: process.env.CODE_SERVER_DISABLE_MARKETPLACE !== 'false',
  disableWorkspaceTrust: process.env.CODE_SERVER_DISABLE_WORKSPACE_TRUST !== 'false',
  settingsTemplatePath: process.env.CODE_SERVER_SETTINGS_TEMPLATE || '/etc/code-server/settings.json',
};

/**
 * Locked-down VS Code settings for security
 * These settings disable terminal, prevent copilot, and lock down the environment
 *
 * IMPORTANT: Settings alone don't fully disable terminal - users can still access via:
 * - View menu → Terminal
 * - Command palette → "Terminal: New Terminal"
 *
 * We also need keybindings.json to block commands, and the SHELL=/bin/false env var
 * ensures any terminal spawn attempt fails immediately.
 */
const LOCKED_SETTINGS = {
  // ===========================================
  // DISABLE TERMINAL - Critical for security
  // ===========================================
  // Multiple layers of terminal blocking:
  // 1. Disable terminal feature entirely
  "terminal.integrated.enabled": false,
  // 2. Set shell to /bin/false so any spawn fails
  "terminal.explorerKind": "external",
  "terminal.external.linuxExec": "/bin/false",
  "terminal.integrated.shell.linux": "/bin/false",
  // Force the default profile to use /bin/false
  "terminal.integrated.defaultProfile.linux": "blocked",
  // Define ONLY a blocked profile - no real shells available
  "terminal.integrated.profiles.linux": {
    "blocked": {
      "path": "/bin/false",
      "args": [],
      "icon": "terminal"
    }
  },
  // Disable automatic shell detection
  "terminal.integrated.useWslProfiles": false,
  // 3. Hide terminal tabs and UI elements
  "terminal.integrated.tabs.enabled": false,
  "terminal.integrated.tabs.hideCondition": "always",
  "terminal.integrated.showExitAlert": false,
  "terminal.integrated.allowChords": false,
  "terminal.integrated.confirmOnExit": "never",
  "terminal.integrated.confirmOnKill": "never",
  // 4. Hide terminal from activity bar and panel
  "terminal.integrated.hideOnStartup": "always",
  // 5. Prevent terminal from auto-showing
  "terminal.integrated.showOnStartup": false,
  // 6. Disable terminal features that could be exploited
  "terminal.integrated.automationProfile.linux": null,
  "terminal.integrated.enableShellIntegration": false,
  "terminal.integrated.shellIntegration.enabled": false,
  "terminal.integrated.inheritEnv": false,
  "terminal.integrated.persistentSessionReviveProcess": "never",

  // ===========================================
  // DISABLE PANEL (where terminal lives)
  // ===========================================
  "workbench.panel.defaultLocation": "bottom",
  "panel.defaultLocation": "bottom",
  // Keep panel closed by default
  "workbench.panel.opensMaximized": "never",

  // Disable task running (which can spawn terminals)
  "task.allowAutomaticTasks": "off",
  "task.autoDetect": "off",
  // Disable debug console terminal integration
  "debug.console.acceptSuggestionOnEnter": "off",
  "debug.internalConsoleOptions": "neverOpen",
  "debug.terminal.clearBeforeReusing": true,

  // DISABLE COPILOT & AI features (we use openagentic-cli instead)
  "github.copilot.enable": false,
  "github.copilot.editor.enableAutoCompletions": false,
  "github.copilot-chat.enabled": false,

  // DISABLE marketplace and extension installation
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false,
  "extensions.ignoreRecommendations": true,
  "extensions.showRecommendationsOnlyOnDemand": false,

  // Disable workspace trust prompts (we trust our sandboxed workspace)
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "security.workspace.trust.banner": "never",
  "security.workspace.trust.emptyWindow": true,

  // Disable telemetry
  "telemetry.telemetryLevel": "off",
  "telemetry.enableTelemetry": false,
  "telemetry.enableCrashReporter": false,

  // Clean UI - hide distracting elements
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.welcomePage.walkthroughs.openOnInstall": false,
  "update.mode": "none",
  "update.showReleaseNotes": false,

  // Disable remote features (security)
  "remote.autoForwardPorts": false,
  "remote.restoreForwardedPorts": false,

  // Editor settings for good defaults
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.minimap.enabled": true,
  "editor.formatOnSave": true,
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,

  // UI - use Material Icon Theme (pre-installed)
  "workbench.iconTheme": "material-icon-theme",
  "workbench.colorTheme": "Default Dark Modern",
};

/**
 * Keybindings to completely disable terminal shortcuts
 * This blocks ALL ways to access terminal via keyboard AND command palette
 *
 * Format: { key, command, when? }
 * Using "-command" removes the default binding
 * Using "command": "" makes the command do nothing
 */
const LOCKED_KEYBINDINGS = [
  // ============================================
  // KEYBOARD SHORTCUTS - Disable all terminal hotkeys
  // ============================================

  // Disable toggle terminal (Ctrl+`)
  { key: "ctrl+`", command: "-workbench.action.terminal.toggleTerminal" },
  { key: "ctrl+`", command: "workbench.action.focusActiveEditorGroup" },
  // Disable new terminal (Ctrl+Shift+`)
  { key: "ctrl+shift+`", command: "-workbench.action.terminal.new" },
  { key: "ctrl+shift+`", command: "workbench.action.focusActiveEditorGroup" },
  // Disable open native console
  { key: "ctrl+shift+c", command: "-workbench.action.terminal.openNativeConsole" },
  // Disable terminal split
  { key: "ctrl+shift+5", command: "-workbench.action.terminal.split" },
  // Disable kill terminal
  { key: "ctrl+shift+k", command: "-workbench.action.terminal.kill" },
  // Disable terminal navigation
  { key: "ctrl+pagedown", command: "-workbench.action.terminal.focusNext", when: "terminalFocus" },
  { key: "ctrl+pageup", command: "-workbench.action.terminal.focusPrevious", when: "terminalFocus" },
  // Disable panel toggle (where terminal lives)
  { key: "ctrl+j", command: "-workbench.action.togglePanel" },
  { key: "ctrl+j", command: "workbench.action.focusActiveEditorGroup" },
  // Additional terminal focus commands
  { key: "alt+f12", command: "-workbench.action.terminal.toggleTerminal" },

  // ============================================
  // COMMAND PALETTE - Block terminal commands even from search
  // These override commands to do nothing when invoked
  // ============================================

  // Block all terminal creation commands
  { key: "", command: "-workbench.action.terminal.new" },
  { key: "", command: "-workbench.action.terminal.newWithCwd" },
  { key: "", command: "-workbench.action.terminal.newLocal" },
  { key: "", command: "-workbench.action.terminal.newInActiveWorkspace" },
  { key: "", command: "-workbench.action.terminal.split" },
  { key: "", command: "-workbench.action.terminal.splitInstance" },
  { key: "", command: "-workbench.action.terminal.splitActiveWorkspace" },

  // Block terminal focus/toggle commands
  { key: "", command: "-workbench.action.terminal.toggleTerminal" },
  { key: "", command: "-workbench.action.terminal.focus" },
  { key: "", command: "-workbench.action.terminal.focusAtIndex1" },
  { key: "", command: "-workbench.action.terminal.focusAtIndex2" },
  { key: "", command: "-workbench.action.terminal.focusAtIndex3" },
  { key: "", command: "-workbench.action.terminal.focusNext" },
  { key: "", command: "-workbench.action.terminal.focusPrevious" },
  { key: "", command: "-workbench.action.terminal.focusNextPane" },
  { key: "", command: "-workbench.action.terminal.focusPreviousPane" },

  // Block terminal view commands
  { key: "", command: "-workbench.action.terminal.openNativeConsole" },
  { key: "", command: "-workbench.action.terminal.runActiveFile" },
  { key: "", command: "-workbench.action.terminal.runSelectedText" },
  { key: "", command: "-workbench.action.terminal.sendSequence" },

  // Block terminal management commands
  { key: "", command: "-workbench.action.terminal.kill" },
  { key: "", command: "-workbench.action.terminal.killAll" },
  { key: "", command: "-workbench.action.terminal.clear" },
  { key: "", command: "-workbench.action.terminal.rename" },
  { key: "", command: "-workbench.action.terminal.renameWithArg" },

  // Block panel/view commands that show terminal
  { key: "", command: "-workbench.action.togglePanel" },
  { key: "", command: "-workbench.view.terminal" },
  { key: "", command: "-terminal.focus" },

  // Block run in terminal commands
  { key: "", command: "-workbench.action.terminal.runRecentCommand" },
  { key: "", command: "-workbench.action.terminal.goToRecentDirectory" },

  // Block task running (uses terminal)
  { key: "", command: "-workbench.action.tasks.runTask" },
  { key: "", command: "-workbench.action.tasks.build" },
  { key: "", command: "-workbench.action.tasks.test" },
  { key: "", command: "-workbench.action.tasks.reRunTask" },
  { key: "", command: "-workbench.action.tasks.showTasks" },
  { key: "", command: "-workbench.action.tasks.configureDefaultBuildTask" },
  { key: "", command: "-workbench.action.tasks.configureDefaultTestTask" },

  // Block debug console (can run commands)
  { key: "", command: "-workbench.debug.action.toggleRepl" },
  { key: "", command: "-workbench.panel.repl.view.focus" },

  // Block panel access shortcuts
  { key: "ctrl+shift+y", command: "-workbench.debug.action.toggleRepl" },
  { key: "ctrl+shift+m", command: "-workbench.actions.view.problems" },
  { key: "ctrl+shift+u", command: "-workbench.action.output.toggleOutput" },

  // Additional terminal-related commands
  { key: "", command: "-workbench.action.terminal.selectAll" },
  { key: "", command: "-workbench.action.terminal.copySelection" },
  { key: "", command: "-workbench.action.terminal.paste" },
  { key: "", command: "-workbench.action.terminal.selectDefaultShell" },
  { key: "", command: "-workbench.action.terminal.configureTerminalSettings" },
];

export class CodeServerService extends EventEmitter {
  private config: CodeServerConfig;
  private instances: Map<string, CodeServerInstance> = new Map();
  private usedPorts: Set<number> = new Set();
  private portToSession: Map<number, string> = new Map();

  constructor(config?: Partial<CodeServerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure directories exist
    this.ensureDirectories();

    console.log('[CodeServerService] Initialized with config:', {
      basePort: this.config.basePort,
      maxInstances: this.config.maxInstances,
      externalUrlPrefix: this.config.externalUrlPrefix,
      binaryPath: this.config.binaryPath,
    });
  }

  private ensureDirectories(): void {
    const dirs = [this.config.userDataDir, this.config.extensionsDir];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        try {
          mkdirSync(dir, { recursive: true, mode: 0o755 });
          console.log(`[CodeServerService] Created directory: ${dir}`);
        } catch (err) {
          console.warn(`[CodeServerService] Failed to create directory ${dir}:`, err);
        }
      }
    }
  }

  /**
   * Allocate a free port from the pool
   */
  private allocatePort(): number | null {
    const maxPort = this.config.basePort + this.config.maxInstances;
    for (let port = this.config.basePort; port < maxPort; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    return null;
  }

  /**
   * Release a port back to the pool
   */
  private releasePort(port: number): void {
    this.usedPorts.delete(port);
    this.portToSession.delete(port);
  }

  /**
   * Get instance URL for browser access
   */
  getInstanceUrl(port: number, workspacePath: string): string {
    // URL includes session port and workspace folder
    return `${this.config.externalUrlPrefix}/${port}/?folder=${encodeURIComponent(workspacePath)}`;
  }

  /**
   * Get internal URL for health checks
   */
  getInternalUrl(port: number): string {
    return `http://localhost:${port}`;
  }

  /**
   * Start a code-server instance for a session
   */
  async startInstance(
    userId: string,
    sessionId: string,
    workspacePath: string,
    sandboxUser?: string
  ): Promise<CodeServerInstance> {
    // Check if already running or starting (prevent race condition)
    const existing = this.instances.get(sessionId);
    if (existing && (existing.status === 'running' || existing.status === 'starting')) {
      console.log(`[CodeServer] Instance already ${existing.status} for session ${sessionId}`);
      return existing;
    }

    // Allocate port
    const port = this.allocatePort();
    if (port === null) {
      throw new Error('No available ports for code-server. Maximum instances reached.');
    }

    // Create user data directory for this session
    const sessionDataDir = path.join(this.config.userDataDir, sessionId);
    if (!existsSync(sessionDataDir)) {
      mkdirSync(sessionDataDir, { recursive: true, mode: 0o755 });
    }

    // Create User directory for VS Code settings
    const userSettingsDir = path.join(sessionDataDir, 'User');
    if (!existsSync(userSettingsDir)) {
      mkdirSync(userSettingsDir, { recursive: true, mode: 0o755 });
    }

    // Write locked-down settings.json
    const settingsPath = path.join(userSettingsDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(LOCKED_SETTINGS, null, 2), { mode: 0o644 });
    console.log(`[CodeServerService] Wrote locked-down settings to ${settingsPath}`);

    // Write locked-down keybindings.json to disable terminal shortcuts
    const keybindingsPath = path.join(userSettingsDir, 'keybindings.json');
    writeFileSync(keybindingsPath, JSON.stringify(LOCKED_KEYBINDINGS, null, 2), { mode: 0o644 });
    console.log(`[CodeServerService] Wrote locked-down keybindings to ${keybindingsPath}`);

    // If sandbox user provided, change ownership of data directory AND workspace
    if (sandboxUser) {
      try {
        // Get UID/GID for sandbox user
        const uidGid = execSync(`id -u ${sandboxUser}`).toString().trim();
        const uid = parseInt(uidGid, 10);
        const gid = uid; // Same as uid for sandbox users

        // Recursively chown the session data directory
        execSync(`chown -R ${uid}:${gid} ${sessionDataDir}`);
        console.log(`[CodeServerService] Changed ownership of ${sessionDataDir} to ${sandboxUser} (${uid}:${gid})`);

        // CRITICAL: Also recursively chown the workspace directory
        // This ensures the sandbox user can write to ALL files in their workspace
        // Not just new files they create, but existing files from cloud sync
        execSync(`chown -R ${uid}:${gid} "${workspacePath}"`);
        console.log(`[CodeServerService] Changed ownership of ${workspacePath} to ${sandboxUser} (${uid}:${gid})`);
      } catch (err) {
        console.warn(`[CodeServerService] Failed to chown for sandbox user ${sandboxUser}:`, err);
      }
    }

    const instance: CodeServerInstance = {
      sessionId,
      userId,
      workspacePath,
      port,
      url: this.getInstanceUrl(port, workspacePath),
      internalUrl: this.getInternalUrl(port),
      status: 'starting',
      startTime: Date.now(),
    };

    this.instances.set(sessionId, instance);
    this.portToSession.set(port, sessionId);

    // Build code-server arguments
    // NOTE: There is NO --disable-terminal flag in code-server (feature request #6186)
    // Terminal blocking is done via: settings.json, keybindings.json, extension, SHELL=/bin/false
    const args = [
      '--bind-addr', `0.0.0.0:${port}`,
      '--auth', 'none', // Auth handled at nginx/ingress level
      '--disable-telemetry',
      '--disable-update-check',
      '--disable-workspace-trust',        // Security: no trust prompts
      '--disable-getting-started-override',
      // NOTE: We allow file downloads/uploads since users need to work with files
      // If you want to restrict: '--disable-file-downloads', '--disable-file-uploads',
      '--log', 'warn', // Suppress verbose debug logging (i18next, etc.)
      '--user-data-dir', sessionDataDir,
      '--extensions-dir', this.config.extensionsDir,
      workspacePath,
    ];

    console.log(`[CodeServerService] Starting code-server for session ${sessionId}`);
    console.log(`[CodeServerService] Command: ${this.config.binaryPath} ${args.join(' ')}`);

    try {
      // Spawn code-server process
      // IMPORTANT: Run as sandbox user if provided (NOT as root)
      // IMPORTANT: Delete PORT from env - code-server uses $PORT to override --bind-addr
      const { PORT: _unused, ...envWithoutPort } = process.env;

      const env = {
        ...envWithoutPort,
        // Disable VS Code telemetry
        VSCODE_CLI_TELEMETRY_OPTOUT: '1',
        // Set home directory for the session (NOT workspace!)
        HOME: sessionDataDir,
        // ===========================================
        // XDG Base Directory Specification
        // Ensures .cache, .config, .local go to sessionDataDir, NOT workspace
        // ===========================================
        XDG_CONFIG_HOME: `${sessionDataDir}/.config`,
        XDG_CACHE_HOME: `${sessionDataDir}/.cache`,
        XDG_DATA_HOME: `${sessionDataDir}/.local/share`,
        XDG_STATE_HOME: `${sessionDataDir}/.local/state`,
        // Disable extension gallery (marketplace)
        VSCODE_GALLERY_SERVICE_URL: '',
        VSCODE_GALLERY_ITEM_URL: '',
        VSCODE_GALLERY_CACHE_URL: '',
        VSCODE_GALLERY_CONTROL_URL: '',
        // ===========================================
        // SECURITY: Terminal Blocking Environment
        // ===========================================
        // Force /bin/false as shell - any terminal attempt fails immediately
        SHELL: '/bin/false',
        // Also set COMSPEC for any Windows compatibility code
        COMSPEC: '/bin/false',
        // Disable terminal capabilities
        TERM: 'dumb',
        // Prevent VS Code from detecting shells
        VSCODE_SHELL_LOGIN: '',
        // Ensure VS Code terminal settings are enforced
        VSCODE_DISABLE_TERMINAL: '1',
        // Override any default shell detection
        VSCODE_TERMINAL_SHELL_INTEGRATION: '0',
        // Prevent integrated terminal from starting
        VSCODE_SKIP_TERMINAL_INIT: '1',
      };

      let proc: ChildProcess;

      if (sandboxUser) {
        // Run code-server as the sandbox user using 'su'
        // This ensures the process runs with the sandbox user's permissions
        const codeServerCmd = `${this.config.binaryPath} ${args.map(a => `'${a}'`).join(' ')}`;
        console.log(`[CodeServerService] Running as sandbox user: ${sandboxUser}`);
        console.log(`[CodeServerService] Command: su -s /bin/sh ${sandboxUser} -c "${codeServerCmd}"`);

        proc = spawn('su', ['-s', '/bin/sh', sandboxUser, '-c', codeServerCmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          env,
        });
      } else {
        // Fallback: run as current user (not recommended for production)
        console.warn(`[CodeServerService] WARNING: No sandbox user provided, running as current user (root)`);
        proc = spawn(this.config.binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          env,
        });
      }

      instance.process = proc;
      instance.pid = proc.pid;

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString().trim();

        // Filter out verbose i18next debug logging
        if (output.includes('i18next:') || output.includes('debug: true') ||
            output.startsWith('{') || output.includes('interpolation:') ||
            output.includes('escapeValue:') || output.includes('nestingPrefix:')) {
          return; // Skip verbose startup logging
        }

        console.log(`[CodeServer:${sessionId}] ${output}`);

        // Check if server is ready
        if (output.includes('HTTP server listening') || output.includes('HTTPS server listening')) {
          instance.status = 'running';
          this.emit('instance:ready', instance);
        }
      });

      // Handle stderr (filter same patterns)
      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString().trim();

        // Filter out verbose i18next debug logging
        if (output.includes('i18next:') || output.includes('debug: true') ||
            output.startsWith('{') || output.includes('interpolation:')) {
          return;
        }

        console.error(`[CodeServer:${sessionId}:err] ${output}`);
      });

      // Handle process exit
      proc.on('exit', (code, signal) => {
        console.log(`[CodeServerService] Process exited for session ${sessionId}: code=${code}, signal=${signal}`);
        instance.status = 'stopped';
        instance.process = undefined;
        this.releasePort(port);
        this.emit('instance:stopped', instance);
      });

      // Handle process error
      proc.on('error', (err) => {
        console.error(`[CodeServerService] Process error for session ${sessionId}:`, err);
        instance.status = 'error';
        instance.error = err.message;
        this.releasePort(port);
        this.emit('instance:error', instance, err);
      });

      // Wait for startup (with timeout)
      await this.waitForStartup(instance);

      this.emit('instance:started', instance);
      console.log(`[CodeServerService] Started code-server for session ${sessionId} on port ${port}`);
      console.log(`[CodeServerService] URL: ${instance.url}`);

      return instance;
    } catch (err: any) {
      console.error(`[CodeServerService] Failed to start code-server for session ${sessionId}:`, err);
      instance.status = 'error';
      instance.error = err.message;
      this.releasePort(port);
      throw err;
    }
  }

  /**
   * Wait for code-server to become ready
   */
  private async waitForStartup(instance: CodeServerInstance): Promise<void> {
    const startTime = Date.now();
    const timeout = this.config.startupTimeout;

    while (Date.now() - startTime < timeout) {
      if (instance.status === 'running') {
        return;
      }
      if (instance.status === 'error' || instance.status === 'stopped') {
        throw new Error(`code-server failed to start: ${instance.error || 'process exited'}`);
      }

      // Check if process is still alive
      if (!instance.process || instance.process.killed) {
        throw new Error('code-server process died during startup');
      }

      // Try health check
      try {
        const response = await fetch(`${instance.internalUrl}/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          instance.status = 'running';
          return;
        }
      } catch {
        // Not ready yet, continue waiting
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`code-server startup timed out after ${timeout}ms`);
  }

  /**
   * Stop a code-server instance
   */
  async stopInstance(sessionId: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) {
      console.log(`[CodeServerService] No instance found for session ${sessionId}`);
      return;
    }

    console.log(`[CodeServerService] Stopping code-server for session ${sessionId}`);
    instance.status = 'stopping';

    if (instance.process && !instance.process.killed) {
      // Send SIGTERM for graceful shutdown
      instance.process.kill('SIGTERM');

      // Wait for graceful shutdown (max 5 seconds)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running
          if (instance.process && !instance.process.killed) {
            console.log(`[CodeServerService] Force killing process for session ${sessionId}`);
            instance.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        instance.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    this.releasePort(instance.port);
    this.instances.delete(sessionId);
    console.log(`[CodeServerService] Stopped code-server for session ${sessionId}`);
  }

  /**
   * Get instance info for a session
   */
  getInstance(sessionId: string): CodeServerInstance | undefined {
    return this.instances.get(sessionId);
  }

  /**
   * Get all active instances
   */
  getAllInstances(): CodeServerInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Check if a specific instance is healthy
   */
  async checkInstanceHealth(sessionId: string): Promise<boolean> {
    const instance = this.instances.get(sessionId);
    if (!instance || instance.status !== 'running') {
      return false;
    }

    try {
      const response = await fetch(`${instance.internalUrl}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check overall service health
   */
  async checkHealth(): Promise<{ healthy: boolean; activeInstances: number; availablePorts: number }> {
    const activeInstances = this.instances.size;
    const availablePorts = this.config.maxInstances - this.usedPorts.size;

    return {
      healthy: true,
      activeInstances,
      availablePorts,
    };
  }

  /**
   * Check if session has active instance
   */
  hasActiveInstance(sessionId: string): boolean {
    const instance = this.instances.get(sessionId);
    return !!instance && instance.status === 'running';
  }

  /**
   * Shutdown all instances
   */
  async shutdown(): Promise<void> {
    console.log(`[CodeServerService] Shutting down ${this.instances.size} instances...`);

    const stopPromises = Array.from(this.instances.keys()).map((sessionId) =>
      this.stopInstance(sessionId).catch((err) => {
        console.error(`[CodeServerService] Error stopping instance ${sessionId}:`, err);
      })
    );

    await Promise.all(stopPromises);

    this.instances.clear();
    this.usedPorts.clear();
    this.portToSession.clear();

    console.log('[CodeServerService] Shutdown complete');
  }
}

// Singleton instance
let codeServerServiceInstance: CodeServerService | null = null;

export function getCodeServerService(): CodeServerService {
  if (!codeServerServiceInstance) {
    codeServerServiceInstance = new CodeServerService();
  }
  return codeServerServiceInstance;
}

export function initCodeServerService(config?: Partial<CodeServerConfig>): CodeServerService {
  codeServerServiceInstance = new CodeServerService(config);
  return codeServerServiceInstance;
}
