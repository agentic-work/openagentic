import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { render } from "ink-testing-library";
import { OaClient } from "../../client.ts";
import { Chat } from "./Chat.tsx";

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

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("Chat screen", () => {
  it("creates a session on first send and accumulates streamed text", async () => {
    const seen: string[] = [];
    const url = await fakeApi((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === "/api/chat/sessions" && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ session: { id: "s1" } }));
      } else if (req.url === "/api/chat/stream" && req.method === "POST") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        // canonical Anthropic frames: thinking is omitted, only text_delta shows
        res.write('{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"…"}}\n');
        res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n');
        res.write('{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n');
        res.write('{"type":"done"}\n');
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    const { lastFrame, stdin } = render(<Chat client={client} onBack={() => {}} onError={() => {}} />);
    await delay();
    stdin.write("hi"); // type into the prompt
    await delay();
    stdin.write("\r"); // submit
    await delay(150);

    expect(seen).toContain("POST /api/chat/sessions");
    expect(seen).toContain("POST /api/chat/stream");
    expect(lastFrame()).toContain("Hello world");
  });
});
