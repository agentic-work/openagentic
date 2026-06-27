import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** A single OpenAgentic instance the CLI can talk to. */
export interface Profile {
  instanceUrl: string;
  apiKey: string;
}

export interface OaConfig {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

/** Resolve the config directory: OA_CONFIG_DIR > XDG_CONFIG_HOME/oa > HOME/.config/oa. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OA_CONFIG_DIR) return env.OA_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "oa");
  return join(env.HOME ?? ".", ".config", "oa");
}

function configFile(dir: string): string {
  return join(dir, "config.json");
}

export function loadConfig(dir: string): OaConfig {
  const file = configFile(dir);
  if (!existsSync(file)) return { defaultProfile: "", profiles: {} };
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<OaConfig>;
  return {
    defaultProfile: raw.defaultProfile ?? "",
    profiles: raw.profiles ?? {},
  };
}

export function saveProfile(
  dir: string,
  name: string,
  profile: Profile,
  makeDefault = false,
): void {
  const cfg = loadConfig(dir);
  cfg.profiles[name] = profile;
  if (makeDefault || !cfg.defaultProfile) cfg.defaultProfile = name;
  writeConfig(dir, cfg);
}

export function getProfile(dir: string, name?: string): Profile | undefined {
  const cfg = loadConfig(dir);
  return cfg.profiles[name ?? cfg.defaultProfile];
}

export function removeProfile(dir: string, name: string): void {
  const cfg = loadConfig(dir);
  delete cfg.profiles[name];
  if (cfg.defaultProfile === name) cfg.defaultProfile = "";
  writeConfig(dir, cfg);
}

function writeConfig(dir: string, cfg: OaConfig): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = configFile(dir);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  // Guarantee owner-only regardless of umask / pre-existing file.
  chmodSync(file, 0o600);
}
