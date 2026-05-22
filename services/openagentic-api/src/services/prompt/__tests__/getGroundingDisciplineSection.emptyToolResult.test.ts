/**
 * Sev-0 META #826 / #983 / #899 — empty-tool-result fabrication.
 *
 * Background: the existing fabrication guardrails (see
 * getGroundingDisciplineSection.test.ts + chatLoop synthesis tests)
 * tell the model to acknowledge missing tools. But Q-loop Q5/Q8/Q9 and
 * Q4-followup-3 show the model STILL fabricates concrete findings when
 * a grounding tool returns `{}`, `[]`, `null`, or an error — it
 * substitutes structural proxies / training-data IDs / made-up numbers
 * rather than admitting the gap.
 *
 * Layer 1 of the two-layer defense is a system-prompt hardening clause
 * that explicitly names the empty-tool-result failure mode and bans
 * substitution. The clause must appear verbatim so we can pin it.
 *
 * Companion layer 2 (chatLoop SYSTEM NOTE augmentation) lives in
 * chatLoop.emptyToolResultGuard.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { getGroundingDisciplineSection } from '../staticSections';

describe('Sev-0 META #826/#983/#899 — empty-tool-result handling clause', () => {
  for (const role of ['member', 'admin'] as const) {
    describe(`role=${role}`, () => {
      const section = getGroundingDisciplineSection(role);

      it('declares the "Empty tool result handling" clause verbatim', () => {
        expect(section).toContain('Empty tool result handling');
      });

      it('forbids substituting any non-verbatim claim for missing tool data', () => {
        expect(section).toContain('verbatim in a tool_result this turn');
      });

      it('names the substitution failure modes (structural proxies / training-data / external assumptions)', () => {
        const lower = section.toLowerCase();
        // The clause must call out at least the structural-proxy + historical-knowledge
        // substitution patterns explicitly — they are the documented Q4-f3 / #883 / #887 modes.
        expect(lower).toMatch(/structural prox/);
        expect(lower).toMatch(/historical knowledge|training data/);
      });

      it('enumerates the empty shapes ({}, [], null, error) the model must handle', () => {
        // The clause should name the concrete shapes so the model has unambiguous triggers.
        expect(section).toMatch(/\{\}/);
        expect(section).toMatch(/\[\]/);
        expect(section).toMatch(/null/);
        expect(section.toLowerCase()).toContain('error');
      });

      it('provides acceptable refusal phrases', () => {
        const lower = section.toLowerCase();
        expect(lower).toContain('the tool returned no data');
        expect(lower).toMatch(/cannot determine .* from the available tools/);
      });
    });
  }

  it('reads identically for member + admin (rubric is role-agnostic)', () => {
    expect(getGroundingDisciplineSection('member')).toBe(getGroundingDisciplineSection('admin'));
  });
});
