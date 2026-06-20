/**
 * Discovery-catalog indexing resilience — the read collection (`mcp_tools_cache`,
 * which `tool_search`/`searchTools` and `getTool` both query) must get
 * populated at boot even when a single MCP tool carries a pathological,
 * over-long description.
 *
 * Two guarantees pinned here, both at the indexer layer (NOT just inside the
 * embedding provider, which already caps — we want the cap applied at the
 * point the indexer builds the combined embedding input, so the input is
 * bounded before it ever leaves ToolSemanticCacheService):
 *
 *  1. `buildToolEmbeddingText(name, description, syntheticQueries)` caps the
 *     combined input to EMBEDDING_INPUT_MAX_CHARS via the shared
 *     embeddingInputCap helper. A 50k-char `read_documentation`-style
 *     description can no longer push the embed call past the model's context
 *     window and 500 the whole indexing run.
 *
 *  2. The combined text still leads with the most-discriminative signal — the
 *     tool name and the start of the description — so semantic discovery still
 *     matches after truncation.
 *
 * Live failure this guards against (openagentic, 2026-06-01): a single oversized
 * tool description 500'd the batch embed call and left `mcp_tools_cache` empty,
 * so `tool_search` returned nothing and no model could discover/call any MCP
 * tool.
 */
import { describe, it, expect } from 'vitest';
import {
  buildToolEmbeddingText,
} from '../ToolSemanticCacheService.js';
import { EMBEDDING_INPUT_MAX_CHARS } from '../embeddingInputCap.js';

describe('buildToolEmbeddingText — indexer-layer embedding input cap', () => {
  it('passes short tools through under the cap', () => {
    const text = buildToolEmbeddingText(
      'web_search',
      'Search the public web and return ranked results.',
      ['search the web', 'find pages'],
    );
    expect(text.length).toBeLessThanOrEqual(EMBEDDING_INPUT_MAX_CHARS);
    expect(text).toContain('web_search');
    expect(text).toContain('Search the public web');
    expect(text).toContain('search the web');
  });

  it('caps a pathological 50k-char description at EMBEDDING_INPUT_MAX_CHARS', () => {
    // aws_knowledge read_documentation-style: one tool with an enormous body.
    const huge = 'A'.repeat(50_000);
    const text = buildToolEmbeddingText('read_documentation', huge, []);
    expect(text.length).toBe(EMBEDDING_INPUT_MAX_CHARS);
  });

  it('leads with the tool name so the most-discriminative signal survives truncation', () => {
    const huge = 'Z'.repeat(50_000);
    const text = buildToolEmbeddingText('read_documentation', huge, ['read docs']);
    // The name prefix must be at the very front (not truncated away).
    expect(text.startsWith('Tool: read_documentation')).toBe(true);
    expect(text.length).toBe(EMBEDDING_INPUT_MAX_CHARS);
  });

  it('is null/undefined-safe and never throws', () => {
    expect(() => buildToolEmbeddingText('t', undefined as any, undefined as any)).not.toThrow();
    const text = buildToolEmbeddingText('t', undefined as any, undefined as any);
    expect(typeof text).toBe('string');
    expect(text).toContain('Tool: t');
  });

  it('handles an oversized synthetic-query tail without exceeding the cap', () => {
    const queries = Array.from({ length: 5000 }, (_, i) => `synthetic query ${i}`);
    const text = buildToolEmbeddingText('list_things', 'List things.', queries);
    expect(text.length).toBeLessThanOrEqual(EMBEDDING_INPUT_MAX_CHARS);
    // Name + description (the high-signal head) still present.
    expect(text).toContain('Tool: list_things');
    expect(text).toContain('List things.');
  });
});
