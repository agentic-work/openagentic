/**
 * H11 source-regression cage — ToolSemanticCacheService must not seed
 * `EMBEDDING_DIMENSIONS` with a hardcoded model-pinned literal (768/1536/3072).
 *
 * The init flow at line ~142 already does the right thing:
 *   EMBEDDING_DIMENSIONS = await this.embeddingService.getInfo().dimensions;
 * Per docs/rules/no-hardcoded-models.md, the module-level default must
 * not preempt that — use 0 as a "not-yet-initialized" sentinel so any
 * pre-init read fails the Milvus dim check instead of silently mapping
 * to nomic-embed-text's 768 (or any other model).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../ToolSemanticCacheService.ts');

describe('ToolSemanticCacheService — no model-pinned embedding-dim default (H11)', () => {
  it('module-level EMBEDDING_DIMENSIONS default is not a hardcoded model dim', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const lines = src.split('\n');
    // Match `let EMBEDDING_DIMENSIONS = 768/1536/3072/etc` — i.e. any number
    // from a known model dim. 0 (sentinel) is allowed.
    const re = /\b(let|const|var)\s+EMBEDDING_DIMENSIONS?\s*=\s*([1-9]\d+)/;
    const hits = lines
      .map((l, i) => ({ line: i + 1, text: l }))
      .filter(({ text }) => re.test(text));

    const summary = hits.length === 0
      ? ''
      : `\nFound ${hits.length} model-pinned embedding-dim default(s):\n` +
        hits.map(h => `  L${h.line}: ${h.text.trim()}`).join('\n') +
        `\n\nFix: use 0 as a "not yet initialized" sentinel; init() at ` +
        `~line 142 sets the live value from embeddingService.getInfo().dimensions.`;

    expect(hits, summary).toEqual([]);
  });
});
