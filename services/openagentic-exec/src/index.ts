/**
 * Openagentic Exec Daemon
 *
 * Lightweight execution service for openagentic CLI and code-server.
 * Controlled by openagentic-manager via REST API and WebSocket.
 *
 * Endpoints:
 *   POST   /sessions              - Create PTY session
 *   GET    /sessions/:id          - Get session status
 *   DELETE /sessions/:id          - Stop session
 *   WS     /ws/terminal/:id       - PTY I/O
 *   POST   /sessions/:id/code-server       - Start code-server
 *   GET    /sessions/:id/code-server       - Get code-server status
 *   GET    /sessions/:id/code-server/ready - Check code-server HTTP readiness
 *   POST   /sessions/:id/code-server/wait-ready - Wait for code-server ready
 *   DELETE /sessions/:id/code-server       - Stop code-server
 *   POST   /files/list            - List workspace files
 *   POST   /files/read            - Read file content
 *   GET    /files/download/:userId/*  - Download file as attachment
 *   GET    /files/download-zip/:userId/*  - Download folder as ZIP
 *   POST   /shell/exec            - Execute shell command in workspace
 *   GET    /health                - Health check
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { promises as fsPromises, createReadStream } from 'fs';
import { join, basename } from 'path';
import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { config } from './config';
import { PtyManager } from './ptyManager';
import { CodeServerManager } from './codeServerManager';
import { initSandboxSystem, sanitizeEmailToUsername, buildSandboxedCommand, getSandboxEnv } from './userSandbox';
import { loggers } from './logger.js';

const execAsync = promisify(exec);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
// Phase 3: separate WebSocketServer instance for /ws/progress so we can
// route upgrades cleanly without piggybacking on the terminal handler.
// Both servers share `noServer: true` and the single HTTP upgrade
// handler dispatches by pathname.
const progressWss = new WebSocketServer({ noServer: true });

// Initialize managers
const ptyManager = new PtyManager();
const codeServerManager = new CodeServerManager();

// Phase 3: tool-event tail subscribers map. Imported here so the
// upgrade handler can dispatch to it without dragging the whole
// implementation into this file.
// shutdownAllProgressTails is exported for future shutdown wiring; the
// pod's K8s lifecycle currently kills the process directly which lets
// the OS reap timers and fs.watch handles. If we add a graceful drain
// later, plug it in there.
import { subscribeProgress, type ToolEvent } from './progressTail.js';

app.use(express.json());

// ===========================================
// SECURITY: Internal API Key Authentication
// ===========================================

const validateAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Health and hook endpoints are always accessible (localhost-only, no secrets needed)
  if (req.path === '/health' || req.path.startsWith('/hooks/')) {
    return next();
  }

  // INTERNAL_API_KEY is mandatory - refuse to operate without it
  if (!config.internalApiKey) {
    loggers.security.error('INTERNAL_API_KEY not configured - rejecting request');
    return res.status(503).json({ error: 'Service misconfigured: INTERNAL_API_KEY required' });
  }

  const authHeader = req.headers['authorization'];
  const internalKeyHeader = req.headers['x-internal-api-key'];

  let providedKey: string | undefined;

  if (internalKeyHeader) {
    providedKey = Array.isArray(internalKeyHeader) ? internalKeyHeader[0] : internalKeyHeader;
  } else if (authHeader?.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7);
  } else if (authHeader?.startsWith('Internal ')) {
    providedKey = authHeader.slice(9);
  }

  if (!providedKey || providedKey !== config.internalApiKey) {
    loggers.security.warn({ path: req.path, ip: req.ip }, 'Unauthorized request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

app.use(validateAuth);

// ===========================================
// Health Check
// ===========================================

// Helper: Promise with timeout
const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  const timeout = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), ms)
  );
  return Promise.race([promise, timeout]).catch(() => fallback);
};

// Cache mount status to avoid FUSE hangs on repeated checks
let cachedMountStatus = { mounted: false, lastCheck: 0, bucket: 'unknown', endpoint: 'unknown', recovering: false };
let consecutiveMountFailures = 0;

/**
 * Attempt to recover a dead s3fs mount.
 * 1. Force-unmount the stale FUSE endpoint
 * 2. Remount using the same credentials/bucket from env
 */
async function attemptMountRecovery(): Promise<boolean> {
  if (cachedMountStatus.recovering) return false;
  cachedMountStatus.recovering = true;
  const bucket = process.env.STORAGE_BUCKET || '';
  const endpoint = process.env.STORAGE_ENDPOINT || '';
  const accessKey = process.env.STORAGE_ACCESS_KEY || '';
  const secretKey = process.env.STORAGE_SECRET_KEY || '';

  if (!bucket || !endpoint || !accessKey || !secretKey) {
    loggers.storage.warn('Cannot recover — missing credentials/config');
    cachedMountStatus.recovering = false;
    return false;
  }

  loggers.storage.info('Attempting s3fs mount recovery...');
  try {
    // Force-unmount stale FUSE
    execSync('fusermount -uz /workspaces 2>/dev/null || umount -l /workspaces 2>/dev/null || true', { timeout: 10000 });

    // Write credentials
    const { writeFileSync, chmodSync } = await import('fs');
    writeFileSync('/etc/passwd-s3fs', `${accessKey}:${secretKey}`);
    chmodSync('/etc/passwd-s3fs', 0o600);

    // Remount with bucket prefix
    execSync(
      `s3fs "${bucket}:/workspaces" /workspaces ` +
      `-o url="${endpoint}" ` +
      `-o use_path_request_style ` +
      `-o allow_other ` +
      `-o umask=0000 -o uid=0 -o gid=0 ` +
      `-o nonempty -o retries=3 ` +
      `-o connect_timeout=10 -o readwrite_timeout=30 ` +
      `-o stat_cache_expire=30 ` +
      `-o passwd_file=/etc/passwd-s3fs`,
      { timeout: 30000 }
    );

    // Verify
    execSync('ls /workspaces/ >/dev/null 2>&1', { timeout: 5000 });
    loggers.storage.info('Mount recovery SUCCEEDED');
    cachedMountStatus.mounted = true;
    cachedMountStatus.lastCheck = Date.now();
    cachedMountStatus.recovering = false;
    consecutiveMountFailures = 0;
    return true;
  } catch (err: any) {
    loggers.storage.error({ err: err?.message || err }, 'Mount recovery FAILED');
    cachedMountStatus.recovering = false;
    return false;
  }
}

