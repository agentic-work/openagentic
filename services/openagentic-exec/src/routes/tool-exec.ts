/**
 * /tool-exec — Sandbox-user tool RPC for Codemode v2
 *
 * Context
 * -------
 * Codemode v2 replaces the "spawn openagentic CLI as a long-running
 * daemon" model with a thin tool-exec endpoint. The backend's
 * ChatPipeline (in openagentic-api, already proven for chat mode)
 * handles the LLM loop, planning, permission gating, etc., and just
 * dispatches the concrete tool calls to this endpoint. That keeps
 * openagentic-exec a small RPC shell with one job: run these tools
 * as the per-user sandbox Linux user and return structured results.
 *
 * Tool names match the openagentic CLI tool catalog 1:1 so the UI's
 * tool-card rendering (Bash/Read/Write/Edit/Glob/Grep/LS) keeps
 * working without a translation layer.
 *
 * Security model
 * --------------
 * 1. Auth: same X-Internal-API-Key / Bearer check as every other
 *    openagentic-exec route. Goes through the global `validateAuth`
 *    middleware in index.ts, which rejects non-health/non-hook paths
 *    unless INTERNAL_API_KEY is configured and matches.
 *
 * 2. Every tool runs as the sandbox user (su via
 *    buildSandboxedCommand) — NEVER as root. If the sandbox user
 *    doesn't exist yet for this user_id, we reject with 400. The
 *    session must be created first (POST /sessions) which provisions
 *    the user.
 *
 * 3. Path jail: every file_path / cwd must resolve under
 *    `/workspaces/<user_id>/` AFTER readlink. Symlink-escape
 *    attempts reject with 403. This matches the pattern used by
 *    `/files/read`, `/files/list`, `/shell/exec` elsewhere in
 *    index.ts. Paths like `/workspace/foo.py` (singular) get
 *    rewritten to the user's jail because the sandbox provisioner
 *    already creates a `/workspace -> /workspaces/<userId>` symlink.
 *
 * 4. Bash commands run through buildSandboxedCommand which:
 *      - drops privileges via `su -s /bin/bash <username>`
 *      - enforces ulimit (processes, files, filesize, cpu, stack, core)
 *      - whitelists a minimal env (PATH/HOME/API keys, no others)
 *    …so even a command that escapes the jail via some trick still
 *    runs with the sandbox user's UID and its ulimits.
 *
 * Response shape
 * --------------
 *   {
 *     tool_use_id,                            // echoed from request
 *     result?: {                              // present on success
 *       content: [{ type: 'text', text }]     // Anthropic-style content
 *     },
 *     error?: { type, message }               // present on failure
 *   }
 *
 * The result.content array matches what the LLM's tool-result block
 * expects — the ChatPipeline forwards it straight into the assistant's
 * next turn without reshaping. Errors are structured so the pipeline
 * can distinguish "tool rejected the input" (validation) from "tool
 * ran but failed" (execution) and decide whether to retry.
 *
 * Streaming
 * ---------
 * This endpoint is synchronous. For now the ChatPipeline treats tool
 * calls as blocking RPCs — no partial/streaming output. The expensive
 * "watch the model produce tokens" work happens on the API side. If
 * we later need streamed Bash output, we'll add a second endpoint
 * (`/tool-exec/stream`) — do NOT mutate the semantics of this one.
 */

