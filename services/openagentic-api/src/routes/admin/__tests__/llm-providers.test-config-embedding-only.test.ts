/**
 * #577 follow-up #2 — Test Connection must skip inference when the
 * provider only exposes embedding-only models.
 *
 * Live regression captured 2026-05-01: user adds the in-cluster
 * `ollama-embedding` provider (GPU node pod) which serves only
 * `nomic-embed-text:latest`. Test Connection picks `models[0]` and
 * calls Ollama's /api/chat → Ollama returns 400 ("model does not
 * support generate"). UX surfaces a misleading "400 Bad Request"
 * error instead of "this is an embedding-only host."
 *
 * Contract pinned here:
 *   1. The handler exports `isEmbeddingOnlyModel(model)` — recognises
 *      Ollama-shaped { capabilities: { embeddings, chat } }, family
 *      hints (nomic-bert / *-embed-* / mxbai / bge), AND name-based
 *      ("embed" substring case-insensitive) signals.
 *   2. The handler filters embedding-only models out of the testModel
 *      candidate pool before picking models[0]. If only embedding
 *      models remain, the existing "skip inference" branch fires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrcPath = join(__dirname, '..', 'llm-providers.ts');

describe('POST /llm-providers/test-config — embedding-only host (#577 follow-up #2)', () => {
  const src = readFileSync(routeSrcPath, 'utf-8');

  it('exports an isEmbeddingOnlyModel helper', () => {
    expect(src).toMatch(/(?:export\s+)?function\s+isEmbeddingOnlyModel\s*\(/);
  });

  it('filters embedding-only models out of the testModel candidate pool', () => {
    // The pool that feeds testModel must reject embedding-only candidates
    // BEFORE picking models[0].
    const handlerStart = src.indexOf("'/llm-providers/test-config'");
    const nextHandler = src.indexOf('fastify.', handlerStart + 1);
    const block = src.slice(handlerStart, nextHandler > 0 ? nextHandler : handlerStart + 8000);

    expect(block).toMatch(/isEmbeddingOnlyModel/);
  });
});

describe('isEmbeddingOnlyModel — pure helper behavior', () => {
  const importHelper = async () => {
    const mod: any = await import('../llm-providers.js').catch(() => null);
    return mod?.isEmbeddingOnlyModel as ((m: any) => boolean) | undefined;
  };

  it('returns true for nomic-embed-text shape (the live regression)', async () => {
    const fn = await importHelper();
    if (!fn) { expect(fn).toBeDefined(); return; }
    expect(fn({
      id: 'nomic-embed-text:latest',
      name: 'nomic-embed-text:latest',
      capabilities: { chat: true, embeddings: true, tools: false },
      family: 'nomic-bert',
    })).toBe(true);
  });

  it('returns true for *-embed-* model names regardless of capabilities flags', async () => {
    const fn = await importHelper();
    if (!fn) { expect(fn).toBeDefined(); return; }
    expect(fn({ id: 'amazon.titan-embed-text-v1' })).toBe(true);
    expect(fn({ id: 'mxbai-embed-large' })).toBe(true);
    expect(fn({ name: 'bge-large-embed' })).toBe(true);
  });

  it('returns false for chat models (gpt-oss:20b)', async () => {
    const fn = await importHelper();
    if (!fn) { expect(fn).toBeDefined(); return; }
    expect(fn({
      id: 'gpt-oss:20b',
      name: 'gpt-oss:20b',
      capabilities: { chat: true, tools: true, embeddings: false },
      family: 'gptoss',
    })).toBe(false);
  });

  it('returns false for ambiguous models when capabilities mark chat:true with no embedding hint', async () => {
    const fn = await importHelper();
    if (!fn) { expect(fn).toBeDefined(); return; }
    // Model has capabilities { chat:true } but name doesn't contain "embed"
    // and family isn't an embedding family — it's a chat model.
    expect(fn({
      id: 'us.anthropic.claude-sonnet-4-6',
      capabilities: { chat: true, tools: true },
    })).toBe(false);
  });

  it('returns false for null / undefined input (defensive)', async () => {
    const fn = await importHelper();
    if (!fn) { expect(fn).toBeDefined(); return; }
    expect(fn(null)).toBe(false);
    expect(fn(undefined)).toBe(false);
    expect(fn({})).toBe(false);
  });
});
