/**
 * Docs sync-guard — the test that makes drift impossible.
 *
 * Guarantees:
 *
 *   (A) FORBIDDEN STRINGS — no docs source file (or generated manifest) may
 *       reference a REMOVED feature: Code Mode, /api/code, sandbox-exec, the
 *       SandboxSecurityPage, the "Intelligence Slider" / "Atlas" Code-Mode-era
 *       marketing names, denied node ids, etc. If anyone re-adds Code-Mode prose
 *       or a stale page, this fails with file:line.
 *
 *   (A2) MODE-COUNT DRIFT — no docs prose or manifest may claim "three ways" /
 *       "3 modes" / "3 ways to work" (case-insensitive). The platform has TWO
 *       modes (Chat + Flows); the third "full development environment" mode was
 *       Code Mode, which was removed. THIS is the class of drift that survived
 *       the JSON-only guard: the stale claim lived in the docs PROSE
 *       (WelcomePage.tsx), not the generated manifests — so the scan below
 *       walks src/features/docs prose, not only public/docs/generated JSON.
 *
 *   (B) SOURCE-MATCH — the generated MCP / flow-template / node-type / service /
 *       agent-type lists must match the ACTUAL source on disk (count + denylist),
 *       proving the volatile docs are source-derived, not hand-maintained.
 *
 *   (C) MODE-COUNT TRUTH — the docs' stated mode count (the "N Ways to Work"
 *       heading) is DERIVED from the canonical modes list (buildModes()), and
 *       that list has exactly the real number of platform modes.
 *
 * Deterministic + offline: file reads + the same extractors the generator runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, relative } from 'path';
import { readdir, readFile, stat } from 'fs/promises';

import { mcpTools } from '../extractors/mcpTools';
import { flowTemplates } from '../extractors/flowTemplates';
import { workflowNodes } from '../extractors/workflowNodes';
import { composeServices } from '../extractors/composeServices';
import { agentTypes } from '../extractors/agentTypes';
import { REMOVED_NODE_TYPES } from '../manifest';
import type { DocManifest } from '../types';

const UI_ROOT = resolve(process.cwd());
const REPO_ROOT = resolve(UI_ROOT, '..', '..');
const DOCS_SRC = resolve(UI_ROOT, 'src', 'features', 'docs');
const GENERATED = resolve(UI_ROOT, 'public', 'docs', 'generated');

// ---------------------------------------------------------------------------
// (A) forbidden-string scan
// ---------------------------------------------------------------------------

interface Rule {
  name: string;
  re: RegExp;
}

// NOTE on scope: this bans the REMOVED **Code Mode** feature (the browser-IDE /
// sandbox-exec / coding-CLI product), NOT the `code_execution` *agent persona*,
// which is still a live, registered agent type in AgentRegistry.ts. Accurate
// docs about that agent are fine; only Code-Mode phrasings are forbidden.
const FORBIDDEN: Rule[] = [
  { name: 'code-mode', re: /code[- ]?mode/i },
  { name: 'codemode', re: /\bcodemode\b/i },
  { name: 'api-code-route', re: /\/api\/code\b/i },
  { name: 'sandbox-exec', re: /sandbox[- ]?exec/i },
  { name: 'k8s-sandbox', re: /k8s[_ -]?sandbox/i },
  { name: 'browser-sandbox-exec', re: /browser_sandbox_exec/i },
  { name: 'sandbox-security-id', re: /sandbox-security/i },
  { name: 'SandboxSecurityPage', re: /SandboxSecurityPage/ },
  { name: 'oap-openagentic-mcp', re: /oap-openagentic-mcp/i },
  { name: 'openagentic_execute', re: /openagentic_execute/i },
  { name: 'code-server', re: /code-server/i },
  { name: 'coding-assistant', re: /coding assistant/i },
  // Code-Mode-era marketing names that leaked through version.json into the
  // changelog manifest. "Intelligence Slider" was the old name for what is now
  // smart model routing; "Atlas" was a Code-Mode-era release codename.
  { name: 'intelligence-slider', re: /intelligence[- ]?slider/i },
  // "Atlas" the feature/codename is forbidden, but the docs hero IMAGE asset is
  // legitimately named atlas.png (the field-guide hero photo). Match the bare
  // word `Atlas` ONLY when it is NOT immediately the .png asset, an "atlas hero"
  // image reference, or an /atlas.png url — those are exempt below via
  // isAtlasImageRef(). The rule itself stays a plain word match; the line-level
  // exemption keeps the legit image asset from tripping it.
  { name: 'atlas-feature', re: /\batlas\b/i },
];

/**
 * The docs landing hero is a photograph at /atlas.png (matching the brand's
 * "field guide / atlas" aesthetic). Those references are NOT the removed
 * Code-Mode-era "Atlas" feature/codename, so a line that only mentions the
 * atlas.png image asset is exempt from the `atlas-feature` rule (and ONLY that
 * rule). Everything else — a bare "Atlas" codename, "Atlas release", etc. —
 * still fails.
 */
