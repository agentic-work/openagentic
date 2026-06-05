/**
 * Docs source-of-truth GUARD — keeps the generated docs honest.
 *
 * This is the regression that pins the structured docs content to the REAL
 * source on disk. It runs the generator (so the assertions are against freshly
 * emitted manifests, never a stale committed snapshot) and then asserts:
 *
 *   (1) the generated `mcp-servers` manifest section count === the real number
 *       of services/mcps/oap-*-mcp dirs;
 *   (2) the `platform-summary` mcp-server-count === that same real count;
 *   (3) the `platform-summary` version === version.json's version, and the
 *       `changelog` current release === version.json's version (no drift);
 *   (4) NO removed-feature string (Code Mode, sandbox-exec, /api/code, …)
 *       appears anywhere in ANY generated manifest.
 *
 * If a new MCP lands, or version.json bumps, and the docs don't follow, THIS
 * fails — so the docs cannot silently go stale.
 *
 * Deterministic + offline: it shells the generator (npm run generate:docs)
 * once, then reads the emitted JSON + the real source on disk.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import { execFileSync } from 'child_process';

const UI_ROOT = resolve(process.cwd());
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const GENERATED = resolve(UI_ROOT, 'public', 'docs', 'generated');
const VERSION_JSON = resolve(REPO_ROOT, 'version.json');
const MCP_DIR = resolve(REPO_ROOT, 'services', 'mcps');

// Same removed-feature phrasings guarded elsewhere — assert they never appear
// in the STRUCTURED generated content (the changelog/summary are new surfaces
// where stale "code mode" prose could otherwise leak back in).
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: 'code-mode', re: /code[- ]?mode/i },
  { name: 'codemode', re: /\bcodemode\b/i },
  { name: 'api-code-route', re: /\/api\/code\b/i },
  { name: 'sandbox-exec', re: /sandbox[- ]?exec/i },
  { name: 'k8s-sandbox', re: /k8s[_ -]?sandbox/i },
  { name: 'openagentic_execute', re: /openagentic_execute/i },
];

async function readJson<T = any>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

async function countMcpDirs(): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await readdir(MCP_DIR);
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (!/^oap-.*-mcp$/.test(e)) continue;
    if ((await stat(resolve(MCP_DIR, e))).isDirectory()) n++;
  }
  return n;
}

let realMcpCount = 0;
let versionJson: { version?: string } = {};

describe('docs source-of-truth guard', () => {
  beforeAll(async () => {
    // Regenerate so we assert against fresh output, not a committed snapshot.
    // Fails the test if the generator itself fails (broken extractor/invariant).
    execFileSync('npm', ['run', 'generate:docs'], {
      cwd: UI_ROOT,
      stdio: 'ignore',
    });
    realMcpCount = await countMcpDirs();
    versionJson = await readJson(VERSION_JSON);
  }, 120_000);

  it('real services/mcps/oap-*-mcp dir count is the expected 14+', () => {
    expect(realMcpCount).toBeGreaterThanOrEqual(14);
  });

  it('mcp-servers manifest section count === real oap-*-mcp dir count', async () => {
    const manifest = await readJson(resolve(GENERATED, 'mcp-servers.json'));
    expect(manifest.sections.length).toBe(realMcpCount);
  });

  it('platform-summary mcp-server-count === real oap-*-mcp dir count', async () => {
    const summary = await readJson(resolve(GENERATED, 'platform-summary.json'));
    const item = summary.sections
      .flatMap((s: any) => s.items)
      .find((i: any) => i.id === 'mcp-server-count');
    expect(item).toBeTruthy();
    expect(item.properties.value).toBe(realMcpCount);
  });

  it('platform-summary version === version.json version', async () => {
    const summary = await readJson(resolve(GENERATED, 'platform-summary.json'));
    const item = summary.sections
      .flatMap((s: any) => s.items)
      .find((i: any) => i.id === 'version');
    expect(item).toBeTruthy();
    expect(item.properties.version).toBe(versionJson.version);
  });

  it('changelog current release === version.json version', async () => {
    const cl = await readJson(resolve(GENERATED, 'changelog.json'));
    const current = cl.sections.find((s: any) => /\(current\)/.test(s.description));
    expect(current, 'a release must be marked current').toBeTruthy();
    // section title is `v<version> — <codename>`; assert the version prefix.
    expect(current.title.startsWith(`v${versionJson.version}`)).toBe(true);
    // and that exactly one release is the current one.
    const currentCount = cl.sections.filter((s: any) =>
      /\(current\)/.test(s.description),
    ).length;
    expect(currentCount).toBe(1);
  });

  it('NO removed-feature string appears in ANY generated manifest', async () => {
    const files = (await readdir(GENERATED)).filter((f) => f.endsWith('.json'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = await readFile(resolve(GENERATED, f), 'utf-8');
      content.split('\n').forEach((line, i) => {
        for (const rule of FORBIDDEN) {
          if (rule.re.test(line)) {
            offenders.push(`${f}:${i + 1} [${rule.name}] ${line.trim().slice(0, 100)}`);
          }
        }
      });
    }
    expect(offenders, `\n${offenders.join('\n')}`).toEqual([]);
  });
});
