/**
 * H12 source-regression cage — MCPToolIndexingService must not carry a
 * hardcoded embedding-dim literal or fall back to `process.env.EMBEDDING_DIMENSION || 'N'`
 * to set the Milvus collection schema. Per docs/rules/no-hardcoded-models.md,
 * dimensions come from embeddingService.getInfo().dimensions.
 *
 * The legitimate path uses `ensureMilvusCollectionWithDimension(name, dim)` at
 * line ~854, called with `embeddingService.getInfo().dimensions`. The dead
 * no-args `ensureMilvusCollection()` at line 420 contained the violating
 * `parseInt(process.env.EMBEDDING_DIMENSION || '768')` literal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../MCPToolIndexingService.ts');

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /process\.env\.EMBEDDING_DIMENSION\s*\|\|\s*['"`]\d+['"`]/, description: "env-fallback embedding-dim literal" },
  { pattern: /\bEMBEDDING_DIM(ENSION|ENSIONS)?\s*=\s*\d+/, description: "module-level embedding-dim constant" },
];

describe('MCPToolIndexingService — no hardcoded embedding-dim (H12)', () => {
  it('source has no env-fallback or module-level embedding-dim literals', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const lines = src.split('\n');
    const hits: Array<{ line: number; description: string; excerpt: string }> = [];
    for (const { pattern, description } of FORBIDDEN_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          hits.push({ line: i + 1, description, excerpt: lines[i].trim() });
        }
      }
    }

    const summary = hits.length === 0
      ? ''
      : `\nFound ${hits.length} hardcoded embedding-dim violation(s):\n` +
        hits.map(h => `  L${h.line} — ${h.description}\n    ${h.excerpt}`).join('\n') +
        `\n\nFix: read dim from this.embeddingService.getInfo().dimensions ` +
        `(see ensureMilvusCollectionWithDimension at line ~854).`;

    expect(hits, summary).toEqual([]);
  });
});
