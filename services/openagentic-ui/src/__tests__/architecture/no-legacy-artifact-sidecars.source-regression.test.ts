/**
 * Architecture gate: the legacy out-of-band artifact sidecars
 * (`visual-renders-strip`, `app-renders-strip`, `artifact-renders-strip`,
 * `setVisualRenders`, `setAppRenders`, and the `VisualRender[]` /
 * `AppRender[]` parent-level useState slots) MUST NOT exist in the
 * source tree. `visual_render` + `app_render` + `artifact_render` wire
 * frames now route through the typed-block path (ContentBlock of type
 * `viz_render` / `app_render`) and render inline inside
 * AgenticActivityStream at the wire-emit chronological position.
 *
 * Any sidecar means artifacts pool at the top or bottom of the message
 * instead of interleaving with the prose + tool calls, which is the
 * Sev-0 narrative-break the typed-block rip fixes.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_ROOT = resolve(__dirname, '../..');
const ARCH_TEST_FILE = resolve(__dirname, 'no-legacy-artifact-sidecars.source-regression.test.ts');

function walkAllSource(dir: string): string[] {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '__tests__'].includes(entry.name)) continue;
      out.push(...walkAllSource(p));
    } else if (
      (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

interface Pattern {
  re: RegExp;
  label: string;
}

const BANNED: ReadonlyArray<Pattern> = [
  { re: /data-testid=["']visual-renders-strip["']/, label: 'visual-renders-strip sidecar' },
  { re: /data-testid=["']app-renders-strip["']/, label: 'app-renders-strip sidecar' },
  { re: /data-testid=["']artifact-renders-strip["']/, label: 'artifact-renders-strip sidecar' },
  { re: /\bsetVisualRenders\b/, label: 'setVisualRenders setter' },
  { re: /\bsetAppRenders\b/, label: 'setAppRenders setter' },
  { re: /\bsetArtifactRenders\b/, label: 'setArtifactRenders setter' },
  { re: /:\s*VisualRender\[\]/, label: 'VisualRender[] parent-level state' },
  { re: /:\s*AppRender\[\]/, label: 'AppRender[] parent-level state' },
  { re: /:\s*ArtifactRender\[\]/, label: 'ArtifactRender[] parent-level state' },
  { re: /useState<VisualRender\[\]>/, label: 'useState<VisualRender[]>' },
  { re: /useState<AppRender\[\]>/, label: 'useState<AppRender[]>' },
  { re: /useState<ArtifactRender\[\]>/, label: 'useState<ArtifactRender[]>' },
];

describe('arch: legacy artifact sidecars are RIPPED', () => {
  it('no source file may declare a legacy artifact sidecar or its state', () => {
    const violations: Array<{ file: string; label: string }> = [];
    for (const file of walkAllSource(SRC_ROOT)) {
      if (file === ARCH_TEST_FILE) continue;
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const codeOnly = stripComments(content);
      for (const { re, label } of BANNED) {
        if (re.test(codeOnly)) {
          violations.push({ file: relative(SRC_ROOT, file), label });
        }
      }
    }
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - [${v.label}] ${v.file}`)
        .join('\n');
      const msg =
        `Legacy artifact sidecars must be ripped. Route visual_render /\n` +
        `app_render / artifact_render through typed ContentBlocks instead.\n\n` +
        `Violations:\n${detail}`;
      expect.fail(msg);
    }
    expect(violations).toEqual([]);
  });
});
