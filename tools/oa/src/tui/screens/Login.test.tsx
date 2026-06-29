import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { OaClient } from "../../client.ts";
import { Login } from "./Login.tsx";

let server: Server | undefined;
let dir: string | undefined;

async function fakeApi(
  handler: (req: { method: string; url: string; body: unknown }, res: import("node:http").ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      handler({ method: req.method ?? "", url: req.url ?? "", body: raw ? JSON.parse(raw) : undefined }, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

const delay = (ms = 60): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  server?.close();
  server = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("Login screen (no profiles → inline form)", () => {
  it("mints a user-bound key and persists the KEY (never the JWT)", async () => {
    const seen: string[] = [];
    const url = await fakeApi((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === "/api/auth/local/login" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ token: "jwt-should-not-persist", user: { id: "u1", email: "admin@example.com", isAdmin: true } }));
      } else if (req.url === "/api/workflows/user/api-keys" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ key: { id: "k1", name: "oa-cli", plaintext_key: "oa_minted_secret", created_at: "x" } }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    dir = mkdtempSync(join(tmpdir(), "oa-login-"));
    let authed = false;
    const { stdin } = render(
      <Login
        configDir={dir}
        defaultInstance={url}
        makeClient={(opts) => new OaClient(opts)}
        onAuthenticated={() => {
          authed = true;
        }}
        onBack={() => {}}
        onError={() => {}}
      />,
    );

    await delay();
    stdin.write("\r"); // accept the prefilled instance (the fake api url)
    await delay();
    stdin.write("admin@example.com");
    await delay();
    stdin.write("\r"); // → password field
    await delay();
    stdin.write("hunter2pw");
    await delay();
    stdin.write("\r"); // submit → login + mint key + saveProfile
    await delay(120);

    expect(seen).toContain("POST /api/auth/local/login");
    expect(seen).toContain("POST /api/workflows/user/api-keys");

    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(cfg.profiles.default.apiKey).toBe("oa_minted_secret");
    expect(cfg.profiles.default.apiKey).not.toBe("jwt-should-not-persist");
    expect(cfg.profiles.default.instanceUrl).toBe(url);
    expect(authed).toBe(true);
  });
});
