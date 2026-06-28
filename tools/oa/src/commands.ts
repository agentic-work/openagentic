import { eventText } from "./chat-text.ts";
import { type ClientOptions, type Execution, OaClient } from "./client.ts";
import { getProfile, loadConfig, removeProfile, saveProfile } from "./config.ts";

/** Shared context every command receives — config location, output sinks,
 * and an injectable client factory (so commands are testable without network). */
export interface CommandContext {
  configDir: string;
  profileName?: string;
  /** --instance override; used when no profile is stored yet. */
  instanceOverride?: string;
  json: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Optional raw writer (no trailing newline) for live token streaming. */
  write?: (chunk: string) => void;
  /** Interactive yes/no prompt for client-side HITL approvals. Absent (e.g.
   * under --json or a non-TTY) means "cannot ask" → cmdDo fails safe and denies. */
  confirm?: (question: string) => Promise<boolean>;
  makeClient: (opts: ClientOptions) => OaClient;
}

/** Build a client for an authed command from the stored profile (or --instance). */
export function resolveClient(ctx: CommandContext): OaClient {
  const profile = getProfile(ctx.configDir, ctx.profileName);
  if (ctx.instanceOverride) {
    return ctx.makeClient({
      instanceUrl: ctx.instanceOverride,
      token: profile?.apiKey,
    });
  }
  if (!profile) {
    throw new Error(
      "No profile configured. Run `oa login` first (or pass --instance).",
    );
  }
  return ctx.makeClient({
    instanceUrl: profile.instanceUrl,
    token: profile.apiKey,
  });
}

export interface LoginInput {
  instanceUrl: string;
  username: string;
  password: string;
  profileName?: string;
  keyName?: string;
}

/** Authenticate, mint a user-bound revocable api key, persist it as a profile.
 * We store the api key — never the short-lived JWT — so the CLI uses the
 * api-issued, revocable credential for every subsequent call. */
export async function cmdLogin(
  ctx: CommandContext,
  input: LoginInput,
): Promise<void> {
  const loginClient = ctx.makeClient({ instanceUrl: input.instanceUrl });
  const { token, user } = await loginClient.login(input.username, input.password);

  const authed = ctx.makeClient({ instanceUrl: input.instanceUrl, token });
  const key = await authed.createApiKey(input.keyName ?? "oa-cli");

  const name = input.profileName ?? "default";
  saveProfile(
    ctx.configDir,
    name,
    { instanceUrl: input.instanceUrl, apiKey: key.plaintext_key },
    true,
  );

  if (ctx.json) {
    ctx.out(JSON.stringify({ profile: name, user: user.email }));
  } else {
    ctx.out(`Logged in as ${user.email}; profile '${name}' saved.`);
  }
}

export async function cmdLogout(ctx: CommandContext): Promise<void> {
  const name = ctx.profileName ?? loadConfig(ctx.configDir).defaultProfile;
  if (!name) {
    ctx.out("No profile to log out of.");
    return;
  }
  removeProfile(ctx.configDir, name);
  ctx.out(`Logged out of profile '${name}'.`);
}

export async function cmdHealth(ctx: CommandContext): Promise<void> {
  const health = await resolveClient(ctx).health();
  if (ctx.json) {
    ctx.out(JSON.stringify(health, null, 2));
  } else {
    ctx.out(`status: ${health.status}${health.version ? ` (v${health.version})` : ""}`);
  }
}

export async function cmdWhoami(ctx: CommandContext): Promise<void> {
  const who = await resolveClient(ctx).whoami();
  if (ctx.json) {
    ctx.out(JSON.stringify(who, null, 2));
  } else {
    ctx.out(`${who.email} (${who.isAdmin ? "admin" : "user"}) via ${who.authMethod}`);
  }
}

// ---- api keys ---------------------------------------------------------------

export async function cmdKeyList(ctx: CommandContext): Promise<void> {
  const keys = await resolveClient(ctx).listApiKeys();
  if (ctx.json) {
    ctx.out(JSON.stringify(keys, null, 2));
    return;
  }
  if (keys.length === 0) {
    ctx.out("No api keys.");
    return;
  }
  for (const k of keys) {
    ctx.out(`${k.id}  ${k.name}  created=${k.created_at}  last_used=${k.last_used_at ?? "never"}`);
  }
}

export async function cmdKeyCreate(ctx: CommandContext, name: string): Promise<void> {
  const key = await resolveClient(ctx).createApiKey(name);
  if (ctx.json) {
    ctx.out(JSON.stringify(key, null, 2));
    return;
  }
  ctx.out(key.plaintext_key);
  ctx.err("Save this key now — it will not be shown again.");
}

