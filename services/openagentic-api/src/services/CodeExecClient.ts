/**
 * CodeExecClient
 *
 * Typed HTTP client for the openagentic-exec service (port 3060).
 * All requests carry the `x-internal-api-key` header so the exec service
 * can authenticate api-originated calls.
 *
 * Endpoint contract (exec service spec Task 2.3 / openagentic-exec):
 *   POST   /sessions           — create session
 *   GET    /sessions/:id       — get session
 *   DELETE /sessions/:id       — stop session
 *   POST   /sessions/:id/resize — resize PTY
 */

export interface CreateSessionInput {
  sessionId: string;
  userId: string;
  userEmail?: string;
  workspacePath: string;
  model?: string;
  apiKey?: string;
  authToken?: string;
  apiEndpoint?: string;
}

export interface ExecSession {
  sessionId: string;
  userId: string;
  status: string;
  workspacePath: string;
  pid: number;
  createdAt: number;
}

export class CodeExecClient {
  private readonly baseUrl: string;
  private readonly internalKey: string;

  constructor() {
    this.baseUrl = (process.env.CODE_EXEC_URL || 'http://openagentic-exec:3060').replace(/\/$/, '');
    this.internalKey = process.env.CODE_EXEC_INTERNAL_KEY || '';
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-internal-api-key': this.internalKey,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    };
    if (body !== undefined) {
      (init as any).body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`CodeExecClient: ${method} ${path} failed with status ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Create a new exec session on the openagentic-exec service. */
  async createSession(input: CreateSessionInput): Promise<ExecSession> {
    return this.request<ExecSession>('POST', '/sessions', input);
  }

  /** Fetch an existing exec session by ID. */
  async getSession(id: string): Promise<ExecSession> {
    return this.request<ExecSession>('GET', `/sessions/${id}`);
  }

  /** Terminate an exec session. */
  async stopSession(id: string): Promise<void> {
    await this.request<unknown>('DELETE', `/sessions/${id}`);
  }

  /** Send a PTY resize event to the exec service. */
  async resize(id: string, cols: number, rows: number): Promise<void> {
    await this.request<unknown>('POST', `/sessions/${id}/resize`, { cols, rows });
  }
}
