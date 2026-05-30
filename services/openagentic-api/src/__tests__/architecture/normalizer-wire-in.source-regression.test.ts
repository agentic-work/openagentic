/**
 * Architecture pin — Phase 2, Task 2.1 (V3 streamProvider normalizer wire-in).
 *
 * V3's `streamProvider.ts` is the single per-turn boundary between V3
 * chatLoop and the provider stream. Spec §12.1 mandates:
 *
 *   - import `selectCanonicalNormalizer` from the SDK
 *   - feed raw provider chunks through `normalizer.consume(chunk)`
 *   - DO NOT wrap V2's `makeStreamAdapter` (legacy non-canonical adapter)
 *
 * This test source-greps `streamProvider.ts` for those three contracts.
 * It is intentionally text-based (mirrors `normalizer-wire-in-per-provider`
 * for providers) so it runs without spinning up the api or loading any
 * runtime dependencies.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §12.1
 * Plan: docs/superpowers/plans/2026-05-09-v3-enterprise-chatmode-implementation.md
 *       Phase 2, Task 2.1.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STREAM_PROVIDER = resolve(__dirname, '../../routes/chat/pipeline/chat/streamProvider.ts');

describe('arch: V3 streamProvider wires SDK normalizer per provider (Phase 2)', () => {
  it('streamProvider.ts imports selectCanonicalNormalizer from SDK', () => {
    const content = readFileSync(STREAM_PROVIDER, 'utf8');
    expect(content).toMatch(
      /import\s*\{[^}]*selectCanonicalNormalizer[^}]*\}\s*from\s*['"][^'"]*@agentic-work\/llm-sdk[^'"]*['"]/,
    );
  });

  it('streamProvider.ts does NOT import V2 makeStreamAdapter', () => {
    const content = readFileSync(STREAM_PROVIDER, 'utf8');
    expect(content).not.toMatch(/makeStreamAdapter/);
  });

  it('streamProvider.ts calls selectCanonicalNormalizer with provider format', () => {
    const content = readFileSync(STREAM_PROVIDER, 'utf8');
    expect(content).toMatch(/selectCanonicalNormalizer\s*\(/);
  });
});
