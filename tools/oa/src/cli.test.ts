import { describe, expect, it } from "vitest";
import { buildContext, buildProgram } from "./cli.ts";

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
    for (const cmd of ["login", "logout", "whoami", "health"]) {
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