export async function cmdKeyRevoke(ctx: CommandContext, id: string): Promise<void> {
  await resolveClient(ctx).revokeApiKey(id);
  ctx.out(ctx.json ? JSON.stringify({ revoked: id }) : `Revoked api key ${id}.`);
}

// ---- flows / workflows ------------------------------------------------------

export async function cmdFlowList(ctx: CommandContext): Promise<void> {
  const flows = await resolveClient(ctx).listWorkflows();
  if (ctx.json) {
    ctx.out(JSON.stringify(flows, null, 2));
    return;
  }
  if (flows.length === 0) {
    ctx.out("No flows.");
    return;
  }
  for (const f of flows) ctx.out(`${f.id}  ${f.name}`);
}

export async function cmdFlowRun(
  ctx: CommandContext,
  id: string,
  input?: Record<string, unknown>,
): Promise<void> {
  const res = await resolveClient(ctx).executeWorkflow(id, input);
  if (ctx.json) {
    ctx.out(JSON.stringify(res, null, 2));
    return;
  }
  ctx.out(`execution ${res.executionId ?? "?"}${res.status ? ` (${res.status})` : ""}`);
}

// ---- agents -----------------------------------------------------------------

export async function cmdAgentList(ctx: CommandContext): Promise<void> {
  const agents = await resolveClient(ctx).listAgents();
  if (ctx.json) {
    ctx.out(JSON.stringify(agents, null, 2));
    return;
  }
  if (agents.length === 0) {
    ctx.out("No agents.");
    return;
  }
  for (const a of agents) ctx.out(`${a.id}  ${a.name}`);
}

export async function cmdAgentRun(
  ctx: CommandContext,
  id: string,
  task: string,
): Promise<void> {
  const res = await resolveClient(ctx).executeAgent(id, task);
  ctx.out(ctx.json ? JSON.stringify(res, null, 2) : `execution ${res.executionId}`);
}

// ---- chat -------------------------------------------------------------------

export async function cmdChat(
  ctx: CommandContext,
  message: string,
  opts: { sessionId?: string } = {},
): Promise<void> {
  const client = resolveClient(ctx);
  const sessionId = opts.sessionId ?? (await client.createSession()).id;
  const live = !ctx.json && typeof ctx.write === "function";
  let full = "";
  await client.chatStream({ sessionId, message }, (event) => {
    const t = eventText(event);
    if (!t) return;
    full += t;
    if (live) ctx.write!(t); // stream tokens live, no per-token newline
  });
  if (ctx.json) {
    ctx.out(JSON.stringify({ sessionId, text: full }));
  } else if (live) {
    ctx.out(""); // terminating newline after the streamed tokens
  } else {
    ctx.out(full); // no raw writer (e.g. tests) — print the whole reply at once
  }
}

// ---- do (natural language) --------------------------------------------------

/** A pending mutating-tool approval the server is blocked on (requestId === auditId). */
interface ApprovalRequest {
  requestId: string;
  toolName: string;
  serverName?: string;
  args?: unknown;
  preview?: string;
  classification?: string;
}

function asApprovalRequest(event: unknown): ApprovalRequest | undefined {
  if (!event || typeof event !== "object") return undefined;
  const e = event as Record<string, unknown>;
  if (e.type !== "approval_required") return undefined;
  // requestId === auditId on the wire; tolerate either being the carrier.
  const id = e.requestId ?? e.auditId;
  if (typeof id !== "string" || !id) return undefined;
  return {
    requestId: id,
    toolName: typeof e.toolName === "string" ? e.toolName : "(unknown tool)",
    serverName: typeof e.serverName === "string" ? e.serverName : undefined,
    args: e.args,
    preview: typeof e.preview === "string" ? e.preview : undefined,
    classification: typeof e.classification === "string" ? e.classification : undefined,
  };
}

/** Route natural language through the chat pipeline, handling mutating-tool
 * approvals client-side. The server BLOCKS on each approval_required frame until
 * we POST a decision (or it times out and fails safe = deny); because chatStream
 * awaits onEvent, prompting here pauses the stream cleanly. */
