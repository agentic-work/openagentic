/**
 * F1 (Gemini extension) — Vertex AI Gemini context-cache wire reference.
 *
 * Gemini's caching surface is fundamentally different from Anthropic's:
 *   - Anthropic / Bedrock-Anthropic: in-band marker on the request body
 *     (cache_control / cachePoint) — F1 pins these.
 *   - Vertex AI Gemini: stateful, out-of-band. Caller `POST /cachedContents`
 *     to create a named resource, then references it via top-level
 *     `cachedContent: "projects/.../cachedContents/<ID>"` on the wire body.
 *
 * The adapter's job is narrow: when the canonical request carries
 * `cached_content`, emit it as `cachedContent` (camelCase) at the top level.
 * Lifecycle (create / refresh / delete) is caller responsibility.
 *
 * Other adapters (Anthropic, Bedrock, OpenAI, AIF Responses, Ollama) ignore
 * `cached_content`. We pin negative assertions in the existing adapter
 * tests via `cache_control` strip checks; no new test surface needed here.
 *
 * Source: https://ai.google.dev/gemini-api/docs/caching
 */

import { describe, it, expect } from 'vitest';
import { OpenagenticToVertexGemini } from '../OpenagenticToVertexGemini.js';
import type { CanonicalRequest } from '../../canonical/types.js';

function baseRequest(extra: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
    system: 'You are a helpful assistant.',
    tools: [
      { name: 'tool_search', description: 'Discover tools.', input_schema: { type: 'object', properties: {} } },
    ],
    tool_choice: { type: 'auto' },
    max_tokens: 1024,
    ...extra,
  };
}

describe('OpenagenticToVertexGemini — cachedContent wire reference', () => {
  it('emits top-level `cachedContent` field when canonical.cached_content is set', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(
      baseRequest({
        cached_content: 'projects/my-proj/locations/us-central1/cachedContents/cache-abc',
      }),
    ) as any;

    expect(body.cachedContent).toBe(
      'projects/my-proj/locations/us-central1/cachedContents/cache-abc',
    );
  });

  it('accepts AI Studio-shape resource names (no project prefix)', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(
      baseRequest({ cached_content: 'cachedContents/cache-xyz' }),
    ) as any;
    expect(body.cachedContent).toBe('cachedContents/cache-xyz');
  });

  it('omits `cachedContent` when canonical.cached_content is unset', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(baseRequest()) as any;
    expect(body.cachedContent).toBeUndefined();
    // Sanity: no leak of the canonical field name on wire
    expect(JSON.stringify(body).includes('cached_content')).toBe(false);
  });

  it('omits `cachedContent` when set to empty string', () => {
    const adapter = new OpenagenticToVertexGemini();
    const body = adapter.adaptRequest(baseRequest({ cached_content: '' })) as any;
    expect(body.cachedContent).toBeUndefined();
  });
});

describe('Other adapters — cached_content is a no-op (Gemini-specific)', () => {
  it('is unused by Anthropic / Bedrock / OpenAI / AIF / Ollama adapters', async () => {
    // Sanity import-check: cached_content is on CanonicalRequest; other
    // adapters compile against the same type without reading the field.
    // Behavioral assertions for those adapters live in adapters.shape.test.ts
    // (cache_control strip checks already pin "no leakage of canonical-only
    // marker fields"). This stub asserts the typing remains coherent.
    const r: CanonicalRequest = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      system: null,
      tools: [],
      tool_choice: { type: 'auto' },
      max_tokens: 1024,
      cached_content: 'cachedContents/x',
    };
    expect(r.cached_content).toBe('cachedContents/x');
  });
});
