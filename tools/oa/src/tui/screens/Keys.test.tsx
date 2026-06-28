import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { render } from "ink-testing-library";
import { OaClient } from "../../client.ts";
import { Keys } from "./Keys.tsx";

let server: Server | undefined;

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
const DOWN = "\u001B[B"; // ANSI down-arrow escape

function keysHandler(seen: string[]) {
  return (req: { method: string; url: string; body: unknown }, res: import("node:http").ServerResponse) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.url === "/api/workflows/user/api-keys" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ id: "k1", name: "ci-bot", created_at: "x", last_used_at: null, expires_at: null }] }));
    } else if (req.url === "/api/workflows/user/api-keys" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ key: { id: "k2", name: "new-key", plaintext_key: "oa_minted_secret", created_at: "x" } }));
    } else if (req.url?.startsWith("/api/workflows/user/api-keys/") && req.method === "DELETE") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  };
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("Keys screen", () => {
  it("lists existing keys", async () => {
    const url = await fakeApi(keysHandler([]));
    const client = new OaClient({ instanceUrl: url, token: "t" });
    const { lastFrame } = render(<Keys client={client} onBack={() => {}} onError={() => {}} />);
    await delay();
    expect(lastFrame()).toContain("ci-bot");
  });

  it("creates a key and shows the plaintext once", async () => {
    const seen: string[] = [];
    const url = await fakeApi(keysHandler(seen));
    const client = new OaClient({ instanceUrl: url, token: "t" });
    const { lastFrame, stdin } = render(<Keys client={client} onBack={() => {}} onError={() => {}} />);
    await delay();
    stdin.write("\r"); // first menu item = "Create new key"
    await delay();
    stdin.write("release-key"); // type the name
    await delay();
    stdin.write("\r"); // submit → POST
    await delay();
    expect(seen).toContain("POST /api/workflows/user/api-keys");
    expect(lastFrame()).toContain("oa_minted_secret");
  });

  it("revokes a key after confirmation (DELETE seen)", async () => {
    const seen: string[] = [];
    const url = await fakeApi(keysHandler(seen));
    const client = new OaClient({ instanceUrl: url, token: "t" });
    const { stdin } = render(<Keys client={client} onBack={() => {}} onError={() => {}} />);
    await delay();
    stdin.write(DOWN); // move past "Create new key" to the first key's revoke row
    await delay();
    stdin.write("\r"); // select → confirm prompt
    await delay();
    stdin.write("y"); // confirm
    await delay();
    expect(seen.some((r) => r === "DELETE /api/workflows/user/api-keys/k1")).toBe(true);
  });
});