import type { Request, Response, Router as ExpressRouter, NextFunction } from 'express';
import express from 'express';
import { execSync, spawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import { join, dirname, isAbsolute, relative, sep } from 'path';
import { randomBytes } from 'crypto';
import { config } from '../config';
import { loggers } from '../logger.js';
import {
  sanitizeEmailToUsername,
  buildSandboxedCommand,
} from '../userSandbox';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolExecBody {
  tool_name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  user_id?: string;
}

interface ToolContent {
  type: 'text';
  text: string;
}

interface ToolSuccess {
  tool_use_id: string;
  result: { content: ToolContent[] };
}

interface ToolFailure {
  tool_use_id: string;
  error: { type: string; message: string };
}

type ToolOutcome = ToolSuccess | ToolFailure;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Bash defaults + ceiling. ChatPipeline can request a shorter timeout
// for cheap commands, but we cap at 5min so a runaway tool call never
// holds up the LLM loop indefinitely. (For real long-running jobs the
// model should use a terminal session, not a one-shot Bash tool.)
const BASH_DEFAULT_TIMEOUT_MS = 60_000;
const BASH_MAX_TIMEOUT_MS = 300_000;

// Read defaults — mirror openagentic CLI defaults (2000 lines / 2000 chars)
const READ_DEFAULT_LIMIT = 2000;
const READ_MAX_LINE_LENGTH = 2000;

// Grep / Glob output caps — keep results bounded so we don't flood the
// LLM context with a mega-listing of node_modules. Matches the CLI's
// default head_limit of 250 for ripgrep output.
const GREP_DEFAULT_HEAD = 250;

// Max output buffer for Bash / Grep / Glob — 10MB. Anything larger
// likely won't fit in the model's context anyway and indicates the
// caller should narrow their query.
const MAX_EXEC_BUFFER = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the user's workspace root and validate sandbox user exists.
 * Returns { workspaceRoot, username } on success, or a ToolFailure on
 * any precondition error (missing user_id, missing sandbox user).
 */
function resolveUser(
  userId: string,
  toolUseId: string
): { workspaceRoot: string; username: string } | ToolFailure {
  if (!userId || typeof userId !== 'string') {
    return {
      tool_use_id: toolUseId,
      error: { type: 'invalid_input', message: 'user_id required' },
    };
  }

  const username = sanitizeEmailToUsername(userId);

  // Must have been provisioned by POST /sessions first. We check via
  // `id <username>` — lightweight, cached by NSS, no filesystem touch.
  try {
    execSync(`id ${username}`, { stdio: 'ignore' });
  } catch {
    return {
      tool_use_id: toolUseId,
      error: {
        type: 'sandbox_user_not_found',
        message: `Sandbox user not provisioned for user_id=${userId}. Create a session via POST /sessions before calling /tool-exec.`,
      },
    };
  }

  const workspaceRoot = join(config.workspacesPath, userId);
  return { workspaceRoot, username };
}

/**
 * Resolve a caller-supplied file_path against the user's workspace
 * jail. Behavior:
 *   - Absolute paths must sit under /workspaces/<userId>/ OR under
 *     the /workspace (singular) compat symlink, which points at the
 *     same place — the sandbox provisioner creates it on session
 *     start. Paths like /workspace/foo.py get rewritten into the
 *     real jail.
 *   - Relative paths are joined onto the workspace root.
 *   - After resolution we realpath() the result and verify it STILL
 *     lives under the real workspace root. This catches symlinks in
 *     the workspace pointing outward (e.g. user did
 *     `ln -s /etc /workspaces/me/etc`).
 *
 * Returns the absolute jailed path, or null on violation.
 */
async function resolveJailedPath(
  inputPath: string,
  workspaceRoot: string,
  userId: string
): Promise<string | null> {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  let candidate = inputPath;

  // Rewrite /workspace/* -> /workspaces/<userId>/* (compat symlink)
  if (candidate === '/workspace' || candidate.startsWith('/workspace/')) {
    candidate = join(workspaceRoot, candidate.slice('/workspace'.length) || '');
  }

  // Relative paths resolve against the user's workspace root
  if (!isAbsolute(candidate)) {
    candidate = join(workspaceRoot, candidate);
  }

  // realpath both sides and confirm containment. For paths that don't
  // exist yet (Write tool creating a new file), realpath the parent
  // directory instead — same containment check still applies.
  const realRoot = await fsPromises.realpath(workspaceRoot).catch(() => workspaceRoot);
  let realTarget: string = candidate;
  try {
    realTarget = await fsPromises.realpath(candidate);
  } catch {
    // Path doesn't exist — resolve the deepest existing ancestor and
    // verify THAT sits in the jail. This lets Write/Edit create new
    // files / directories, while still blocking e.g.
    // /workspaces/me/../../../etc/passwd.
    const parent = dirname(candidate);
    try {
      const realParent = await fsPromises.realpath(parent);
      realTarget = join(realParent, candidate.slice(parent.length + 1));
    } catch {
      // Parent also doesn't exist — walk up until we find something
      // that does, then append the rest.
      let walk = parent;
      while (walk && walk !== sep && walk !== dirname(walk)) {
        try {
          const r = await fsPromises.realpath(walk);
          realTarget = join(r, candidate.slice(walk.length));
          break;
        } catch {
          walk = dirname(walk);
        }
      }
      // If we never found a real ancestor, treat the candidate as-is
      // for the containment check. (realTarget defaulted to `candidate`
      // at declaration, so no further action needed here.)
    }
  }

  // Require exact match OR strict prefix followed by a path separator
  // so that /workspaces/jane-evil isn't treated as a child of
  // /workspaces/jane.
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(prefix)) {
    loggers.api.warn(
      { userId, inputPath, resolvedPath: realTarget, workspaceRoot: realRoot },
      'tool-exec: path escaped sandbox jail'
    );
    return null;
  }

  return realTarget;
}

