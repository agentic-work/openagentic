import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProfile } from "./config.ts";
import { OaClient } from "./client.ts";
import { type CommandContext, cmdDo } from "./commands.ts";

let server: Server | undefined;
async function fakeApi(
  handler: (req: IncomingMessage, body: unknown, res: ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () =>
      handler(req, Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined, res),
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

function ctxFor(url: string | undefined, overrides: Partial<CommandContext> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oa-do-"));
  if (url) saveProfile(dir, "local", { instanceUrl: url, apiKey: "oa_k" }, true);
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CommandContext = {
    configDir: dir,
    json: false,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: (o) => new OaClient(o),
    ...overrides,
  };
  return { ctx, out, err };
}

/** A stream that emits text, with an optional approval gate that holds the rest
 * of the stream server-side until the approval POST lands (mirrors the server). */
function streamServer(opts: {
  withApproval?: { requestId: string; toolName: string };
  onApproval?: (info: { url: string; body: unknown }) => void;
}) {
  return async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    return fakeApi((req, body, res) => {
      if (req.url === "/api/chat/sessions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ session: { id: "s1" } }));
        return;
      }
      // Real gate-release endpoint: POST /api/approvals/:auditId/{approve,deny}
      // (verb in path, no body). The legacy /api/chat/approvals/:id does NOT
      // release auditAndGate, so the client must hit this one.
      if (req.url?.startsWith("/api/approvals/")) {
        opts.onApproval?.({ url: req.url, body });
        release?.();
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      // /api/chat/stream
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (opts.withApproval) {
        const a = opts.withApproval;
        res.write(
          `${JSON.stringify({
            type: "approval_required",
            requestId: a.requestId,
            auditId: a.requestId,
            toolName: a.toolName,
            serverName: "kubernetes",
            args: { namespace: "prod", name: "api" },
            preview: `${a.toolName} prod/api`,
            classification: "mutating",
            timeoutMs: 30000,
          })}\n`,
        );
        gate.then(() => {
          res.write(`${JSON.stringify({ type: "approval_resolved", requestId: a.requestId })}\n`);
          res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"all done"}}\n');
          res.end();
        });
      } else {
        res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n');
        res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n');
        res.end();
      }
    });
  };
}

describe("cmdDo — natural language → chat", () => {
  it("assembles the NL text into a chat turn and prints the assistant reply", async () => {
    const url = await streamServer({})();
    const { ctx, out } = ctxFor(url);
    await cmdDo(ctx, "what is the cluster status", {});
    expect(out.join("")).toContain("Hello there");
  });

  it("throws the `oa login` hint when no profile is configured", async () => {
    const { ctx } = ctxFor(undefined);
    await expect(cmdDo(ctx, "do a thing", {})).rejects.toThrow(/oa login/);
  });

  it("--yes auto-approves a gated tool call and the stream continues", async () => {
    let approval: { url: string; body: unknown } | undefined;
    const url = await streamServer({
      withApproval: { requestId: "req-9", toolName: "k8s_delete_pod" },
      onApproval: (info) => {
        approval = info;
      },
    })();
    const { ctx, out } = ctxFor(url);

    await cmdDo(ctx, "delete the stuck pod", { yes: true });

    const printed = out.join("\n");
    expect(approval?.url).toBe("/api/approvals/req-9/approve"); // verb-in-path, releases the gate
    expect(approval?.body).toBeUndefined(); // no body on the wire
    expect(printed).toContain("k8s_delete_pod"); // tool name surfaced
    expect(printed).toContain("k8s_delete_pod prod/api"); // preview surfaced
    expect(printed).toContain("all done"); // stream continued past the gate
  });

  it("interactive confirm → false denies the tool call and reports it", async () => {
    let approval: { url: string; body: unknown } | undefined;
    const asked: string[] = [];
    const url = await streamServer({
      withApproval: { requestId: "req-deny", toolName: "aws_terminate_instance" },
      onApproval: (info) => {
        approval = info;
      },
    })();
    const { ctx, out } = ctxFor(url, {
      confirm: async (q) => {
        asked.push(q);
        return false;
      },
    });

    await cmdDo(ctx, "kill the prod box", {});

    expect(asked.length).toBe(1);
    expect(asked[0]).toContain("aws_terminate_instance");
    expect(approval?.url).toBe("/api/approvals/req-deny/deny"); // POSTs the /deny verb
    expect(out.join("\n").toLowerCase()).toContain("denied");
  });

  it("--json emits {sessionId, text, approvals}; defaults to DENY under --json with no --yes", async () => {
    let approval: { url: string; body: unknown } | undefined;
    const url = await streamServer({
      withApproval: { requestId: "req-json", toolName: "gcp_delete_bucket" },
      onApproval: (info) => {
        approval = info;
      },
    })();
    // confirm present, but --json must fail safe (never prompt) → deny
    const { ctx, out } = ctxFor(url, { json: true, confirm: async () => true });

    await cmdDo(ctx, "nuke the bucket", {});

    expect(approval?.url).toBe("/api/approvals/req-json/deny"); // json + no --yes → fail-safe deny
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.text).toContain("all done");
    expect(parsed.approvals).toEqual([{ toolName: "gcp_delete_bucket", approved: false }]);
  });

  it("reuses an explicit sessionId without creating a new session", async () => {
    const urls: string[] = [];
    const url = await fakeApi((req, _b, res) => {
      urls.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n');
      res.end();
    });
    const { ctx } = ctxFor(url);
    await cmdDo(ctx, "status", { sessionId: "given" });
    expect(urls).not.toContain("/api/chat/sessions");
    expect(urls).toContain("/api/chat/stream");
  });
});