function isAtlasImageRef(line: string): boolean {
  const l = line.toLowerCase();
  // atlas.png filename, /atlas.png url, or "atlas hero" image-artwork prose.
  return /atlas\.png/.test(l) || /atlas hero/.test(l) || /atlas hero artwork/.test(l);
}

/**
 * (A2) Mode-count drift phrasings. The platform has exactly TWO ways to work
 * (Chat + Flows). Any prose claiming three (the removed Code-Mode third mode)
 * is drift. Case-insensitive; scanned across BOTH docs prose and manifests.
 */
const MODE_DRIFT: Rule[] = [
  { name: 'three-ways', re: /three\s+ways/i },
  { name: '3-ways', re: /\b3\s+ways\b/i },
  { name: 'three-ways-to-work', re: /three\s+ways\s+to\s+work/i },
  { name: '3-ways-to-work', re: /\b3\s+ways\s+to\s+work\b/i },
  { name: 'three-modes', re: /three\s+modes/i },
  { name: '3-modes', re: /\b3\s+modes\b/i },
];

/**
 * Allowlisted files — legit `sandbox` uses that are NOT Code Mode.
 *
 * NOTE: ChangelogPage.tsx is intentionally NOT allowlisted. Code Mode was fully
 * excised from openagentic, so even the historical changelog must be Code-Mode
 * free — the prose page is now scanned like every other docs source so any
 * future reintroduction fails the build. The bare-word `sandbox` (iframe
 * sandbox attr, OAT synth "sandboxed runtime", agent playground) is legit and
 * is NOT in the forbidden list above (only the Code-Mode phrasings are).
 */
const ALLOWLIST = new Set<string>([]);

async function walk(dir: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  let entries: import('fs').Dirent[] = [];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as import('fs').Dirent[];
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      out.push(...(await walk(full, exts)));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out;
}