/** Shell-escape for single-quoted strings in the sandbox wrapper. */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a command as the sandbox user and collect stdout/stderr.
 * Uses spawn + su so we can stream output into size-capped buffers
 * and enforce a hard wall-clock timeout. The `shellCommand` is the
 * payload that runs INSIDE the sandboxed bash; this function wraps
 * it with buildSandboxedCommand() to drop privileges.
 *
 * Returns { stdout, stderr, exitCode, timedOut }. Exit code -1 means
 * the process was killed by us (timeout or fatal spawn error).
 */
async function runAsSandboxUser(
  username: string,
  shellCommand: string,
  opts: {
    cwd?: string;
    timeoutMs: number;
    env?: Record<string, string>;
  }
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  const wrapped = buildSandboxedCommand(username, shellCommand);

  return new Promise((resolve) => {
    // Use shell=false + explicit /bin/sh -c so only our wrapper
    // sees its own string. (buildSandboxedCommand already escapes
    // the payload; we just need an sh to run the `su ...` line.)
    const child = spawn('/bin/sh', ['-c', wrapped], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_EXEC_BUFFER) {
        stdout += chunk.toString('utf8');
      } else if (stdoutBytes - chunk.length < MAX_EXEC_BUFFER) {
        stdout += chunk.toString('utf8').slice(0, MAX_EXEC_BUFFER - (stdoutBytes - chunk.length));
        stdout += '\n...[truncated: stdout exceeded 10MB cap]';
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_EXEC_BUFFER) {
        stderr += chunk.toString('utf8');
      } else if (stderrBytes - chunk.length < MAX_EXEC_BUFFER) {
        stderr += chunk.toString('utf8').slice(0, MAX_EXEC_BUFFER - (stderrBytes - chunk.length));
        stderr += '\n...[truncated: stderr exceeded 10MB cap]';
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      // Hard-kill 2s later if SIGTERM didn't land
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 2000);
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\n[spawn error] ${err.message}`;
      resolve({ stdout, stderr, exitCode: -1, timedOut });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // exitCode == null when killed by signal — map to -1 (matches
      // the convention elsewhere in the codebase).
      const exitCode = code ?? (signal ? -1 : 0);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

/** Apply openagentic-style `<padded N>→<line>` line numbering. */
function addLineNumbers(content: string, startLine: number): string {
  if (!content) return '';
  const lines = content.split(/\r?\n/);
  return lines
    .map((line, i) => {
      const numStr = String(i + startLine);
      const padded = numStr.length >= 6 ? numStr : numStr.padStart(6, ' ');
      // Truncate very long lines so one pathological line doesn't
      // blow past the context window. Matches openagentic CLI behavior.
      const truncated =
        line.length > READ_MAX_LINE_LENGTH
          ? line.slice(0, READ_MAX_LINE_LENGTH) + '...[line truncated]'
          : line;
      return `${padded}→${truncated}`;
    })
    .join('\n');
}

function toText(text: string): ToolContent[] {
  return [{ type: 'text', text }];
}

function okResult(toolUseId: string, text: string): ToolSuccess {
  return {
    tool_use_id: toolUseId,
    result: { content: toText(text) },
  };
}

function errResult(
  toolUseId: string,
  type: string,
  message: string
): ToolFailure {
  return { tool_use_id: toolUseId, error: { type, message } };
}

// ---------------------------------------------------------------------------
// Per-tool implementations
// ---------------------------------------------------------------------------

async function runBash(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  const command = input.command;
  if (typeof command !== 'string' || !command.trim()) {
    return errResult(toolUseId, 'invalid_input', 'Bash.input.command (string) required');
  }

  // Resolve cwd (default = workspace root)
  let cwd = workspaceRoot;
  if (input.cwd) {
    const resolved = await resolveJailedPath(String(input.cwd), workspaceRoot, userId);
    if (!resolved) {
      return errResult(
        toolUseId,
        'path_escape',
        `Bash.input.cwd must resolve under /workspaces/${userId}/`
      );
    }
    cwd = resolved;
  }

  const rawTimeout = typeof input.timeout === 'number' ? input.timeout : BASH_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(Math.max(1_000, rawTimeout), BASH_MAX_TIMEOUT_MS);

  const { stdout, stderr, exitCode, timedOut } = await runAsSandboxUser(
    username,
    `cd ${shellSingleQuote(cwd)} && ${command}`,
    { timeoutMs }
  );

  // Format output the way the openagentic CLI does: stdout, then a
  // separator, then stderr (if any), then an exit marker if non-zero
  // or timed out. The LLM keys on these markers to decide whether to
  // retry or report failure.
  const parts: string[] = [];
  if (stdout) parts.push(stdout.replace(/\n+$/, ''));
  if (stderr) {
    if (parts.length) parts.push('');
    parts.push('[stderr]');
    parts.push(stderr.replace(/\n+$/, ''));
  }
  if (timedOut) {
    parts.push('');
    parts.push(`[command timed out after ${timeoutMs}ms]`);
  }
  if (exitCode !== 0 && !timedOut) {
    parts.push('');
    parts.push(`[exit code ${exitCode}]`);
  }

  return okResult(toolUseId, parts.join('\n') || '(no output)');
}

async function runRead(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string
): Promise<ToolOutcome> {
  if (typeof input.file_path !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Read.input.file_path (string) required');
  }

  const filePath = await resolveJailedPath(input.file_path, workspaceRoot, userId);
  if (!filePath) {
    return errResult(
      toolUseId,
      'path_escape',
      `Read.input.file_path must resolve under /workspaces/${userId}/`
    );
  }

  let content: string;
  try {
    content = await fsPromises.readFile(filePath, 'utf-8');
  } catch (err: any) {
    const code = err?.code;
    if (code === 'ENOENT') {
      return errResult(toolUseId, 'not_found', `File not found: ${input.file_path}`);
    }
    if (code === 'EISDIR') {
      return errResult(toolUseId, 'is_directory', `Path is a directory, not a file: ${input.file_path}`);
    }
    if (code === 'EACCES') {
      return errResult(toolUseId, 'permission_denied', `Permission denied reading: ${input.file_path}`);
    }
    return errResult(toolUseId, 'read_failed', err?.message || String(err));
  }

  const offset = Math.max(0, Number(input.offset) || 0);
  const limit = Math.max(1, Math.min(100_000, Number(input.limit) || READ_DEFAULT_LIMIT));

  const allLines = content.split(/\r?\n/);
  const sliceEnd = Math.min(offset + limit, allLines.length);
  const slice = allLines.slice(offset, sliceEnd).join('\n');
  const numbered = addLineNumbers(slice, offset + 1);

  const truncationNotice =
    sliceEnd < allLines.length
      ? `\n\n[showing lines ${offset + 1}-${sliceEnd} of ${allLines.length}; use offset/limit to page]`
      : '';

  return okResult(toolUseId, numbered + truncationNotice);
}

async function runWrite(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  if (typeof input.file_path !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Write.input.file_path (string) required');
  }
  if (typeof input.content !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Write.input.content (string) required');
  }

  const filePath = await resolveJailedPath(input.file_path, workspaceRoot, userId);
  if (!filePath) {
    return errResult(
      toolUseId,
      'path_escape',
      `Write.input.file_path must resolve under /workspaces/${userId}/`
    );
  }

  // Atomic write: write to temp sibling, then rename. The sandbox user
  // writes so file ownership matches the rest of the workspace — no
  // root-owned files that the CLI/Bash tools subsequently can't edit.
  //
  // We use a shell-level `cat > tmp && mv tmp final` under su so the
  // sandbox user is the one touching the filesystem. The content
  // flows in via a heredoc with a randomized delimiter so it survives
  // arbitrary bytes in the payload.
  const delim = `__AGW_WRITE_${randomBytes(12).toString('hex')}__`;
  // Delimiter chosen to be hex-only so user content can't forge it
  // inside a reasonable document; we still re-check below.
  if (input.content.includes(delim)) {
    return errResult(toolUseId, 'delim_collision', 'Internal delimiter collision, please retry.');
  }

  const tmpPath = `${filePath}.agw-tmp-${randomBytes(6).toString('hex')}`;
  // Ensure parent dir exists before writing (sandbox user mkdir -p).
  // If the mkdir itself escapes the jail we already rejected above
  // via resolveJailedPath — realpath(parent) was in the jail.
  const parent = dirname(filePath);

  const script = [
    `mkdir -p ${shellSingleQuote(parent)}`,
    // heredoc with quoted delimiter so bash doesn't interpolate
    `cat > ${shellSingleQuote(tmpPath)} <<'${delim}'`,
    input.content,
    delim,
    `mv ${shellSingleQuote(tmpPath)} ${shellSingleQuote(filePath)}`,
  ].join('\n');

  const { stdout, stderr, exitCode, timedOut } = await runAsSandboxUser(
    username,
    script,
    { timeoutMs: BASH_DEFAULT_TIMEOUT_MS }
  );

  if (timedOut) {
    return errResult(toolUseId, 'timeout', 'Write timed out');
  }
  if (exitCode !== 0) {
    return errResult(
      toolUseId,
      'write_failed',
      stderr.trim() || stdout.trim() || `write failed with exit ${exitCode}`
    );
  }

  const bytes = Buffer.byteLength(input.content, 'utf8');
  return okResult(toolUseId, `Wrote ${bytes} bytes to ${input.file_path}`);
}

async function runEdit(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  if (typeof input.file_path !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Edit.input.file_path (string) required');
  }
  if (typeof input.old_string !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Edit.input.old_string (string) required');
  }
  if (typeof input.new_string !== 'string') {
    return errResult(toolUseId, 'invalid_input', 'Edit.input.new_string (string) required');
  }
  if (input.old_string === input.new_string) {
    return errResult(toolUseId, 'no_op', 'Edit.input.old_string and new_string must differ');
  }

  const filePath = await resolveJailedPath(input.file_path, workspaceRoot, userId);
  if (!filePath) {
    return errResult(
      toolUseId,
      'path_escape',
      `Edit.input.file_path must resolve under /workspaces/${userId}/`
    );
  }

  let original: string;
  try {
    original = await fsPromises.readFile(filePath, 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return errResult(toolUseId, 'not_found', `File not found: ${input.file_path}`);
    }
    return errResult(toolUseId, 'read_failed', err?.message || String(err));
  }

  const occurrences = original.split(input.old_string).length - 1;
  const replaceAll = input.replace_all === true;

  if (occurrences === 0) {
    return errResult(
      toolUseId,
      'not_found_in_file',
      `old_string not found in ${input.file_path}`
    );
  }
  if (occurrences > 1 && !replaceAll) {
    return errResult(
      toolUseId,
      'ambiguous_match',
      `old_string matches ${occurrences} locations in ${input.file_path}; pass replace_all:true or provide more context so it's unique.`
    );
  }

  const updated = replaceAll
    ? original.split(input.old_string).join(input.new_string)
    : original.replace(input.old_string, input.new_string);

  // Re-use the same atomic-write path so ownership stays correct.
  return runWrite(
    { file_path: input.file_path, content: updated },
    toolUseId,
    userId,
    workspaceRoot,
    username
  ).then((res) => {
    if ('error' in res) return res;
    // Override the success text so the model sees "edited N locations"
    // instead of "wrote N bytes".
    return okResult(
      toolUseId,
      replaceAll
        ? `Edited ${occurrences} occurrence${occurrences === 1 ? '' : 's'} in ${input.file_path}`
        : `Edited 1 occurrence in ${input.file_path}`
    );
  });
}

