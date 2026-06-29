import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProfile } from "./config.ts";
import { OaClient } from "./client.ts";
import {
  type CommandContext,
  cmdAgentList,
  cmdAgentRun,
  cmdChat,
  cmdFlowList,
  cmdFlowRun,
  cmdKeyCreate,
  cmdKeyList,
  cmdKeyRevoke,
} from "./commands.ts";

let server: Server | undefined;
async function fakeApi(
  handler: (req: { method: string; url: string; body: unknown }, res: import("node:http").ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () =>
      handler({ method: req.method ?? "", url: req.url ?? "", body: Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined }, res),
    );
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const a = server!.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}
afterEach(() => {
  server?.close();
  server = undefined;
});

function ctxFor(url: string, json = false) {
  const dir = mkdtempSync(join(tmpdir(), "oa-ops-"));
  saveProfile(dir, "local", { instanceUrl: url, apiKey: "oa_k" }, true);
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CommandContext = {
    configDir: dir,
    json,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: (o) => new OaClient(o),
  };
  return { ctx, out, err };
}

describe("key commands", () => {
  it("cmdKeyCreate prints the one-time plaintext key", async () => {
    const url = await fakeApi((_r, res) => {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ key: { id: "k1", name: "ci", plaintext_key: "oa_NEW", created_at: "x" } }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdKeyCreate(ctx, "ci");
    expect(out.join("\n")).toContain("oa_NEW");
  });

  it("cmdKeyList prints each key name", async () => {
    const url = await fakeApi((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [{ id: "k1", name: "laptop", created_at: "x", last_used_at: null, expires_at: null }] }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdKeyList(ctx);
    expect(out.join("\n")).toContain("laptop");
  });

  it("cmdKeyRevoke DELETEs the key id", async () => {
    let seen = "";
    const url = await fakeApi((r, res) => {
      seen = `${r.method} ${r.url}`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });
    const { ctx } = ctxFor(url);
    await cmdKeyRevoke(ctx, "k1");
    expect(seen).toBe("DELETE /api/workflows/user/api-keys/k1");
  });
});

describe("flow commands", () => {
  it("cmdFlowList prints workflow names", async () => {
    const url = await fakeApi((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ workflows: [{ id: "w1", name: "incident-triage" }], total: 1 }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdFlowList(ctx);
    expect(out.join("\n")).toContain("incident-triage");
  });

  it("cmdFlowRun posts input and prints the execution id", async () => {
    let body: unknown;
    const url = await fakeApi((r, res) => {
      body = r.body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ executionId: "e9", status: "running" }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdFlowRun(ctx, "w1", { region: "us" });
    expect(body).toMatchObject({ input: { region: "us" } });
    expect(out.join("\n")).toContain("e9");
  });
});

describe("agent commands", () => {
  it("cmdAgentList prints agent names", async () => {
    const url = await fakeApi((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ agents: [{ id: "a1", name: "reasoning" }] }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdAgentList(ctx);
    expect(out.join("\n")).toContain("reasoning");
  });

  it("cmdAgentRun posts the task and prints the execution id", async () => {
    let body: unknown;
    const url = await fakeApi((r, res) => {
      body = r.body;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ executionId: "ex1" }));
    });
    const { ctx, out } = ctxFor(url);
    await cmdAgentRun(ctx, "a1", "summarize logs");
    expect(body).toMatchObject({ task: "summarize logs" });
    expect(out.join("\n")).toContain("ex1");
  });
});

describe("chat command", () => {
  it("creates a session, streams the reply, and prints the assistant text", async () => {
    const url = await fakeApi((r, res) => {
      if (r.url === "/api/chat/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ session: { id: "s1" } }));
        return;
      }
      // /api/chat/stream
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"content","text":"Hello "}\n\n');
      res.write('data: {"type":"content","text":"world"}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const { ctx, out } = ctxFor(url);
    await cmdChat(ctx, "hi", {});
    expect(out.join("")).toContain("Hello world");
  });

  it("renders text from canonical content_block_delta(text_delta) frames and omits thinking", async () => {
    const url = await fakeApi((r, res) => {
      if (r.url === "/api/chat/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ session: { id: "s1" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"stream_start"}\n\n');
      res.write('data: {"type":"ping"}\n\n');
      res.write('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"reasoning here"}}\n\n');
      res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n');
      res.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const { ctx, out } = ctxFor(url);
    await cmdChat(ctx, "hi", {});
    const printed = out.join("");
    expect(printed).toContain("Hi there");
    expect(printed).not.toContain("reasoning here");
  });

  it("streams tokens through ctx.write (no per-token newlines) when a raw writer is present", async () => {
    const url = await fakeApi((r, res) => {
      if (r.url === "/api/chat/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ session: { id: "s1" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n');
      res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n');
      res.write('{"type":"done"}\n');
      res.end();
    });
    const { ctx } = ctxFor(url);
    const written: string[] = [];
    ctx.write = (s) => written.push(s);
    await cmdChat(ctx, "hi", {});
    expect(written.join("")).toBe("Hi there"); // streamed token-by-token, joined seamlessly
  });

  it("reuses an explicit sessionId when provided", async () => {
    const urls: string[] = [];
    const url = await fakeApi((r, res) => {
      urls.push(r.url);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"text":"ok"}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const { ctx } = ctxFor(url);
    await cmdChat(ctx, "hi", { sessionId: "given" });
    expect(urls).not.toContain("/api/chat/sessions");
    expect(urls).toContain("/api/chat/stream");
  });
});
