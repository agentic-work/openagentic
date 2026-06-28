import { Command } from "commander";
import * as readline from "node:readline/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OaClient } from "./client.ts";
import { configDir } from "./config.ts";
import {
  type CommandContext,
  cmdAgentList,
  cmdAgentRun,
  cmdChat,
  cmdDo,
  cmdFlowList,
  cmdFlowRun,
  cmdHealth,
  cmdKeyCreate,
  cmdKeyList,
  cmdKeyRevoke,
  cmdLogin,
  cmdLogout,
  cmdWhoami,
  type LoginInput,
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

export interface Prompter {
  input(question: string, opts?: { default?: string }): Promise<string>;
  password(question: string): Promise<string>;
}

/* c8 ignore start — interactive terminal IO, exercised live not in unit tests */
/** One-shot interactive y/N prompt for client-side HITL approvals. */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    const ans = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}
/* c8 ignore stop */

export function buildContext(global: GlobalOpts, io: Io): CommandContext {
  // Only offer an interactive approval prompt when we can actually ask: a real
  // TTY and not --json. Otherwise leave confirm undefined so cmdDo fails safe (deny).
  const canPrompt = !(global.json ?? false) && Boolean(process.stdin.isTTY);
  return {
    configDir: configDir(),
    profileName: global.profile,
    instanceOverride: global.instance,
    json: global.json ?? false,
    out: io.out,
    err: io.err,
    write: (chunk) => process.stdout.write(chunk),
    confirm: canPrompt ? (q) => promptYesNo(q) : undefined,
    makeClient: (opts) => new OaClient(opts),
  };
}

/** Make bare `oa "<english>"` work: when the first non-flag positional is NOT a
 * known subcommand, splice `do` in before it. Real subcommands, an explicit
 * `do`, and pure-flag invocations (`--help`, `--version`, bare `oa`) pass
 * through untouched. */
export function normalizeArgv(argv: string[], knownCommands: string[]): string[] {
  const head = argv.slice(0, 2); // [node, oa]
  const rest = argv.slice(2);
  const firstPositional = rest.findIndex((a) => !a.startsWith("-"));
  if (firstPositional === -1) return argv; // all flags / empty → leave alone
  if (knownCommands.includes(rest[firstPositional])) return argv; // real subcommand
  return [...head, ...rest.slice(0, firstPositional), "do", ...rest.slice(firstPositional)];
}

/** Resolve login inputs from flags, env, then interactive prompts (in that order). */
export async function resolveLoginInput(
  opts: { instance?: string; username?: string; password?: string; name?: string },
  prompter: Prompter,
): Promise<LoginInput> {
  const instanceUrl =
    opts.instance ?? (await prompter.input("Instance URL", { default: "http://localhost:8080" }));
  const username = opts.username ?? (await prompter.input("Username or email"));
  const password =
    opts.password ?? process.env.OA_PASSWORD ?? (await prompter.password("Password"));
  return { instanceUrl, username, password, profileName: opts.name };
}

/* c8 ignore start — interactive terminal IO, exercised live not in unit tests */
function createReadlinePrompter(): { prompter: Prompter; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const iface = rl as unknown as { _writeToOutput?: (s: string) => void };
  const orig = iface._writeToOutput?.bind(rl);
  iface._writeToOutput = (s: string) => {
    if (muted) {
      if (s.includes("\n")) process.stdout.write("\n");
      return;
    }
    if (orig) orig(s);
    else process.stdout.write(s);
  };
  return {
    close: () => rl.close(),
    prompter: {
      async input(q, o) {
        const def = o?.default ? ` [${o.default}]` : "";
        const ans = (await rl.question(`${q}${def}: `)).trim();
        return ans || o?.default || "";
      },
      async password(q) {
        process.stdout.write(`${q}: `);
        muted = true;
        const ans = await rl.question("");
        muted = false;
        return ans.trim();
      },
    },
  };
}
/* c8 ignore stop */

/** Attach the connection/output options shared by every leaf command. */
function common(cmd: Command): Command {
  return cmd
    .option("-p, --profile <name>", "config profile to use")
    .option("--instance <url>", "instance URL / override")
    .option("--json", "machine-readable JSON output");
}

