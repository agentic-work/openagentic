/**
 * Docs sync-guard — the test that makes drift impossible.
 *
 * Two guarantees:
 *
 *   (A) FORBIDDEN STRINGS — no docs source file (or generated manifest) may
 *       reference a REMOVED feature: Code Mode, /api/code, sandbox-exec, the
 *       SandboxSecurityPage, denied node ids, etc. If anyone re-adds Code-Mode
 *       prose or a stale page, this fails with file:line.
 *
 *   (B) SOURCE-MATCH — the generated MCP / flow-template / node-type / service
 *       lists must match the ACTUAL source on disk (count + denylist), proving
 *       the volatile docs are source-derived, not hand-maintained.
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

  beforeAll(async () => {
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
          if (rule.re.test(line)) {
            offenders.push(
              `${relative(REPO_ROOT, file)}:${i + 1} [${rule.name}] ${line.trim().slice(0, 120)}`,
            );
          }
        }
      });
    }
  });

  it('finds zero forbidden Code-Mode / sandbox-exec references in docs + generated manifests', () => {
    expect(offenders, `\n${offenders.join('\n')}`).toEqual([]);
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
