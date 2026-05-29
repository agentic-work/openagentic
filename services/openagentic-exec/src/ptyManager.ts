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

interface InternalSession {
  pty: pty.IPty;
  meta: Session;
  listeners: Array<(data: string) => void>;
}

export class PtyManager {
  private claudePath: string;
  private sessions: Map<string, InternalSession> = new Map();

  constructor(opts: { claudePath: string }) {
    this.claudePath = opts.claudePath;
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    if (this.sessions.has(input.sessionId)) {
      return this.sessions.get(input.sessionId)!.meta;
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
    };

    this.sessions.set(input.sessionId, internal);

    p.onData((data: string) => {
      for (const cb of internal.listeners) {
        cb(data);
      }
    });

    p.onExit(() => {
      meta.status = 'stopped';
    });

    return meta;
  }

  onData(sessionId: string, cb: (data: string) => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listeners.push(cb);
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
      session.pty.resize(cols, rows);
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