async function runGlob(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  if (typeof input.pattern !== 'string' || !input.pattern.trim()) {
    return errResult(toolUseId, 'invalid_input', 'Glob.input.pattern (string) required');
  }

  let searchRoot = workspaceRoot;
  if (input.path) {
    const resolved = await resolveJailedPath(String(input.path), workspaceRoot, userId);
    if (!resolved) {
      return errResult(
        toolUseId,
        'path_escape',
        `Glob.input.path must resolve under /workspaces/${userId}/`
      );
    }
    searchRoot = resolved;
  }

  // Shell out to `find` via bash globstar. Avoids bringing the `glob`
  // npm package in as a new dep and keeps behavior identical whether
  // the endpoint is running or a user runs the same pattern manually
  // in their terminal.
  //
  // We use bash -O globstar so ** matches across directories. The
  // pattern is inserted via single-quote escape so shell metacharacters
  // in the pattern don't get re-interpreted outside globbing.
  //
  // printf "%s\n" keeps output one-per-line even when there's zero or
  // one result (the bare glob expansion would output the literal
  // pattern if no match — shopt -s nullglob prevents that).
  const pattern = shellSingleQuote(input.pattern);
  const script =
    `cd ${shellSingleQuote(searchRoot)} && ` +
    `shopt -s globstar nullglob dotglob 2>/dev/null; ` +
    `matches=(${pattern}); ` +
    `if [ \${#matches[@]} -eq 0 ]; then exit 0; fi; ` +
    `printf "%s\\n" "\${matches[@]}" | sort`;

  // NOTE: buildSandboxedCommand runs the payload under
  // `su -s /bin/bash ... -c 'source ~/.bashrc 2>/dev/null; <ulimits> && <cmd>'`
  // so we're already inside bash by the time this script runs. The
  // shopt line above toggles globstar inside that bash invocation.
  const { stdout, stderr, exitCode, timedOut } = await runAsSandboxUser(
    username,
    script,
    { timeoutMs: 30_000 }
  );

  if (timedOut) {
    return errResult(toolUseId, 'timeout', 'Glob timed out');
  }
  if (exitCode !== 0) {
    return errResult(
      toolUseId,
      'glob_failed',
      stderr.trim() || `glob failed with exit ${exitCode}`
    );
  }

  const matches = stdout.split('\n').filter((s) => s.length > 0);
  if (matches.length === 0) {
    return okResult(toolUseId, `No files matched pattern: ${input.pattern}`);
  }

  // Cap the output so a greedy pattern like ** doesn't dump 100k
  // entries into the model context.
  const cap = GREP_DEFAULT_HEAD;
  const shown = matches.slice(0, cap).join('\n');
  const tail =
    matches.length > cap
      ? `\n\n[${matches.length - cap} more results truncated; narrow the pattern]`
      : '';
  return okResult(toolUseId, shown + tail);
}

