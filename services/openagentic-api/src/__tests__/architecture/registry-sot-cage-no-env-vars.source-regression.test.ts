/**
 * Architecture cage — no process.env.*_MODEL reads outside the allow-list.
 *
 * Plan: docs/superpowers/plans/2026-05-01-registry-sot-v1.md (Task F0.1)
 * Spec: docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md
 *
 * The Registry SoT v1 contract: model resolution at runtime reads ONLY from
 * admin.model_role_assignments (via resolveModel()). Env-var reads are
 * permitted ONLY in the bootstrap allow-list — files that run once at cold
 * start to seed the Registry from helm values, then never read env again.
 *
 * EXPECTED INITIAL STATE: this test lands RED with documented violations
 * (MCPToolIndexingService.ts:724, DocumentIndexingService.ts:91, etc.).
 * Phase F3 closes each violation by routing every consumer through
 * resolveModel({role:'embedding'}) etc.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..');

const FORBIDDEN_ENV_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /process\.env\.DEFAULT_CHAT_MODEL\b/, name: 'DEFAULT_CHAT_MODEL' },
  { pattern: /process\.env\.DEFAULT_CODE_MODEL\b/, name: 'DEFAULT_CODE_MODEL' },
  { pattern: /process\.env\.DEFAULT_EMBEDDING_MODEL\b/, name: 'DEFAULT_EMBEDDING_MODEL' },
  { pattern: /process\.env\.OLLAMA_CHAT_MODEL\b/, name: 'OLLAMA_CHAT_MODEL' },
  { pattern: /process\.env\.OLLAMA_EMBEDDING_MODEL\b/, name: 'OLLAMA_EMBEDDING_MODEL' },
  { pattern: /process\.env\.EMBEDDING_MODEL\b/, name: 'EMBEDDING_MODEL' },
  { pattern: /process\.env\.EMBEDDING_PROVIDER\b/, name: 'EMBEDDING_PROVIDER' },
  { pattern: /process\.env\.DEFAULT_MODEL\b/, name: 'DEFAULT_MODEL' },
];

/**
 * Files where env-var reads are explicitly allowed.
 * - UniversalEmbeddingService: bootstrap-mode embedding provider config (gated by OPENAGENTIC_BOOTSTRAP_MODE in F3)
 * - ProviderManager: display-only provider listing
 * - LLMProviderSeeder: cold-start provider-row seeding
 * - bootstrapProviderEnv: pure parser of BOOTSTRAP_PROVIDER_* env block
 * - RegistryBootstrapSeeder: F2's idempotent seeder (reads SEEDER_VERSION + bootstrap env)
 * - AdminValidationService: admin-portal probe model (validation only, not routing)
 *
 * Paths are relative to services/openagentic-api/src/.
 */
const ALLOW_LIST = new Set<string>([
  'services/llm-providers/UniversalEmbeddingService.ts',
  'services/llm-providers/ProviderManager.ts',
  'services/LLMProviderSeeder.ts',
  'services/llm-providers/bootstrapProviderEnv.ts',
  'services/model-routing/RegistryBootstrapSeeder.ts',
  'services/AdminValidationService.ts',
]);

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // Skip test directories, generated dirs, node_modules
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist' || entry === 'generated') continue;
      yield* walkSource(p);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      yield p;
    }
  }
}

interface Violation {
  file: string;
  envVar: string;
  line: number;
}

describe('Registry SoT v1 cage — no process.env.*_MODEL reads outside Registry allow-list', () => {
  it('all source files (excluding bootstrap allow-list) read model identifiers via resolveModel(), not env vars', () => {
    const violations: Violation[] = [];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      if (ALLOW_LIST.has(rel)) continue;

      const src = readFileSync(filePath, 'utf8');
      const lines = src.split('\n');

      for (const { pattern, name } of FORBIDDEN_ENV_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, envVar: name, line: i + 1 });
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden env-var model read(s):\n` +
        violations.map(v => `  ${v.file}:${v.line} reads process.env.${v.envVar}`).join('\n') +
        `\n\nFix: route through resolveModel({role: '...'}) per spec docs/superpowers/specs/2026-05-01-registry-sot-v1-design.md\n` +
        `If this file is genuinely bootstrap-only, add it to ALLOW_LIST in this test file with justification.`;

    expect(violations, summary).toEqual([]);
  });
});
