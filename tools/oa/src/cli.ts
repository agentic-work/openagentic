import { Command } from "commander";
import * as readline from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { OaClient } from "./client.ts";
import { configDir } from "./config.ts";
import {
  type CommandContext,
  cmdAgentList,
  cmdAgentRun,
  cmdChat,
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
    .option("--instance <url>", "instance URL")
    .option("-u, --username <user>", "username or email")
    .option("-w, --password <pw>", "password (or set OA_PASSWORD)")
    .option("--name <profile>", "profile name to save", "default")
    /* c8 ignore start — wires interactive prompter; logic covered via resolveLoginInput */
    .action(async (opts) => {
      const { prompter, close } = createReadlinePrompter();
      try {
        const input = await resolveLoginInput(opts, prompter);
        try {
          const hasUi = await new OaClient({ instanceUrl: input.instanceUrl }).detectUi();
          io.err(hasUi ? "Detected web UI at this instance." : "Headless instance — using username/password login.");
        } catch {
          /* detection is best-effort */
        }
        await cmdLogin(ctx(), input);
      } finally {
        close();
      }
    })
    /* c8 ignore stop */;

  program.command("logout").description("Remove a stored profile").action(async () => {
    await cmdLogout(ctx());
  });
  program.command("whoami").description("Show the authenticated identity").action(async () => {
    await cmdWhoami(ctx());
  });
  program.command("health").description("Check instance health").action(async () => {
    await cmdHealth(ctx());
  });

  const key = program.command("key").description("Manage user-bound api keys");
  key.command("list").description("List your api keys").action(async () => {
    await cmdKeyList(ctx());
  });
  key.command("create <name>").description("Create an api key").action(async (name: string) => {
    await cmdKeyCreate(ctx(), name);
  });
  key.command("revoke <id>").description("Revoke an api key").action(async (id: string) => {
    await cmdKeyRevoke(ctx(), id);
  });

  const flow = program.command("flow").description("Flows / workflows");
  flow.command("list").description("List flows").action(async () => {
    await cmdFlowList(ctx());
  });
  flow
    .command("run <id>")
    .description("Run a flow")
    .option("--input <json>", "JSON input object")
    .action(async (id: string, opts: { input?: string }) => {
      await cmdFlowRun(ctx(), id, opts.input ? JSON.parse(opts.input) : undefined);
    });

  const agent = program.command("agent").description("Agents");
  agent.command("list").description("List agents").action(async () => {
    await cmdAgentList(ctx());
  });
  agent
    .command("run <id> <task...>")
    .description("Run an agent on a task")
    .action(async (id: string, task: string[]) => {
      await cmdAgentRun(ctx(), id, task.join(" "));
    });

  program
    .command("chat <message...>")
    .description("Send a chat message and stream the reply")
    .option("--session <id>", "reuse an existing chat session")
    .action(async (message: string[], opts: { session?: string }) => {
      await cmdChat(ctx(), message.join(" "), { sessionId: opts.session });
    });

  return program;
}

/* c8 ignore start — process entrypoint */
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  const io: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };
  buildProgram(io)
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      io.err(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
/* c8 ignore stop */
