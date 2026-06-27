/** Error carrying the HTTP status and the server's error message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Extract a human-readable message from an error response body of any shape. */
function errorMessage(data: unknown, statusText: string, status: number): string {
  const d = data as { error?: unknown; message?: unknown } | null;
  const err = d?.error;
  if (typeof err === "string" && err) return err;
  if (typeof d?.message === "string" && d.message) return d.message;
  if (err && typeof err === "object") {
    const nested = (err as { message?: unknown }).message;
    if (typeof nested === "string" && nested) return nested;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return statusText || `HTTP ${status}`;
}

export interface ClientOptions {
  instanceUrl: string;
  /** A user-bound api key (oa_…) or a login JWT. Omitted for unauthed calls. */
  token?: string;
}

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    name?: string;
    isAdmin: boolean;
    groups?: string[];
  };
}

export interface WhoAmI {
  userId: string;
  email: string;
  isAdmin: boolean;
  groups: string[];
  authMethod: "api-key" | "jwt";
}

export interface Health {
  status: string;
  version?: string;
  [key: string]: unknown;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  plaintext_key: string;
  created_at: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface Agent {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface RequestOptions {
  body?: unknown;
  /** Attach the Authorization header (default true). */
  auth?: boolean;
}

export class OaClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.instanceUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if ((opts.auth ?? true) && this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new ApiError(res.status, errorMessage(data, res.statusText, res.status));
    }
    return data as T;
  }

  login(username: string, password: string): Promise<LoginResult> {
    return this.request<LoginResult>("POST", "/api/auth/local/login", {
      body: { username, password },
      auth: false,
    });
  }

  whoami(): Promise<WhoAmI> {
    return this.request<WhoAmI>("POST", "/api/auth/validate-token");
  }

  health(): Promise<Health> {
    return this.request<Health>("GET", "/api/health", { auth: false });
  }

  async createApiKey(name: string): Promise<ApiKeyCreated> {
    const res = await this.request<{ key: ApiKeyCreated }>(
      "POST",
      "/api/workflows/user/api-keys",
      { body: { name } },
    );
    return res.key;
  }

  async listApiKeys(): Promise<ApiKeyInfo[]> {
    const res = await this.request<{ keys: ApiKeyInfo[] }>(
      "GET",
      "/api/workflows/user/api-keys",
    );
    return res.keys;
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request("DELETE", `/api/workflows/user/api-keys/${encodeURIComponent(id)}`);
  }

  async listWorkflows(): Promise<Workflow[]> {
    const res = await this.request<{ workflows: Workflow[] }>(
      "GET",
      "/api/workflows",
    );
    return res.workflows;
  }

  executeWorkflow(
    id: string,
    input?: Record<string, unknown>,
  ): Promise<{ executionId?: string; status?: string; [key: string]: unknown }> {
    return this.request("POST", `/api/workflows/${encodeURIComponent(id)}/execute`, {
      body: { input: input ?? {}, trigger_type: "manual" },
    });
  }

  async listAgents(): Promise<Agent[]> {
    const res = await this.request<{ agents: Agent[] }>("GET", "/api/agents");
    return res.agents;
  }

  executeAgent(
    id: string,
    task: string,
    context?: Record<string, unknown>,
  ): Promise<{ executionId: string }> {
    return this.request("POST", `/api/agents/${encodeURIComponent(id)}/execute`, {
      body: { task, context: context ?? {} },
    });
  }

  async createSession(title?: string): Promise<{ id: string; [key: string]: unknown }> {
    const res = await this.request<{ session: { id: string; [key: string]: unknown } }>(
      "POST",
      "/api/chat/sessions",
      { body: { title: title ?? "oa" } },
    );
    return res.session;
  }

  /** Stream a chat turn; invokes onEvent for each parsed SSE `data:` frame. */
  async chatStream(
    params: { sessionId: string; message: string; model?: string },
    onEvent: (event: unknown) => void,
  ): Promise<void> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text();
      let data: unknown = {};
      try {
        data = JSON.parse(text);
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, errorMessage(data, res.statusText, res.status));
    }
    if (!res.body) return;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const emit = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Real wire format is newline-delimited JSON; tolerate an optional SSE
      // `data:` prefix and skip keepalive sentinels.
      const payload = trimmed.startsWith("data:")
        ? trimmed.slice(trimmed.indexOf(":") + 1).trim()
        : trimmed;
      if (!payload || payload === "[DONE]") return;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* skip non-JSON keepalive line */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        emit(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    emit(buf); // flush any trailing frame with no final newline
  }

  /** Detect whether the target deploy serves the web UI (SPA) vs is headless. */
  async detectUi(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/`, { method: "GET" });
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/html")) return false;
      const body = await res.text();
      return body.includes('id="root"') || body.toLowerCase().includes("<!doctype html");
    } catch {
      return false;
    }
  }
}
