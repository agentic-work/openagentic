/**
 * Task Y.3 — Add explicit between-tool narration mandate to getOutputSection.
 *
 * Sprint Y / #880/#807 regression class (2026-05-19).
 *
 * Current getOutputSection tells the model to narrate in "ONE short sentence"
 * between tool calls, but does NOT explicitly forbid coalescing ("DO NOT
 * coalesce") and does NOT mention "one short narration sentence" by name.
 *
 * New additions:
 *   1. "DO NOT coalesce" — explicit prohibition
 *   2. "one short narration sentence" (or equivalent phrase) after each tool_use
 *   3. Final synthesis comes AFTER all tool_use + artifact emissions
 *
 * Size constraint: section must stay ≤ 2900 chars (existing cap from
 * prompt-typography-nudge.test.ts line 129).
 */
import { describe, it, expect } from 'vitest';
import { getOutputSection } from '../staticSections.js';

describe('Task Y.3 — output section interleave mandate', () => {
  const ROLES = ['admin', 'member'] as const;

  for (const role of ROLES) {
    describe(`role=${role}`, () => {
      // -------------------------------------------------------------------
      // DO NOT coalesce must be present
      // -------------------------------------------------------------------

      it('"DO NOT coalesce" string is present', () => {
        const body = getOutputSection(role);
        expect(body).toMatch(/DO NOT coalesce|do not coalesce|DON'T coalesce|don't coalesce/i);
      });

      // -------------------------------------------------------------------
      // "one short narration sentence" or equivalent must be present
      // -------------------------------------------------------------------

      it('"one short narration sentence" or equivalent phrase exists', () => {
        const body = getOutputSection(role);
        expect(body).toMatch(
          /one\s+short\s+narration\s+sentence|one\s+narration\s+sentence|ONE\s+short\s+narration/i,
        );
      });

      // -------------------------------------------------------------------
      // Final synthesis placement mandate
      // -------------------------------------------------------------------

      it('states final synthesis prose comes AFTER all tool_use + artifact emissions', () => {
        const body = getOutputSection(role);
        // Must explicitly say final synthesis is after tool calls/artifacts.
        expect(body).toMatch(
          /final\s+synthesis.*after|synthesis.*after.*tool|after\s+all\s+tool/i,
        );
      });

      // -------------------------------------------------------------------
      // Section size cap
      // -------------------------------------------------------------------

      it('section size stays ≤ 2900 chars', () => {
        const body = getOutputSection(role);
        expect(body.length).toBeLessThanOrEqual(2900);
      });
    });
  }
});