app.get('/health', (req, res) => {
  // INSTANT health check - MUST respond immediately for K8s probes
  // CRITICAL: NEVER touch FUSE filesystem here - it can block Node.js entirely
  // Storage status comes from the cached background check

  const activeSessions = ptyManager.getAllSessions().length;
  const activeCodeServers = codeServerManager.getAllInstances().length;
  const storageDegraded = !cachedMountStatus.mounted && consecutiveMountFailures >= 2;

  res.json({
    status: storageDegraded ? 'degraded' : 'healthy',
    activeSessions,
    activeCodeServers,
    codeServerAvailable: true,
    config: {
      sandboxEnabled: config.sandboxEnabled,
      workspacesPath: config.workspacesPath,
      codeServerBasePort: config.codeServerBasePort,
    },
    storage: {
      bucket: cachedMountStatus.bucket || process.env.STORAGE_BUCKET || 'unknown',
      endpoint: cachedMountStatus.endpoint || process.env.STORAGE_ENDPOINT || 'unknown',
      mounted: cachedMountStatus.mounted,
      type: cachedMountStatus.mounted ? 's3fs' : 'ephemeral',
      recovering: cachedMountStatus.recovering,
      consecutiveFailures: consecutiveMountFailures,
      cached: true,
      cacheAge: Date.now() - cachedMountStatus.lastCheck,
    },
  });
});

// Background mount status updater - runs every 30 seconds
// Uses `mountpoint` command (non-blocking) instead of FUSE access() which can hang
setInterval(async () => {
  try {
    const workspaceBucket = process.env.STORAGE_BUCKET || 'ephemeral';
    const workspaceEndpoint = process.env.STORAGE_ENDPOINT || 'local';

    // Check mount via `mountpoint` (kernel-level, doesn't touch FUSE)
    let isMountpoint = false;
    try {
      execSync('mountpoint -q /workspaces', { timeout: 3000 });
      isMountpoint = true;
    } catch {
      isMountpoint = false;
    }

    // If mountpoint exists, verify it's not stale by doing a quick ls with timeout
    let mounted = false;
    if (isMountpoint) {
      try {
        execSync('timeout 3 ls /workspaces/ >/dev/null 2>&1', { timeout: 5000 });
        mounted = true;
      } catch {
        // Mount exists but is stale (Transport endpoint not connected)
        mounted = false;
        loggers.storage.warn('FUSE mount is stale — Transport endpoint not connected');
      }
    }

    cachedMountStatus = {
      ...cachedMountStatus,
      mounted,
      lastCheck: Date.now(),
      bucket: workspaceBucket,
      endpoint: workspaceEndpoint,
    };

    if (!mounted && process.env.STORAGE_MODE === 's3fs') {
      consecutiveMountFailures++;
      loggers.storage.warn({ consecutiveFailures: consecutiveMountFailures }, 'Mount check FAILED');

      // Auto-recover after 2 consecutive failures
      if (consecutiveMountFailures >= 2 && !cachedMountStatus.recovering) {
        attemptMountRecovery();
      }
    } else {
      consecutiveMountFailures = 0;
    }
  } catch (err) {
    loggers.api.warn({ err }, 'Background mount check error');
  }
}, 30000);

// Initialize cache on startup (after mount is established)
setTimeout(async () => {
  try {
    const workspaceBucket = process.env.STORAGE_BUCKET || 'ephemeral';
    const workspaceEndpoint = process.env.STORAGE_ENDPOINT || 'local';

    let mounted = false;
    try {
      await fsPromises.access(config.workspacesPath);
      mounted = true;
    } catch {
      mounted = false;
    }

    cachedMountStatus = {
      mounted,
      lastCheck: Date.now(),
      bucket: workspaceBucket,
      endpoint: workspaceEndpoint,
      recovering: false,
    };
    loggers.api.info({ mountStatus: cachedMountStatus }, 'Initial mount status cached');
  } catch (err) {
    loggers.api.warn({ err }, 'Initial mount check failed');
  }
}, 5000);

// ===========================================
// Platform Hooks (called by openagentic CLI via settings.json hooks)
// ===========================================
// These endpoints receive structured events from the CLI's hook system.
// No auth required — hooks run inside the same container as localhost-only calls.
// Events are forwarded to the code manager via the PTY event system.

app.post('/hooks/tool-start', (req, res) => {
  const { session, tool } = req.body || {};
  if (session && tool) {
    ptyManager.emit('hook', session, { type: 'tool_start', tool, timestamp: Date.now() });
  }
  res.json({ ok: true });
});

app.post('/hooks/tool-end', (req, res) => {
  const { session, tool, exit: exitCode } = req.body || {};
  if (session && tool) {
    ptyManager.emit('hook', session, { type: 'tool_end', tool, exitCode, timestamp: Date.now() });
    // Auto-refresh file list if file-related tool completed
    if (['Write', 'Edit', 'FileWrite', 'FileEdit', 'NotebookEdit'].includes(tool)) {
      ptyManager.emit('hook', session, { type: 'file_changed', tool, timestamp: Date.now() });
    }
  }
  res.json({ ok: true });
});

// ===========================================
// Session Management (PTY)
// ===========================================

