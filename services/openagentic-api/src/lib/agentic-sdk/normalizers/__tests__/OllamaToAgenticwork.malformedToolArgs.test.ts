/**
 * B4 — api-side mirror of the SDK malformed-tool-args test.
 *
 * The api ships its own copy of OllamaToOpenagentic.ts under
 * src/lib/agentic-sdk/normalizers/ (vendored snapshot from openagentic-sdk).
 * This test pins the same B4 behavior on the vendored copy so the upstream
 * fix has to land in both files before this test goes GREEN.
 *
 * See <internal-sdk>/.../OllamaToOpenagentic.malformedToolArgs.test.ts
 * for the canonical version + reasoning.
 */
import { describe, it, expect } from 'vitest';
import { loadNdjsonFixture } from './fixtures/loader.js';

import { createOllamaToOpenagenticNormalizer } from '../OllamaToOpenagentic.js';
import type { CanonicalEvent } from '../CanonicalEvent.js';

function normalize(chunks: any[]): CanonicalEvent[] {
  const n = createOllamaToOpenagenticNormalizer({
    messageId: 'msg_test',
    model: 'gpt-oss:20b',
  });
  const events: CanonicalEvent[] = [];
  for (const c of chunks) {
    for (const ev of n.consume(c as any)) events.push(ev);
  }
  for (const ev of n.finalize()) events.push(ev);
  return events;
}

describe('api OllamaToOpenagenticNormalizer — malformed tool_calls.arguments (B4)', () => {
  it('does NOT throw on malformed arguments string', () => {
    const chunks = loadNdjsonFixture('ollama-malformed-args-real.ndjson');
    expect(() => normalize(chunks)).not.toThrow();
  });

  it('flags the tool_use block with __malformed_args=true', () => {
    const chunks = loadNdjsonFixture('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const toolUseStart = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'content_block_start' }> =>
        e.type === 'content_block_start' && e.content_block.type === 'tool_use',
    );
    expect(toolUseStart).toBeDefined();
    if (toolUseStart && toolUseStart.content_block.type === 'tool_use') {
      expect((toolUseStart.content_block.input as any).__malformed_args).toBe(true);
    }
  });

  it('emits stop_reason=tool_use so chatLoop can pair with synthetic tool_result', () => {
    const chunks = loadNdjsonFixture('ollama-malformed-args-real.ndjson');
    const events = normalize(chunks);
    const messageDelta = events.find(
      (e): e is Extract<CanonicalEvent, { type: 'message_delta' }> =>
        e.type === 'message_delta',
    );
    expect(messageDelta).toBeDefined();
    expect(messageDelta!.delta.stop_reason).toBe('tool_use');
  });
});
