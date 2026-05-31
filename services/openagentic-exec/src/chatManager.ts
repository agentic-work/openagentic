import { spawn, type ChildProcess } from 'child_process';
import { buildClaudeSpawn } from './buildClaudeSpawn.js';
import type { CreateSessionInput, Session } from './ptyManager.js';

// Persistent stream-json session: `claude --print --input-format stream-json
// --output-format stream-json` reads user messages as NDJSON from stdin and
// streams structured events (system/assistant/user/result) as NDJSON to stdout.
// This is the "no xterm" codemode path — the browser renders these events as
// DOM/React components instead of terminal bytes.
const STREAM_JSON_ARGS = [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
];

const OUTPUT_BUFFER_MAX = 256 * 1024; // cap of replayed NDJSON for late WS connects

interface InternalChatSession {
  proc: ChildProcess;
  meta: Session;
  listeners: Array<(line: string) => void>;
  /** Recent COMPLETE NDJSON lines, replayed to a late-connecting socket. */
  replay: string[];
  /** Carry partial stdout between chunks until a newline completes a line. */
  stdoutBuf: string;
}

/**
 * ChatManager — the stream-json sibling of PtyManager. Same lifecycle surface
 * (createSession / onData / removeListener / write / stopSession / getStatus /
 * getOutputBuffer), but spawns a piped child_process (not a PTY) and emits one
 * NDJSON line per listener callback instead of raw terminal bytes.
 */
export class ChatManager {
  private claudePath: string;
  private sessions: Map<string, InternalChatSession> = new Map();

  constructor(opts: { claudePath: string }) {
    this.claudePath = opts.claudePath;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      if (existing.meta.status === 'running') return existing.meta;
      this.sessions.delete(input.sessionId);
    }

    const cfg = buildClaudeSpawn({
      claudePath: this.claudePath,
      workspacePath: input.workspacePath,
      apiEndpoint: input.apiEndpoint,
      authToken: input.authToken,
      model: input.model,
      home: input.home,
    });

    const proc = spawn(cfg.command, [...cfg.args, ...STREAM_JSON_ARGS], {
      cwd: cfg.cwd,
      env: cfg.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const meta: Session = {
      sessionId: input.sessionId,
      userId: input.userId,
      status: 'running',
      workspacePath: input.workspacePath,
      pid: proc.pid ?? -1,
      createdAt: Date.now(),
    };

    const internal: InternalChatSession = { proc, meta, listeners: [], replay: [], stdoutBuf: '' };
    this.sessions.set(input.sessionId, internal);

    proc.stdout?.on('data', (chunk: Buffer) => {
      internal.stdoutBuf += chunk.toString('utf8');
      const lines = internal.stdoutBuf.split('\n');
      internal.stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        internal.replay.push(trimmed);
        let total = internal.replay.reduce((a, l) => a + l.length + 1, 0);
        while (total > OUTPUT_BUFFER_MAX && internal.replay.length > 1) {
          total -= (internal.replay.shift() as string).length + 1;
        }
        for (const cb of internal.listeners) cb(trimmed);
      }
    });

    // claude logs diagnostics to stderr; surface as a synthetic event so the UI
    // can show a banner, but don't break the NDJSON contract.
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim();
      if (!text) return;
      const evt = JSON.stringify({ type: 'system', subtype: 'stderr', text: text.slice(0, 500) });
      for (const cb of internal.listeners) cb(evt);
    });

    proc.on('exit', () => {
      meta.status = 'stopped';
      internal.listeners = [];
    });

    return meta;
  }

  onData(sessionId: string, cb: (line: string) => void): void {
    this.sessions.get(sessionId)?.listeners.push(cb);
  }

  removeListener(sessionId: string, cb: (line: string) => void): void {
    const s = this.sessions.get(sessionId);
    if (s) s.listeners = s.listeners.filter(l => l !== cb);
  }

  /**
   * Send a user turn. Accepts either a raw text string or a JSON string. A
   * `{ text }` payload (or bare text) is wrapped into claude's stream-json user
   * message; a full stream-json message JSON is forwarded verbatim.
   */
  write(sessionId: string, data: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.meta.status !== 'running' || !s.proc.stdin?.writable) return;
    let line = data;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object' && parsed.type === 'user') {
        line = JSON.stringify(parsed);
      } else {
        const text = typeof parsed?.text === 'string' ? parsed.text : data;
        line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
      }
    } catch {
      line = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: data }] } });
    }
    s.proc.stdin.write(line + '\n');
  }

  async stopSession(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try { s.proc.stdin?.end(); } catch { /* ignore */ }
    try { s.proc.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise<void>(r => setTimeout(r, 100));
    if (s.meta.status === 'running') {
      try { s.proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    s.meta.status = 'stopped';
    s.listeners = [];
  }

  /** Joined NDJSON lines (newline-delimited) for replay on a late connect. */
  getOutputBuffer(sessionId: string): string {
    const s = this.sessions.get(sessionId);
    return s ? s.replay.map(l => l + '\n').join('') : '';
  }

  getStatus(sessionId: string): 'running' | 'stopped' | 'unknown' {
    const s = this.sessions.get(sessionId);
    return s ? s.meta.status : 'unknown';
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map(s => s.meta);
  }
}
