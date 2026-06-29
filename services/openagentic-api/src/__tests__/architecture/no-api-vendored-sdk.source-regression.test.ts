/**
 * Architecture pin — Workstream D, Step 1 (SDK consolidation, substeps A3-A6).
 *
 * openagentic-api MUST consume the openagentic-sdk as a declared dependency,
 * NOT via a hand-vendored copy of the normalizer source files. Specifically:
 *
 *  1. `services/openagentic-api/package.json` declares `@agentic-work/llm-sdk`.
 *  2. Zero source files import from `./canonicalNormalizer.js` (the api-side
 *     factory wrapper that was invented in 2026-05-05 D-0 and is being removed).
 *  3. The vendored `services/openagentic-api/src/services/llm-providers/
 *     canonicalNormalizer.ts` file does NOT exist (rip target).
 *  4. The vendored `services/openagentic-api/src/services/llm-providers/
 *     normalizers/` directory does NOT exist (rip target).
 *
 * SoT: openagentic-sdk owns the canonical normalizer family + the
 * `selectCanonicalNormalizer` factory + the `CanonicalStreamFormat`
 * discriminator. openagentic-api imports from `@agentic-work/llm-sdk`.
 *
 * the design notes
 *       Workstream D, Step 1.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_ROOT = join(__dirname, '../../..');
const API_SRC = join(API_ROOT, 'src');
const PROVIDERS_DIR = join(API_SRC, 'services/llm-providers');

function walkTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const stat = statSync(p);
    if (stat.isDirectory()) {
      // Skip node_modules + dist + cache
      if (['node_modules', 'dist', '.cache', '.turbo'].includes(entry)) continue;
      out.push(...walkTsFiles(p));
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
      out.push(p);
    }
  }
  return out;
}

describe('openagentic-api consumes openagentic-sdk as a dep, not a vendor copy', () => {
  it('package.json declares @agentic-work/llm-sdk', () => {
    const pkg = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8'));
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    expect(allDeps['@agentic-work/llm-sdk']).toBeDefined();
    // Must be either a `file:` link, a `workspace:` ref, or a real version.
    expect(allDeps['@agentic-work/llm-sdk']).toMatch(/^(file:|workspace:|\d|\^|~)/);
  });

  it('no source file imports from ./canonicalNormalizer.js (the ripped api-side wrapper)', () => {
    const offenders: { file: string; line: number; content: string }[] = [];
    // The arch test itself documents the pattern in comments; exclude it
    // from the walk so its self-references don't trip the gate.
    const SELF_PATH = __filename;
    for (const file of walkTsFiles(API_SRC)) {
      if (file === SELF_PATH) continue;
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, idx) => {
        // Skip line comments. Block comments are best-effort skipped — for
        // arch-cage purposes, an `import from '...'` statement inside a
        // block comment is vanishingly rare; ignore the edge.
        if (/^\s*\/\//.test(line)) return;
        // Match: from './canonicalNormalizer.js' or from '../llm-providers/canonicalNormalizer.js'
        if (/from\s+['"][.\/]+canonicalNormalizer(?:\.js)?['"]/.test(line)) {
          offenders.push({
            file: file.replace(API_SRC + '/', ''),
            line: idx + 1,
            content: line.trim(),
          });
        }
      });
    }
    expect(
      offenders,
      `These files still import the ripped api-side canonicalNormalizer — re-point to '@agentic-work/llm-sdk' instead:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('the vendored canonicalNormalizer.ts does NOT exist in api', () => {
    const ripped = join(PROVIDERS_DIR, 'canonicalNormalizer.ts');
    expect(
      existsSync(ripped),
      `${ripped} should be ripped — its factory + types now live in @agentic-work/llm-sdk at lib/normalizers/select.ts`,
    ).toBe(false);
  });

  it('the vendored normalizers/ directory does NOT exist in api', () => {
    const ripped = join(PROVIDERS_DIR, 'normalizers');
    expect(
      existsSync(ripped),
      `${ripped} should be ripped — vendored copy of @agentic-work/llm-sdk/lib/normalizers/. Use the SDK directly.`,
    ).toBe(false);
  });
});
