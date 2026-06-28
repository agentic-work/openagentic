import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProfile } from "./config.ts";
import { OaClient } from "./client.ts";
import {
  type CommandContext,
  cmdScheduledAgentCreate,
  cmdScheduledAgentDelete,
  cmdScheduledAgentList,
  cmdScheduledAgentLogs,
  cmdScheduledAgentStart,
  cmdScheduledAgentStatus,
  cmdScheduledAgentStop,
} from "./commands.ts";

interface Captured {
  method: string;
  url: string;
  body: unknown;
}

let server: Server | undefined;

async function fakeApi(
  handler: (req: Captured, res: ServerResponse) => void,
): Promise<{ url: string; reqs: Captured[] }> {
  const reqs: Captured[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      const cap = { method: req.method ?? "", url: req.url ?? "", body: raw ? JSON.parse(raw) : undefined };
      reqs.push(cap);
      handler(cap, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const a = server!.address();
  return { url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, reqs };
}

afterEach(() => {
  server?.close();
  server = undefined;
});

function sendJson(res: ServerResponse, json: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(json));
}

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

function ctxFor(url: string | undefined, overrides: Partial<CommandContext> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oa-sched-"));
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

describe("agent create — schedule a flow", () => {
  it("requires confirmation: no schedule is created without -y / a confirm", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule() }, 201));
    const { ctx, out } = ctxFor(url); // no confirm, not yes, not json

    await cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "0 9 * * *" }, {});

    expect(reqs.find((r) => r.url === "/api/workflows/w1/schedules")).toBeUndefined();
    expect(out.join("\n").toLowerCase()).toContain("abort");
  });

  it("-y creates the schedule and prints next_run_at", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule({ name: "daily" }) }, 201));
    const { ctx, out } = ctxFor(url);

    await cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "0 9 * * *", name: "daily" }, { yes: true });

    const post = reqs.find((r) => r.method === "POST" && r.url === "/api/workflows/w1/schedules");
    expect(post?.body).toMatchObject({ cron_expression: "0 9 * * *", name: "daily" });
    expect(out.join("\n")).toContain("2026-06-29T09:00:00Z");
  });

  it("--json proceeds without prompting and emits the schedule shape", async () => {
    const { url } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule() }, 201));
    const { ctx, out } = ctxFor(url, { json: true });

    await cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "0 9 * * *" }, {});

    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.id).toBe("sc1");
    expect(parsed.next_run_at).toBe("2026-06-29T09:00:00Z");
  });

  it("validates that a flow id and a cron are provided", async () => {
    const { ctx } = ctxFor("http://unused");
    await expect(
      cmdScheduledAgentCreate(ctx, { flowId: "", cron: "0 9 * * *" }, { yes: true }),
    ).rejects.toThrow(/flow/i);
    await expect(
      cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "" }, { yes: true }),
    ).rejects.toThrow(/schedule|cron/i);
  });

  it("--report-to prints the honest SMTP advisory and still creates", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule() }, 201));
    const { ctx, err } = ctxFor(url);

    await cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "0 9 * * *", reportTo: "ops@x.com" }, { yes: true });

    const advisory = err.join("\n");
    expect(advisory).toContain("send_email");
    expect(advisory).toContain("SMTP");
    expect(advisory).toContain("oa agent logs");
    expect(reqs.some((r) => r.method === "POST" && r.url === "/api/workflows/w1/schedules")).toBe(true);
  });

  it("throws the `oa login` hint when no profile is configured", async () => {
    const { ctx } = ctxFor(undefined);
    await expect(cmdScheduledAgentCreate(ctx, { flowId: "w1", cron: "0 9 * * *" }, { yes: true })).rejects.toThrow(
      /oa login/,
    );
  });
});

describe("agent stop / start — toggle is_active", () => {
  it("stop PATCHes is_active:false", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule({ is_active: false }) }));
    const { ctx } = ctxFor(url);

    await cmdScheduledAgentStop(ctx, "w1", "sc1");

    const patch = reqs.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("/api/workflows/w1/schedules/sc1");
    expect(patch?.body).toEqual({ is_active: false });
  });

  it("start PATCHes is_active:true", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { schedule: schedule({ is_active: true }) }));
    const { ctx } = ctxFor(url);

    await cmdScheduledAgentStart(ctx, "w1", "sc1");

    const patch = reqs.find((r) => r.method === "PATCH");
    expect(patch?.body).toEqual({ is_active: true });
  });
});

