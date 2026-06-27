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
