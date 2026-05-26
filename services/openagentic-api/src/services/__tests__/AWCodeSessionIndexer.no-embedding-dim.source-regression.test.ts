/**
 * H9 source-regression cage — AWCodeSessionIndexer must not bake an
 * embedding-dim literal into the Milvus collection schema or the
 * zero-vector fallback. The Milvus collection's `embedding` field
 * MUST take its dim from this.embeddingService.getInfo().dimensions.
 *
 * Per docs/rules/no-hardcoded-models.md §"Embedding dimension assumptions":
 *   const EMBEDDING_DIM = 1536  // pins to OpenAI's text-embedding-ada-002
 *   const EMBEDDING_DIM = 768   // pins to nomic-embed-text / 384-D models
 * Both break when the operator switches the embedding model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOURCE = join(__dirname, '../AWCodeSessionIndexer.ts');

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Module-level/instance const literal pinned to a model dim.
  { pattern: /\b(const|let|var)\s+EMBEDDING_DIM(ENSION|ENSIONS)?\s*=\s*([1-9]\d+)/, description: "module-level embedding-dim constant" },
  // Bare `dim: 768` / `dim: 1536` / `dim: 3072` in a Milvus schema literal.
  { pattern: /\bdim:\s*(768|1024|1536|3072)\b/, description: "bare embedding-dim literal in Milvus schema" },
  // `new Array(768).fill(0)` etc — model-pinned zero-vector fallback.
  { pattern: /new\s+Array\s*\(\s*(768|1024|1536|3072)\s*\)\s*\.fill/, description: "model-pinned zero-vector Array fallback" },
];

describe('AWCodeSessionIndexer — no embedding-dim literal (H9)', () => {
  it('source has no hardcoded embedding-dim', () => {
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
      : `\nFound ${hits.length} embedding-dim violation(s):\n` +
        hits.map(h => `  L${h.line} — ${h.description}\n    ${h.excerpt}`).join('\n') +
        `\n\nFix: read dim from this.embeddingService.getInfo().dimensions ` +
        `at collection-create time and from a stored instance field elsewhere.`;

    expect(hits, summary).toEqual([]);
  });
});
