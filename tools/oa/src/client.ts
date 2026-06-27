/** Error carrying the HTTP status and the server's error message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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
      const message =
        (data && (data.error || data.message)) ||
        res.statusText ||
        `HTTP ${res.status}`;
      throw new ApiError(res.status, String(message));
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
}
