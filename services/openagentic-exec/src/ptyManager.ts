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
 * PTY Session Manager for Exec Daemon
 *
 * Manages PTY-based CLI sessions with user sandboxing.
 * Each session runs the openagentic CLI in an isolated environment.
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { join } from 'path';
import { loggers } from './logger.js';
import { existsSync, mkdirSync, watch, readFileSync, unlinkSync } from 'fs';
import { config } from './config';
import {
  createSandboxUser,
  // deleteSandboxUser not used — sandbox users persist for pod lifetime
  buildSandboxedCommand,
  getSandboxEnv,
  SandboxUser,
  CreateSandboxUserOptions,
} from './userSandbox';

// Startup event types for SSE streaming
export type StartupEventType =
  | 'pty_spawning'
  | 'pty_spawned'
  | 'cli_initializing'
  | 'cli_ready'
  | 'cli_error'
  | 'sandbox_creating'
  | 'sandbox_created'
  | 'workspace_validating'
  | 'workspace_ready';

export interface StartupEvent {
  type: StartupEventType;
  message: string;
  timestamp: number;
  sessionId: string;
  details?: Record<string, any>;
}

// Readiness check result
export interface ReadinessResult {
  ready: boolean;
  cliResponsive: boolean;
  startupPhase: StartupEventType;
  message: string;
  details?: {
    pid: number;
    uptime: number;
    lastActivity: number;
    outputSample?: string;
  };
}

export interface PtySession {
  id: string;
  userId: string;
  /**
   * The underlying node-pty process. Null while the session is in
   * 'pending' status — we defer pty.spawn until the WebSocket client
   * sends its first resize message so Ink's very first layout pass runs
   * against the real viewport dims instead of spawn defaults. Once
   * attachClient() runs, this is populated and stays non-null for the
   * rest of the session's lifetime.
   */
  pty: pty.IPty | null;
  sandboxUser: SandboxUser | null;
  workspacePath: string;
  model?: string;  // Model used for CLI
  apiKey?: string;  // User's API key for platform LLM access (also used by Continue extension)
  apiEndpoint?: string;  // API endpoint URL
  status: 'pending' | 'starting' | 'running' | 'stopped' | 'error';
  /** CLI readiness status - only true when CLI is confirmed responsive */
  cliReady: boolean;
  /** Current startup phase */
  startupPhase: StartupEventType;
  /** Startup events log */
  startupEvents: StartupEvent[];
  createdAt: number;
  lastActivity: number;
  pid: number;
  outputBuffer: string;
  /** Set to true when session is intentionally stopped (not crashed) to prevent race conditions with sandbox user cleanup */
  intentionalStop?: boolean;
  /** Number of auto-restarts (CLI must never stay dead in code mode) */
  restartCount?: number;
  /** Pending readiness check callback */
  pendingReadinessCheck?: {
    resolve: (result: ReadinessResult) => void;
    timeout: NodeJS.Timeout;
    marker: string;
  };
  /**
   * Spawn args captured by createSession, consumed by attachClient when
   * the WS client delivers its first resize message. Cleared once the
   * PTY is actually spawned so subsequent restarts read from the stored
   * shellCommand/shellArgs/env closure instead.
   */
  pendingSpawn?: {
    shellCommand: string;
    shellArgs: string[];
    env: Record<string, string>;
  };
}

export interface CreateSessionOptions {
  sessionId: string;
  userId: string;
  userEmail?: string;  // User's email for Linux username (e.g., john.doe@company.com -> john-doe)
  workspacePath: string;  // REQUIRED - must be the user's MinIO-synced workspace
  model?: string;
  apiKey?: string;
  apiEndpoint?: string;  // API endpoint for platform LLM access
}

