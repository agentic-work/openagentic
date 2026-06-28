import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { OaClient } from "./client.ts";

let server: Server | undefined;

async function fakeApi(
  handler: (req: IncomingMessage, body: unknown, res: ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      handler(req, raw ? JSON.parse(raw) : undefined, res);
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

describe("OaClient.approveChatToolCall", () => {
  // The authoritative chat mutating gate is auditAndGate.ts (waitFor(auditId)),
  // released ONLY by POST /api/approvals/:auditId/{approve,deny} (verb in PATH,
  // NO body) — NOT the legacy POST /api/chat/approvals/:id {approved} endpoint,
  // which resolves the other (PendingApprovalStore/PermissionService) mechanisms.
  it("POSTs /api/approvals/:id/approve with Bearer auth and no body", async () => {
    let seen: { method?: string; url?: string; auth?: string; body: unknown } | undefined;
    const url = await fakeApi((req, body, res) => {
      seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const client = new OaClient({ instanceUrl: url, token: "oa_secret" });

    await client.approveChatToolCall("req-123", true);

    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("/api/approvals/req-123/approve");
    expect(seen?.auth).toBe("Bearer oa_secret");
    expect(seen?.body).toBeUndefined();
  });

  it("url-encodes the id and routes a deny decision to /deny with no body", async () => {
    let seen: { url?: string; body: unknown } | undefined;
    const url = await fakeApi((req, body, res) => {
      seen = { url: req.url, body };
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    await client.approveChatToolCall("a/b#c", false);

    expect(seen?.url).toBe(`/api/approvals/${encodeURIComponent("a/b#c")}/deny`);
    expect(seen?.body).toBeUndefined();
  });
});

describe("OaClient.chatStream awaits an async onEvent", () => {
  it("pauses the read loop until an async onEvent resolves (approval POST completes before the next frame)", async () => {
    let releaseStream: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      releaseStream = r;
    });
    let approvalUrl: string | undefined;

    const url = await fakeApi((req, _body, res) => {
      if (req.url?.startsWith("/api/approvals/")) {
        approvalUrl = req.url;
        releaseStream?.(); // unblock the still-open stream only once the POST lands
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      // /api/chat/stream — emit the approval gate, then hold the rest until the POST arrives
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('{"type":"approval_required","requestId":"r1","toolName":"k8s_delete"}\n');
      gate.then(() => {
        res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"done"}}\n');
        res.end();
      });
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    const order: string[] = [];
    await client.chatStream({ sessionId: "s1", message: "hi" }, async (event) => {
      const e = event as { type?: string; requestId?: string };
      if (e.type === "approval_required") {
        await client.approveChatToolCall(e.requestId!, true);
        order.push("approved");
      } else if (e.type === "content_block_delta") {
        order.push("next-frame");
      }
    });

    // If chatStream did not await onEvent, "next-frame" could never arrive at all
    // (the server is gated on the approval POST) — and the order proves the pause.
    expect(approvalUrl).toBe("/api/approvals/r1/approve");
    expect(order).toEqual(["approved", "next-frame"]);
  });
});
