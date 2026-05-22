/**
 * Architecture pin — Workstream D, Phase D-2 (per-provider normalizer wire-in).
 *
 * Each LLM provider's streamCompletion path MUST consume native chunks through
 * an SDK normalizer instance — `selectCanonicalNormalizer(format, opts)` or one
 * of the per-format `create*ToOpenagenticNormalizer` factories — and forward
 * the resulting `CanonicalEvent[]` rather than emitting hand-rolled translations.
 *
 * Single-accumulator-per-stream pattern, mirrors Anthropic claude.ts:1997-2111.
 *
 * Plan: docs/superpowers/plans/2026-05-05-chatmode-100-percent-accuracy-implementation.md
 *       Workstream D, Phase D-2.
 * Source: docs/research/2026-05-05-sdk-wire-in-plan.md §"Phase D-2: provider-side wire-in".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROVIDERS = join(__dirname, '../../services/llm-providers');

function readProvider(name: string): string {
  return readFileSync(join(PROVIDERS, `${name}.ts`), 'utf8');
}

describe('D-2.1 — AnthropicProvider streams through SDK normalizer', () => {
  it('imports selectCanonicalNormalizer or createAnthropicShapeToOpenagenticNormalizer from the SDK', () => {
    const src = readProvider('AnthropicProvider');
    // After Step-1 consolidation, the SoT is the SDK package
    // `@agentic-work/llm-sdk`. Legacy api-local paths are kept as
    // alternates only for transitional periods (caged by
    // `no-api-vendored-sdk.source-regression.test.ts`).
    const importsFactory =
      /from\s+['"]@agentic-work\/llm-sdk[^'"]*['"]/.test(src) ||
      /from\s+['"]\.\/canonicalNormalizer\.js['"]/.test(src) ||
      /from\s+['"]\.\/normalizers\/index\.js['"]/.test(src) ||
      /from\s+['"]\.\/normalizers\/AnthropicShapeToOpenagentic\.js['"]/.test(src);
    expect(importsFactory).toBe(true);
  });

  it('constructs a normalizer in the streaming completion path', () => {
    const src = readProvider('AnthropicProvider');
    // Either factory call should appear in the streaming path.
    const usesFactory =
      /selectCanonicalNormalizer\s*\(/.test(src) ||
      /createAnthropicShapeToOpenagenticNormalizer\s*\(/.test(src);
    expect(usesFactory).toBe(true);
  });

  it('feeds native chunks through normalizer.consume()', () => {
    const src = readProvider('AnthropicProvider');
    // The wire-in pattern is `for await (...) { ...normalizer.consume(event) }`.
    // We allow the call site to be `.consume(` regardless of variable name.
    expect(src).toMatch(/\.consume\s*\(/);
  });

  it('flushes normalizer state via finalize() at stream end', () => {
    const src = readProvider('AnthropicProvider');
    expect(src).toMatch(/\.finalize\s*\(\s*\)/);
  });
});
