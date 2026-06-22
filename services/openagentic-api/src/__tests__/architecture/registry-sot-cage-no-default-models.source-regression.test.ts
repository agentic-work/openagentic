/**
 * Architecture cage — no system_configuration.default_models reads.
 *
 * the design notes
 * the design notes
 *
 * The Registry SoT v1 contract: the secondary SoT row at
 * system_configuration.default_models JSONB ({chat, code, embedding, vision,
 * imageGen}) is RETIRED. Defaults come from Registry queries:
 *   findFirst({role, enabled:true}, orderBy:{priority:asc})
 *
 * EXPECTED INITIAL STATE: this test lands RED with documented violations
 * (ModelConfigurationService.ts reads default_models for getDefaultCodeModel
 * fallback; routes/admin/llm-providers.ts has GET + PUT handlers; UI panel
 * consumes it). Phase F4 closes them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

interface ForbiddenPattern {
  pattern: RegExp;
  description: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  // Direct string-literal Prisma queries on the system_configuration row
  { pattern: /['"`]default_models['"`]/, description: "string literal 'default_models' (Prisma key)" },
  // The legacy helper that reads the row
  { pattern: /\bgetDefaultModels\s*\(\s*\)/, description: 'getDefaultModels() helper call' },
  // Any property access pattern that evidences reading the JSONB shape
  { pattern: /\bdefault_models\.(chat|code|embedding|vision|imageGen)\b/, description: 'default_models.{role} JSONB read' },
];

/**
 * Files where these reads are allowed during the migration window.
 * - The F4 migration shim that reads-once-and-nulls is the only legitimate consumer.
 * - F4 lands a small backfill helper; until then no allowances.
 *
 * Paths are relative to services/openagentic-api/src/.
 */
const ALLOW_LIST_PREFIXES: string[] = [
  // F4 migration shim filename will go here when written.
  // For now: zero allow-list entries — every match is a violation to close in F4.
];

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
  description: string;
  line: number;
}

describe('Registry SoT v1 cage — no system_configuration.default_models reads', () => {
  it('all source files (excluding F4 migration shim) read defaults from Registry, not system_configuration', () => {
    const violations: Violation[] = [];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      if (ALLOW_LIST_PREFIXES.some(prefix => rel.startsWith(prefix))) continue;

      const src = readFileSync(filePath, 'utf8');
      const lines = src.split('\n');

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, description, line: i + 1 });
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden default_models reference(s):\n` +
        violations.map(v => `  ${v.file}:${v.line} — ${v.description}`).join('\n') +
        `\n\nFix: Phase F4 retires system_configuration.default_models. Read from Registry:\n` +
        `  prisma.modelRoleAssignment.findFirst({ where: { role, enabled: true }, orderBy: { priority: 'asc' } })\n` +
        `Or call resolveModel({ role: 'chat'|'code'|'embedding'|... }) — the design notes`;

    expect(violations, summary).toEqual([]);
  });
});
