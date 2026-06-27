import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configDir,
  getProfile,
  loadConfig,
  removeProfile,
  saveProfile,
} from "./config.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "oa-cfg-"));
}

describe("config store", () => {
  it("round-trips a profile through save then load", () => {
    const dir = tempDir();
    saveProfile(
      dir,
      "local",
      { instanceUrl: "http://localhost:8080", apiKey: "oa_k_test" },
      true,
    );

    const cfg = loadConfig(dir);

    expect(cfg.defaultProfile).toBe("local");
    expect(cfg.profiles.local.instanceUrl).toBe("http://localhost:8080");
    expect(cfg.profiles.local.apiKey).toBe("oa_k_test");
  });

  it("returns an empty config when no file exists yet", () => {
    const cfg = loadConfig(tempDir());
    expect(cfg.profiles).toEqual({});
    expect(cfg.defaultProfile).toBe("");
  });

  it("writes the config file owner-only (0600) so the api key is not world-readable", () => {
    const dir = tempDir();
    saveProfile(dir, "local", { instanceUrl: "http://x", apiKey: "secret" });
    const mode = statSync(join(dir, "config.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("getProfile resolves the default when no name is given", () => {
    const dir = tempDir();
    saveProfile(dir, "prod", { instanceUrl: "http://prod", apiKey: "p" }, true);
    saveProfile(dir, "dev", { instanceUrl: "http://dev", apiKey: "d" });

    expect(getProfile(dir)?.instanceUrl).toBe("http://prod");
    expect(getProfile(dir, "dev")?.instanceUrl).toBe("http://dev");
    expect(getProfile(dir, "nope")).toBeUndefined();
  });

  it("removeProfile drops the profile and clears it as default", () => {
    const dir = tempDir();
    saveProfile(dir, "local", { instanceUrl: "http://x", apiKey: "s" }, true);

    removeProfile(dir, "local");

    const cfg = loadConfig(dir);
    expect(cfg.profiles.local).toBeUndefined();
    expect(cfg.defaultProfile).toBe("");
  });

  it("configDir honors OA_CONFIG_DIR override", () => {
    expect(configDir({ OA_CONFIG_DIR: "/custom/oa" } as NodeJS.ProcessEnv)).toBe(
      "/custom/oa",
    );
  });

  it("configDir falls back to XDG_CONFIG_HOME/oa then HOME/.config/oa", () => {
    expect(
      configDir({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/u" } as NodeJS.ProcessEnv),
    ).toBe("/xdg/oa");
    expect(configDir({ HOME: "/home/u" } as NodeJS.ProcessEnv)).toBe(
      "/home/u/.config/oa",
    );
  });
});
