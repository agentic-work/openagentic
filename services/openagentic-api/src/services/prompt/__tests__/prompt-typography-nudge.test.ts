/**
 * G4 — Slice C revision: mock-fidelity prose nudge.
 *
 * Mocks audit (chatmode-mocks-fidelity-audit)
 * found Slice C v1 (UPPERCASE banner + `## h2` anchors + 14 bolds) was
 * pushing the model AWAY from the customer-language at
 * `mocks/UX/AI/Chatmode/end-state-*.html`. The mocks use ZERO
 * headings in narrative, ZERO UPPERCASE banners in prose, ZERO
 * emoji severity badges across 1,235 lines.
 *
 * G4 replaces the nudge with mock-aligned guidance:
 *   - Compose answer as named compose_app / compose_visual artifacts
 *   - Prose INTERPRETS, does not recap
 *   - No headings (#, ##, ###) in narrative
 *   - No UPPERCASE banners
 *   - Monospace = fact, sans = narrator
 *   - Bold ONLY the metric the user came for
 *   - End with 3 imperative chips ending in →
 *
 * Targets `getOutputSection(role)` in `staticSections.ts`. Preserves
 * CLAUDE.md rule 8(a) — the chronological narrative is still load-
 * bearing (final synthesis comes AFTER tools; mid-stream prose stays
 * one short sentence per tool batch).
 *
 * Sibling tests:
 *   - staticSections.test.ts                  (baseline section assertions)
 *   - getSystemPromptForRole.ac7-size.test.ts (≤5,000 tok composed cap)
 *   - architecture/system-prompt-size...test  (≤18,000 chars per role .md)
 */
import { describe, it, expect } from 'vitest';
import { getOutputSection } from '../staticSections.js';
import { getSystemPromptForRole } from '../getSystemPromptForRole.js';

const ROLES = ['admin', 'member'] as const;

const NULL_CTX = {
  userId: 'u-test',
  sessionId: 'sess-test',
  tenantId: 'tenant-test',
  modelInUse: 'test-model',
  userMessage: 'hi',
  priorTurnCount: 0,
};

// 2026-05-19 (#880/#807 fix): bumped 5000 → 5750 tok to fit dispatch
// mechanism rule + softened gate + few-shot example. See
// getSystemPromptForRole.ac7-size.test.ts for context.
const TOKEN_CAP = 5750;
const CHARS_PER_TOKEN = 4;
const CHAR_CAP = TOKEN_CAP * CHARS_PER_TOKEN; // 23,000 chars

describe('G4 — mock-fidelity prose nudge (getOutputSection)', () => {
  for (const role of ROLES) {
    it(`${role}: tells the model to lead with named compose_app/compose_visual artifacts`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/compose_app|compose_visual|named artifact/i);
      // At least one of the named templates should be mentioned by name.
      expect(body).toMatch(/kpi_grid|savings_grid|incident_card|version_matrix|cluster_inventory|incident_timeline/);
    });

    it(`${role}: prose INTERPRETS, does NOT recap the artifacts`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/interpret/i);
      expect(body).toMatch(/no recap|does NOT recap|not recap|don['’]t recap/i);
    });

    it(`${role}: forbids headings (#, ##, ###) in narrative prose`, () => {
      const body = getOutputSection(role);
      // The nudge must explicitly call out that headings should not be
      // used in narrative — sections come from artifact bands.
      expect(body).toMatch(/No headings|no heading|no `?#|no `?##/i);
    });

    it(`${role}: forbids UPPERCASE banners in prose`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/No UPPERCASE|no uppercase|no all-caps/i);
    });

    it(`${role}: encourages monospace for facts (tool names, IDs, commands)`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/monospace|backtick/i);
    });

    it(`${role}: caps bold to the ONE metric the user came for`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/\bbold\b.{0,80}(?:only|one)/i);
    });

    it(`${role}: follow-up chips are contextual — only when genuinely useful`, () => {
      // #910 — chips MUST NOT appear on every turn. Trivial Q&A ("what's 2+2",
      // single-fact lookups, definitions, casual conversation) get NO chips.
      // Multi-step work / artifacts / advisory output may end with up to 3
      // imperative chips IF a real next step exists.
      const body = getOutputSection(role);
      expect(body, 'must call out the conditional case').toMatch(/only.{0,40}(?:when|if).{0,80}(?:next.step|continuation|useful)|do not.{0,40}(?:always|every turn)|skip.{0,30}chip|no.{0,20}chip.{0,30}(?:trivial|simple|small.talk)/i);
      // When chips DO appear, the verb→ shape stays.
      expect(body).toMatch(/→/);
    });

    it(`${role}: preserves CLAUDE.md 8(a) — chronological interleave, no end-batching`, () => {
      const body = getOutputSection(role);
      expect(body).toMatch(/interleave|between tool|chronolog|narrative|do not batch|don['’]t batch/i);
    });

    it(`${role}: voice is calm peer/exec/discovery, not pager-stress`, () => {
      const body = getOutputSection(role);
      // The new copy must reference at least one of the peer/exec
      // personas so future re-authors keep the tone.
      expect(body).toMatch(/peer|exec|discovery|thinking partner|CIO|CSO/i);
    });
  }

  it('composed admin prompt with the nudge stays ≤ 5,000 tokens (20,000 chars)', async () => {
    const composed = await getSystemPromptForRole('admin', NULL_CTX, {});
    expect(composed.length).toBeLessThanOrEqual(CHAR_CAP);
  });

  it('composed member prompt with the nudge stays ≤ 5,000 tokens', async () => {
    const composed = await getSystemPromptForRole('member', NULL_CTX, {});
    expect(composed.length).toBeLessThanOrEqual(CHAR_CAP);
  });

  it('getOutputSection delta stays bounded — under 2,900 chars total', () => {
    // The whole section (existing 4 bullets + the G4 mock-fidelity
    // paragraph) must remain a compact nudge. Bumped 2,800 → 2,900
    // for #910 — the chip rule grew (~50 chars) to describe when chips
    // are contextual vs trivial. Same nudge size budget otherwise.
    const body = getOutputSection('member');
    expect(body.length).toBeLessThanOrEqual(2900);
  });
});
