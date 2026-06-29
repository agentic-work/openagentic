/**
 * H3 source-regression cage — ModelConfigurationService must not infer
 * tier/quality from substring patterns. Tier = `m.priority` from
 * admin.model_role_assignments (registry SoT), not `model.includes('opus')`
 * etc.
 *
 * Audit (project_provider_model_sot_audit_2026_05_05.md): the
 * `getModelQualityScore(modelId)` helper at lines 706-728 inferred quality
 * via 17 substring patterns. This commit deletes it.
 *
 * Other substring sniffs in this file (image-only filter, embeddingModels
 * detection in assignServicesToModels, cheapModel finder) are out of scope
 * for H3 — those are tracked separately in the audit memo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../ModelConfigurationService.ts');

describe('ModelConfigurationService — no quality-score substring inference (H3)', () => {
  it('source has no `getModelQualityScore` helper or its substring patterns', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const lines = src.split('\n');

    // The signature line we want gone.
    const helperHits = lines
      .map((l, i) => ({ line: i + 1, text: l }))
      .filter(({ text }) => /\bgetModelQualityScore\b/.test(text));

    // The 'opus'/'sonnet'/'gpt-5'/etc substring sniffs in tier scoring
    // — they have a number return, signature `return \d+`. Match that
    // pattern shape narrowly to avoid catching legitimate uses elsewhere.
    const scoreLineRe = /modelLower\.includes\(['"]\w[^'"]*['"]\)\s*\)\s*return\s+\d+/;
    const scoreHits = lines
      .map((l, i) => ({ line: i + 1, text: l }))
      .filter(({ text }) => scoreLineRe.test(text));

    const allHits = [...helperHits, ...scoreHits];
    const summary = allHits.length === 0
      ? ''
      : `\nFound ${allHits.length} H3 violation(s):\n` +
        allHits.map(h => `  L${h.line}: ${h.text.trim()}`).join('\n') +
        `\n\nFix: sort by m.priority directly. ModelAssignment carries the ` +
        `registry's priority column; that's the operator's truth, not a guess.`;

    expect(allHits, summary).toEqual([]);
  });
});
