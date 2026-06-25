/**
 * Sev-0 META #826 (with #822 / #824 / #825 sub-cases) — pin the
 * grounding discipline rubric in the static system prompt section.
 *
 * The model behaviors this is meant to suppress:
 *   - Q2 (#822): fabricated Task sub-agent dispatch when Task tool
 *     wasn't even loaded this turn.
 *   - Q5 (#824): definitive root-cause verdict with zero tool calls.
 *   - Q8 (#825): real tool calls + empty results → "service not
 *     deployed" claim (label-selector miss masquerading as truth).
 *   - Q9 (#826 META): zero storage tools loaded; model emits
 *     "🔴 CRITICAL: 3 storage accounts allow public access".
 *
 * The section pins the cannot-verify rubric + forbidden patterns. We
 * test the prompt CONTAINS those guardrails so future edits can't
 * silently drop them.
 */
import { describe, it, expect } from 'vitest';
import { getGroundingDisciplineSection } from '../staticSections';

describe('Sev-0 META #826 — getGroundingDisciplineSection', () => {
  for (const role of ['member', 'admin'] as const) {
    describe(`role=${role}`, () => {
      const section = getGroundingDisciplineSection(role);

      it('declares the cannot-verify rubric verbatim', () => {
        expect(section).toMatch(/Cannot verify:/i);
        expect(section.toLowerCase()).toContain('valid response shape');
      });

      it('demands that EVERY specific value trace to a tool_result', () => {
        expect(section.toLowerCase()).toContain('must trace to a tool_result');
        // The hit-list — counts/ids/hosts/dollar amounts/severity verdicts
        const valueTypes = ['account', 'count', 'hostname', 'dollar', 'severity', 'status'];
        for (const v of valueTypes) {
          expect(section.toLowerCase()).toContain(v);
        }
      });

      it('forbids "🔴 CRITICAL" with no grounding (Q9 pattern)', () => {
        expect(section).toContain('CRITICAL');
        expect(section.toLowerCase()).toContain('no grounding tool_result');
      });

      it('forbids "I dispatched N sub-agents…" without Task tool_use (Q2 pattern)', () => {
        expect(section.toLowerCase()).toContain('dispatched');
        expect(section.toLowerCase()).toContain('sub-agent');
        expect(section.toLowerCase()).toMatch(/no task tool_use|no task tool/);
      });

      it('warns that empty-result ≠ does-not-exist (Q8 pattern)', () => {
        expect(section.toLowerCase()).toMatch(/label.?selector/);
        expect(section.toLowerCase()).toContain('empty');
      });

      it('requires "From general knowledge" prefix when answering without grounding', () => {
        expect(section.toLowerCase()).toContain('from general knowledge');
        expect(section.toLowerCase()).toContain('not verified');
      });

      it('does NOT include the section header itself in forbidden-pattern list', () => {
        // Section title appears exactly once at the top.
        const title = '## Grounding discipline';
        const occurrences = (section.match(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        expect(occurrences).toBe(1);
      });

      it('returns a stable string ≥ 800 chars (substantive rubric, not a one-liner)', () => {
        expect(section.length).toBeGreaterThanOrEqual(800);
      });

      // #967 (2026-05-20) — gpt-oss:20b refused "build me an HTML dashboard,
      // no tools" by citing "policy: must use tools to fetch data." Small
      // models overgeneralize "every value traces to a tool_result" to mean
      // "must call a tool for any request." The carve-out: code templates,
      // scaffolds, examples, mock data that the user EXPLICITLY requests
      // are NOT fabrication — they are creative-code output. The rule
      // applies to FACTUAL CLAIMS about the user's environment, not to
      // user-requested code with placeholder data.
      it('#967 carves out user-requested code templates / mock data', () => {
        const lower = section.toLowerCase();
        // Either the word "template" / "scaffold" / "mock" appears in a
        // permissive context, OR there is an explicit "code with placeholder
        // values" carve-out phrase.
        expect(lower).toMatch(/template|scaffold|mock data|placeholder|example data/);
        // The carve-out must explicitly frame it as NOT fabrication.
        expect(lower).toMatch(/not fabrication|legitimate|explicit(ly)?\s+request/);
      });
    });
  }

  it('reads identically for member + admin (rubric is role-agnostic)', () => {
    expect(getGroundingDisciplineSection('member')).toBe(getGroundingDisciplineSection('admin'));
  });
});
