/**
 * Architecture pin — RouterTuningService DEFAULT block must NOT contain
 * a hardcoded model identifier for `intentClassifierModelId`.
 *
 * the design notes +
 *       follow-up Smart-Router agency layering (chat session, this commit).
 *
 * Why this gate exists:
 *   `RouterTuningService.ts:87` previously hardcoded
 *     `intentClassifierModelId: 'gpt-oss:20b'`.
 *   That literal violated docs/rules/no-hardcoded-models.md AND broke the
 *   classifier in production: the live Ollama host doesn't have the model
 *   pulled, every classify call threw, the IntentClassifier returned null,
 *   the lexical safety-net mis-classified user prompts (e.g. "azure sky"
 *   becoming intent:cloud-list), and the Smart Router routed every chat
 *   prompt to Sonnet 4.6 because the FCA scoring tilts toward high-quality
 *   models when no real intent signal exists.
 *
 * What this test asserts:
 *   The `ROUTER_TUNING_DEFAULTS` block in
 *   `services/RouterTuningService.ts` does not contain any of the
 *   forbidden model-literal patterns from
 *   `no-hardcoded-model-literals.source-regression.test.ts`. Empty string
 *   is allowed and means "resolve at construction time from the registry's
 *   chat-role default" — see `startup/04-providers.ts`.
 *
 * Production reference:
 *   Anthropic Claude Code does not hardcode classifier models. See
 *   `~/anthropic/src/utils/model/model.ts:36` `getSmallFastModel()` —
 *   resolves via env-var with a soft default at runtime, never a string
 *   literal in service code.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SVC = join(__dirname, '../../services/RouterTuningService.ts');

const FORBIDDEN_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'gpt-oss family', re: /['"`]gpt-oss(?::[a-zA-Z0-9_.-]+)?['"`]/ },
  { name: 'gpt-4o family',  re: /['"`]gpt-4o(-mini)?['"`]/ },
  { name: 'gpt-5 family',   re: /['"`]gpt-5(\.\d+)?(-mini)?['"`]/ },
  { name: 'gemini family',  re: /['"`]gemini-(1|2|3)\.\d+(-pro|-flash|-flash-exp)?['"`]/ },
  { name: 'claude family',  re: /['"`]claude-(opus|sonnet|haiku)-[0-9.-]+(-v\d+)?['"`]/ },
  { name: 'bedrock claude', re: /['"`]anthropic\.claude-[a-z0-9.-]+['"`]/ },
  { name: 'bedrock us claude', re: /['"`]us\.anthropic\.claude-[a-z0-9.-]+['"`]/ },
];

function extractDefaultsBlock(src: string): { start: number; end: number; body: string } {
  const startMarker = /export const ROUTER_TUNING_DEFAULTS\s*:[^=]*=\s*\{/;
  const m = startMarker.exec(src);
  if (!m) throw new Error('ROUTER_TUNING_DEFAULTS export not found in RouterTuningService.ts');
  const startIdx = m.index + m[0].length;

  // Walk forward, balancing braces, ignoring strings and comments minimally.
  let depth = 1;
  let i = startIdx;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return { start: startIdx, end: i, body: src.slice(startIdx, i) };
}

describe('RouterTuningService.ROUTER_TUNING_DEFAULTS — no hardcoded classifier model literal', () => {
  const src = readFileSync(SVC, 'utf8');
  const block = extractDefaultsBlock(src);

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    it(`DEFAULT block must not contain ${name} literal`, () => {
      const match = re.exec(block.body);
      expect(
        match,
        `Found ${name} literal in RouterTuningService.ROUTER_TUNING_DEFAULTS block.\n` +
          `The classifier model must be resolved at construction time from\n` +
          `the registry's chat-role default — see startup/04-providers.ts.\n` +
          `An empty string ('') in the default is allowed and signals "auto-resolve".\n` +
          `Match: ${match?.[0]}`,
      ).toBeNull();
    });
  }

  it('intentClassifierModelId default is the empty string (auto-resolve sentinel)', () => {
    const re = /intentClassifierModelId\s*:\s*['"`]([^'"`]*)['"`]/;
    const m = re.exec(block.body);
    expect(m, 'intentClassifierModelId field not found in DEFAULT block').not.toBeNull();
    expect(
      m![1],
      `intentClassifierModelId default must be '' (empty string sentinel for ` +
        `"auto-resolve from registry"). Got: ${JSON.stringify(m![1])}`,
    ).toBe('');
  });
});
