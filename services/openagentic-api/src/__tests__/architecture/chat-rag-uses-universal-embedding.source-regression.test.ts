/**
 * Architecture gate: ChatRAGService.generateEmbedding MUST route through
 * UniversalEmbeddingService so ingest and search land on the SAME provider
 * + dim. The pre-2026-05-15 implementation hardcoded a `fetch` to an
 * Ollama URL while the search side (SharedKBService) used
 * UniversalEmbeddingService — different providers, different dims, and
 * ingested chunks were silently unreachable from search.
 *
 * Live evidence captured in execution 83d527dc-0a26-4243-afeb-024e938c428a:
 *   - Ingest log: "[ChatRAG] Ingestion complete ... ingested:1, total:1"
 *     (Ollama nomic-embed-text, 768-dim)
 *   - Search log: "Generated embedding successfully with
 *     UniversalEmbeddingService ... dimensions:3072 ... model:
 *     text-embedding-3-large"
 *   - Net: "[ChatRAG] Knowledge search completed ... sharedResults: 0"
 *
 * This regression guard pins the wiring so a future reviewer can't
 * silently re-introduce the Ollama-only hardcode.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RAG = join(__dirname, '../..', 'services/ChatRAGService.ts');

describe('Architecture: ChatRAGService embedding routes through UniversalEmbeddingService', () => {
  const src = readFileSync(RAG, 'utf8');

  it('generateEmbedding imports UniversalEmbeddingService dynamically', () => {
    expect(src).toMatch(/UniversalEmbeddingService/);
    expect(src).toMatch(/import\(['"]\.\/UniversalEmbeddingService\.js['"]\)/);
  });

  it('generateEmbedding does NOT call a hardcoded fetch to an Ollama URL', () => {
    // Pre-fix shape was: fetch(`${this.embeddingUrl}/api/embeddings`, ...).
    // Pin that anti-pattern out so a future "quick fix" can't bring it back.
    expect(src).not.toMatch(/fetch\(`?\$\{this\.embeddingUrl\}/);
    expect(src).not.toMatch(/embeddingUrl\s*:\s*string/);
  });

  it('comments explain WHY universal-embedding routing is load-bearing', () => {
    // A future maintainer must understand this is not a stylistic choice.
    expect(src.replace(/\s+\/\/\s*/g, ' ').replace(/\s+/g, ' ')).toMatch(/ingest and search use the SAME provider/i);
  });
});