export function buildProgram(io: Io): Command {
  const program = new Command();
  program
    .name("oa")
    .description("Headless control plane for OpenAgentic — drive chat, flows, and agents from the terminal")
    .version(VERSION);

  program.configureOutput({
    writeOut: (s) => io.out(s.replace(/\n$/, "")),
    writeErr: (s) => io.err(s.replace(/\n$/, "")),
  });

  const ctx = (options: GlobalOpts): CommandContext => buildContext(options, io);

  common(program.command("login"))
    .description("Authenticate and store a profile (mints a user-bound api key)")
    .option("-u, --username <user>", "username or email")
    .option("-w, --password <pw>", "password (or set OA_PASSWORD)")
    .option("--name <profile>", "profile name to save", "default")
    /* c8 ignore start — wires the interactive prompter; logic is covered by resolveLoginInput */
    .action(async (options) => {
      const { prompter, close } = createReadlinePrompter();
      try {
        const input = await resolveLoginInput(options, prompter);
        try {
          const hasUi = await new OaClient({ instanceUrl: input.instanceUrl }).detectUi();
          io.err(hasUi ? "Detected web UI at this instance." : "Headless instance — using username/password login.");
        } catch {
          /* detection is best-effort */
        }
        await cmdLogin(ctx(options), input);
      } finally {
        close();
      }
    })
    /* c8 ignore stop */;

  common(program.command("logout")).description("Remove a stored profile").action(async (options) => {
    await cmdLogout(ctx(options));
  });
  common(program.command("whoami")).description("Show the authenticated identity").action(async (options) => {
    await cmdWhoami(ctx(options));
  });
  common(program.command("health")).description("Check instance health").action(async (options) => {
    await cmdHealth(ctx(options));
  });

  const key = program.command("key").description("Manage user-bound api keys");
  common(key.command("list")).description("List your api keys").action(async (options) => {
    await cmdKeyList(ctx(options));
  });
  common(key.command("create <name>")).description("Create an api key").action(async (name: string, options) => {
    await cmdKeyCreate(ctx(options), name);
  });
  common(key.command("revoke <id>")).description("Revoke an api key").action(async (id: string, options) => {
    await cmdKeyRevoke(ctx(options), id);
  });

  const flow = program.command("flow").description("Flows / workflows");
  common(flow.command("list")).description("List flows").action(async (options) => {
    await cmdFlowList(ctx(options));
  });
  common(flow.command("run <id>"))
    .description("Run a flow")
    .option("--input <json>", "JSON input object")
    .action(async (id: string, options: { input?: string } & GlobalOpts) => {
      await cmdFlowRun(ctx(options), id, options.input ? JSON.parse(options.input) : undefined);
    });

  const agent = program.command("agent").description("Agents");
  common(agent.command("list")).description("List agents").action(async (options) => {
    await cmdAgentList(ctx(options));
  });
  common(agent.command("run <id> <task...>"))
    .description("Run an agent on a task")
    .action(async (id: string, task: string[], options) => {
      await cmdAgentRun(ctx(options), id, task.join(" "));
    });

  common(program.command("chat <message...>"))
    .description("Send a chat message and stream the reply")
    .option("--session <id>", "reuse an existing chat session")
    .action(async (message: string[], options: { session?: string } & GlobalOpts) => {
      await cmdChat(ctx(options), message.join(" "), { sessionId: options.session });
    });

  common(program.command("do <text...>"))
    .description("Run a plain-English request through chat (approves mutating tools interactively)")
    .option("-y, --yes", "auto-approve all tool calls (non-interactive)")
    .option("--session <id>", "reuse an existing chat session")
    .action(async (text: string[], options: { yes?: boolean; session?: string } & GlobalOpts) => {
      await cmdDo(ctx(options), text.join(" "), { yes: options.yes, sessionId: options.session });
    });

  return program;
}

/* c8 ignore start — process entrypoint */
// Detect "run as the program" robustly: when installed as a global npm bin,
// process.argv[1] is a SYMLINK to this file, so a plain URL comparison fails and
// the CLI would silently do nothing. Resolve both through realpath first.
function invokedAsMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(argv1).href;
  }
}
if (invokedAsMain()) {
  const io: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };
  const program = buildProgram(io);
  const known = program.commands.map((c) => c.name());
  program
    .parseAsync(normalizeArgv(process.argv, known))
    .catch((err: unknown) => {
      io.err(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
/* c8 ignore stop */
