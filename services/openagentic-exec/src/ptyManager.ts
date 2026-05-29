import * as pty from 'node-pty';
import { buildClaudeSpawn } from './buildClaudeSpawn.js';

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  workspacePath: string;
  apiEndpoint: string;
  authToken: string;
  model: string;
  home: string;
  userEmail?: string;
}

export interface Session {
  sessionId: string;
  userId: string;
  status: 'running' | 'stopped';
  workspacePath: string;
  pid: number;
  createdAt: number;
}

const OUTPUT_BUFFER_MAX = 64 * 1024;

interface InternalSession {
  pty: pty.IPty;
  meta: Session;
  listeners: Array<(data: string) => void>;
  outputBuffer: string;
}

export class PtyManager {
  private claudePath: string;
  private sessions: Map<string, InternalSession> = new Map();

  constructor(opts: { claudePath: string }) {
    this.claudePath = opts.claudePath;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const existing = this.sessions.get(input.sessionId);
    if (existing) {
      // I1: If session is still running, return it (idempotent).
      // If stopped, delete and fall through to create a fresh one.
      if (existing.meta.status === 'running') {
        return existing.meta;
      }
      this.sessions.delete(input.sessionId);
    }

    const spawn = buildClaudeSpawn({
      claudePath: this.claudePath,
      workspacePath: input.workspacePath,
      apiEndpoint: input.apiEndpoint,
      authToken: input.authToken,
      model: input.model,
      home: input.home,
    });

    const p = pty.spawn(spawn.command, spawn.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: spawn.cwd,
      env: spawn.env,
    });

    const meta: Session = {
      sessionId: input.sessionId,
      userId: input.userId,
      status: 'running',
      workspacePath: input.workspacePath,
      pid: p.pid,
      createdAt: Date.now(),
    };

    const internal: InternalSession = {
      pty: p,
      meta,
      listeners: [],
      outputBuffer: '',
    };

    this.sessions.set(input.sessionId, internal);

    p.onData((data: string) => {
      // Maintain rolling output buffer for WS replay on late connects
      const combined = internal.outputBuffer + data;
      internal.outputBuffer = combined.length > OUTPUT_BUFFER_MAX
        ? combined.slice(-OUTPUT_BUFFER_MAX)
        : combined;
      for (const cb of internal.listeners) {
        cb(data);
      }
    });

    p.onExit(() => {
      meta.status = 'stopped';
      // I1: free heavy memory on process exit
      internal.listeners = [];
      internal.outputBuffer = '';
    });

    return meta;
  }

  onData(sessionId: string, cb: (data: string) => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.push(cb);
    }
  }

  // C2: Remove a specific data listener to prevent leaks and cross-talk.
  removeListener(sessionId: string, cb: (data: string) => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners = session.listeners.filter(l => l !== cb);
    }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.meta.status === 'running') {
      session.pty.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session && session.meta.status === 'running') {
      try {
        session.pty.resize(cols, rows);
      } catch {
        // pty may have exited between the status check and this call
      }
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.pty.kill('SIGTERM');
    } catch {
      // process may already be gone
    }

    await new Promise<void>(resolve => setTimeout(resolve, 100));

    if (session.meta.status === 'running') {
      try {
        session.pty.kill('SIGKILL');
      } catch {
        // ignore
      }
    }

    session.meta.status = 'stopped';
    // I1: free heavy memory; keep the entry so getStatus still returns 'stopped'
    session.listeners = [];
    session.outputBuffer = '';
  }

  getOutputBuffer(sessionId: string): string {
    return this.sessions.get(sessionId)?.outputBuffer ?? '';
  }

  getStatus(sessionId: string): 'running' | 'stopped' | 'unknown' {
    const session = this.sessions.get(sessionId);
    if (!session) return 'unknown';
    return session.meta.status;
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).map(s => s.meta);
  }
}
