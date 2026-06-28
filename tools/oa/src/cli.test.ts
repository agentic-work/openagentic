import { describe, expect, it } from "vitest";
import { buildContext, buildProgram, normalizeArgv, type Prompter, resolveLoginInput } from "./cli.ts";

const KNOWN = ["login", "logout", "whoami", "health", "key", "flow", "agent", "chat", "do"];

describe("normalizeArgv", () => {
  it("splices `do` before an unknown leading positional (bare oa \"<english>\")", () => {
    expect(normalizeArgv(["node", "oa", "create an agent that triages incidents"], KNOWN)).toEqual([
      "node",
      "oa",
      "do",
      "create an agent that triages incidents",
    ]);
  });

  it("splices `do` for an unknown multi-token positional", () => {
    expect(normalizeArgv(["node", "oa", "delete", "the", "stuck", "pod"], KNOWN)).toEqual([
      "node",
      "oa",
      "do",
      "delete",
      "the",
      "stuck",
      "pod",
    ]);
  });

  it("leaves a real subcommand untouched", () => {
    const argv = ["node", "oa", "chat", "hello world"];
    expect(normalizeArgv(argv, KNOWN)).toEqual(argv);
  });

  it("leaves an explicit `do` untouched (no double-splice)", () => {
    const argv = ["node", "oa", "do", "--yes", "make a thing"];
    expect(normalizeArgv(argv, KNOWN)).toEqual(argv);
  });

  it("leaves a pure-flag invocation untouched (--help / --version / bare)", () => {
    expect(normalizeArgv(["node", "oa", "--help"], KNOWN)).toEqual(["node", "oa", "--help"]);
    expect(normalizeArgv(["node", "oa", "--version"], KNOWN)).toEqual(["node", "oa", "--version"]);
    expect(normalizeArgv(["node", "oa"], KNOWN)).toEqual(["node", "oa"]);
  });
});

describe("buildContext", () => {
  it("maps global flags onto the command context", () => {
    const ctx = buildContext(
      { profile: "p", instance: "http://x", json: true },
      { out: () => {}, err: () => {} },
    );
    expect(ctx.profileName).toBe("p");
    expect(ctx.instanceOverride).toBe("http://x");
    expect(ctx.json).toBe(true);
    expect(typeof ctx.makeClient).toBe("function");
    expect(typeof ctx.configDir).toBe("string");
  });

  it("defaults json off when not requested", () => {
    const ctx = buildContext({}, { out: () => {}, err: () => {} });
    expect(ctx.json).toBe(false);
    expect(ctx.profileName).toBeUndefined();
  });
});

describe("buildProgram", () => {
  it("registers the implemented commands and shows them in help", async () => {
    const lines: string[] = [];
    const program = buildProgram({ out: (s) => lines.push(s), err: (s) => lines.push(s) });
    program.exitOverride();
    try {
      await program.parseAsync(["node", "oa", "--help"]);
    } catch {
      // commander throws on --help under exitOverride; the help text is captured above.
    }
    const help = lines.join("\n");
    for (const cmd of ["login", "logout", "whoami", "health", "key", "flow", "agent", "chat", "do"]) {
      expect(help).toContain(cmd);
    }
  });

  it("parses `do --yes <text...>` into text + the yes flag", async () => {
    const program = buildProgram({ out: () => {}, err: () => {} });
    const doCmd = program.commands.find((c) => c.name() === "do");
    expect(doCmd).toBeDefined();
    // Stub the action to a no-op so we assert parsing without hitting the network;
    // commander still populates processedArgs + opts on the command beforehand.
    (doCmd as unknown as { _actionHandler: (() => void) | null })._actionHandler = () => {};
    await program.parseAsync(["node", "oa", "do", "--yes", "make", "a", "thing"]);
    const processed = (doCmd as unknown as { processedArgs: unknown[] }).processedArgs;
    expect(processed[0]).toEqual(["make", "a", "thing"]);
    expect(doCmd!.opts().yes).toBe(true);
  });

  it("reports a version", async () => {
    const lines: string[] = [];
    const program = buildProgram({ out: (s) => lines.push(s), err: (s) => lines.push(s) });
    program.exitOverride();
    try {
      await program.parseAsync(["node", "oa", "--version"]);
    } catch {
      // version also triggers exitOverride
    }
    expect(lines.join("\n")).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("resolveLoginInput", () => {
  function stubPrompter(answers: Record<string, string>): Prompter & { asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      async input(q) {
        asked.push(q);
        return answers[q] ?? "";
      },
      async password(q) {
        asked.push(q);
        return answers[q] ?? "";
      },
    };
  }

  it("uses provided flags and does not prompt for them", async () => {
    const p = stubPrompter({});
    const input = await resolveLoginInput(
      { instance: "http://h:8000", username: "admin@x", password: "pw", name: "prod" },
      p,
    );
    expect(input).toEqual({
      instanceUrl: "http://h:8000",
      username: "admin@x",
      password: "pw",
      profileName: "prod",
    });
    expect(p.asked).toEqual([]);
  });

  it("prompts only for the missing fields", async () => {
    const p = stubPrompter({ "Username or email": "admin@x", Password: "secret" });
    const input = await resolveLoginInput({ instance: "http://h:8000" }, p);
    expect(input.username).toBe("admin@x");
    expect(input.password).toBe("secret");
    expect(p.asked).toContain("Username or email");
    expect(p.asked).toContain("Password");
    expect(p.asked).not.toContain("Instance URL");
  });
});
