/**
 * progressTail — file-tail event source for /ws/progress/:id
 *
 * Phase 3 of the CodeMode polish work needs a side channel for live
 * structured tool events that runs alongside the xterm.js PTY stream
 * (which is unstructured ANSI bytes from the openagentic Ink TUI). The
 * easiest available source is openagentic's own pino log file: every
 * tool invocation, success, error, and progress event already gets
 * logged via logEvent() to ~/.openagentic/logs/openagentic-${pid}.jsonl
 * inside the sandbox user's home dir.
 *
 * This module:
 *   1. Resolves the per-session pino log directory based on the
 *      sandbox user's home (or the daemon-runner home if no sandbox)
 *   2. Discovers the latest log file by mtime (openagentic rotates
 *      per-pid, so the freshest one is the active session)
 *   3. Tails it line-by-line via fs.watch + read-from-offset
 *   4. Filters for tool events (event names starting with
 *      `agw_tool_use_`) and forwards them as parsed JSON
 *   5. Re-discovers the latest file every poll tick so a process
 *      restart inside the sandbox is picked up automatically
 *
 * The tail is cooperative: each /ws/progress connection registers a
 * subscriber, and the file watcher only runs while at least one
 * subscriber is active. Last unsubscribe stops the watcher and
 * releases the file descriptor.
 */

import { EventEmitter } from 'node:events'
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  watch,
  type FSWatcher,
} from 'node:fs'
import { join } from 'node:path'

/**
 * Per-session tail state. We track the active file path, the byte
 * offset we've already streamed, and the active fs.watch handle so
 * we can clean up when the last subscriber leaves.
 */
interface TailState {
  sessionId: string
  /** Resolved logs directory we tail (sandbox user's or fallback). */
  logsDir: string
  /** Active log file path (latest by mtime). Re-resolved on each tick. */
  currentFile: string | null
  /** Bytes already streamed from currentFile. */
  offset: number
  /** Bytes left over from a partial line (no trailing newline yet). */
  buffered: string
  /** Active subscribers — once empty we tear the watcher down. */
  subscribers: Set<(event: ToolEvent) => void>
  /** fs.watch handle on the logs directory; null when idle. */
  watcher: FSWatcher | null
  /** Periodic re-poll for the case where fs.watch doesn't fire (NFS, etc.). */
  pollTimer: ReturnType<typeof setInterval> | null
}

/**
 * Shape of a single forwarded event. We pass through the raw pino
 * record but mark the wire-protocol fields the UI needs upfront for
 * cheap discrimination at the React layer.
 */
export interface ToolEvent {
  /** Event name from the pino record (e.g. agw_tool_use_success). */
  event: string
  /** Pino timestamp (ISO 8601 string). */
  time?: string
  /** Pino log level (50 = error, 30 = info, etc.). */
  level?: number
  /** Tool identifier the model used (e.g. "Bash", "Edit", "Write"). */
  tool_name?: string
  /** Tool use id from the assistant turn (matches tool_result). */
  tool_use_id?: string
  /** Optional duration when the event represents a completion. */
  durationMs?: number
  /** Anything else from the raw pino record passes through verbatim. */
  [key: string]: unknown
}

const TICK_MS = 250
const READ_CHUNK_BYTES = 64 * 1024

const states = new Map<string, TailState>()

function discoverLogsDir(sessionMeta: { sandboxUsername?: string; userHome?: string }): string {
  // Sandbox path takes precedence — that's where openagentic actually
  // writes when running under a sandbox user.
  if (sessionMeta.sandboxUsername) {
    return `/home/${sessionMeta.sandboxUsername}/.openagentic/logs`
  }
  if (sessionMeta.userHome) {
    return join(sessionMeta.userHome, '.openagentic', 'logs')
  }
  // No sandbox / no user home → use the daemon's own home as the fallback
  return join(process.env.HOME ?? '/root', '.openagentic', 'logs')
}

/**
 * Pick the freshest .jsonl file in the logs dir. openagentic rotates
 * per-pid (`openagentic-${pid}.jsonl`), so the latest file is the
 * currently-running process for this sandbox user. Returns null when
 * the dir is missing or empty (e.g. openagentic hasn't started yet).
 */
function pickActiveLogFile(logsDir: string): string | null {
  if (!existsSync(logsDir)) return null
  let files: string[]
  try {
    files = readdirSync(logsDir)
  } catch {
    return null
  }
  let bestPath: string | null = null
  let bestMtime = -1
  for (const name of files) {
    if (!name.endsWith('.jsonl') && !name.endsWith('.log')) continue
    const fullPath = join(logsDir, name)
    try {
      const st = statSync(fullPath)
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs
        bestPath = fullPath
      }
    } catch {
      // skip unreadable
    }
  }
  return bestPath
}

/**
 * Drain the current file from `state.offset` to EOF. Buffers a partial
 * trailing line into `state.buffered` so split-across-reads lines
 * concatenate correctly on the next tick.
 */