async function runGrep(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  if (typeof input.pattern !== 'string' || !input.pattern.trim()) {
    return errResult(toolUseId, 'invalid_input', 'Grep.input.pattern (string) required');
  }

  let searchRoot = workspaceRoot;
  if (input.path) {
    const resolved = await resolveJailedPath(String(input.path), workspaceRoot, userId);
    if (!resolved) {
      return errResult(
        toolUseId,
        'path_escape',
        `Grep.input.path must resolve under /workspaces/${userId}/`
      );
    }
    searchRoot = resolved;
  }

  // Map the openagentic-style input keys to ripgrep args.
  const outputMode: string =
    typeof input.output_mode === 'string' &&
    ['content', 'files_with_matches', 'count'].includes(input.output_mode)
      ? input.output_mode
      : 'files_with_matches';

  const rgArgs: string[] = [];
  if (input['-i'] === true) rgArgs.push('-i');
  if (outputMode === 'content' && input['-n'] !== false) rgArgs.push('-n');
  if (typeof input.type === 'string' && /^[A-Za-z0-9_+-]+$/.test(input.type)) {
    rgArgs.push('--type', input.type);
  }
  if (typeof input.glob === 'string') {
    rgArgs.push('--glob', input.glob);
  }
  if (typeof input['-A'] === 'number' && outputMode === 'content') rgArgs.push('-A', String(input['-A']));
  if (typeof input['-B'] === 'number' && outputMode === 'content') rgArgs.push('-B', String(input['-B']));
  if (typeof input['-C'] === 'number' && outputMode === 'content') rgArgs.push('-C', String(input['-C']));

  if (outputMode === 'files_with_matches') rgArgs.push('-l');
  else if (outputMode === 'count') rgArgs.push('-c');
  // (content mode: no extra flag, default rg output)

  if (input.multiline === true) rgArgs.push('-U', '--multiline-dotall');

  // Cap total output lines via head to keep context predictable.
  const headLimit =
    typeof input.head_limit === 'number' && input.head_limit > 0
      ? Math.min(Math.floor(input.head_limit), 10_000)
      : GREP_DEFAULT_HEAD;

  // Build the command. rg exits 1 when there are no matches — treat
  // that as "no results" rather than an error.
  const rgCmd =
    [
      'rg',
      '--color=never',
      '--no-heading',
      ...rgArgs.map(shellSingleQuote),
      shellSingleQuote(input.pattern),
      shellSingleQuote(searchRoot),
    ].join(' ') + ` | head -n ${headLimit}`;

  const { stdout, stderr, exitCode, timedOut } = await runAsSandboxUser(
    username,
    rgCmd,
    { timeoutMs: 60_000 }
  );

  if (timedOut) {
    return errResult(toolUseId, 'timeout', 'Grep timed out');
  }

  // Note: because of `| head`, the pipeline's exit status is head's
  // (which is 0 as long as it reads something). rg's own exit code is
  // swallowed. That's OK for our purposes — we rely on the content of
  // stdout to distinguish hit vs miss. rg's stderr surfaces real
  // errors (bad pattern, missing tool, etc.) regardless.
  if (exitCode !== 0 && !stdout) {
    return errResult(
      toolUseId,
      'grep_failed',
      stderr.trim() || `grep failed with exit ${exitCode}`
    );
  }

  if (!stdout.trim()) {
    return okResult(toolUseId, `No matches for pattern: ${input.pattern}`);
  }

  // Strip the absolute workspace prefix so results are relative to
  // the user's workspace — matches the mental model the UI uses.
  const prefix = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep;
  const rel = stdout
    .split('\n')
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .join('\n');

  return okResult(toolUseId, rel.replace(/\n+$/, ''));
}

