import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { OaClient } from "./client.ts";
import { configDir } from "./config.ts";
import {
  type CommandContext,
  cmdHealth,
  cmdLogin,
  cmdLogout,
  cmdWhoami,
} from "./commands.ts";

export const VERSION = "0.1.0";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface GlobalOpts {
  profile?: string;
  instance?: string;
  json?: boolean;
}

/** Build a CommandContext from parsed global flags + io sinks. */
export function buildContext(global: GlobalOpts, io: Io): CommandContext {
  return {
    configDir: configDir(),
    profileName: global.profile,
    instanceOverride: global.instance,
    json: global.json ?? false,
    out: io.out,
    err: io.err,
    makeClient: (opts) => new OaClient(opts),
  };
}

/** Construct the commander program. Output is routed through `io` so it is
 * testable (help/version/errors included). */
export function buildProgram(io: Io): Command {
  const program = new Command();
  program
    .name("oa")
    .description("Headless control plane for OpenAgentic — drive chat, flows, and agents from the terminal")
    .version(VERSION)
    .option("-p, --profile <name>", "config profile to use")
    .option("--instance <url>", "override the instance URL")
    .option("--json", "machine-readable JSON output");

  program.configureOutput({
    writeOut: (s) => io.out(s.replace(/\n$/, "")),
    writeErr: (s) => io.err(s.replace(/\n$/, "")),
  });

  const ctx = (): CommandContext => buildContext(program.opts() as GlobalOpts, io);

  program
    .command("login")
    .description("Authenticate and store a profile (mints a user-bound api key)")
    .requiredOption("--instance <url>", "instance URL")
    .requiredOption("-u, --username <user>", "username or email")
    .option("-w, --password <pw>", "password (or set OA_PASSWORD)")
    .option("--name <profile>", "profile name to save", "default")
    .action(async (opts) => {
      const password = opts.password ?? process.env.OA_PASSWORD;
      if (!password) throw new Error("Password required: pass --password or set OA_PASSWORD.");
      await cmdLogin(buildContext(program.opts() as GlobalOpts, io), {
        instanceUrl: opts.instance,
        username: opts.username,
        password,
        profileName: opts.name,
      });
    });

  program
    .command("logout")
    .description("Remove a stored profile")
    .action(async () => {
      await cmdLogout(ctx());
    });

  program
    .command("whoami")
    .description("Show the authenticated identity")
    .action(async () => {
      await cmdWhoami(ctx());
    });

  program
    .command("health")
    .description("Check instance health")
    .action(async () => {
      await cmdHealth(ctx());
    });

  return program;
}

/* c8 ignore start — process entrypoint, exercised via the CLI not unit tests */
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  const io: Io = {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  };
  buildProgram(io)
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      io.err(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
/* c8 ignore stop */
