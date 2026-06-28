import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { render } from "ink-testing-library";
import { OaClient } from "../../client.ts";
import { Home } from "./Home.tsx";

let server: Server | undefined;

async function fakeApi(
  handler: (req: { method: string; url: string }, res: import("node:http").ServerResponse) => void,
): Promise<string> {
  server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => handler({ method: req.method ?? "", url: req.url ?? "" }, res));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server!.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

const delay = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("Home screen", () => {
  it("renders identity + health when whoami succeeds", async () => {
    const url = await fakeApi((req, res) => {
      if (req.url === "/api/auth/validate-token") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ userId: "u1", email: "admin@x.io", isAdmin: true, groups: [], authMethod: "api-key" }));
      } else if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const client = new OaClient({ instanceUrl: url, token: "t" });
    const { lastFrame } = render(<Home client={client} onNavigate={() => {}} onQuit={() => {}} onError={() => {}} />);
    await delay();
    expect(lastFrame()).toContain("admin@x.io");
  });

  it("surfaces an auth failure instead of spinning forever and routes it to onError", async () => {
    let captured: unknown;
    const url = await fakeApi((req, res) => {
      if (req.url === "/api/auth/validate-token") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid API key" }));
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }
    });
    const client = new OaClient({ instanceUrl: url, token: "revoked" });
    const { lastFrame } = render(
      <Home client={client} onNavigate={() => {}} onQuit={() => {}} onError={(e) => (captured = e)} />,
    );
    await delay();
    const frame = lastFrame() ?? "";
    expect(frame.toLowerCase()).toContain("not authenticated");
    expect(captured).toBeInstanceOf(Error);
  });
});
