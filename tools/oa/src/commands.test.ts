import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile, saveProfile } from "./config.ts";
import { OaClient } from "./client.ts";
import {
  type CommandContext,
  cmdHealth,
  cmdLogin,
  cmdLogout,
  cmdWhoami,
  resolveClient,
} from "./commands.ts";

let server: Server | undefined;

async function fakeApi(
  responder: (req: IncomingMessage, body: unknown) => { status?: number; json?: unknown },
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const out = responder(req, raw ? JSON.parse(raw) : undefined);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

afterEach(() => {
  server?.close();
  server = undefined;
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "oa-cmd-"));
}

function ctx(overrides: Partial<CommandContext>): CommandContext {
  const out: string[] = [];
  const err: string[] = [];
  return {
    configDir: tempDir(),
    json: false,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: (o) => new OaClient(o),
    _out: out,
    _err: err,
    ...overrides,
  } as CommandContext & { _out: string[]; _err: string[] };
}

describe("resolveClient", () => {
  it("builds a client from the saved profile's url + api key", () => {
    const dir = tempDir();
    saveProfile(dir, "local", { instanceUrl: "http://x", apiKey: "oa_k" }, true);
    const seen: unknown[] = [];
    resolveClient(ctx({ configDir: dir, makeClient: (o) => (seen.push(o), new OaClient(o)) }));
    expect(seen[0]).toEqual({ instanceUrl: "http://x", token: "oa_k" });
  });

  it("throws a helpful error when no profile is configured", () => {
    expect(() => resolveClient(ctx({ configDir: tempDir() }))).toThrow(/oa login/);
  });

  it("honors an instance override with no stored profile (token optional)", () => {
    const seen: unknown[] = [];
    resolveClient(
      ctx({ instanceOverride: "http://ovr", makeClient: (o) => (seen.push(o), new OaClient(o)) }),
    );
    expect(seen[0]).toMatchObject({ instanceUrl: "http://ovr" });
  });
});

describe("cmdLogin", () => {
  it("authenticates, mints a user-bound api key, and saves it as the active profile", async () => {
    const url = await fakeApi((req) => {
      if (req.url === "/api/auth/local/login")
        return { json: { success: true, token: "jwt", user: { id: "u", email: "a@b.c", isAdmin: true } } };
      if (req.url === "/api/workflows/user/api-keys")
        return { status: 201, json: { key: { id: "k", name: "oa-cli", plaintext_key: "oa_minted", created_at: "x" } } };
      return { status: 404, json: { error: "nope" } };
    });
    const dir = tempDir();

    await cmdLogin(ctx({ configDir: dir }), {
      instanceUrl: url,
      username: "a@b.c",
      password: "pw",
      profileName: "local",
    });

    const prof = getProfile(dir, "local");
    expect(prof?.instanceUrl).toBe(url);
    expect(prof?.apiKey).toBe("oa_minted"); // stores the minted api key, NOT the JWT
  });
});

describe("cmdHealth", () => {
  it("prints the status (human mode)", async () => {
    const url = await fakeApi(() => ({ json: { status: "healthy", version: "1.0.5" } }));
    const c = ctx({ instanceOverride: url });
    await cmdHealth(c);
    expect((c as unknown as { _out: string[] })._out.join("\n")).toMatch(/healthy/);
  });

  it("prints raw JSON when json mode is on", async () => {
    const url = await fakeApi(() => ({ json: { status: "healthy", version: "1.0.5" } }));
    const c = ctx({ instanceOverride: url, json: true });
    await cmdHealth(c);
    const printed = JSON.parse((c as unknown as { _out: string[] })._out.join("\n"));
    expect(printed.version).toBe("1.0.5");
  });
});

describe("cmdLogout", () => {
  it("removes the named profile", async () => {
    const dir = tempDir();
    saveProfile(dir, "local", { instanceUrl: "http://x", apiKey: "oa_k" }, true);
    await cmdLogout(ctx({ configDir: dir, profileName: "local" }));
    expect(getProfile(dir, "local")).toBeUndefined();
  });
});

describe("cmdWhoami", () => {
  it("prints the resolved identity", async () => {
    const url = await fakeApi(() => ({
      json: { userId: "u1", email: "a@b.c", isAdmin: true, groups: [], authMethod: "api-key" },
    }));
    const dir = tempDir();
    saveProfile(dir, "local", { instanceUrl: url, apiKey: "oa_k" }, true);
    const c = ctx({ configDir: dir });
    await cmdWhoami(c);
    expect((c as unknown as { _out: string[] })._out.join("\n")).toMatch(/a@b\.c/);
  });
});
