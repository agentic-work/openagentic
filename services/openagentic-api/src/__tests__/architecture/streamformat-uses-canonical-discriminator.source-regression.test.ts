/**
 * Architecture pin — Workstream D, Phase D-0 (SDK wire-in).
 *
 * `ILLMProvider.ts` `StreamFormat` MUST be the 8-value `CanonicalStreamFormat`
 * (or a strict re-export of it), not the legacy 3-value union
 * (`'anthropic' | 'openai' | 'gemini'`).
 *
 * After Step-1 consolidation (2026-05-05), the `CanonicalStreamFormat` union
 * + `selectCanonicalNormalizer(format, opts)` factory are owned by
 * `@agentic-work/llm-sdk` (`lib/normalizers/select.ts`) — this api-side
 * arch test now pins the import boundary, not the union body. The 8-value
 * coverage is asserted in the SDK's own test
 * (`src/lib/normalizers/__tests__/select.test.ts`).
 *
 * Why this gate exists:
 *   - The SDK's `selectCanonicalNormalizer(format, opts)` factory is the
 *     load-bearing seam for every provider's stream → CanonicalEvent
 *     conversion. It dispatches on `CanonicalStreamFormat`, an exhaustive
 *     8-value union: anthropic, bedrock-anthropic, vertex-anthropic,
 *     foundry-anthropic, ollama, openai, gemini, aif-responses.
 *   - The legacy `StreamFormat` declared at `ILLMProvider.ts:136` was a
 *     3-value subset that could not represent AIF's three sub-modes
 *     (Anthropic / OpenAI / Responses), Bedrock-Anthropic vs Bedrock-Nova,
 *     Foundry-Anthropic, Vertex-Anthropic, or Ollama's NDJSON wire.
 *   - D-1 onward depends on providers being able to declare the full 8-value
 *     `streamFormat` (e.g. `'aif-responses' as const`), which is impossible
 *     while `StreamFormat` is the 3-value subset.
 *
 * the design notes
 *       Workstream D, Phase D-0.
 * Source: the design notes §"Phase D-0: type unification".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ILLM_PROVIDER = join(__dirname, '../../services/llm-providers/ILLMProvider.ts');

describe('D-0 — StreamFormat uses CanonicalStreamFormat discriminator (post-consolidation)', () => {
  it('ILLMProvider.ts does NOT declare a 3-value-only StreamFormat union', () => {
    const src = readFileSync(ILLM_PROVIDER, 'utf8');
    // Reject any export that's literally just the 3 legacy values:
    //   export type StreamFormat = 'anthropic' | 'openai' | 'gemini';
    // Whitespace-tolerant. Comments and trailing semicolons allowed.
    const legacyRe = /export\s+type\s+StreamFormat\s*=\s*['"]anthropic['"]\s*\|\s*['"]openai['"]\s*\|\s*['"]gemini['"]\s*;/;
    expect(src).not.toMatch(legacyRe);
  });

  it('ILLMProvider.ts is connected to CanonicalStreamFormat from the SDK (import or re-export)', () => {
    const src = readFileSync(ILLM_PROVIDER, 'utf8');
    // Accept either the consolidated SDK path (the post-Step-1 SoT) or a
    // legacy api-local path (transitional — flagged as deletion target by
    // `no-api-vendored-sdk.source-regression.test.ts`). The strict gate is
    // that SOME canonical-shaped import exists; the no-api-vendored test is
    // what enforces SDK-only.
    const sdkImportRe = /import\s+(?:type\s+)?\{[^}]*\bCanonicalStreamFormat\b[^}]*\}\s+from\s+['"]@agentic-work\/llm-sdk[^'"]*['"]/;
    const sdkExportRe = /export\s+(?:type\s+)?\{[^}]*\bCanonicalStreamFormat\b[^}]*\}\s+from\s+['"]@agentic-work\/llm-sdk[^'"]*['"]/;
    expect(sdkImportRe.test(src) || sdkExportRe.test(src)).toBe(true);
  });
});