// Create session
app.post('/sessions', async (req, res) => {
  try {
    const { sessionId, userId, userEmail, workspacePath, model, apiKey, apiEndpoint } = req.body;

    // SECURITY: All fields required - workspacePath must come from openagentic-manager
    // which syncs it from MinIO. No fallbacks allowed.
    if (!sessionId || !userId || !workspacePath) {
      return res.status(400).json({
        error: 'sessionId, userId, and workspacePath are all required',
        detail: 'workspacePath must be the user\'s MinIO-synced workspace directory'
      });
    }

    // If GitHub token is in env, authenticate gh CLI before creating session
    const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (ghToken) {
      try {
        const { execFileSync } = await import('child_process');
        execFileSync('gh', ['auth', 'login', '--with-token'], {
          input: ghToken,
          env: process.env,
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        execFileSync('gh', ['auth', 'setup-git'], { env: process.env, timeout: 5000, stdio: 'pipe' });
        loggers.api.info({ sessionId, userId }, 'GitHub CLI authenticated on session creation');
      } catch (ghErr) {
        loggers.api.warn({ sessionId, err: ghErr instanceof Error ? ghErr.message : String(ghErr) }, 'Failed to auth gh CLI on session create (non-fatal)');
      }
    }

    const session = await ptyManager.createSession({
      sessionId,
      userId,
      userEmail,  // Used for Linux username (john.doe@company.com -> john-doe)
      workspacePath,
      model,
      apiKey,
      apiEndpoint,
    });

    res.json({
      sessionId: session.id,
      userId: session.userId,
      status: session.status,
      workspacePath: session.workspacePath,
      pid: session.pid,
      createdAt: session.createdAt,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to create session');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get session status
app.get('/sessions/:sessionId', (req, res) => {
  const status = ptyManager.getSessionStatus(req.params.sessionId);

  if (!status) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json(status);
});

// List all sessions
app.get('/sessions', (req, res) => {
  const sessions = ptyManager.getAllSessions().map(s => ({
    id: s.id,
    userId: s.userId,
    status: s.status,
    workspacePath: s.workspacePath,
    pid: s.pid,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));

  res.json({ sessions });
});

// Stop session
app.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Stop code-server if running
    await codeServerManager.stopInstance(sessionId).catch(() => {});

    // Stop PTY session
    await ptyManager.stopSession(sessionId);

    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Write to session (REST fallback)
app.post('/sessions/:sessionId/write', (req, res) => {
  try {
    const { data } = req.body;
    const { sessionId } = req.params;

    if (!data) {
      return res.status(400).json({ error: 'data required' });
    }

    ptyManager.write(sessionId, data);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ===========================================
// Native-React Chat Mode — Server-Sent Events bridge to
// openagentic's stream-json output format. Replaces terminal emulation
// for the CodeMode UI. The browser sends a user message, we spawn a
// one-shot `openagentic --print --input-format stream-json
// --output-format stream-json --continue` as the sandbox user, pipe
// the user message to its stdin, and forward each JSONL line of
// stdout back to the browser as an SSE event. Each line is a complete
// stream-json record (system/init, stream_event for message_start,
// content_block_start, content_block_delta, etc., result, ...).
//
// Session state persists across turns because --continue rehydrates
// from the previous jsonl in the workspace's .openagentic/projects
// directory (same mechanism the TUI uses). Multiple concurrent chat
// calls on the same session are NOT supported — the browser must
// serialize turns (one request at a time) because --continue races
// if two writers append to the same transcript file. The typical
// UX only has one outstanding turn anyway.
// ===========================================
// ───────────────────────────────────────────────────────────────────────────
// Active chat registry — stores in-flight openagentic child processes by
// sessionId so the /chat/control endpoint (interrupts, permission
// responses) can look up the correct stdin to write to. One entry per
// active turn; cleared on exit/abort/result. See POST /sessions/:id/chat
// and POST /sessions/:id/chat/control below.
// ───────────────────────────────────────────────────────────────────────────

interface ActiveChat {
  child: ReturnType<typeof spawn>;
  sessionId: string;
  startedAt: number;
  /** Cleared when the turn emits a result event or the child exits. */
  stdinOpen: boolean;
}
const activeChats = new Map<string, ActiveChat>();

app.post('/sessions/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const {
    message,
    model: modelOverride,
    permissionMode: permissionModeRaw,
    images,
  } = (req.body || {}) as {
    message?: string;
    model?: string;
    permissionMode?: string;
    images?: Array<{ name: string; mediaType: string; base64: string }>;
  };

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) required in body' });
  }

  // Prevent concurrent chats for the same session — a new POST while
  // one is already in flight would race on the same openagentic child's
  // stdin and corrupt the JSONL stream. Client is expected to cancel
  // first via /chat/control {interrupt} or let the current turn finish.
  if (activeChats.has(sessionId)) {
    return res.status(409).json({
      error: 'chat already in flight for this session',
      hint: 'send {subtype:"interrupt"} via /chat/control or wait for the current turn to finish',
    });
  }

  // Validate & translate permission mode. Openagentic accepts
  // --permission-mode with values { default, acceptEdits, plan,
  // bypassPermissions, dontAsk } and the shortcut flag --permissive for
  // bypassPermissions. We fall back to --permissive so existing
  // callers that didn't upgrade yet still get the old behavior.
  const validPermissionModes = new Set([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
  ]);
  const permissionMode =
    permissionModeRaw && validPermissionModes.has(permissionModeRaw)
      ? permissionModeRaw
      : 'bypassPermissions';

  const session = ptyManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!session.sandboxUser) {
    return res.status(400).json({
      error: 'Session has no sandbox user (non-sandbox sessions not supported for chat)',
    });
  }

  // SSE headers — tell nginx/axios not to buffer so streaming actually
  // reaches the browser in real time.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendSSE = (event: string, data: string | Record<string, unknown>) => {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    res.write(`event: ${event}\n`);
    res.write(`data: ${payload}\n\n`);
  };

  // Build the sandboxed one-shot command. We always pass --continue so
  // context persists across turns, and --session-id only if a specific
  // UUID was requested (openagentic auto-generates otherwise). The
  // --include-partial-messages flag makes content_block_delta events
  // fire for each token so the browser can stream text in real time.
  const effectiveApiEndpoint =
    session.apiEndpoint || process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000';
  const effectiveModel = modelOverride || session.model || config.defaultModel;

  const agArgs = [
    '--print',
    '--verbose',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--non-interactive',
    // Permission mode: bypassPermissions uses the --permissive shortcut
    // (plus --allow-permissive so the sandbox accepts it); other modes
    // pass through --permission-mode <value>. We always include
    // --allow-permissive because it's the cluster policy — even in
    // plan/default mode, we want the toggle available if the user
    // subsequently cycles to permissive mid-session.
    ...(permissionMode === 'bypassPermissions'
      ? ['--permissive']
      : ['--permission-mode', permissionMode]),
    '--allow-permissive',
    // Permission prompts via stdio: force openagentic to route
    // `can_use_tool` decisions through the stream-json channel
    // (structuredIO.createCanUseTool) rather than the static-rules-
    // only fallback. Without this, `--permission-mode default` silently
    // resolves tool permissions without ever asking the client, so
    // our PermissionDialog never fires. See getCanUseToolFn in
    // openagentic/src/cli/print.ts — the 'stdio' branch sends
    // control_request{subtype:'can_use_tool'} on stdout, which is
    // exactly what our exec-daemon → UI bridge expects.
    '--permission-prompt-tool', 'stdio',
    '--continue',
  ];
  if (session.apiKey) {
    agArgs.push('--api-key', session.apiKey);
    agArgs.push('--api-endpoint', `${effectiveApiEndpoint}/api/openagentic`);
  }
  if (effectiveModel) {
    agArgs.push('--model', effectiveModel);
  }
  // Shell-escape the workspace path (which is trusted, so quoting is
  // sufficient) and build the inner command that bash -c will run.
  const innerCmd = `cd "${session.workspacePath.replace(/"/g, '\\"')}" && ${config.openagenticPath} ${agArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
  const sandboxedCmd = buildSandboxedCommand(session.sandboxUser.username, innerCmd);

  const env = {
    ...process.env,
    ...getSandboxEnv(session.sandboxUser, session.apiKey, effectiveApiEndpoint, effectiveModel),
    OPENAGENTIC_MANAGED: '1',
    OPENAGENTIC_SESSION_ID: sessionId,
    OPENAGENTIC_USER_ID: session.userId,
    CONTAINER_MODE: '1',
    MCP_PROXY_URL: process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080',
  } as Record<string, string>;

  loggers.api.info(
    { sessionId, model: effectiveModel, permissionMode },
    'chat-stream: spawning openagentic stream-json',
  );

  const child = spawn('/bin/bash', ['-c', sandboxedCmd], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Register in the active-chat map so /chat/control can find this
  // child's stdin to write interrupts / permission responses. Removed
  // on exit/abort/error below.
  const activeEntry: ActiveChat = {
    child,
    sessionId,
    startedAt: Date.now(),
    stdinOpen: true,
  };
  activeChats.set(sessionId, activeEntry);

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let closed = false;

  const closeStream = (reason: string, detail?: Record<string, unknown>) => {
    if (closed) return;
    closed = true;
    sendSSE('done', { reason, ...(detail || {}) });
    try { res.end(); } catch { /* already closed */ }
    activeChats.delete(sessionId);
  };

  const closeStdin = () => {
    if (!activeEntry.stdinOpen) return;
    activeEntry.stdinOpen = false;
    try { child.stdin.end(); } catch { /* already ended */ }
  };

  // Pipe the user message into openagentic's stdin as a single JSONL
  // record. UNLIKE the pre-#40 version we do NOT close stdin here —
  // it stays open for the lifetime of the turn so the /chat/control
  // endpoint can inject control_request (interrupt) and control_response
  // (permission approve/deny) records mid-turn. Stdin is closed when
  // the openagentic child emits a `result` event (see stdout handler),
  // when the client disconnects, or when the child errors/exits.
  try {
    // Build the user message content. If images are attached, send a
    // multi-block content array (text + image blocks) so vision-capable
    // models can see them. Otherwise send a plain string.
    let content: string | Array<Record<string, unknown>> = message;
    if (images && images.length > 0) {
      const blocks: Array<Record<string, unknown>> = [
        { type: 'text', text: message },
      ];
      for (const img of images) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }
      content = blocks;
    }
    const userRecord = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
    });
    child.stdin.write(userRecord + '\n');
  } catch (writeErr) {
    loggers.api.error({ sessionId, err: writeErr }, 'chat-stream: failed to write user message to stdin');
    closeStream('stdin_error', { message: String(writeErr) });
    try { child.kill('SIGTERM'); } catch {}
    return;
  }

  // Forward stdout lines as SSE. Each line is already a complete
  // stream-json record; we re-emit verbatim so the browser parser can
  // `JSON.parse` without worrying about partial lines. We also peek at
  // each line for a `result` event — once openagentic finishes the turn
  // we close stdin so the child exits cleanly. Partial JSON parse
  // failures are ignored; we never fail the stream on a peek error.
  child.stdout.on('data', (chunk: Buffer) => {
    if (closed) return;
    stdoutBuffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      sendSSE('message', line);
      if (activeEntry.stdinOpen) {
        try {
          const peeked = JSON.parse(line) as { type?: string };
          if (peeked.type === 'result') closeStdin();
        } catch { /* ignore — some lines may be diagnostic */ }
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    // Cap at 32KB so a runaway stderr doesn't balloon memory.
    if (stderrBuffer.length > 32 * 1024) {
      stderrBuffer = stderrBuffer.slice(-16 * 1024);
    }
  });

  child.on('exit', (code, signal) => {
    // Flush any trailing stdout line that didn't end in \n.
    if (stdoutBuffer.trim()) {
      sendSSE('message', stdoutBuffer.trim());
      stdoutBuffer = '';
    }
    loggers.api.info(
      { sessionId, code, signal, stderrTail: stderrBuffer.slice(-500) },
      'chat-stream: openagentic exited',
    );
    closeStream('exit', { code, signal, stderr: stderrBuffer.slice(-2000) });
  });

  child.on('error', (err) => {
    loggers.api.error({ sessionId, err }, 'chat-stream: openagentic spawn error');
    closeStream('error', { message: err.message });
  });

  // If the client disconnects mid-stream, kill the child so we don't
  // leak openagentic processes. 10s grace on SIGTERM, then SIGKILL.
  //
  // NOTE: use res.on('close'), NOT req.on('close'). In Node the
  // IncomingMessage emits 'close' as soon as the request body is fully
  // consumed — for a small POST that's within milliseconds of the
  // handler running, so req.on('close') would kill openagentic before it
  // produced any output. ServerResponse.on('close') only fires when the
  // underlying socket is actually terminated, which is what we want.
  res.on('close', () => {
    if (closed) return;
    if (child.exitCode !== null) return;
    loggers.api.warn({ sessionId }, 'chat-stream: client disconnected, terminating openagentic');
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch {}
      }
    }, 10_000);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// POST /sessions/:sessionId/chat/control
//
// Injects a control_request (interrupt / end_session / set_permission_mode)
// or control_response (approve / deny) into the currently-active chat's
// stdin. Requires a matching entry in `activeChats`. Used by the UI for:
//   • Esc / Ctrl+C interrupt — `{type:'control_request', request:{subtype:'interrupt'}}`
//   • Permission dialog approve — `{type:'control_response', response:{...}}`
//   • Permission dialog deny    — ditto with cancel/deny
//   • Mid-session mode change   — `{type:'control_request', request:{subtype:'set_permission_mode'}}`
//
// The client is trusted to send valid openagentic protocol frames — we
// just JSON-stringify and write the payload as one line to stdin. We
// don't inspect or validate the frame shape beyond ensuring it's a
// plain object so we can reject bad bodies early.
// ───────────────────────────────────────────────────────────────────────────

app.post('/sessions/:sessionId/chat/control', (req, res) => {
  const { sessionId } = req.params;
  const body = (req.body || {}) as Record<string, unknown>;

  if (!body || typeof body !== 'object' || !body.type) {
    return res.status(400).json({ error: 'body must be a stream-json control record with a `type` field' });
  }

  const entry = activeChats.get(sessionId);
  if (!entry) {
    return res.status(404).json({
      error: 'no active chat for this session',
      hint: 'start a chat via POST /sessions/:id/chat before sending control frames',
    });
  }
  if (!entry.stdinOpen) {
    return res.status(409).json({ error: 'active chat stdin already closed (turn finishing)' });
  }

  if (!entry.child.stdin) {
    return res.status(500).json({ error: 'active chat has no writable stdin' });
  }
  try {
    const line = JSON.stringify(body);
    entry.child.stdin.write(line + '\n');
    loggers.api.info(
      { sessionId, controlType: body.type, subtype: (body as any).request?.subtype },
      'chat-control: wrote control frame to stdin',
    );
    res.json({ success: true });
  } catch (writeErr) {
    loggers.api.error({ sessionId, err: writeErr }, 'chat-control: failed to write to stdin');
    const message = writeErr instanceof Error ? writeErr.message : String(writeErr);
    res.status(500).json({ error: message });
  }
});

// Resize session
app.post('/sessions/:sessionId/resize', (req, res) => {
  try {
    const { cols, rows } = req.body;
    const { sessionId } = req.params;

    if (!cols || !rows) {
      return res.status(400).json({ error: 'cols and rows required' });
    }

    ptyManager.resize(sessionId, cols, rows);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ===========================================
// Readiness Check - Verify CLI is truly ready
// ===========================================

// Readiness check endpoint - verifies CLI is actually responsive
app.post('/sessions/:sessionId/readiness-check', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { timeout = 10000 } = req.body;

    const result = await ptyManager.checkReadiness(sessionId, timeout);

    // Include additional context for debugging
    res.json({
      ...result,
      sessionId,
      timestamp: Date.now(),
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Readiness check failed');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      ready: false,
      cliResponsive: false,
      startupPhase: 'cli_error',
      message: `Readiness check error: ${message}`,
    });
  }
});

// Get quick readiness status (non-blocking)
app.get('/sessions/:sessionId/readiness', (req, res) => {
  const { sessionId } = req.params;
  const session = ptyManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({
      ready: false,
      cliResponsive: false,
      startupPhase: 'cli_error',
      message: 'Session not found',
    });
  }

  res.json({
    ready: session.cliReady,
    cliResponsive: session.status === 'running',
    startupPhase: session.startupPhase,
    message: session.cliReady ? 'CLI is ready' : `CLI startup phase: ${session.startupPhase}`,
    sessionId,
    timestamp: Date.now(),
    details: {
      pid: session.pid,
      uptime: Date.now() - session.createdAt,
      lastActivity: session.lastActivity,
      status: session.status,
    },
  });
});

// ===========================================
// Output Buffer - for terminal WS replay on reconnect
// ===========================================

app.get('/sessions/:sessionId/output-buffer', (req, res) => {
  const { sessionId } = req.params;
  const session = ptyManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ buffer: session.outputBuffer || '', length: (session.outputBuffer || '').length });
});

// ===========================================
// Startup Logs - SSE stream for real-time startup visibility
// ===========================================

// SSE endpoint for startup logs
app.get('/sessions/:sessionId/startup-logs', (req, res) => {
  const { sessionId } = req.params;
  const session = ptyManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send existing startup events immediately
  const existingEvents = ptyManager.getStartupEvents(sessionId);
  for (const event of existingEvents) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Subscribe to new startup events
  const unsubscribe = ptyManager.subscribeToStartupEvents(sessionId, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    // If CLI is ready, send a completion event and close
    if (event.type === 'cli_ready') {
      res.write(`data: ${JSON.stringify({ type: 'stream_complete', message: 'CLI is ready' })}\n\n`);
      // Don't close immediately - let the client decide when to close
    }
  });

  // Also forward PTY output as startup logs (sanitized)
  const dataHandler = (sid: string, data: string) => {
    if (sid === sessionId) {
      // Sanitize and send as log event
      const sanitizedData = data
        .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // Remove other ANSI escapes
        .trim();

      if (sanitizedData) {
        res.write(`data: ${JSON.stringify({
          type: 'log',
          message: sanitizedData.substring(0, 500),
          timestamp: Date.now(),
          sessionId,
        })}\n\n`);
      }
    }
  };
  ptyManager.on('data', dataHandler);

  // Handle client disconnect
  req.on('close', () => {
    unsubscribe();
    ptyManager.off('data', dataHandler);
    loggers.api.info({ sessionId }, 'Startup log stream closed');
  });

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });

  loggers.api.info({ sessionId }, 'Startup log stream opened');
});

// ===========================================
// Token Refresh - Restart CLI with new token
// ===========================================

// Refresh session token (restart CLI with new API key)
// CRITICAL: This MUST be called on every user reconnect to ensure fresh token
app.post('/sessions/:sessionId/refresh', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { apiKey, model, apiEndpoint, githubToken } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required for token refresh' });
    }

    const existingSession = ptyManager.getSession(sessionId);
    if (!existingSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get session details before stopping
    const { userId, workspacePath } = existingSession;

    loggers.api.info({ sessionId, userId }, 'Refreshing token for session');

    // Update GitHub token in process env if provided (persists for future CLI restarts)
    if (githubToken) {
      process.env.GITHUB_TOKEN = githubToken;
      process.env.GH_TOKEN = githubToken;
      loggers.api.info({ sessionId }, 'Updated GitHub token for session');

      // Authenticate gh CLI with the token so git/gh commands work in the PTY
      try {
        const { execFileSync } = await import('child_process');
        // Use execFile with piped stdin to avoid shell injection
        const ghLogin = execFileSync('gh', ['auth', 'login', '--with-token'], {
          input: githubToken,
          env: { ...process.env, GITHUB_TOKEN: githubToken, GH_TOKEN: githubToken },
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Configure git to use gh as credential helper
        execFileSync('gh', ['auth', 'setup-git'], { env: process.env, timeout: 5000, stdio: 'pipe' });
        loggers.api.info({ sessionId }, 'GitHub CLI authenticated and git configured');
      } catch (ghErr) {
        loggers.api.warn({ sessionId, err: ghErr instanceof Error ? ghErr.message : String(ghErr) }, 'Failed to auth gh CLI (non-fatal)');
      }
    }

    // Stop only the CLI process - keep sandbox user and code-server alive
    // This prevents "Cannot reconnect" errors in VS Code
    await ptyManager.stopSession(sessionId, { keepSandbox: true });

    // Wait a moment for CLI cleanup
    await new Promise(resolve => setTimeout(resolve, 300));

    // Restart with fresh token
    const newSession = await ptyManager.createSession({
      sessionId,
      userId,
      workspacePath,
      model: model || existingSession.model,
      apiKey,
      apiEndpoint,
    });

    loggers.api.info({ sessionId, pid: newSession.pid }, 'Session restarted with fresh token');

    res.json({
      sessionId: newSession.id,
      userId: newSession.userId,
      status: newSession.status,
      workspacePath: newSession.workspacePath,
      pid: newSession.pid,
      refreshed: true,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to refresh session');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ===========================================
// File Upload (for code mode file attachments)
// ===========================================

// Upload file to session workspace
app.post('/sessions/:sessionId/upload', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = ptyManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { filename, content, targetPath } = req.body;

    if (!filename || !content) {
      return res.status(400).json({ error: 'filename and content (base64) required' });
    }

    // Determine target directory
    const uploadDir = targetPath
      ? join(session.workspacePath, targetPath)
      : join(session.workspacePath, 'uploads');

    // Ensure upload directory exists
    await fsPromises.mkdir(uploadDir, { recursive: true });

    // Decode base64 and write file
    const fileBuffer = Buffer.from(content, 'base64');
    const filePath = join(uploadDir, filename);

    await fsPromises.writeFile(filePath, fileBuffer);

    // SECURITY: chown uploaded file to the sandbox user so they can read/modify it
    try {
      const sandboxUsername = sanitizeEmailToUsername(session.userId);
      execSync(`chown ${sandboxUsername}:${sandboxUsername} "${filePath}"`, { stdio: 'ignore' });
    } catch {
      // If sandbox user doesn't exist yet, file stays root-owned (non-critical)
    }

    const relativePath = targetPath
      ? `${targetPath}/${filename}`
      : `uploads/${filename}`;

    loggers.api.info({ filePath, size: fileBuffer.length }, 'File uploaded');

    res.json({
      success: true,
      path: filePath,
      relativePath,
      size: fileBuffer.length,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to upload file');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ===========================================
// Code Server Management
// ===========================================

// Start code-server
app.post('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = ptyManager.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const instance = await codeServerManager.startInstance(
      sessionId,
      session.userId,
      session.workspacePath,
      session.sandboxUser || undefined,
      session.apiKey,  // Pass API key for Continue extension config
      session.apiEndpoint  // Pass API endpoint for Continue extension config
    );

    res.json({
      status: instance.status,
      url: instance.url,
      port: instance.port,
      workspacePath: instance.workspacePath,
    });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to start code-server');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Get code-server status
app.get('/sessions/:sessionId/code-server', (req, res) => {
  const { sessionId } = req.params;
  const instance = codeServerManager.getInstance(sessionId);

  if (!instance) {
    return res.json({ status: 'not_started', url: null });
  }

  res.json({
    status: instance.status,
    url: instance.url,
    port: instance.port,
    workspacePath: instance.workspacePath,
    startedAt: instance.startedAt,
  });
});

// Check code-server HTTP readiness (is it actually serving requests?)
app.get('/sessions/:sessionId/code-server/ready', async (req, res) => {
  const { sessionId } = req.params;
  const instance = codeServerManager.getInstance(sessionId);

  if (!instance) {
    return res.json({
      ready: false,
      error: 'No code-server instance found',
      status: 'not_started',
    });
  }

  // Use the HTTP readiness check to verify code-server is actually responding
  const result = await codeServerManager.isCodeServerReady(sessionId);

  res.json({
    ready: result.ready,
    url: result.url || instance.url,
    error: result.error,
    status: instance.status,
    port: instance.port,
    workspacePath: instance.workspacePath,
    startedAt: instance.startedAt,
  });
});

// Wait for code-server to be HTTP-ready (blocking with timeout)
app.post('/sessions/:sessionId/code-server/wait-ready', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { timeout = 30000 } = req.body;

    const instance = codeServerManager.getInstance(sessionId);
    if (!instance) {
      return res.json({
        ready: false,
        error: 'No code-server instance found',
        status: 'not_started',
      });
    }

    loggers.api.info({ sessionId, timeout }, 'Waiting for code-server HTTP readiness');

    const isReady = await codeServerManager.waitForHttpReady(sessionId, timeout);

    if (isReady) {
      const result = await codeServerManager.isCodeServerReady(sessionId);
      res.json({
        ready: true,
        url: result.url || instance.url,
        status: instance.status,
        port: instance.port,
        workspacePath: instance.workspacePath,
      });
    } else {
      res.json({
        ready: false,
        error: 'Timeout waiting for code-server HTTP readiness',
        status: instance.status,
        port: instance.port,
      });
    }
  } catch (error) {
    loggers.api.error({ err: error }, 'Wait for code-server readiness failed');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ready: false, error: message });
  }
});

// Stop code-server
app.delete('/sessions/:sessionId/code-server', async (req, res) => {
  try {
    await codeServerManager.stopInstance(req.params.sessionId);
    res.json({ status: 'stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// List all code-server instances
app.get('/code-servers', (req, res) => {
  const instances = codeServerManager.getAllInstances().map(i => ({
    sessionId: i.sessionId,
    userId: i.userId,
    status: i.status,
    url: i.url,
    port: i.port,
    workspacePath: i.workspacePath,
    startedAt: i.startedAt,
  }));

  res.json({ instances });
});

// ===========================================
// Workspace File Operations
// ===========================================

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  children?: FileEntry[];
}

// List files in workspace
app.post('/files/list', async (req, res) => {
  try {
    const { userId, directory = '.', recursive = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const workspaceRoot = join(config.workspacesPath, userId);
    const targetDir = join(workspaceRoot, directory);

    // Security: Ensure path is within workspace
    const realTarget = await fsPromises.realpath(targetDir).catch(() => targetDir);
    const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
    if (!realTarget.startsWith(realRoot)) {
      return res.status(403).json({ error: 'Access denied - path traversal attempt' });
    }

    // Check if directory exists
    try {
      await fsPromises.access(targetDir);
    } catch {
      return res.json({ success: true, files: [], workspacePath: workspaceRoot });
    }

    const listRecursive = async (dir: string, basePath: string): Promise<FileEntry[]> => {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      const results: FileEntry[] = [];

      for (const entry of entries) {
        // Skip only node_modules and .git (they're huge and noisy)
        // Show all other hidden files like VSCode does
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }

        const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          const children = recursive ? await listRecursive(fullPath, entryPath) : undefined;
          results.push({
            name: entry.name,
            type: 'directory',
            path: entryPath,
            children,
          });
        } else {
          const stats = await fsPromises.stat(fullPath).catch(() => null);
          results.push({
            name: entry.name,
            type: 'file',
            path: entryPath,
            size: stats?.size,
          });
        }
      }

      return results;
    };

    const files = await listRecursive(targetDir, '');
    res.json({ success: true, files, workspacePath: workspaceRoot });
  } catch (error) {
    loggers.api.error({ err: error }, 'Failed to list files');
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Read file content
app.post('/files/read', async (req, res) => {
  try {
    const { userId, filepath } = req.body;

    if (!userId || !filepath) {
      return res.status(400).json({ error: 'userId and filepath required' });
    }

    const workspaceRoot = join(config.workspacesPath, userId);
    const fullPath = join(workspaceRoot, filepath);

    // Security: Ensure path is within workspace
    const realTarget = await fsPromises.realpath(fullPath).catch(() => fullPath);
    const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
    if (!realTarget.startsWith(realRoot)) {
      return res.status(403).json({ error: 'Access denied - path traversal attempt' });
    }

    const content = await fsPromises.readFile(fullPath, 'utf-8');
    res.json({ success: true, content, filepath });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(404).json({ error: message });
  }
});

// Download file - returns file as attachment for browser download
// GET /files/download/:userId/*filepath - allows direct browser link
app.get('/files/download/:userId/*', async (req, res) => {
  try {
    const { userId } = req.params;
    const filepath = (req.params as Record<string, string>)[0]; // Everything after /download/:userId/

    if (!userId || !filepath) {
      return res.status(400).json({ error: 'userId and filepath required' });
    }

    const workspaceRoot = join(config.workspacesPath, userId);
    const fullPath = join(workspaceRoot, filepath);

    // Security: Ensure path is within workspace
    const realTarget = await fsPromises.realpath(fullPath).catch(() => fullPath);
    const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
    if (!realTarget.startsWith(realRoot)) {
      return res.status(403).json({ error: 'Access denied - path traversal attempt' });
    }

    // Check file exists
    const stats = await fsPromises.stat(fullPath).catch(() => null);
    if (!stats || stats.isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Get filename for download
    const filename = basename(fullPath);

    // Set headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);

    // Stream file to response
    const stream = createReadStream(fullPath);
    stream.pipe(res);
    stream.on('error', (err) => {
      loggers.api.error({ err }, 'Download stream error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Download folder as ZIP
app.get('/files/download-zip/:userId/*', async (req, res) => {
  try {
    const { userId } = req.params;
    const folderpath = (req.params as Record<string, string>)[0] || '.';

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const workspaceRoot = join(config.workspacesPath, userId);
    const fullPath = join(workspaceRoot, folderpath);

    // Security: Ensure path is within workspace
    const realTarget = await fsPromises.realpath(fullPath).catch(() => fullPath);
    const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
    if (!realTarget.startsWith(realRoot)) {
      return res.status(403).json({ error: 'Access denied - path traversal attempt' });
    }

    // Check folder exists
    const stats = await fsPromises.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Get folder name for download
    const foldername = folderpath === '.' ? userId : basename(fullPath);

    // Set headers for ZIP download
    res.setHeader('Content-Disposition', `attachment; filename="${foldername}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    // Use archiver to stream ZIP
    const archiver = await import('archiver');
    const archive = archiver.default('zip', { zlib: { level: 6 } });

    archive.on('error', (err) => {
      loggers.api.error({ err }, 'Archive error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create ZIP' });
      }
    });

    archive.pipe(res);
    archive.directory(fullPath, false);
    await archive.finalize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// ===========================================
// Shell Execution Endpoint
// ===========================================

// Execute shell command in user's workspace (for MCP tools)
app.post('/shell/exec', async (req, res) => {
  try {
    const { userId, command, timeout = 60000, workingDirectory } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'userId required',
        stdout: '',
        stderr: '',
        exitCode: 1
      });
    }

    if (!command || !command.trim()) {
      return res.status(400).json({
        success: false,
        error: 'command required',
        stdout: '',
        stderr: '',
        exitCode: 1
      });
    }

    const workspaceRoot = join(config.workspacesPath, userId);

    // Ensure workspace exists
    await fsPromises.mkdir(workspaceRoot, { recursive: true });

    // Determine working directory
    let cwd = workspaceRoot;
    if (workingDirectory) {
      const targetDir = join(workspaceRoot, workingDirectory);
      // Security: Ensure path is within workspace
      const realTarget = await fsPromises.realpath(targetDir).catch(() => targetDir);
      const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
      if (realTarget.startsWith(realRoot)) {
        cwd = targetDir;
      }
    }

    loggers.shell.info({ userId, command: command.substring(0, 100) }, 'Executing command');

    // SECURITY: Run command as the sandbox user, not root
    const sandboxUsername = sanitizeEmailToUsername(userId);

    // Check if sandbox user exists; if not, run as-is (backward compat for dev)
    let shellCommand: string;
    try {
      execSync(`id ${sandboxUsername}`, { stdio: 'ignore' });
      shellCommand = buildSandboxedCommand(sandboxUsername, command);
    } catch {
      // Sandbox user doesn't exist yet (no PTY session started) - refuse execution
      loggers.shell.warn({ sandboxUsername }, 'Sandbox user not found, refusing execution');
      return res.status(400).json({
        success: false,
        error: `Sandbox user not initialized. Start a PTY session first.`,
        stdout: '',
        stderr: '',
        exitCode: 1
      });
    }

    // Execute sandboxed command with timeout
    const { stdout, stderr } = await execAsync(shellCommand, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: {
        ...process.env,
        HOME: workspaceRoot,
        USER: sandboxUsername,
        TERM: 'xterm-256color'
      }
    });

    loggers.shell.info({ userId }, 'Command completed');
    res.json({
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0
    });
  } catch (error: any) {
    loggers.shell.error({ err: error.message }, 'Command failed');
    // exec errors include stdout/stderr
    res.json({
      success: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
      exitCode: error.code || 1,
      error: error.message
    });
  }
});

// ===========================================
// WebSocket Handler for PTY I/O
// ===========================================

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const pathname = url.pathname;

  // Validate internal API key first — both /ws/terminal and /ws/progress
  // sit behind the same key. Done before path dispatch so an unauth'd
  // attempt to /ws/progress can't enumerate session ids by timing the
  // socket.destroy().
  const internalKey = url.searchParams.get('internalKey');
  if (config.internalApiKey && internalKey !== config.internalApiKey) {
    loggers.security.warn('Unauthorized WebSocket connection attempt');
    socket.destroy();
    return;
  }

  // Dispatch by pathname. /ws/terminal/:id is the long-standing PTY
  // proxy; /ws/progress/:id is the Phase 3 structured tool-event tail
  // running off the openagentic pino log. Anything else gets a hard
  // close so we don't fingerprint the daemon by leaving sockets open.
  if (pathname.startsWith('/ws/terminal/')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
    return;
  }
  if (pathname.startsWith('/ws/progress/')) {
    progressWss.handleUpgrade(request, socket, head, (ws) => {
      progressWss.emit('connection', ws, request);
    });
    return;
  }
  socket.destroy();
});