export async function cmdDo(
  ctx: CommandContext,
  text: string,
  opts: { yes?: boolean; sessionId?: string } = {},
): Promise<void> {
  const client = resolveClient(ctx);
  const sessionId = opts.sessionId ?? (await client.createSession()).id;
  const live = !ctx.json && typeof ctx.write === "function";
  const approvals: Array<{ toolName: string; approved: boolean }> = [];
  let full = "";

  await client.chatStream({ sessionId, message: text }, async (event) => {
    const approval = asApprovalRequest(event);
    if (approval) {
      if (!ctx.json) {
        ctx.out(`\nApproval required: ${approval.toolName}${approval.serverName ? ` (${approval.serverName})` : ""}`);
        if (approval.preview) ctx.out(`  ${approval.preview}`);
        if (approval.args !== undefined) ctx.out(`  args: ${JSON.stringify(approval.args)}`);
      }

      // Decide. --yes approves; otherwise prompt; but never prompt under --json
      // or when no prompter is wired (non-TTY) — fail safe = deny.
      let approved: boolean;
      if (opts.yes) {
        approved = true;
      } else if (ctx.json || !ctx.confirm) {
        approved = false;
      } else {
        approved = await ctx.confirm(`Approve tool ${approval.toolName}?`);
      }

      await client.approveChatToolCall(approval.requestId, approved);
      approvals.push({ toolName: approval.toolName, approved });
      if (!ctx.json) {
        ctx.out(approved ? `Approved: ${approval.toolName}` : `Denied: ${approval.toolName}`);
      }
      return;
    }

    // approval_resolved is the server's acknowledgement; nothing more to do
    // (we already surfaced the local decision above), so just continue.
    const t = eventText(event);
    if (!t) return;
    full += t;
    if (live) ctx.write!(t);
  });

  if (ctx.json) {
    ctx.out(JSON.stringify({ sessionId, text: full, approvals }));
  } else if (live) {
    ctx.out(""); // terminating newline after the streamed tokens
  } else if (full) {
    ctx.out(full); // no raw writer (e.g. tests) — print the whole reply at once
  }
}

// ---- autonomous agents (flow + schedule) ------------------------------------
//
// An "autonomous agent" (#122) is an existing flow plus a cron schedule that
// runs it unattended. These commands are a thin façade over the schedule CRUD
// API + the existing workflow/execution endpoints — no new runtime. Report-out
// is the flow's own terminal node (send_email/slack), surfaced via `agent logs`.
//
// They live in the `oa agent` group alongside the existing platform-agent
// `list`/`run` commands. `list` already belongs to platform agents, so the
// scheduled-agent listing is exposed as `oa agent schedules` to avoid colliding.

export interface AgentCreateInput {
  /** The flow / workflow id to schedule. */
  flowId: string;
  /** Cron expression, e.g. "0 9 * * *". */
  cron: string;
  name?: string;
  timezone?: string;
  /** Advisory only — see the SMTP note printed at create time. */
  reportTo?: string;
}

/** Decide whether a confirm-gated action should proceed. Explicit intent
 * (`-y` or `--json`) proceeds; an interactive TTY prompts; otherwise (no way to
 * ask) it does not proceed. */
async function shouldProceed(
  ctx: CommandContext,
  yes: boolean | undefined,
  question: string,
): Promise<boolean> {
  if (yes) return true;
  if (ctx.json) return true; // machine-driven, explicit intent
  if (ctx.confirm) return ctx.confirm(question);
  return false;
}

/** Turn a flow into a scheduled, unattended agent. */
export async function cmdScheduledAgentCreate(
  ctx: CommandContext,
  input: AgentCreateInput,
  opts: { yes?: boolean } = {},
): Promise<void> {
  if (!input.flowId) throw new Error("A flow id is required (--flow <workflowId>).");
  if (!input.cron) throw new Error('A schedule is required (--schedule "<cron>").');

  const client = resolveClient(ctx);

  // Honest report-out note: we cannot verify a send_email node or SMTP from here.
  if (input.reportTo && !ctx.json) {
    ctx.err(
      `Note: --report-to is advisory. Email report-out requires the flow to contain a ` +
        `send_email node and server SMTP config; oa cannot verify either from here. ` +
        `Use \`oa agent logs ${input.flowId}\` to see each run's output regardless.`,
    );
  }

  // Print the resolved plan before asking for confirmation.
  if (!ctx.json) {
    ctx.out(`Plan: schedule flow ${input.flowId}`);
    ctx.out(`  cron: ${input.cron}${input.timezone ? `   timezone: ${input.timezone}` : ""}`);
    if (input.name) ctx.out(`  name: ${input.name}`);
  }

  const proceed = await shouldProceed(ctx, opts.yes, `Create scheduled agent for flow ${input.flowId}?`);
  if (!proceed) {
    ctx.out(ctx.json ? JSON.stringify({ created: false }) : "Aborted; no schedule created.");
    return;
  }

  const schedule = await client.createSchedule(input.flowId, {
    cron_expression: input.cron,
    name: input.name,
    timezone: input.timezone,
  });

  if (ctx.json) {
    ctx.out(JSON.stringify(schedule, null, 2));
    return;
  }
  ctx.out(`Created schedule ${schedule.id} for flow ${schedule.workflow_id}.`);
  ctx.out(`  next run: ${schedule.next_run_at ?? "(pending)"}`);
  ctx.out(`  active: ${schedule.is_active}`);
}