function drainFile(state: TailState): void {
  if (!state.currentFile) return
  let st
  try {
    st = statSync(state.currentFile)
  } catch {
    return
  }
  // File rotated/truncated under us — restart from offset 0
  if (st.size < state.offset) {
    state.offset = 0
    state.buffered = ''
  }
  if (st.size === state.offset) return
  let fd: number | null = null
  try {
    fd = openSync(state.currentFile, 'r')
    while (state.offset < st.size) {
      const remaining = st.size - state.offset
      const len = Math.min(READ_CHUNK_BYTES, remaining)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, state.offset)
      state.offset += len
      state.buffered += buf.toString('utf8')
    }
    // Split into complete lines, keep any trailing partial line for
    // the next drain.
    const idx = state.buffered.lastIndexOf('\n')
    if (idx === -1) return
    const complete = state.buffered.slice(0, idx)
    state.buffered = state.buffered.slice(idx + 1)
    for (const line of complete.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (!trimmed.startsWith('{')) continue
      let parsed: ToolEvent
      try {
        parsed = JSON.parse(trimmed) as ToolEvent
      } catch {
        continue
      }
      // Filter for tool events. openagentic also writes lots of api
      // call events (agw_api_query, agw_api_success, etc.) to the
      // same file — those are useful too but Phase 3 cards focus on
      // tool execution. Forward both API and tool events; the UI
      // layer can decide which to render.
      const evName = typeof parsed.event === 'string' ? parsed.event : ''
      if (
        !evName.startsWith('agw_tool_use_') &&
        !evName.startsWith('agw_api_') &&
        evName !== 'agw_file_changed'
      ) {
        continue
      }
      for (const sub of state.subscribers) {
        try {
          sub(parsed)
        } catch {
          // sub blew up — drop and keep going so one bad subscriber
          // can't stall the whole tail
        }
      }
    }
  } catch {
    // transient read error — try again next tick
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {}
    }
  }
}

/**
 * Re-resolve the active log file. When openagentic (or whatever
 * process is logging) restarts inside the sandbox, the latest pid
 * changes and we need to reset offset on the new file. We also need
 * to handle the cold-start case where the dir is empty when the
 * client first connects and the file appears later.
 */
function refreshActiveFile(state: TailState): void {
  const next = pickActiveLogFile(state.logsDir)
  if (next === state.currentFile) return
  // New file → reset offset and buffered, replay any history that's
  // already in the new file (the openagentic CLI may have been logging
  // for a while before the first /ws/progress client connected).
  state.currentFile = next
  state.offset = 0
  state.buffered = ''
}

/**
 * Spin up the watcher loop for a session if it isn't already running.
 * Idempotent — calling it multiple times is safe.
 */
function ensureWatching(state: TailState): void {
  if (state.pollTimer) return
  // Tick at 250ms — the file write pattern from pino is small,
  // frequent appends, so a fast poll keeps perceived latency low
  // without burning CPU on idle sessions.
  state.pollTimer = setInterval(() => {
    refreshActiveFile(state)
    drainFile(state)
  }, TICK_MS)
  // fs.watch is best-effort. On Linux it usually fires on file
  // append; on NFS / FUSE / S3FS mounts it may not. The poll timer
  // above is the actual source of truth; the watcher is a latency
  // optimization that fires drainFile() immediately when something
  // changes.
  if (existsSync(state.logsDir)) {
    try {
      state.watcher = watch(state.logsDir, () => {
        refreshActiveFile(state)
        drainFile(state)
      })
    } catch {
      // watch failed — the poll timer covers it
    }
  }
}

function stopWatching(state: TailState): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer)
    state.pollTimer = null
  }
  if (state.watcher) {
    try {
      state.watcher.close()
    } catch {}
    state.watcher = null
  }
}

/**
 * Public API: subscribe to tool events for a given session. Returns
 * an unsubscribe function. The first subscriber starts the watcher;
 * the last unsubscribe stops it. Subscribers are called synchronously
 * with each parsed event in the order they were appended to the file.
 */
export function subscribeProgress(
  sessionId: string,
  sessionMeta: { sandboxUsername?: string; userHome?: string },
  callback: (event: ToolEvent) => void,
): () => void {
  let state = states.get(sessionId)
  if (!state) {
    state = {
      sessionId,
      logsDir: discoverLogsDir(sessionMeta),
      currentFile: null,
      offset: 0,
      buffered: '',
      subscribers: new Set(),
      watcher: null,
      pollTimer: null,
    }
    states.set(sessionId, state)
  }
  state.subscribers.add(callback)

  // Replay history once on subscription so a late-joining client
  // sees what already happened in the session. We do this by reading
  // the current file from offset 0, which is the default state for a
  // freshly-allocated state object.
  if (state.currentFile === null) {
    refreshActiveFile(state)
    if (state.currentFile && existsSync(state.currentFile)) {
      try {
        const content = readFileSync(state.currentFile, 'utf8')
        // Send history events directly to this subscriber only — we
        // don't want to spam other subscribers that already saw them.
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('{')) continue
          try {
            const parsed = JSON.parse(trimmed) as ToolEvent
            const evName = typeof parsed.event === 'string' ? parsed.event : ''
            if (
              !evName.startsWith('agw_tool_use_') &&
              !evName.startsWith('agw_api_') &&
              evName !== 'agw_file_changed'
            ) {
              continue
            }
            try {
              callback(parsed)
            } catch {}
          } catch {}
        }
        state.offset = Buffer.byteLength(content, 'utf8')
      } catch {}
    }
  }

  ensureWatching(state)

  return () => {
    if (!state) return
    state.subscribers.delete(callback)
    if (state.subscribers.size === 0) {
      stopWatching(state)
      states.delete(sessionId)
    }
  }
}

/**
 * Tear down all active tails. Called from the daemon shutdown path
 * so we don't leak file descriptors or timers.
 */
export function shutdownAllProgressTails(): void {
  for (const state of states.values()) {
    stopWatching(state)
    state.subscribers.clear()
  }
  states.clear()
}