// Default EventEmitter MaxListeners is 10. We fan out per-connection
// PTY listeners on the SHARED `ptyManager` EventEmitter (each browser
// WS registers one `data` + one `exit` handler that filters by
// sessionId), so anything above 5 concurrent connections would fire
// a spurious MaxListenersExceededWarning — and, worse, mask a real
// leak by making a legitimate use-case indistinguishable from one.
// Bumping to 200 gives headroom for realistic concurrency (multiple
// browser tabs + rapid reconnect windows + the progress channel) and
// leaves a clear signal if we ever blow past it.
//
// This is defense-in-depth — the cleanup-once converged-handler
// pattern below is what actually fixes the leak. Without that, a
// higher ceiling just delays the OOM.
ptyManager.setMaxListeners(200);

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.pathname.replace('/ws/terminal/', '');

  const session = ptyManager.getSession(sessionId);
  if (!session || (session.status !== 'running' && session.status !== 'starting')) {
    ws.close(4002, 'Session not found or not running');
    return;
  }

  loggers.websocket.info({ sessionId, initialStatus: session.status }, 'Terminal connected');

  // Forward PTY output to WebSocket. This closure captures `ws` and
  // `sessionId`, so it MUST be removed on teardown or the ws object
  // (plus its send buffer and underlying socket) can't be garbage-
  // collected. The converged cleanup path below handles that.
  const dataHandler = (sid: string, data: string) => {
    if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };
  ptyManager.on('data', dataHandler);

  // PTY exit handler — using `once` instead of `on` because the PTY
  // only exits ONCE per session. `once` auto-removes the listener
  // after it fires, guaranteeing no accumulation even if the cleanup
  // path below somehow misses it (belt-and-suspenders).
  const exitHandler = (sid: string) => {
    if (sid === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.close(4003, 'Session ended');
    }
  };
  ptyManager.once('exit', exitHandler);

  // Converged single-shot cleanup. Historically this cleanup was
  // duplicated across `ws.on('close')` and `ws.on('error')`, which
  // meant:
  //   1. If both handlers fired (normal path: error → close), the
  //      ptyManager.off() calls ran twice and any bug in the first
  //      pass could leak on the second pass
  //   2. Neither handler ever called ws.removeAllListeners() to
  //      break the retain cycle between `ws` → close/error handler
  //      → captured `dataHandler` → `ws` — which meant a closed
  //      socket kept its entire listener graph alive
  //
  // This version routes both events through a single `cleanup()`
  // closure guarded by `cleanedUp` so it runs at-most-once, AND
  // calls ws.removeAllListeners() at the end to sever the cycle.
  // OOM observed 2026-04-08 on pod openagentic-2cb1bf3f719f was
  // driven by this exact pattern: rapid WS reconnects during a
  // panel-resize storm leaked the retain graph until 2Gi was full
  // and the kernel killed the container.
  let cleanedUp = false;
  const cleanup = (reason: 'close' | 'error') => {
    if (cleanedUp) return;
    cleanedUp = true;
    ptyManager.off('data', dataHandler);
    ptyManager.off('exit', exitHandler);
    // Break the retain cycle: the ws object references its close/
    // error/message listeners, which reference dataHandler via
    // closure. Removing all ws listeners here means the only thing
    // still holding dataHandler is ptyManager's listener array,
    // which we just cleared — so the closure is now reachable only
    // through the dying `ws` and GC can reclaim it.
    try {
      ws.removeAllListeners();
    } catch {
      // removeAllListeners can throw if the ws is in a weird state;
      // safe to swallow since we're already tearing down.
    }
    loggers.websocket.info({ sessionId, reason }, 'Terminal disconnected');
  };

  // Forward WebSocket input to PTY
  ws.on('message', (data: Buffer | string) => {
    try {
      const message = data.toString();

      // Check for control messages (JSON)
      if (message.startsWith('{')) {
        try {
          const control = JSON.parse(message);
          if (control.type === 'resize' && control.cols && control.rows) {
            ptyManager.resize(sessionId, control.cols, control.rows);
            return;
          }
          if (control.type === 'keepalive') {
            return; // Silently consume — don't forward to PTY
          }
        } catch {
          // Not JSON, send as input
        }
      }

      // Send to PTY (no-op if still pending)
      ptyManager.write(sessionId, message);
    } catch (error) {
      loggers.websocket.error({ err: error }, 'Message error');
    }
  });

  ws.on('close', () => cleanup('close'));
  ws.on('error', (error) => {
    loggers.websocket.error({ sessionId, err: error }, 'WebSocket error');
    cleanup('error');
  });
});

