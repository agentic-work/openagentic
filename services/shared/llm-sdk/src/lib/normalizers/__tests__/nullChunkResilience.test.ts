/**
 * Malformed-chunk resilience — every normalizer's `consume()` must tolerate a
 * null / undefined / non-object chunk WITHOUT throwing.
 *
 * Why this is a real hazard, not a synthetic one:
 *   - SSE / NDJSON transport layers occasionally hand the normalizer a line
 *     that JSON-parsed to `null` (a bare `null\n` keep-alive, a truncated
 *     frame, a double-newline that yields an empty parse). The provider
 *     wrapper iterates parsed lines and feeds each to consume() — a single
 *     `null` line was crashing the entire stream with
 *     "Cannot read properties of null (reading 'usage'|'message'|...)".
 *   - A crash mid-stream is the worst failure mode: the partial assistant
 *     turn already rendered to the user is abandoned with an unhandled
 *     TypeError instead of degrading to a clean finalize().
 *
 * Contract: consume(garbage) is a NO-OP that returns an array (never throws).
 * finalize() must STILL close the message cleanly afterward.
 */
import { describe, it, expect } from 'vitest';
import { createOpenAIToOpenagenticNormalizer } from '../OpenAIToOpenagentic.js';
import { createOllamaToOpenagenticNormalizer } from '../OllamaToOpenagentic.js';
import { createVertexGeminiToOpenagenticNormalizer } from '../VertexGeminiToOpenagentic.js';
import {
  createBedrockToOpenagenticNormalizer,
} from '../AnthropicShapeToOpenagentic.js';
import { createAIFResponsesToOpenagenticNormalizer } from '../AIFResponsesToOpenagentic.js';
import { createGemmaToOpenagenticNormalizer } from '../GemmaToOpenagentic.js';

const GARBAGE: unknown[] = [null, undefined, 42, 'str', [], true];

const factories: Array<{ name: string; make: () => any }> = [
  { name: 'OpenAI', make: () => createOpenAIToOpenagenticNormalizer({ messageId: 'm' }) },
  { name: 'Ollama', make: () => createOllamaToOpenagenticNormalizer({ messageId: 'm' }) },
  { name: 'VertexGemini', make: () => createVertexGeminiToOpenagenticNormalizer({ messageId: 'm' }) },
  { name: 'AnthropicShape', make: () => createBedrockToOpenagenticNormalizer({ messageId: 'm' }) },
  { name: 'AIFResponses', make: () => createAIFResponsesToOpenagenticNormalizer({ messageId: 'm' }) },
  { name: 'Gemma', make: () => createGemmaToOpenagenticNormalizer({ messageId: 'm' }) },
];

describe('normalizer null/garbage chunk resilience', () => {
  for (const { name, make } of factories) {
    for (const g of GARBAGE) {
      it(`${name}: consume(${JSON.stringify(g) ?? 'undefined'}) does not throw`, () => {
        const n = make();
        expect(() => n.consume(g)).not.toThrow();
      });
    }

    it(`${name}: finalize() still closes the message cleanly after a garbage chunk`, () => {
      const n = make();
      n.consume(null);
      const tail = n.finalize();
      const types = tail.map((e: any) => e.type);
      // finalize must always terminate the canonical envelope.
      expect(types).toContain('message_stop');
    });
  }
});
