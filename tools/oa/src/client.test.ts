import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { ApiError, OaClient } from "./client.ts";

interface CapturedRequest {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: unknown;
}

type Responder = (
  req: IncomingMessage,
  body: unknown,
) => { status?: number; json?: unknown };

let server: Server | undefined;

async function fakeApi(responder: Responder): Promise<{
  url: string;
  requests: CapturedRequest[];
}> {
  const requests: CapturedRequest[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      const out = responder(req, body);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, requests };
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("OaClient", () => {
  it("login posts username/password to /api/auth/local/login with no auth header", async () => {
    const api = await fakeApi(() => ({
      json: { success: true, token: "jwt-123", user: { id: "u1", email: "a@b.c", isAdmin: true } },
    }));
    const client = new OaClient({ instanceUrl: api.url });

    const res = await client.login("admin@openagentic.local", "pw");

    expect(api.requests[0].method).toBe("POST");
    expect(api.requests[0].url).toBe("/api/auth/local/login");
    expect(api.requests[0].body).toEqual({
      username: "admin@openagentic.local",
      password: "pw",
    });
    expect(api.requests[0].headers.authorization).toBeUndefined();
    expect(res.token).toBe("jwt-123");
    expect(res.user.email).toBe("a@b.c");
  });

  it("authed requests send Authorization: Bearer <token>", async () => {
    const api = await fakeApi(() => ({
      json: { userId: "u1", email: "a@b.c", isAdmin: false, groups: [], authMethod: "api-key" },
    }));
    const client = new OaClient({ instanceUrl: api.url, token: "oa_secret" });

    const who = await client.whoami();

    expect(api.requests[0].url).toBe("/api/auth/validate-token");
    expect(api.requests[0].headers.authorization).toBe("Bearer oa_secret");
    expect(who.email).toBe("a@b.c");
    expect(who.authMethod).toBe("api-key");
  });

  it("createApiKey POSTs a name and returns the one-time plaintext key", async () => {
    const api = await fakeApi(() => ({
      status: 201,
      json: {
        key: { id: "k1", name: "cli", plaintext_key: "oa_abc", created_at: "2026-06-27T00:00:00Z" },
        warning: "Save this key now.",
      },
    }));
    const client = new OaClient({ instanceUrl: api.url, token: "jwt-123" });

    const key = await client.createApiKey("cli");

    expect(api.requests[0].method).toBe("POST");
    expect(api.requests[0].url).toBe("/api/workflows/user/api-keys");
    expect(api.requests[0].body).toEqual({ name: "cli" });
    expect(key.plaintext_key).toBe("oa_abc");
  });

  it("listApiKeys returns the keys array", async () => {
    const api = await fakeApi(() => ({
      json: { keys: [{ id: "k1", name: "cli", created_at: "x", last_used_at: null, expires_at: null }] },
    }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });
    expect(await client.listApiKeys()).toHaveLength(1);
  });

  it("revokeApiKey issues a DELETE to the key id path", async () => {
    const api = await fakeApi(() => ({ json: { success: true, message: "API key revoked" } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    await client.revokeApiKey("k1");

    expect(api.requests[0].method).toBe("DELETE");
    expect(api.requests[0].url).toBe("/api/workflows/user/api-keys/k1");
  });

  it("health parses the status payload (no auth required)", async () => {
    const api = await fakeApi(() => ({ json: { status: "healthy", version: "1.0.5" } }));
    const client = new OaClient({ instanceUrl: api.url });
    const h = await client.health();
    expect(h.status).toBe("healthy");
    expect(h.version).toBe("1.0.5");
  });

  it("listWorkflows returns the workflows array", async () => {
    const api = await fakeApi(() => ({
      json: { workflows: [{ id: "w1", name: "triage" }], total: 1, limit: 50, offset: 0 },
    }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });
    const flows = await client.listWorkflows();
    expect(flows[0].name).toBe("triage");
  });

  it("executeWorkflow POSTs input to the :id/execute path", async () => {
    const api = await fakeApi(() => ({ json: { executionId: "e1", status: "running" } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    const res = await client.executeWorkflow("w1", { foo: "bar" });

    expect(api.requests[0].method).toBe("POST");
    expect(api.requests[0].url).toBe("/api/workflows/w1/execute");
    expect(api.requests[0].body).toMatchObject({ input: { foo: "bar" } });
    expect(res.executionId).toBe("e1");
  });

  it("listAgents returns the agents array", async () => {
    const api = await fakeApi(() => ({ json: { agents: [{ id: "a1", name: "reasoning" }] } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });
    expect((await client.listAgents())[0].name).toBe("reasoning");
  });

  it("maps a non-2xx response to ApiError carrying status and server message", async () => {
    const api = await fakeApi(() => ({ status: 401, json: { error: "Invalid API key" } }));
    const client = new OaClient({ instanceUrl: api.url, token: "bad" });

    await expect(client.whoami()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "Invalid API key",
    });
    await expect(client.whoami()).rejects.toBeInstanceOf(ApiError);
  });

  it("normalizes a trailing slash in instanceUrl so paths are not doubled", async () => {
    const api = await fakeApi(() => ({ json: { status: "healthy" } }));
    const client = new OaClient({ instanceUrl: `${api.url}/` });
    await client.health();
    expect(api.requests[0].url).toBe("/api/health");
  });
});