describe('docs sync-guard (A): no removed-feature strings', () => {
  let offenders: string[] = [];
  let modeDriftOffenders: string[] = [];

  beforeAll(async () => {
    // Scan BOTH the docs PROSE (src/features/docs — .ts/.tsx pages + components)
    // AND the generated manifests. Scanning the prose is the gap that let
    // "Three Ways to Work" survive: it lived in WelcomePage.tsx, never in JSON.
    const docFiles = await walk(DOCS_SRC, ['.ts', '.tsx']);
    let genFiles: string[] = [];
    try {
      const gen = await readdir(GENERATED);
      genFiles = gen.filter((f) => f.endsWith('.json')).map((f) => resolve(GENERATED, f));
    } catch {
      genFiles = [];
    }

    for (const file of [...docFiles, ...genFiles]) {
      const relDoc = relative(DOCS_SRC, file);
      if (ALLOWLIST.has(relDoc)) continue;
      const content = await readFile(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        for (const rule of FORBIDDEN) {
          if (!rule.re.test(line)) continue;
          // The atlas.png hero image asset is a legit false-positive for the
          // bare-word `atlas-feature` rule only — exempt it.
          if (rule.name === 'atlas-feature' && isAtlasImageRef(line)) continue;
          offenders.push(
            `${relative(REPO_ROOT, file)}:${i + 1} [${rule.name}] ${line.trim().slice(0, 120)}`,
          );
        }
        for (const rule of MODE_DRIFT) {
          if (rule.re.test(line)) {
            modeDriftOffenders.push(
              `${relative(REPO_ROOT, file)}:${i + 1} [${rule.name}] ${line.trim().slice(0, 120)}`,
            );
          }
        }
      });
    }
  });

  it('finds zero forbidden Code-Mode / sandbox-exec / intelligence-slider / Atlas references in docs + generated manifests', () => {
    expect(offenders, `\n${offenders.join('\n')}`).toEqual([]);
  });

  it('finds zero "three ways" / "3 modes" / "3 ways to work" mode-count drift in docs prose + manifests', () => {
    expect(modeDriftOffenders, `\n${modeDriftOffenders.join('\n')}`).toEqual([]);
  });

  it('SandboxSecurityPage.tsx has been deleted', async () => {
    let exists = true;
    try {
      await stat(resolve(DOCS_SRC, 'pages', 'SandboxSecurityPage.tsx'));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (B) source-match: generated lists track actual source
// ---------------------------------------------------------------------------

async function countDirs(parent: string, re: RegExp): Promise<number> {
  let n = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(parent);
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (!re.test(e)) continue;
    const s = await stat(resolve(parent, e));
    if (s.isDirectory()) n++;
  }
  return n;
}

describe('docs sync-guard (B): generated lists match source', () => {
  it('MCP manifest section count === number of oap-*-mcp dirs', async () => {
    const realCount = await countDirs(
      resolve(REPO_ROOT, 'services', 'mcps'),
      /^oap-.*-mcp$/,
    );
    expect(realCount).toBeGreaterThanOrEqual(14);
    const manifest: DocManifest = await mcpTools({
      rootGlob: 'services/mcps/oap-*-mcp',
    })(REPO_ROOT);
    expect(manifest.sections.length).toBe(realCount);
  });

  it('Flow-template count === seed/templates/*.json count', async () => {
    const dir = resolve(
      REPO_ROOT,
      'services',
      'openagentic-workflows',
      'seed',
      'templates',
    );
    const entries = await readdir(dir);
    const jsonCount = entries.filter((e) => e.endsWith('.json')).length;
    const manifest = await flowTemplates({
      dir: 'services/openagentic-workflows/seed/templates',
    })(REPO_ROOT);
    const items = manifest.sections.flatMap((s) => s.items);
    expect(items.length).toBe(jsonCount);
  });

  it('Node-types manifest excludes every removed/denied node id', async () => {
    const manifest = await workflowNodes({
      registryPath: 'services/shared/workflow-engine/src/nodes/registry.ts',
      schemaDir: 'services/shared/workflow-engine/src/nodes',
      deny: REMOVED_NODE_TYPES,
    })(REPO_ROOT);
    const ids = manifest.sections.flatMap((s) => s.items.map((i) => i.id));
    for (const denied of REMOVED_NODE_TYPES) {
      expect(ids).not.toContain(denied);
    }
    expect(ids.length).toBeGreaterThanOrEqual(50);
  });

  it('Deployed-services manifest contains no code/exec/sandbox service', async () => {
    const manifest = await composeServices({ path: 'docker-compose.yml' })(REPO_ROOT);
    const ids = manifest.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      expect(id).not.toMatch(/code|codemode|^exec$|sandbox/i);
    }
  });
});

// ---------------------------------------------------------------------------
// (C) generated counts === real source counts (mcp / node-types / agent-types)
// + the docs' stated mode count === the canonical modes list length.
//
// (B) above proves the EXTRACTOR output tracks source. (C) additionally pins
// the GENERATED JSON on disk (what actually ships to the docs UI) to the real
// source counts, so a stale committed manifest can't drift from the source.
// ---------------------------------------------------------------------------

async function countFiles(dir: string, suffix: string): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  return entries.filter((e) => e.endsWith(suffix)).length;
}

async function readGenerated(name: string): Promise<DocManifest> {
  const raw = await readFile(resolve(GENERATED, name), 'utf-8');
  return JSON.parse(raw) as DocManifest;
}

function itemCount(m: DocManifest): number {
  return m.sections.flatMap((s) => s.items).length;
}

/**
 * Parse the canonical platform modes count straight from WelcomePage's
 * `buildModes()` source — the SINGLE source of truth the page derives both the
 * "N Ways to Work" heading and the mode cards from. We count the top-level
 * `title:` keys inside the returned array (one per mode object), so adding or
 * removing a mode automatically moves this number.
 */
function canonicalModeCount(welcomeSrc: string): number {
  const m = welcomeSrc.match(/function buildModes\([^)]*\)\s*:\s*ModeData\[\]\s*\{([\s\S]*?)\n\}/);
  if (!m) return -1;
  const body = m[1];
  // Mode objects sit at 4-space indent inside `return [ ... ]`.
  return [...body.matchAll(/^\s{4}title:\s*/gm)].length;
}

