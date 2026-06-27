import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { OaClient } from "./client.ts";

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

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("OaClient.createSession", () => {
  it("POSTs a title and returns the session object", async () => {
    let seen: { method: string; url: string; body: unknown } | undefined;
    const url = await fakeApi((req, res) => {
      seen = req;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ session: { id: "s1", title: "CLI", createdAt: "x" } }));
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    const s = await client.createSession("CLI");

    expect(seen?.method).toBe("POST");
    expect(seen?.url).toBe("/api/chat/sessions");
    expect(seen?.body).toEqual({ title: "CLI" });
    expect(s.id).toBe("s1");
  });
});

describe("OaClient.chatStream", () => {
  it("parses SSE data frames and invokes onEvent per frame", async () => {
    const url = await fakeApi((req, res) => {
      expect(req.url).toBe("/api/chat/stream");
      expect(req.body).toMatchObject({ sessionId: "s1", message: "hi" });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"content","text":"Hel"}\n\n');
      res.write('data: {"type":"content","text":"lo"}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    const events: unknown[] = [];
    await client.chatStream({ sessionId: "s1", message: "hi" }, (e) => events.push(e));

    expect(events).toEqual([
      { type: "content", text: "Hel" },
      { type: "content", text: "lo" },
    ]);
  });

  it("parses bare NDJSON frames (no data: prefix, newline-separated — the real wire format)", async () => {
    const url = await fakeApi((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('{"type":"stream_start"}\n');
      res.write('{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n');
      res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"oa "}}\n');
      res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"works"}}\n');
      res.write('{"type":"done"}\n');
      res.end();
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });
    const events: Array<{ delta?: { type?: string; text?: string } }> = [];
    await client.chatStream({ sessionId: "s1", message: "hi" }, (e) => events.push(e as never));
    const text = events
      .filter((e) => e.delta?.type === "text_delta")
      .map((e) => e.delta?.text)
      .join("");
    expect(text).toBe("oa works");
  });

  it("throws ApiError on a non-2xx before streaming", async () => {
    const url = await fakeApi((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid API key" }));
    });
    const client = new OaClient({ instanceUrl: url, token: "bad" });
    await expect(
      client.chatStream({ sessionId: "s1", message: "hi" }, () => {}),
    ).rejects.toMatchObject({ name: "ApiError", status: 401 });
  });
});

describe("OaClient.detectUi", () => {
  it("returns true when GET / serves the SPA html shell", async () => {
    const url = await fakeApi((req, res) => {
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end('<!doctype html><html><body><div id="root"></div></body></html>');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    expect(await new OaClient({ instanceUrl: url }).detectUi()).toBe(true);
  });

  it("returns false when / is not an html SPA (headless api)", async () => {
    const url = await fakeApi((_req, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });
    expect(await new OaClient({ instanceUrl: url }).detectUi()).toBe(false);
  });
});