// ===========================================
// WebSocket Handler for /ws/progress/:id
// ===========================================
//
// This is the Phase 3 side channel: structured tool/api events that
// run alongside the unstructured PTY byte stream. Events come from
// openagentic's own pino log (~/.openagentic/logs/*.jsonl inside the
// sandbox user's home), tailed by progressTail.ts. The browser
// consumes them via /api/code/ws/progress/${sessionId} (proxied
// through openagentic-manager) and renders floating React tool cards
// over the xterm canvas. Zero coupling to the PTY: closing one
// connection has no effect on the other; opening a progress socket
// without an active terminal session is allowed (you'll just see
// historical events from the most recent openagentic run).

progressWss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const sessionId = url.pathname.replace('/ws/progress/', '');

  // Look up the session so we know which sandbox user to tail.
  // The session may not exist (cold start, or progress connection
  // landed before the PTY one); we still allow the subscription so
  // late-arriving events from a freshly-spawned CLI flow through.
  const session = ptyManager.getSession(sessionId);
  const sandboxUsername = (session as { sandboxUser?: { username?: string } } | null)?.sandboxUser?.username;

  loggers.websocket.info({ sessionId, sandboxUsername }, 'Progress connected');

  // Send a small init frame so the client can confirm the channel
  // opened and discover what session it landed on. Mirrors the
  // session_started semantic the terminal channel uses but is
  // intentionally minimal.
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'progress_init',
        sessionId,
        timestamp: Date.now(),
      }),
    );
  }

  // Subscribe to the per-session event tail. The callback fires for
  // every parsed pino event matching the tool/api filter; we forward
  // each as a discrete WebSocket message so the browser can handle
  // them one-at-a-time without re-parsing batches.
  const unsubscribe = subscribeProgress(
    sessionId,
    { sandboxUsername },
    (event: ToolEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(event));
      } catch (err) {
        loggers.websocket.warn({ sessionId, err }, 'Progress send failed');
      }
    },
  );

  // Same converged single-shot cleanup pattern as the terminal
  // handler above — see the long comment there for rationale. The
  // progress channel was less likely to leak (subscribeProgress
  // already uses a per-subscriber Set that reaps correctly), but the
  // retain-cycle between `ws` → close/error handlers → `unsubscribe`
  // closure → `ws` is identical, so we fix both the same way.
  let cleanedUp = false;
  const cleanup = (reason: 'close' | 'error') => {
    if (cleanedUp) return;
    cleanedUp = true;
    unsubscribe();
    try {
      ws.removeAllListeners();
    } catch {
      // swallow — see terminal handler for rationale
    }
    loggers.websocket.info({ sessionId, reason }, 'Progress disconnected');
  };

  // Lightweight keepalive — just consume client pings, don't forward
  // anything. The browser sends keepalives to prevent the proxy
  // (nginx, openagentic-manager) from closing the socket on idle.
  ws.on('message', (data: Buffer | string) => {
    const text = data.toString();
    if (text.startsWith('{')) {
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'keepalive') return;
      } catch {
        // not JSON — ignore, this channel is server→client only
      }
    }
  });

  ws.on('close', () => cleanup('close'));
  ws.on('error', (error) => {
    loggers.websocket.error({ sessionId, err: error }, 'Progress WebSocket error');
    cleanup('error');
  });
});

