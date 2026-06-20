/**
 * SDK contract — `selectCanonicalNormalizer(format, opts)` dispatches across
 * the full `CanonicalStreamFormat` 8-value union, returning the per-format
 * factory implementation.
 *
 * This is the consolidation target: the openagentic-api previously invented
 * its own dispatcher at `services/openagentic-api/src/services/llm-providers/
 * canonicalNormalizer.ts` — the SDK is the SoT, the api consumes from here.
 *
 * the design notes
 *       Workstream D, Step 1 (SDK consolidation, substep A1).
 */
import { describe, it, expect } from 'vitest';
import {
  selectCanonicalNormalizer,
  type CanonicalStreamFormat,
} from '../select.js';

const ALL_FORMATS: CanonicalStreamFormat[] = [
  'anthropic',
  'bedrock-anthropic',
  'vertex-anthropic',
  'foundry-anthropic',
  'ollama',
  'openai',
  'gemini',
  'aif-responses',
];

describe('selectCanonicalNormalizer — SDK factory dispatch', () => {
  it('exports the CanonicalStreamFormat union with all 8 members', () => {
    // Compile-time check: assigning each member to the union type
    // would error if the union were missing one. Runtime check is
    // surface — the array length proves coverage in the test.
    expect(ALL_FORMATS).toHaveLength(8);
    expect(new Set(ALL_FORMATS).size).toBe(8);
  });

  it.each(ALL_FORMATS)('returns a usable normalizer for format=%s', (format) => {
    const norm = selectCanonicalNormalizer(format, {
      messageId: 'msg_test',
      model: 'test-model',
    });
    expect(typeof norm.consume).toBe('function');
    expect(typeof norm.finalize).toBe('function');
  });

  it('throws on an unknown format (exhaustive switch)', () => {
    // Cast through any to bypass TS exhaustive check — proves the
    // runtime guard fires.
    expect(() =>
      selectCanonicalNormalizer('not-a-real-format' as any, {
        messageId: 'msg_test',
      }),
    ).toThrow(/unsupported stream format/i);
  });

  it('passes messageId + model through to the underlying normalizer', () => {
    // Anthropic-shape passthrough exposes message_start synthesis when the
    // input lacks one — feed in a content_block event and observe that the
    // synthesized message_start carries our messageId + model.
    const norm = selectCanonicalNormalizer('anthropic', {
      messageId: 'msg_passthrough_check',
      model: 'claude-test',
    });
    const events = norm.consume({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as any);
    const messageStart = events.find((e: any) => e.type === 'message_start') as any;
    expect(messageStart).toBeDefined();
    expect(messageStart.message.id).toBe('msg_passthrough_check');
    expect(messageStart.message.model).toBe('claude-test');
  });
});
