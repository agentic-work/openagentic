import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { OaClient } from "./client.ts";

interface CapturedRequest {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: unknown;
}

type Responder = (
  req: IncomingMessage,
  body: unknown,
) => { status?: number; json?: unknown };

let server: Server | undefined;

async function fakeApi(responder: Responder): Promise<{
  url: string;
  requests: CapturedRequest[];
}> {
  const requests: CapturedRequest[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      const out = responder(req, body);
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(out.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, requests };
}

afterEach(() => {
  server?.close();
  server = undefined;
});

/** A full schedule object as the API returns it. */
function schedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "sc1",
    workflow_id: "w1",
    name: "daily",
    cron_expression: "0 9 * * *",
    timezone: "UTC",
    input_template: {},
    is_active: true,
    next_run_at: "2026-06-29T09:00:00Z",
    last_run_at: null,
    last_run_status: null,
    total_runs: 0,
    ...overrides,
  };
}

describe("OaClient — schedules", () => {
  it("createSchedule POSTs cron+name to the workflow schedules path with Bearer", async () => {
    const api = await fakeApi(() => ({ status: 201, json: { schedule: schedule() } }));
    const client = new OaClient({ instanceUrl: api.url, token: "oa_k" });

    const sc = await client.createSchedule("w1", { cron_expression: "0 9 * * *", name: "daily" });

    expect(api.requests[0].method).toBe("POST");
    expect(api.requests[0].url).toBe("/api/workflows/w1/schedules");
    expect(api.requests[0].body).toEqual({ cron_expression: "0 9 * * *", name: "daily" });
    expect(api.requests[0].headers.authorization).toBe("Bearer oa_k");
    expect(sc.id).toBe("sc1");
    expect(sc.next_run_at).toBe("2026-06-29T09:00:00Z");
  });

  it("listSchedules GETs the workflow schedules and returns the array", async () => {
    const api = await fakeApi(() => ({ json: { schedules: [schedule({ total_runs: 3 })] } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    const list = await client.listSchedules("w1");

    expect(api.requests[0].method).toBe("GET");
    expect(api.requests[0].url).toBe("/api/workflows/w1/schedules");
    expect(list).toHaveLength(1);
    expect(list[0].total_runs).toBe(3);
  });

  it("updateSchedule PATCHes the patch body to the schedule path", async () => {
    const api = await fakeApi(() => ({ json: { schedule: schedule({ is_active: false }) } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    const sc = await client.updateSchedule("w1", "sc1", { is_active: false });

    expect(api.requests[0].method).toBe("PATCH");
    expect(api.requests[0].url).toBe("/api/workflows/w1/schedules/sc1");
    expect(api.requests[0].body).toEqual({ is_active: false });
    expect(sc.is_active).toBe(false);
  });

  it("deleteSchedule DELETEs the schedule path", async () => {
    const api = await fakeApi(() => ({ json: { success: true } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    await client.deleteSchedule("w1", "sc1");

    expect(api.requests[0].method).toBe("DELETE");
    expect(api.requests[0].url).toBe("/api/workflows/w1/schedules/sc1");
  });

  it("listExecutions GETs the workflow executions, most recent first", async () => {
    const api = await fakeApi(() => ({
      json: { executions: [{ id: "e2", status: "completed" }, { id: "e1", status: "failed" }], total: 2 },
    }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    const ex = await client.listExecutions("w1");

    expect(api.requests[0].method).toBe("GET");
    expect(api.requests[0].url).toBe("/api/workflows/w1/executions");
    expect(ex[0].id).toBe("e2");
  });

  it("getExecution GETs the execution detail path", async () => {
    const api = await fakeApi(() => ({ json: { id: "e2", status: "completed", output: { sent: true } } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    const e = await client.getExecution("w1", "e2");

    expect(api.requests[0].method).toBe("GET");
    expect(api.requests[0].url).toBe("/api/workflows/w1/executions/e2");
    expect(e.status).toBe("completed");
  });

  it("url-encodes ids in schedule paths", async () => {
    const api = await fakeApi(() => ({ json: { success: true } }));
    const client = new OaClient({ instanceUrl: api.url, token: "t" });

    await client.deleteSchedule("w/1", "s 1");

    expect(api.requests[0].url).toBe("/api/workflows/w%2F1/schedules/s%201");
  });
});
