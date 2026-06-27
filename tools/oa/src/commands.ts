import { type ClientOptions, OaClient } from "./client.ts";
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

/** Pull the visible reply text out of a stream event across known shapes.
 * The platform emits canonical Anthropic frames (content_block_delta with a
 * delta.text_delta for the answer, delta.thinking_delta for internal reasoning
 * which we omit); we also tolerate simpler text/delta/OpenAI-choice shapes. */
function eventText(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const e = event as Record<string, unknown>;
  const delta = e.delta;
  if (delta && typeof delta === "object") {
    const d = delta as { text?: unknown; type?: unknown };
    if (typeof d.text === "string") return d.text; // text_delta = the reply (thinking_delta omitted)
    return "";
  }
  if (typeof e.delta === "string") return e.delta;
  if (typeof e.text === "string") return e.text;
  if (typeof e.content === "string") return e.content;
  const choices = e.choices as Array<{ delta?: { content?: string } }> | undefined;
  if (choices?.[0]?.delta?.content) return choices[0].delta.content as string;
  return "";
}

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
