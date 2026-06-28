/**
 * H10 source-regression cage — SemanticLearningService must not declare a
 * hardcoded embedding-dimension constant. Per docs/rules/no-hardcoded-models.md
 * §"Embedding dimension assumptions" — `const EMBEDDING_DIM = 768/1536/3072`
 * pins a Milvus collection to one model and breaks if the operator switches.
 *
 * Audit (project_provider_model_sot_audit_2026_05_05.md): the constant at
 * line 29 was declared but never read — pure dead code. Just delete it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../SemanticLearningService.ts');

describe('SemanticLearningService — no hardcoded embedding-dimension constant (H10)', () => {
  it('source has no `EMBEDDING_DIM*` numeric literal declaration', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const lines = src.split('\n');
    const hits = lines
      .map((l, i) => ({ line: i + 1, text: l }))
      .filter(({ text }) => /\bEMBEDDING_DIM(ENSION|ENSIONS)?\s*=\s*\d+/.test(text));

    const summary = hits.length === 0
      ? ''
      : `\nFound ${hits.length} hardcoded embedding-dim constant(s):\n` +
        hits.map(h => `  L${h.line}: ${h.text.trim()}`).join('\n') +
        `\n\nFix: read dimensions from embeddingService.getInfo().dimensions ` +
        `(see docs/rules/no-hardcoded-models.md).`;

    expect(hits, summary).toEqual([]);
  });
});
