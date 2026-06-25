/**
 * Architecture cage — no model_config.{chatModel,embeddingModel,...} runtime reads.
 *
 * the design notes
 * the design notes
 *
 * The Registry SoT v1 contract: per-provider JSONB role-pin fields (chatModel,
 * embeddingModel, codeModel, defaultModel, visionModel, imageModel,
 * compactionModel, additionalModels, disabledModels) are RETIRED. They get
 * nulled in F6 and dropped in F7. No code in the routing path may read them.
 *
 * EXPECTED INITIAL STATE: this test lands RED with documented violations
 * (admin-ollama.ts:100 reads model_config.chatModel, ModelConfigurationService
 * reads role-pins for legacy candidate-pool building, OllamaModelSyncService
 * reads/writes them, etc.). Phase F6 closes them; F7 drops the columns.
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
  field: string;
}

const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  // Snake-case access on the model_config JSONB
  { pattern: /\bmodel_config\.chatModel\b/, field: 'model_config.chatModel' },
  { pattern: /\bmodel_config\.embeddingModel\b/, field: 'model_config.embeddingModel' },
  { pattern: /\bmodel_config\.codeModel\b/, field: 'model_config.codeModel' },
  { pattern: /\bmodel_config\.defaultModel\b/, field: 'model_config.defaultModel' },
  { pattern: /\bmodel_config\.visionModel\b/, field: 'model_config.visionModel' },
  { pattern: /\bmodel_config\.imageModel\b/, field: 'model_config.imageModel' },
  { pattern: /\bmodel_config\.compactionModel\b/, field: 'model_config.compactionModel' },
  { pattern: /\bmodel_config\.additionalModels\b/, field: 'model_config.additionalModels' },
  { pattern: /\bmodel_config\.disabledModels\b/, field: 'model_config.disabledModels' },
  // Camel-case alias `mc.*Model` reads (common destructure: `const mc = provider.model_config`)
  { pattern: /\bmc\.chatModel\b/, field: 'mc.chatModel (alias of model_config.chatModel)' },
  { pattern: /\bmc\.embeddingModel\b/, field: 'mc.embeddingModel' },
  { pattern: /\bmc\.codeModel\b/, field: 'mc.codeModel' },
  { pattern: /\bmc\.defaultModel\b/, field: 'mc.defaultModel' },
  { pattern: /\bmc\.visionModel\b/, field: 'mc.visionModel' },
  { pattern: /\bmc\.imageModel\b/, field: 'mc.imageModel' },
  { pattern: /\bmc\.compactionModel\b/, field: 'mc.compactionModel' },
  { pattern: /\bmodelConfig\.chatModel\b/, field: 'modelConfig.chatModel' },
  { pattern: /\bmodelConfig\.embeddingModel\b/, field: 'modelConfig.embeddingModel' },
  { pattern: /\bmodelConfig\.codeModel\b/, field: 'modelConfig.codeModel' },
  { pattern: /\bmodelConfig\.defaultModel\b/, field: 'modelConfig.defaultModel' },
  { pattern: /\bmodelConfig\.visionModel\b/, field: 'modelConfig.visionModel' },
  { pattern: /\bmodelConfig\.imageModel\b/, field: 'modelConfig.imageModel' },
  { pattern: /\bmodelConfig\.compactionModel\b/, field: 'modelConfig.compactionModel' },
  { pattern: /\bmodelConfig\.additionalModels\b/, field: 'modelConfig.additionalModels' },
  { pattern: /\bmodelConfig\.disabledModels\b/, field: 'modelConfig.disabledModels' },
];

/**
 * Files where role-pin reads are explicitly allowed.
 * - RegistryBootstrapSeeder: F2 reads-once-and-nulls during backfill
 * - ProviderQualifier helpers / migration shims (none yet — add as we go)
 *
 * Paths are relative to services/openagentic-api/src/.
 */
const ALLOW_LIST_PREFIXES: string[] = [
  'services/model-routing/RegistryBootstrapSeeder.ts',
  // Migration shim files added during F4-F6 may need allow-listing temporarily.
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
  field: string;
  line: number;
}

describe('Registry SoT v1 cage — no model_config.*Model JSONB role-pin runtime reads', () => {
  it('all source files (excluding allow-list) read role-models via resolveModel(), not JSONB', () => {
    const violations: Violation[] = [];

    for (const filePath of walkSource(SRC)) {
      const rel = relative(SRC, filePath);
      if (ALLOW_LIST_PREFIXES.some(prefix => rel.startsWith(prefix))) continue;

      const src = readFileSync(filePath, 'utf8');
      const lines = src.split('\n');

      for (const { pattern, field } of FORBIDDEN_PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            violations.push({ file: rel, field, line: i + 1 });
          }
        }
      }
    }

    const summary = violations.length === 0
      ? ''
      : `\n${violations.length} forbidden JSONB role-pin read(s):\n` +
        violations.map(v => `  ${v.file}:${v.line} reads ${v.field}`).join('\n') +
        `\n\nFix: route through resolveModel({role: '...'}) the design notes\n` +
        `If this file is genuinely a backfill shim, add it to ALLOW_LIST_PREFIXES with justification.`;

    expect(violations, summary).toEqual([]);
  });
});