async function runLS(
  input: Record<string, any>,
  toolUseId: string,
  userId: string,
  workspaceRoot: string,
  username: string
): Promise<ToolOutcome> {
  // Default: workspace root. Accept either path or file_path for
  // compat with CLI-style callers.
  const requested =
    typeof input.path === 'string'
      ? input.path
      : typeof input.file_path === 'string'
        ? input.file_path
        : '.';
  const resolved = await resolveJailedPath(requested, workspaceRoot, userId);
  if (!resolved) {
    return errResult(
      toolUseId,
      'path_escape',
      `LS.input.path must resolve under /workspaces/${userId}/`
    );
  }

  const { stdout, stderr, exitCode, timedOut } = await runAsSandboxUser(
    username,
    `ls -la --color=never ${shellSingleQuote(resolved)}`,
    { timeoutMs: 15_000 }
  );

  if (timedOut) return errResult(toolUseId, 'timeout', 'LS timed out');
  if (exitCode !== 0) {
    return errResult(
      toolUseId,
      'ls_failed',
      stderr.trim() || `ls failed with exit ${exitCode}`
    );
  }

  return okResult(toolUseId, stdout.replace(/\n+$/, ''));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const toolHandlers: Record<
  string,
  (
    input: Record<string, any>,
    toolUseId: string,
    userId: string,
    workspaceRoot: string,
    username: string
  ) => Promise<ToolOutcome>
> = {
  Bash: runBash,
  Read: (input, id, uid, root) => runRead(input, id, uid, root),
  Write: runWrite,
  Edit: runEdit,
  Glob: runGlob,
  Grep: runGrep,
  LS: runLS,
};

export function createToolExecRouter(): ExpressRouter {
  const router = express.Router();

  router.post('/tool-exec', async (req: Request, res: Response, _next: NextFunction) => {
    const body = (req.body || {}) as ToolExecBody;
    const toolUseId =
      typeof body.tool_use_id === 'string' && body.tool_use_id
        ? body.tool_use_id
        : `tu_${randomBytes(8).toString('hex')}`;

    const toolName = body.tool_name;
    const userId = body.user_id;
    const input = (body.input || {}) as Record<string, any>;

    if (typeof toolName !== 'string' || !toolName) {
      return res
        .status(400)
        .json(errResult(toolUseId, 'invalid_input', 'tool_name (string) required'));
    }

    const handler = toolHandlers[toolName];
    if (!handler) {
      return res
        .status(400)
        .json(errResult(toolUseId, 'unknown_tool', `Unknown tool_name: ${toolName}`));
    }

    if (typeof userId !== 'string' || !userId) {
      return res
        .status(400)
        .json(errResult(toolUseId, 'invalid_input', 'user_id (string) required'));
    }

    const resolved = resolveUser(userId, toolUseId);
    if ('error' in resolved) {
      return res.status(400).json(resolved);
    }
    const { workspaceRoot, username } = resolved;

    // Session identifier for logs — we don't get a real sessionId on
    // the tool-exec path (ChatPipeline owns the conversation), so we
    // use the tool_use_id as a correlation key.
    const startedAt = Date.now();
    try {
      const outcome = await handler(input, toolUseId, userId, workspaceRoot, username);
      const durationMs = Date.now() - startedAt;
      loggers.api.info(
        {
          route: '/tool-exec',
          sessionId: toolUseId,
          user_id: userId,
          tool_name: toolName,
          durationMs,
          outcome: 'error' in outcome ? 'error' : 'ok',
          error_type: 'error' in outcome ? outcome.error.type : undefined,
        },
        'tool-exec completed'
      );
      // Always 200 — the structured error field inside the body tells
      // the pipeline what went wrong. Non-200 is reserved for
      // framing/auth failures (handled above and via middleware).
      return res.json(outcome);
    } catch (err: any) {
      const durationMs = Date.now() - startedAt;
      loggers.api.error(
        {
          route: '/tool-exec',
          sessionId: toolUseId,
          user_id: userId,
          tool_name: toolName,
          durationMs,
          err: err?.message || String(err),
        },
        'tool-exec handler threw'
      );
      return res
        .status(500)
        .json(errResult(toolUseId, 'handler_exception', err?.message || String(err)));
    }
  });

  return router;
}
