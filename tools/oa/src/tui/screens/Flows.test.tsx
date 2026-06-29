import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { render } from "ink-testing-library";
import { OaClient } from "../../client.ts";
import { Flows } from "./Flows.tsx";

let server: Server | undefined;

interface Seen {
  method: string;
  url: string;
}

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

describe("Flows screen", () => {
  it("lists flows and executes the highlighted one on Enter", async () => {
    const seen: Seen[] = [];
    const url = await fakeApi((req, res) => {
      seen.push({ method: req.method, url: req.url });
      if (req.url === "/api/workflows" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ workflows: [{ id: "w1", name: "Incident Triage" }, { id: "w2", name: "Cost Anomaly" }] }));
      } else if (req.url?.startsWith("/api/workflows/") && req.method === "POST") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ executionId: "exec-123", status: "running" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });

    const { lastFrame, stdin } = render(<Flows client={client} onBack={() => {}} onError={() => {}} />);
    await delay();
    expect(lastFrame()).toContain("Incident Triage");
    expect(lastFrame()).toContain("Cost Anomaly");

    stdin.write("\r"); // Enter on the highlighted (first) flow
    await delay();

    expect(seen.some((r) => r.method === "POST" && r.url === "/api/workflows/w1/execute?async=true")).toBe(true);
    expect(lastFrame()).toContain("exec-123");
  });
});
