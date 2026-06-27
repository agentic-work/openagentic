import { describe, expect, it } from "vitest";
import { buildContext, buildProgram, type Prompter, resolveLoginInput } from "./cli.ts";

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
    for (const cmd of ["login", "logout", "whoami", "health", "key", "flow", "agent", "chat"]) {
      expect(help).toContain(cmd);
    }
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