// ===========================================
// Start Server
// ===========================================

const PORT = config.port;

// Initialize sandbox system and start server
async function startServer() {
  // Clean up stale sandbox users from previous runs
  if (config.sandboxEnabled) {
    await initSandboxSystem();
  }

  // CRITICAL: Bind to 0.0.0.0 so the service can be accessed from outside the pod
  server.listen(PORT, '0.0.0.0', () => {
    loggers.api.info({
      port: PORT,
      workspacesPath: config.workspacesPath,
      sandboxEnabled: config.sandboxEnabled,
      codeServerBinary: config.codeServerBinary,
      codeServerPortRange: `${config.codeServerBasePort}-${config.codeServerBasePort + config.codeServerMaxInstances - 1}`,
    }, 'Openagentic Exec Daemon started');
  });
}

// Start the server
startServer().catch((err) => {
  loggers.api.fatal({ err }, 'Failed to start exec daemon');
  process.exit(1);
});

// ===========================================
// Pod Metrics Endpoint — live CPU/mem/IO from /proc
// ===========================================
app.get('/metrics', (req, res) => {
  try {
    const fs = require('fs');
    
    // CPU: read /proc/stat for total CPU usage
    let cpu = 0;
    try {
      const stat = fs.readFileSync('/proc/stat', 'utf8');
      const cpuLine = stat.split('\n')[0]; // "cpu  user nice system idle ..."
      const parts = cpuLine.split(/\s+/).slice(1).map(Number);
      const total = parts.reduce((a: number, b: number) => a + b, 0);
      const idle = parts[3] || 0;
      cpu = Math.round(((total - idle) / total) * 100);
    } catch {}
    
    // Memory: read /proc/meminfo
    let mem = 0;
    try {
      const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
      const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0') / 1024; // MB
      const available = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0') / 1024;
      mem = Math.round(total - available);
    } catch {}
    
    // IO: read /proc/diskstats for total IO
    let io = 0;
    try {
      const diskstats = fs.readFileSync('/proc/diskstats', 'utf8');
      const lines = diskstats.split('\n').filter((l: string) => l.includes('sda') || l.includes('vda'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const sectorsRead = parseInt(parts[5] || '0');
        const sectorsWritten = parseInt(parts[9] || '0');
        io += (sectorsRead + sectorsWritten) * 512 / 1024; // KB
      }
      io = Math.round(io);
    } catch {}
    
    res.json({ cpu, mem, io });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
