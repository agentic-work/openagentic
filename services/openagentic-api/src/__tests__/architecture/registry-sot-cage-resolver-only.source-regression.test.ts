/**
 * Architecture cage — only resolveModel.ts may call legacy lookup functions.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F1.8)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * Once F1's `resolveModel()` accessor lands, every consumer in the platform
 * MUST go through it. The legacy lookup helpers (`getDefaultChatModel`,
 * `getDefaultCodeModel`, `getDefaultEmbeddingModel`, `listRegistryCandidatePool`)
 * exist only as internal implementation details that resolveModel() composes —
 * direct calls from anywhere else cause routing drift between the documented
 * Registry contract and what services actually run.
 *
 * EXPECTED INITIAL STATE: this test lands RED with documented violations.
 * F3 closes each violation by routing every consumer through
 * `resolveModel({role: '...'})`. When F3 finishes the test goes GREEN and
 * the cage holds for all future commits.
 *
 * The pre-commit hook (scripts/pre-commit.sh) runs the architecture suite
 * before every commit, so re-introducing a direct legacy call gets caught
 * before it lands.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

/**
 * Forbidden legacy lookup function names. Match call expressions and import
 * specifiers — we don't want anyone reaching for these from outside the
 * resolver path.
 */
const FORBIDDEN_LEGACY_CALLS: Array<{ pattern: RegExp; name: string }> = [
  // Function-call-site patterns: `getDefaultChatModel(`, `.getDefaultChatModel(`
  { pattern: /\bgetDefaultChatModel\s*\(/, name: 'getDefaultChatModel' },
  { pattern: /\bgetDefaultCodeModel\s*\(/, name: 'getDefaultCodeModel' },
  { pattern: /\bgetDefaultEmbeddingModel\s*\(/, name: 'getDefaultEmbeddingModel' },
  { pattern: /\blistRegistryCandidatePool\s*\(/, name: 'listRegistryCandidatePool' },
  // Import-specifier patterns — catches `import { getDefaultChatModel } from ...`
  { pattern: /\bgetDefaultChatModel\b\s*[,}]/, name: 'getDefaultChatModel (import)' },
  { pattern: /\bgetDefaultCodeModel\b\s*[,}]/, name: 'getDefaultCodeModel (import)' },
  { pattern: /\bgetDefaultEmbeddingModel\b\s*[,}]/, name: 'getDefaultEmbeddingModel (import)' },
  { pattern: /\blistRegistryCandidatePool\b\s*[,}]/, name: 'listRegistryCandidatePool (import)' },
];

/**
 * Files allowed to call the legacy helpers. Tight allow-list:
 *
 * - resolveModel.ts: the new universal accessor that wraps these helpers (F1.5
 *   for SmartRouter scoring — but via injected deps, not direct call). May call
 *   them in transitional shim code through F3.
 * - The legacy helpers' own definition files. They define themselves; not a
 *   "call from outside" violation.
 * - RegistryBootstrapSeeder.ts: F2's seeder may call legacy helpers during
 *   migration window before F3 swaps them.
 *
 * Paths are relative to services/openagentic-api/src/.
 */
const ALLOW_LIST = new Set<string>([
  'services/model-routing/resolveModel.ts',
  'services/model-routing/RegistryCandidatePool.ts',           // defines listRegistryCandidatePool
  'services/model-routing/defaultModelsAdmin.ts',              // defines getDefault* helpers (legacy)
  'services/model-routing/RegistryBootstrapSeeder.ts',         // F2 seeder transitional
  'services/llm-providers/UniversalEmbeddingService.ts',       // already on env-var allow-list; same bootstrap role
]);

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist' || entry === 'generated') continue;
      yield* walkSource(p);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      yield p;
    }
  }
}

interface Violation {
  file: string;
  callee: string;
  line: number;
}

describe('Registry SoT v1 cage — only resolveModel.ts (and seeder) may call legacy lookup helpers', () => {
  it('all source files (excluding allow-list) read models via resolveModel(), not legacy helpers', () => {
    const violations: Violation[] = [];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      if (ALLOW_LIST.has(rel)) continue;

      const src = readFileSync(filePath, 'utf8');
      const lines = src.split('\n');

      for (const { pattern, name } of FORBIDDEN_LEGACY_CALLS) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, callee: name, line: i + 1 });
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden legacy lookup call(s) — these must go through resolveModel():\n` +
        violations.map(v => `  ${v.file}:${v.line} uses ${v.callee}`).join('\n') +
        `\n\nFix: replace with resolveModel({role: 'chat'|'code'|'embedding'|...}) per ` +
        `docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md.\n` +
        `If this file is a genuine bootstrap shim, add to ALLOW_LIST in this test file with justification.`;

    expect(violations, summary).toEqual([]);
  });
});
