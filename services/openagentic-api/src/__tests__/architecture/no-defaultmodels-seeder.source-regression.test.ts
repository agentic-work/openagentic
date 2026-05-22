/**
 * Architecture cage — DefaultModelsSeeder.ts must not exist and no source file
 * may import it.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F2.3)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * DefaultModelsSeeder wrote to admin.system_configuration.default_models — the
 * secondary SoT retired by Registry SoT v1. The RegistryBootstrapSeeder
 * (seedRegistryFromHelm) replaces its function. This cage ensures the deleted
 * file does not creep back and no other file takes on a boot-time write to the
 * legacy default_models row via this class.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

const DELETED_FILE = join(SRC, 'services/model-routing/DefaultModelsSeeder.ts');

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'generated') continue;
      yield* walkSource(p);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield p;
    }
  }
}

describe('Registry SoT v1 cage — DefaultModelsSeeder must not exist', () => {
  it('DefaultModelsSeeder.ts file does not exist (was deleted in F2.3)', () => {
    expect(
      existsSync(DELETED_FILE),
      `DefaultModelsSeeder.ts still exists at ${DELETED_FILE} — F2.3 requires it to be deleted.`,
    ).toBe(false);
  });

  it('no source or test file imports or instantiates DefaultModelsSeeder', () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    /**
     * Patterns that indicate a live reference (import or constructor call) to
     * DefaultModelsSeeder, as opposed to a documentation comment explaining the
     * history of the deleted class.
     */
    const LIVE_REFERENCE_PATTERNS: RegExp[] = [
      // Static import: import { DefaultModelsSeeder } from ...
      /\bimport\b[^;]*\bDefaultModelsSeeder\b/,
      // Dynamic import: import('...DefaultModelsSeeder...')
      /\bimport\s*\(\s*['"`][^'"]+DefaultModelsSeeder/,
      // Constructor call: new DefaultModelsSeeder(
      /\bnew\s+DefaultModelsSeeder\s*\(/,
    ];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      // Skip this arch test file itself — its assertion strings mention the name.
      if (rel.includes('no-defaultmodels-seeder')) continue;

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();
        // Skip pure comment lines (// or * prefix) — we allow historical docs.
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        for (const pattern of LIVE_REFERENCE_PATTERNS) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, line: i + 1, text: trimmed.slice(0, 80) });
            break; // one violation per line is enough
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} live import/use reference(s) to deleted DefaultModelsSeeder:\n` +
        violations.map(v => `  ${v.file}:${v.line}  ${v.text}`).join('\n') +
        `\n\nFix: remove all imports/uses of DefaultModelsSeeder — it was deleted in F2.3.\n` +
        `The replacement is seedRegistryFromHelm() from RegistryBootstrapSeeder.ts.`;

    expect(violations, summary).toEqual([]);
  });
});