describe("agent list — flows joined with schedules", () => {
  it("lists only flows that have at least one schedule", async () => {
    const { url } = await fakeApi((r, res) => {
      if (r.url === "/api/workflows") {
        sendJson(res, { workflows: [{ id: "w1", name: "triage" }, { id: "w2", name: "idle" }], total: 2 });
        return;
      }
      if (r.url === "/api/workflows/w1/schedules") {
        sendJson(res, { schedules: [schedule({ last_run_status: "success", total_runs: 5 })] });
        return;
      }
      if (r.url === "/api/workflows/w2/schedules") {
        sendJson(res, { schedules: [] });
        return;
      }
      sendJson(res, {});
    });
    const { ctx, out } = ctxFor(url);

    await cmdScheduledAgentList(ctx);

    const printed = out.join("\n");
    expect(printed).toContain("triage");
    expect(printed).toContain("sc1");
    expect(printed).toContain("0 9 * * *");
    expect(printed).not.toContain("idle"); // w2 has no schedule → excluded
  });
});

describe("agent status / logs", () => {
  it("status shows the schedule plus recent runs", async () => {
    const { url } = await fakeApi((r, res) => {
      if (r.url === "/api/workflows/w1/schedules") {
        sendJson(res, { schedules: [schedule({ last_run_status: "success", total_runs: 2 })] });
        return;
      }
      if (r.url?.startsWith("/api/workflows/w1/executions")) {
        sendJson(res, { executions: [{ id: "e2", status: "completed", started_at: "t2" }], total: 1 });
        return;
      }
      sendJson(res, {});
    });
    const { ctx, out } = ctxFor(url);

    await cmdScheduledAgentStatus(ctx, "w1");

    const printed = out.join("\n");
    expect(printed).toContain("sc1");
    expect(printed).toContain("success");
    expect(printed).toContain("e2");
  });

  it("logs fetches and prints the most recent execution's output", async () => {
    const { url, reqs } = await fakeApi((r, res) => {
      if (r.url === "/api/workflows/w1/executions/e2") {
        sendJson(res, { id: "e2", status: "completed", output: { report: "emailed ops@x" } });
        return;
      }
      if (r.url?.startsWith("/api/workflows/w1/executions")) {
        sendJson(res, { executions: [{ id: "e2", status: "completed" }, { id: "e1", status: "failed" }], total: 2 });
        return;
      }
      sendJson(res, {});
    });
    const { ctx, out } = ctxFor(url);

    await cmdScheduledAgentLogs(ctx, "w1");

    expect(reqs.some((r) => r.url === "/api/workflows/w1/executions/e2")).toBe(true);
    expect(out.join("\n")).toContain("emailed ops@x");
  });

  it("logs reports no runs yet when there are none", async () => {
    const { url } = await fakeApi((_r, res) => sendJson(res, { executions: [], total: 0 }));
    const { ctx, out } = ctxFor(url);

    await cmdScheduledAgentLogs(ctx, "w1");

    expect(out.join("\n").toLowerCase()).toContain("no runs");
  });
});

describe("agent delete", () => {
  it("deletes the schedule with -y", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { success: true }));
    const { ctx } = ctxFor(url);

    await cmdScheduledAgentDelete(ctx, "w1", "sc1", { yes: true });

    expect(reqs.some((r) => r.method === "DELETE" && r.url === "/api/workflows/w1/schedules/sc1")).toBe(true);
  });

  it("aborts (no DELETE) without -y or a confirm", async () => {
    const { url, reqs } = await fakeApi((_r, res) => sendJson(res, { success: true }));
    const { ctx } = ctxFor(url);

    await cmdScheduledAgentDelete(ctx, "w1", "sc1", {});

    expect(reqs.some((r) => r.method === "DELETE")).toBe(false);
  });
});

describe("auth", () => {
  it("agent list throws the `oa login` hint with no profile", async () => {
    const { ctx } = ctxFor(undefined);
    await expect(cmdScheduledAgentList(ctx)).rejects.toThrow(/oa login/);
  });
});