/** List autonomous agents: flows that have ≥1 schedule, joined with their schedules. */
export async function cmdScheduledAgentList(ctx: CommandContext): Promise<void> {
  const client = resolveClient(ctx);
  const flows = await client.listWorkflows();
  const rows: Array<{ id: string; name: string; schedules: Awaited<ReturnType<typeof client.listSchedules>> }> = [];
  for (const f of flows) {
    const schedules = await client.listSchedules(f.id);
    if (schedules.length > 0) rows.push({ id: f.id, name: f.name, schedules });
  }

  if (ctx.json) {
    ctx.out(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    ctx.out('No scheduled agents. Create one with `oa agent create --flow <id> --schedule "<cron>"`.');
    return;
  }
  for (const { id, name, schedules } of rows) {
    ctx.out(`${id}  ${name}`);
    for (const s of schedules) {
      ctx.out(
        `  ${s.id}  ${s.cron_expression}  active=${s.is_active}  ` +
          `next=${s.next_run_at ?? "-"}  last=${s.last_run_status ?? "-"}`,
      );
    }
  }
}

/** Show a flow's schedule(s) + recent runs. */
export async function cmdScheduledAgentStatus(ctx: CommandContext, workflowId: string): Promise<void> {
  const client = resolveClient(ctx);
  const schedules = await client.listSchedules(workflowId);
  let executions: Execution[] = [];
  try {
    executions = await client.listExecutions(workflowId);
  } catch {
    /* execution history is best-effort */
  }

  if (ctx.json) {
    ctx.out(JSON.stringify({ workflowId, schedules, recentExecutions: executions.slice(0, 5) }, null, 2));
    return;
  }
  if (schedules.length === 0) {
    ctx.out(`No schedules for flow ${workflowId}.`);
  }
  for (const s of schedules) {
    ctx.out(
      `${s.id}  ${s.cron_expression}  active=${s.is_active}  ` +
        `next=${s.next_run_at ?? "-"}  last=${s.last_run_status ?? "-"}  runs=${s.total_runs}`,
    );
  }
  if (executions.length > 0) {
    ctx.out("recent runs:");
    for (const e of executions.slice(0, 5)) {
      ctx.out(`  ${e.id}  ${e.status ?? "-"}${e.started_at ? `  ${e.started_at}` : ""}`);
    }
  }
}

/** Show the most recent run's output — the flow's report payload. */
export async function cmdScheduledAgentLogs(ctx: CommandContext, workflowId: string): Promise<void> {
  const client = resolveClient(ctx);
  const executions = await client.listExecutions(workflowId);
  if (executions.length === 0) {
    ctx.out(ctx.json ? JSON.stringify({ workflowId, execution: null }) : `No runs yet for flow ${workflowId}.`);
    return;
  }
  const latest = await client.getExecution(workflowId, executions[0].id);

  if (ctx.json) {
    ctx.out(JSON.stringify(latest, null, 2));
    return;
  }
  ctx.out(`execution ${latest.id}${latest.status ? ` (${latest.status})` : ""}`);
  const payload = latest.output ?? latest.result ?? latest.node_outputs ?? latest;
  ctx.out(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
}

/** Pause/resume a schedule by toggling is_active. */
async function setScheduleActive(
  ctx: CommandContext,
  workflowId: string,
  scheduleId: string,
  active: boolean,
): Promise<void> {
  const schedule = await resolveClient(ctx).updateSchedule(workflowId, scheduleId, { is_active: active });
  if (ctx.json) {
    ctx.out(JSON.stringify(schedule, null, 2));
    return;
  }
  ctx.out(`Schedule ${schedule.id} ${active ? "started" : "stopped"} (active=${schedule.is_active}).`);
}

export function cmdScheduledAgentStart(ctx: CommandContext, workflowId: string, scheduleId: string): Promise<void> {
  return setScheduleActive(ctx, workflowId, scheduleId, true);
}

export function cmdScheduledAgentStop(ctx: CommandContext, workflowId: string, scheduleId: string): Promise<void> {
  return setScheduleActive(ctx, workflowId, scheduleId, false);
}

/** Delete a schedule (confirm unless -y / --json). */
export async function cmdScheduledAgentDelete(
  ctx: CommandContext,
  workflowId: string,
  scheduleId: string,
  opts: { yes?: boolean } = {},
): Promise<void> {
  const proceed = await shouldProceed(ctx, opts.yes, `Delete schedule ${scheduleId}?`);
  if (!proceed) {
    ctx.out(ctx.json ? JSON.stringify({ deleted: false }) : "Aborted; nothing deleted.");
    return;
  }
  await resolveClient(ctx).deleteSchedule(workflowId, scheduleId);
  ctx.out(ctx.json ? JSON.stringify({ deleted: scheduleId }) : `Deleted schedule ${scheduleId}.`);
}