export class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();

  constructor() {
    super();
  }

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
   * Scan the user's .openagentic project transcript files and rename any
   * oversized ones so `--continue` skips them. openagentic's Ink REPL
   * rehydrates the most-recent session from
   *   <workspace>/.openagentic/projects/<slug>/<uuid>.jsonl
   * on startup, and a transcript above ~500KB (thousands of tool-call
   * entries) causes the very first React layout pass to block — no
   * frames ever reach the PTY, the WS sees only the setup escape
   * preamble, and the browser canvas stays blank.
   *
   * The safe behaviour is to bail into a fresh session rather than hang
   * forever. Renaming to .quarantined keeps the data around for manual
   * inspection but takes it out of --continue's selection set. Threshold
   * is intentionally conservative (300KB) — well under the hang point
   * but above any realistic healthy transcript.
   */
  private quarantineOversizedSessions(workspacePath: string, sessionId: string): void {
    const QUARANTINE_SIZE_BYTES = 300 * 1024;
    const projectsRoot = join(workspacePath, '.openagentic', 'projects');
    if (!existsSync(projectsRoot)) return;

    const { readdirSync, statSync, renameSync } = require('fs') as typeof import('fs');

    let quarantined = 0;
    for (const projectSlug of readdirSync(projectsRoot)) {
      const projectDir = join(projectsRoot, projectSlug);
      let stat;
      try {
        stat = statSync(projectDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      for (const fname of readdirSync(projectDir)) {
        if (!fname.endsWith('.jsonl')) continue;
        const fpath = join(projectDir, fname);
        let fstat;
        try {
          fstat = statSync(fpath);
        } catch {
          continue;
        }
        if (fstat.size < QUARANTINE_SIZE_BYTES) continue;

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const dest = `${fpath}.${ts}.quarantined`;
        try {
          renameSync(fpath, dest);
          quarantined++;
          loggers.pty.warn(
            { sessionId, file: fname, sizeBytes: fstat.size, quarantinedAs: fname + '.quarantined' },
            'Quarantined oversized session transcript (would hang openagentic --continue)',
          );
        } catch (renameErr) {
          loggers.pty.warn(
            { sessionId, file: fname, err: renameErr instanceof Error ? renameErr.message : String(renameErr) },
            'Failed to quarantine oversized session file',
          );
        }
      }
    }

    if (quarantined > 0) {
      loggers.pty.info(
        { sessionId, count: quarantined, threshold: QUARANTINE_SIZE_BYTES },
        `Quarantined ${quarantined} oversized session file(s) before --continue`,
      );
    }
  }

  /**
   * Create a new PTY session
   */
  async createSession(options: CreateSessionOptions): Promise<PtySession> {
    const { sessionId, userId, userEmail, workspacePath, apiKey, apiEndpoint } = options;
    // Use provided model or fall back to config default (from DEFAULT_MODEL env)
    const model = options.model || config.defaultModel;

    // Check if session already exists
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // SECURITY: Validate workspace path - no fallbacks allowed
    if (!workspacePath) {
      throw new Error('workspacePath is required - must be provided by openagentic-manager');
    }

    // SECURITY: Ensure workspace is within user's allowed directory
    this.validateWorkspacePath(userId, workspacePath);

    // Ensure workspace exists (should already exist from MinIO sync)
    if (!existsSync(workspacePath)) {
      mkdirSync(workspacePath, { recursive: true });
    }

    loggers.pty.info({ sessionId, userId, userEmail, workspacePath }, 'Creating session');

    // Quarantine oversized --continue session state. openagentic's Ink REPL
    // hangs during its first layout pass when --continue tries to rehydrate
    // a jsonl transcript above ~500KB — the WASM WASM parser blocks inside
    // message rehydration, no frames ever emit to stdout, and the user sees
    // a blank canvas. Detected 2026-04-11 against a 1MB session file for
    // Trent's account. Safer to bail into a fresh session than to hang.
    try {
      this.quarantineOversizedSessions(workspacePath, sessionId);
    } catch (err) {
      loggers.pty.warn(
        { sessionId, err: err instanceof Error ? err.message : String(err) },
        'Session-state quarantine scan failed (non-fatal)',
      );
    }

    let sandboxUser: SandboxUser | null = null;
    let shellCommand: string;
    let shellArgs: string[];
    let env: Record<string, string>;

    // Default API endpoint for platform LLM access
    const effectiveApiEndpoint = apiEndpoint || process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000';

    // Emit workspace validation event
    const tempSession = { id: sessionId, startupEvents: [] as StartupEvent[], startupPhase: 'workspace_validating' as StartupEventType };
    this.emitStartupEvent(tempSession as PtySession, 'workspace_validating', `Validating workspace: ${workspacePath}`);

    // Build OpenAgentic CLI args — native interactive mode
    // v2 runs as a full TUI. The PTY captures output and the manager forwards it.
    // No --print/--output-format/--input-format — those only work for one-shot mode.
    const cliArgs = [
      config.openagenticPath,
      '--verbose',
      '--allow-permissive',
      '--permissive',
      '--continue',        // Always resume from last session — persistent context across reconnects
    ];

    // DO NOT pass --model — let the platform smart router decide (same as chat mode)
    // The API endpoint handles model selection based on slider tiers and provider routing

    // Pass auth via both CLI flags AND env vars for maximum compatibility
    if (apiKey) {
      cliArgs.push('--api-key', apiKey);
      cliArgs.push('--api-endpoint', `${effectiveApiEndpoint}/api/openagentic`);
    } else if (config.ollamaHost) {
      cliArgs.push('--ollama-host', config.ollamaHost);
    }

    // Fetch codemode admin config for managed settings injection (marketplace lock)
    let codemodeConfig: any = null;
    try {
      const configUrl = `${config.openagenticApiEndpoint || effectiveApiEndpoint}/api/admin/codemode/config-bundle-internal`;
      const resp = await fetch(configUrl, {
        headers: config.internalApiKey ? { 'X-Internal-API-Key': config.internalApiKey } : {},
      });
      if (resp.ok) {
        codemodeConfig = await resp.json();
        loggers.pty.info({ sessionId }, 'Fetched codemode admin config for managed injection');
      }
    } catch (err) {
      loggers.pty.warn({ err }, 'Failed to fetch codemode admin config — session will run without managed lockdown');
    }

    if (config.sandboxEnabled) {
      // Emit sandbox creation event
      this.emitStartupEvent(tempSession as PtySession, 'sandbox_creating', 'Creating sandbox user environment...');

      // Create sandbox user with email-based username + managed config injection
      sandboxUser = await createSandboxUser({
        userEmail: userEmail || '',
        workspacePath,
        sessionId, // fallback if no email
        ...(codemodeConfig ? { managedSettings: codemodeConfig.managedSettings, managedMcp: codemodeConfig.managedMcp } : {}),
      } as any);

      this.emitStartupEvent(tempSession as PtySession, 'sandbox_created', `Sandbox user created: ${sandboxUser.username}`);

      const cliCommand = `cd "${workspacePath}" && ${cliArgs.join(' ')}`;

      // Run CLI with sandbox
      const sandboxedCommand = buildSandboxedCommand(sandboxUser.username, cliCommand);

      shellCommand = '/bin/bash';
      shellArgs = ['-c', sandboxedCommand];

      const sandboxEnv = getSandboxEnv(sandboxUser, apiKey, effectiveApiEndpoint, model);

      env = {
        ...process.env,
        ...sandboxEnv,
        OPENAGENTIC_MANAGED: '1',
        OPENAGENTIC_SESSION_ID: sessionId,
        OPENAGENTIC_USER_ID: userId,
        CONTAINER_MODE: '1',
        MCP_PROXY_URL: process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080',
      } as Record<string, string>;
    } else {
      // No sandbox - run directly (less secure, for development)
      shellCommand = config.openagenticPath;
      shellArgs = [
        '--verbose',
        '--allow-dangerously-skip-permissions',
        '--dangerously-skip-permissions',
      ];

      // DO NOT pass --model — smart router decides

      // Auth via env vars
      if (!apiKey && config.ollamaHost) {
        shellArgs.push('--ollama-host', config.ollamaHost);
      }

      env = {
        ...process.env,
        HOME: workspacePath,
        OPENAGENTIC_API_KEY: apiKey || '',
        ANTHROPIC_API_KEY: apiKey || '',
        ANTHROPIC_BASE_URL: apiKey ? `${effectiveApiEndpoint}/api/openagentic` : '',
        OPENAGENTIC_API_ENDPOINT: effectiveApiEndpoint,
        OPENAGENTIC_MANAGED: '1',
        OPENAGENTIC_SESSION_ID: sessionId,
        OPENAGENTIC_USER_ID: userId,
        CONTAINER_MODE: '1',
        MCP_PROXY_URL: process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080',
      } as Record<string, string>;
    }

    // Spawn the PTY immediately at default dims. The earlier deferred-
    // spawn experiment (wait for first client resize before spawning)
    // caused openagentic to hang after emitting setup escapes — it seems
    // Ink doesn't handle the case where stdout is attached to a PTY that
    // gets SIGWINCH'd during its first layout pass, and the symptoms were
    // indistinguishable from a blocked DA1 query. Going back to the
    // known-working pattern: spawn at 120×40, let SIGWINCH reflow happen
    // naturally when the client's first resize arrives.
    const session: PtySession = {
      id: sessionId,
      userId,
      pty: null as any, // populated immediately below by spawnPtyInto
      sandboxUser,
      workspacePath,
      model,
      apiKey,
      apiEndpoint: effectiveApiEndpoint,
      status: 'starting',
      cliReady: false,
      startupPhase: 'pty_spawning',
      startupEvents: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      pid: 0,
      outputBuffer: '',
    };
    this.sessions.set(sessionId, session);
    return this.spawnPtyInto(session, shellCommand, shellArgs, env, 120, 40);
  }

  /**
   * Spawn the actual node-pty process for a session and wire all the
   * lifecycle handlers (readiness file-watch, onData forwarding,
   * onExit auto-restart). Split out of createSession so both the
   * normal creation path and the attachClient deferred path can share
   * it. Mutates the session in place and returns it.
   */
  private spawnPtyInto(
    session: PtySession,
    shellCommand: string,
    shellArgs: string[],
    env: Record<string, string>,
    cols: number,
    rows: number,
  ): PtySession {
    const sessionId = session.id;
    const workspacePath = session.workspacePath;
    const safeCols = Math.max(2, Math.floor(cols));
    const safeRows = Math.max(1, Math.floor(rows));

    loggers.pty.info({ sessionId, cols: safeCols, rows: safeRows }, 'Spawning PTY');

    const ptyProcess = pty.spawn(shellCommand, shellArgs, {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: workspacePath,
      env,
    });

    session.pty = ptyProcess;
    session.pid = ptyProcess.pid;
    session.status = 'running';
    session.startupPhase = 'pty_spawned';

    this.emitStartupEvent(session, 'pty_spawned', `PTY process spawned (PID: ${ptyProcess.pid})`);
    this.emitStartupEvent(session, 'cli_initializing', 'Waiting for CLI to initialize...');

    // File-watch readiness detection: CLI writes .openagentic-ready when REPL mounts.
    const readyMarkerPath = join(workspacePath, '.openagentic-ready');
    try { unlinkSync(readyMarkerPath); } catch { /* stale marker from previous session */ }

    let readyWatcher: ReturnType<typeof watch> | null = null;
    try {
      readyWatcher = watch(workspacePath, (_, filename) => {
        if (filename === '.openagentic-ready' && !session.cliReady) {
          try {
            const marker = JSON.parse(readFileSync(readyMarkerPath, 'utf-8'));
            if (marker.ready === true) {
              session.cliReady = true;
              readyWatcher?.close();
              readyWatcher = null;
              this.emitStartupEvent(session, 'cli_ready', 'CLI initialized (ready marker detected)', {
                pid: marker.pid, timestamp: marker.ts, detectedVia: 'file-watch',
              });
              loggers.pty.info({ sessionId, pid: marker.pid }, 'CLI ready via file-watch marker');
            }
          } catch { /* partial write, retry on next fs event */ }
        }
      });
    } catch (watchErr) {
      loggers.pty.warn({ sessionId, err: watchErr }, 'Failed to start readiness file-watch, falling back to ANSI detection');
    }

    const readyTimeout = setTimeout(() => {
      readyWatcher?.close();
      readyWatcher = null;
      if (!session.cliReady) {
        this.emitStartupEvent(session, 'cli_error', 'CLI did not signal readiness within 60 seconds', {
          outputSample: session.outputBuffer.slice(-500),
        });
        loggers.pty.error({ sessionId }, 'CLI readiness timeout — no .openagentic-ready marker after 60s');
      }
    }, 60000);

    ptyProcess.onData((data: string) => {
      session.lastActivity = Date.now();
      session.outputBuffer += data;
      if (session.outputBuffer.length > 100000) {
        session.outputBuffer = session.outputBuffer.slice(-50000);
      }
      loggers.pty.debug({ sessionId, chars: data.length }, 'Session output');
      this.detectCliReady(session, data);
      if (session.pendingReadinessCheck) {
        const { marker, resolve, timeout } = session.pendingReadinessCheck;
        if (data.includes(marker)) {
          clearTimeout(timeout);
          session.pendingReadinessCheck = undefined;
          resolve({
            ready: true,
            cliResponsive: true,
            startupPhase: session.startupPhase,
            message: 'CLI is responsive and ready',
            details: {
              pid: session.pid,
              uptime: Date.now() - session.createdAt,
              lastActivity: session.lastActivity,
              outputSample: session.outputBuffer.slice(-500),
            },
          });
        }
      }
      this.emit('data', sessionId, data);
    });

    const handlePtyExit = (exitCode: number, signal: number) => {
      loggers.pty.info({ sessionId, exitCode, signal, intentionalStop: session.intentionalStop }, 'CLI process exited');
      if (session.intentionalStop) {
        session.status = 'stopped';
        this.emit('exit', sessionId, exitCode, signal);
        return;
      }
      this.restartCli(session, shellCommand, shellArgs, workspacePath, env, handlePtyExit);
    };

    ptyProcess.onExit(({ exitCode, signal }) => {
      readyWatcher?.close();
      readyWatcher = null;
      clearTimeout(readyTimeout);
      handlePtyExit(exitCode ?? 0, signal ?? 0);
    });

    return session;
  }

  /**
   * Kept for WebSocket handler compatibility. With immediate spawn
   * restored, the PTY is already live by the time the WS connects, so
   * this just routes to the normal resize() path.
   */
  attachClient(sessionId: string, cols: number, rows: number): PtySession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.resize(sessionId, cols, rows);
    return session;
  }

  /**
   * Auto-restart the CLI process for a session.
   * In code mode the CLI must never stay dead — /exit, Ctrl+D, or crashes all trigger a respawn.
   */
  private restartCli(
    session: PtySession,
    shellCommand: string,
    shellArgs: string[],
    workspacePath: string,
    env: Record<string, string>,
    onExit: (exitCode: number, signal: number) => void,
  ): void {
    const MAX_RESTARTS = 10;
    const RESTART_DELAY_MS = 2000;
    const sessionId = session.id;

    session.restartCount = (session.restartCount || 0) + 1;

    if (session.restartCount > MAX_RESTARTS) {
      loggers.pty.error({ sessionId, restartCount: session.restartCount }, 'CLI exceeded max restart attempts');
      session.status = 'stopped';
      this.emit('exit', sessionId, 1, 0);
      return;
    }

    loggers.pty.info({ sessionId, restartCount: session.restartCount }, 'Auto-restarting CLI');

    // Show restart banner in terminal
    const msg = `\r\n\x1b[33m⟳ OpenAgentic restarting... (${session.restartCount}/${MAX_RESTARTS})\x1b[0m\r\n`;
    this.emit('data', sessionId, msg);

    const delay = RESTART_DELAY_MS * Math.min(session.restartCount, 5);
    setTimeout(() => {
      if (!this.sessions.has(sessionId) || session.intentionalStop) return;

      try {
        const cols = session.pty?.cols ?? 120;
        const rows = session.pty?.rows ?? 40;
        const newPty = pty.spawn(shellCommand, shellArgs, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: workspacePath,
          env,
        });

        session.pty = newPty;
        session.pid = newPty.pid;
        session.status = 'running';
        session.cliReady = false;
        session.outputBuffer = '';

        newPty.onData((data: string) => {
          session.lastActivity = Date.now();
          session.outputBuffer += data;
          if (session.outputBuffer.length > 100000) {
            session.outputBuffer = session.outputBuffer.slice(-50000);
          }
          this.detectCliReady(session, data);
          this.emit('data', sessionId, data);
        });

        newPty.onExit(({ exitCode, signal }) => onExit(exitCode ?? 0, signal ?? 0));

        loggers.pty.info({ sessionId, pid: newPty.pid, restartCount: session.restartCount }, 'CLI auto-restarted');
      } catch (err) {
        loggers.pty.error({ sessionId, err }, 'Failed to auto-restart CLI');
        session.status = 'stopped';
        this.emit('exit', sessionId, 1, 0);
      }
    }, delay);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): PtySession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Write data to a session's PTY
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'running' && session.pty) {
      session.pty.write(data);
      session.lastActivity = Date.now();
    }
  }

  /**
   * Pending resize timers per session — prevents SIGWINCH storms during
   * rapid splitter drag. Only the final resize in a 50ms burst fires.
   */
  private resizeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Resize a session's PTY (debounced: 50ms server-side)
   *
   * Combined with the client's 100ms debounce, the child process sees
   * at most one SIGWINCH per ~150ms during continuous drag — well within
   * Ink's processing capacity (~16ms per render).
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;

    // Clear any pending resize for this session
    const pending = this.resizeTimers.get(sessionId);
    if (pending) clearTimeout(pending);

    // Debounce: fire after 50ms of no further resize messages
    this.resizeTimers.set(sessionId, setTimeout(() => {
      this.resizeTimers.delete(sessionId);
      // Guard: PTY may have been closed between setTimeout and callback
      try {
        if (session.status === 'running' && session.pty) {
          session.pty.resize(cols, rows);
        }
      } catch {
        // ENOTTY: PTY was closed — safe to ignore
      }
    }, 50));
  }

  /**
   * Stop a session
   */
  async stopSession(sessionId: string, options?: { keepSandbox?: boolean }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const keepSandbox = options?.keepSandbox ?? false;
    loggers.pty.info({ sessionId, keepSandbox }, 'Stopping session');

    // Mark as intentional stop to prevent race conditions with onExit cleanup
    session.intentionalStop = true;

    // Send SIGTERM to gracefully stop (skip if still pending — no PTY yet)
    try {
      session.pty?.kill('SIGTERM');
    } catch {
      // Process might already be dead
    }

    // Wait a bit, then force kill if needed
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (session.status === 'running') {
      try {
        session.pty?.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }

    session.status = 'stopped';

    // NEVER delete sandbox user — exec pods are permanent per-user.
    // The sandbox user persists for the entire pod lifecycle so that:
    // 1. Auto-restart can reuse the same user without re-creation
    // 2. Code-server and other user processes keep running
    // 3. File ownership remains consistent
    // The user is only cleaned up when the pod itself is destroyed.

    this.sessions.delete(sessionId);
    loggers.pty.info({ sessionId }, 'Session stopped and cleaned up');
  }

  /**
   * Get session status
   */
  getSessionStatus(sessionId: string): {
    id: string;
    userId: string;
    status: string;
    workspacePath: string;
    pid: number;
    createdAt: number;
    lastActivity: number;
    cliReady: boolean;
    startupPhase: StartupEventType;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      id: session.id,
      userId: session.userId,
      status: session.status,
      workspacePath: session.workspacePath,
      pid: session.pid,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      cliReady: session.cliReady,
      startupPhase: session.startupPhase,
    };
  }

  /**
   * Emit a startup event for SSE streaming
   */
  private emitStartupEvent(session: PtySession, type: StartupEventType, message: string, details?: Record<string, any>): void {
    const event: StartupEvent = {
      type,
      message,
      timestamp: Date.now(),
      sessionId: session.id,
      details,
    };
    session.startupPhase = type;
    session.startupEvents.push(event);

    // Keep only last 50 events
    if (session.startupEvents.length > 50) {
      session.startupEvents = session.startupEvents.slice(-50);
    }

    loggers.pty.info({ type, message }, 'Startup event');
    this.emit('startup', session.id, event);
  }

  /**
   * Detect CLI ready state from output
   * Look for patterns that indicate the CLI has initialized
   */
  private detectCliReady(session: PtySession, data: string): void {
    if (session.cliReady) return; // Already ready

    // Look for various ready indicators.
    // The CLI runs in TUI mode (Ink framework) which outputs ANSI escape sequences,
    // NOT NDJSON. The TUI renders a prompt (❯), sets the terminal title to "OpenAgentic",
    // and enables mouse tracking. We detect these patterns.
    const readyPatterns = [
      'OpenAgentic',           // Terminal title or TUI header (TUI mode)
      '\u276F',               // ❯ prompt character (TUI mode, unicode)
      '\xE2\x9D\xAF',        // ❯ prompt character (UTF-8 bytes)
      '?1006h',               // SGR mouse mode enabled (Ink TUI startup)
      '"type":"system"',      // System message from CLI (NDJSON mode)
      '"type":"init"',        // Init message (NDJSON mode)
      '"type":"ready"',       // Ready event (NDJSON mode)
      '"type":"start"',       // Stream start event (NDJSON mode)
      'Entering interactive mode', // Interactive mode message
      'Ready for input',      // Ready prompt
      '{"role":"assistant"',  // Assistant response started
      'OPENAGENTIC_READY',     // Explicit ready marker
    ];

    // Also look for error patterns to detect failures
    const errorPatterns = [
      'ENOENT',               // File not found
      'ECONNREFUSED',         // Connection refused
      'ECONNRESET',           // Connection reset
      'Unable to connect',    // Connection error
      'Failed to connect',    // Generic connection failure
      'Error:',               // Generic error
      'error:',               // lowercase error
      'Authentication failed', // Auth failure
      'Invalid API key',      // API key issue
    ];

    for (const pattern of readyPatterns) {
      if (data.includes(pattern)) {
        session.cliReady = true;
        this.emitStartupEvent(session, 'cli_ready', 'CLI initialized and ready', {
          detectedPattern: pattern,
          outputSample: data.substring(0, 200),
        });
        return;
      }
    }

    for (const pattern of errorPatterns) {
      if (data.includes(pattern)) {
        const outputSample = data.substring(0, 500);
        loggers.pty.error({ pattern, outputSample }, 'CLI error output captured');
        this.emitStartupEvent(session, 'cli_error', `CLI error detected: ${pattern}`, {
          errorPattern: pattern,
          outputSample,
        });
        // Don't set cliReady to false - it might recover
        return;
      }
    }
  }

  /**
   * Check if CLI is ready by sending a test command
   * Returns a promise that resolves when CLI responds
   */
  async checkReadiness(sessionId: string, timeoutMs: number = 10000): Promise<ReadinessResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        ready: false,
        cliResponsive: false,
        startupPhase: 'cli_error',
        message: 'Session not found',
      };
    }

    if (session.status !== 'running') {
      return {
        ready: false,
        cliResponsive: false,
        startupPhase: session.startupPhase,
        message: `Session is ${session.status}`,
      };
    }

    // If already marked ready, do a quick check
    if (session.cliReady) {
      // Still verify CLI is responsive with a test
      const marker = `READY_CHECK_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          session.pendingReadinessCheck = undefined;
          // CLI didn't respond, but session is running - maybe it's busy
          resolve({
            ready: session.cliReady,
            cliResponsive: false,
            startupPhase: session.startupPhase,
            message: session.cliReady
              ? 'CLI was ready but did not respond to test (may be busy)'
              : 'CLI did not respond within timeout',
            details: {
              pid: session.pid,
              uptime: Date.now() - session.createdAt,
              lastActivity: session.lastActivity,
              outputSample: session.outputBuffer.slice(-500),
            },
          });
        }, timeoutMs);

        session.pendingReadinessCheck = { resolve, timeout, marker };

        // Send a simple echo command that will appear in output
        // For JSON-based CLI, send a ping message
        const pingMessage = JSON.stringify({ type: 'ping', marker }) + '\n';
        session.pty?.write(pingMessage);
      });
    }

    // Not ready yet - check based on startup phase and timing
    const uptime = Date.now() - session.createdAt;

    // If CLI has had recent activity and uptime > 2s, consider it "starting"
    if (uptime < 5000) {
      return {
        ready: false,
        cliResponsive: false,
        startupPhase: session.startupPhase,
        message: 'CLI is starting up, please wait...',
        details: {
          pid: session.pid,
          uptime,
          lastActivity: session.lastActivity,
        },
      };
    }

    // Been running for a while but not ready - check if there's activity
    const timeSinceActivity = Date.now() - session.lastActivity;
    if (timeSinceActivity < 5000 && session.outputBuffer.length > 0) {
      // Recent activity - CLI is doing something
      return {
        ready: false,
        cliResponsive: true,
        startupPhase: session.startupPhase,
        message: 'CLI is active but not yet ready',
        details: {
          pid: session.pid,
          uptime,
          lastActivity: session.lastActivity,
          outputSample: session.outputBuffer.slice(-500),
        },
      };
    }

    // No recent activity and not ready - might be stuck
    return {
      ready: false,
      cliResponsive: false,
      startupPhase: session.startupPhase,
      message: 'CLI appears unresponsive - no recent activity',
      details: {
        pid: session.pid,
        uptime,
        lastActivity: session.lastActivity,
        outputSample: session.outputBuffer.slice(-500),
      },
    };
  }

  /**
   * Get startup events for a session (for SSE streaming)
   */
  getStartupEvents(sessionId: string): StartupEvent[] {
    const session = this.sessions.get(sessionId);
    return session?.startupEvents || [];
  }

  /**
   * Subscribe to startup events for a session
   */
  subscribeToStartupEvents(sessionId: string, callback: (event: StartupEvent) => void): () => void {
    const handler = (sid: string, event: StartupEvent) => {
      if (sid === sessionId) {
        callback(event);
      }
    };
    this.on('startup', handler);

    // Return unsubscribe function
    return () => this.off('startup', handler);
  }
}