describe('docs sync-guard (C): generated counts === real source counts', () => {
  it('generated mcp-servers.json section count === real oap-*-mcp dir count', async () => {
    const real = await countDirs(resolve(REPO_ROOT, 'services', 'mcps'), /^oap-.*-mcp$/);
    expect(real).toBeGreaterThanOrEqual(14);
    const gen = await readGenerated('mcp-servers.json');
    expect(gen.sections.length).toBe(real);
  });

  it('generated agent-types.json item count === real built-in agent *.md count', async () => {
    const agentDir = resolve(REPO_ROOT, 'services', 'openagentic-api', 'src', 'agents', 'built-in');
    const realMd = await countFiles(agentDir, '.md');
    expect(realMd).toBeGreaterThanOrEqual(8);
    // extractor (what the generator would emit) tracks the real md set …
    const extracted = await agentTypes({
      dir: 'services/openagentic-api/src/agents/built-in',
    })(REPO_ROOT);
    expect(itemCount(extracted)).toBe(realMd);
    // … and the on-disk generated JSON matches it too.
    const gen = await readGenerated('agent-types.json');
    expect(itemCount(gen)).toBe(realMd);
  });

  it('generated node-types.json item count === extractor (registry minus deny) count', async () => {
    const extracted = await workflowNodes({
      registryPath: 'services/shared/workflow-engine/src/nodes/registry.ts',
      schemaDir: 'services/shared/workflow-engine/src/nodes',
      deny: REMOVED_NODE_TYPES,
    })(REPO_ROOT);
    const realNodeCount = itemCount(extracted);
    expect(realNodeCount).toBeGreaterThanOrEqual(50);
    const gen = await readGenerated('node-types.json');
    expect(itemCount(gen)).toBe(realNodeCount);
  });
});

describe('docs sync-guard (D): stated mode count === canonical modes list', () => {
  const WELCOME = resolve(DOCS_SRC, 'pages', 'WelcomePage.tsx');

  it('canonical modes list (buildModes) has exactly TWO modes', async () => {
    const src = await readFile(WELCOME, 'utf-8');
    expect(canonicalModeCount(src)).toBe(2);
  });

  it('the "Ways to Work" heading is DERIVED from modes.length, not hardcoded', async () => {
    const src = await readFile(WELCOME, 'utf-8');
    // The heading must render the count from the canonical list …
    expect(src).toMatch(/\{numberWord\(modes\.length\)\}\s*Ways to Work/);
    // … and must NOT hardcode an English number-word in front of "Ways to Work".
    expect(src).not.toMatch(/\b(One|Two|Three|Four|Five)\s+Ways to Work/);
  });
});
