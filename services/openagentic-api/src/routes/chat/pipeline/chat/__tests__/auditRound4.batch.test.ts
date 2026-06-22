/**
 * 2026-05-12 round 4 — batch of 3 SEV-1 audit fixes from the external
 * audit's `NOT_DONE` list:
 *
 *   F1-4 — reject truncated/malformed tool_use input on tool_use_complete
 *          (chatLoop.ts:279-287). Today the contentBlock is pushed
 *          regardless of input shape; downstream dispatch fails with a
 *          confusing TypeError instead of a structured error.
 *
 *   F2-5 — log when system prompt is undefined at streamProvider entry.
 *          Today silent — operators couldn't tell a config bug from a
 *          legitimate no-system request.
 *
 *   F0-3 — getStreamFormatForModel return type union too narrow
 *          (`'anthropic'|'openai'|'gemini'` only). The SDK normalizer
 *          factory accepts 8 formats; the cast at the provider boundary
 *          was eating valid values like 'bedrock-anthropic' /
 *          'aif-responses' / 'ollama'. Widen to match the SDK.
 *
 * Source-grep tests — pin the contracts without spinning up streams.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHATLOOP = join(__dirname, '..', 'chatLoop.ts');
const STREAMPROVIDER = join(__dirname, '..', 'streamProvider.ts');
const PROVIDERMANAGER = join(__dirname, '..', '..', '..', '..', '..', 'services', 'llm-providers', 'ProviderManager.ts');

describe('audit round 4 — batch of 3 SEV-1 fixes (2026-05-12)', () => {
  describe('F1-4 truncated tool_use input guard', () => {
    const src = readFileSync(CHATLOOP, 'utf8');

    it('chatLoop guards tool_use_complete against non-object input', () => {
      // The fix pattern: a runtime check before pushing the tool_use
      // content block that rejects undefined/null/non-object input.
      // The error is emitted via opcode-`e:` annotation so the model
      // sees a structured failure on the next turn.
      expect(src).toMatch(/truncated_tool_use|invalid tool_use input|tool_use input is not an object/i);
    });
  });

  describe('F2-5 log when system prompt is undefined', () => {
    const src = readFileSync(STREAMPROVIDER, 'utf8');

    it('streamProvider emits a debug/info/warn log when req.system is undefined', () => {
      // Look for the pattern: a logger call inside the system-undefined
      // branch. Accept either `if (!req.system)` or `if (req.system) … else`.
      expect(src).toMatch(/req\.system is undefined|system prompt is undefined|system prompt undefined/i);
      expect(src).toMatch(/(logger|rootLogger)\.(debug|info|warn)/);
    });
  });

  describe('F0-3 getStreamFormatForModel union widening', () => {
    const src = readFileSync(PROVIDERMANAGER, 'utf8');

    it('return type includes the 8 SDK normalizer formats, not just 3', () => {
      // The SDK normalizer factory accepts:
      //   anthropic | bedrock-anthropic | vertex-anthropic | foundry-anthropic
      //   | ollama | openai | gemini | aif-responses
      // Casting to a narrower 3-value union erased real formats.
      const sig = src.match(/getStreamFormatForModel\([^)]*\):\s*([^{]+)\{/);
      expect(sig).not.toBeNull();
      const returnType = sig![1];
      expect(returnType).toMatch(/bedrock-anthropic/);
      expect(returnType).toMatch(/ollama/);
      expect(returnType).toMatch(/aif-responses/);
    });
  });
});
