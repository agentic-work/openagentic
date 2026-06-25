/**
 * resolveContextWindow — canonicalizes the multiple historical key names
 * used for "input context window in tokens" across the model_role_assignments
 * `capabilities` JSON.
 *
 * Live evidence (2026-05-25, audit of admin.model_role_assignments):
 *   - bedrock-dev Sonnet 4.5 chat row: capabilities.contextWindow = 200000
 *   - older rows / discovery code variations write either `contextWindowTokens`
 *     or `maxContextTokens` (both have appeared in tests + seeders)
 *   - SmartModelRouter.createProfileFromDiscovery used to read only
 *     contextWindowTokens || maxContextTokens, falling through to 8192 for
 *     rows that stored `contextWindow` — which silently failed the
 *     T3 capability gate (contextT3Floor=200000) with NO_T3_MODEL_IN_REGISTRY.
 *
 * Resolution order (any-first-non-null-positive-number wins):
 *   1. capabilities.contextWindowTokens (legacy A)
 *   2. capabilities.contextWindow       (legacy B — Sonnet's seeded form)
 *   3. capabilities.maxContextTokens    (legacy C)
 *   4. undefined (caller decides fallback)
 *
 * Returns undefined when none of the keys carry a finite positive number,
 * so the caller can apply its own fallback (e.g. 8192 default).
 *
 * Tests: resolveContextWindow.test.ts
 */
export function resolveContextWindow(
  caps: Record<string, unknown> | null | undefined,
): number | undefined {
  if (!caps || typeof caps !== 'object') return undefined;
  const candidates: ReadonlyArray<string> = [
    'contextWindowTokens',
    'contextWindow',
    'maxContextTokens',
  ];
  for (const key of candidates) {
    const v = (caps as Record<string, unknown>)[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return v;
    }
  }
  return undefined;
}
