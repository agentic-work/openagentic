/**
 * Architecture cage: every LLMProvider must route its wire events through
 * the vendored openagentic-sdk normalizer + typed builders, NEVER emit
 * object literals inline.
 *
 * The cage is a source-grep: providers must NOT contain `yield { type:`
 * patterns (or any other ad-hoc object-literal emission shape) for canonical
 * model-stream events. They must import from
 * `../../lib/agentic-sdk/agentic-events/builders.js` and emit results of
 * `build*` calls.
 *
 * Migration order (this test starts with one provider PASSING — Ollama —
 * and the others as EXPECTED FAILURES via skip+TODO. Each fix iteration
 * un-skips one provider).
 *
 * SCOPE — what counts as a "canonical model-stream event" inline emission:
 *   - yield { type: 'content_block_start', ... }
 *   - yield { type: 'content_block_delta',  ... }
 *   - yield { type: 'content_block_stop',   ... }
 *   - yield { type: 'message_start',        ... }
 *   - yield { type: 'message_delta',        ... }
 *   - yield { type: 'message_stop',         ... }
 *   - yield { type: 'thinking_delta',       ... }
 *   - yield { type: 'text_delta',           ... }
 *
 * OUT OF SCOPE — provider-native OpenAI-format chunks (no `type:` discriminator;
 * the consumer chatLoop reads `choices[].delta.tool_calls` directly):
 *   - yield { id: 'chatcmpl-...', object: 'chat.completion.chunk', ... }
 * These remain as ad-hoc object emission because they ARE the upstream
 * provider shape, not canonical platform events. Future SDK extension can
 * route these too (Layer 3 tool_executing / tool_completed events).
 *
 * Spec: per memory entry `reference_sdk_normalizer_gap_analysis.md` G2 +
 * `feedback_real_provider_testing_regime_chatmode_pivot.md`, every emit
 * site is meant to be routed through openagentic-sdk normalizers + builders.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROVIDERS_DIR = resolve(__dirname, '../../services/llm-providers');

// One provider in scope this commit. Future iterations append:
//   'AzureAIFoundryProvider.ts', 'AWSBedrockProvider.ts', 'GoogleVertexProvider.ts'
const PROVIDERS = ['OllamaProvider.ts'];

// Canonical event types whose ad-hoc emission this cage forbids.
const CANONICAL_EVENT_TYPES = [
  'content_block_start',
  'content_block_delta',
  'content_block_stop',
  'message_start',
  'message_delta',
  'message_stop',
  'thinking_delta',
  'text_delta',
];

function findInlineCanonicalEmissions(src: string): string[] {
  const violations: string[] = [];
  // Match `yield {` followed by any whitespace/newlines, then `type:` with
  // one of the canonical discriminators. The regex is multi-line aware so
  // it catches the wrapped multi-line form OllamaProvider uses.
  const re = /yield\s*\{\s*type:\s*['"]([a-z_]+)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (CANONICAL_EVENT_TYPES.includes(m[1])) {
      violations.push(m[0]);
    }
  }
  return violations;
}

describe('Architecture: SDK wire-in per provider', () => {
  for (const p of PROVIDERS) {
    it(`${p} — no inline 'yield { type: <canonical>' emission, all events via SDK builders`, async () => {
      const path = resolve(PROVIDERS_DIR, p);
      const src = await readFile(path, 'utf8');
      const violations = findInlineCanonicalEmissions(src);
      expect(
        violations,
        `${p} still emits ad-hoc object literals for canonical model-stream events: ${violations.slice(0, 5).join(', ')}…`,
      ).toEqual([]);
    });

    it(`${p} — imports builders from the vendored agentic-sdk`, async () => {
      const path = resolve(PROVIDERS_DIR, p);
      const src = await readFile(path, 'utf8');
      expect(
        src,
        `${p} must import from '../../lib/agentic-sdk/agentic-events/builders.js' (or .ts)`,
      ).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/agentic-sdk\/agentic-events\/builders/);
    });
  }
});
