/**
 * Task Y.2 — Rewrite getArtifactExplicitRequestGate RULE 2 to eliminate
 * the "implicit-flow trigger" language and replace with server-side
 * tool_choice forcing contract.
 *
 * Sprint Y / #880/#807 regression class (2026-05-19).
 *
 * Current RULE 2 says "implicit-flow trigger — sankey/streaming_table
 * auto-emit on phrases like 'and what's in each X'". This contradicts
 * the gate (which forbids model-expansion) and is superseded by the
 * artifactVerbDetector + tool_choice forcing on the server side.
 *
 * New shape:
 *   RULE 1 — Explicit ask wins (unchanged)
 *   RULE 2 — Server-side forcing: when tool_choice arrives, dispatch it
 *   RULE 3 — Default = markdown prose (was RULE 3 "simple-list prompts")
 *   RULE 4 — Truly ambiguous → request_clarification (unchanged)
 *
 * RED→GREEN: verify the rewrite removes "implicit-flow" + adds
 * "server-side forcing" / "tool_choice" reference in RULE 2.
 */
import { describe, it, expect } from 'vitest';
import { getArtifactExplicitRequestGate } from '../staticSections.js';

describe('Task Y.2 — explicit-request gate: 4-rule rewrite', () => {
  const ROLES = ['admin', 'member'] as const;

  for (const role of ROLES) {
    describe(`role=${role}`, () => {
      // -------------------------------------------------------------------
      // Structure: exactly 4 RULE statements, numbered 1–4
      // -------------------------------------------------------------------

      it('gate text contains exactly 4 RULE statements numbered 1–4', () => {
        const body = getArtifactExplicitRequestGate(role);
        // Check for RULE 1, RULE 2, RULE 3, RULE 4 — all 4 must exist.
        expect(body).toMatch(/RULE\s*1/);
        expect(body).toMatch(/RULE\s*2/);
        expect(body).toMatch(/RULE\s*3/);
        expect(body).toMatch(/RULE\s*4/);
        // There must NOT be a RULE 5 (no extra rules).
        expect(body).not.toMatch(/RULE\s*5/);
      });

      // -------------------------------------------------------------------
      // RULE 2 must reference server-side forcing / tool_choice
      // -------------------------------------------------------------------

      it('RULE 2 references server-side forcing and/or tool_choice', () => {
        const body = getArtifactExplicitRequestGate(role);
        // Find RULE 2 section — extract from "RULE 2" up to "RULE 3".
        const rule2Match = body.match(/RULE\s*2.*?(?=\*\*RULE\s*3|$)/s);
        expect(rule2Match, 'RULE 2 section must exist').not.toBeNull();
        const rule2Text = rule2Match![0];
        // Must reference server-side forcing concept.
        expect(rule2Text).toMatch(/server.?side|tool_choice|server.side forcing/i);
      });

      it('RULE 2 does NOT contain the phrase "implicit-flow"', () => {
        const body = getArtifactExplicitRequestGate(role);
        // The old RULE 2 used "implicit-flow trigger" — this must be gone.
        expect(body).not.toMatch(/implicit.flow/i);
      });

      // -------------------------------------------------------------------
      // RULE 3 must name markdown prose as default + "table for tabular"
      // -------------------------------------------------------------------

      it('RULE 3 names "markdown prose" as the default', () => {
        const body = getArtifactExplicitRequestGate(role);
        // Extract from "RULE 3" up to "RULE 4" using non-greedy s-flag match.
        const rule3Match = body.match(/RULE\s*3.*?(?=\*\*RULE\s*4|$)/s);
        expect(rule3Match, 'RULE 3 section must exist').not.toBeNull();
        const rule3Text = rule3Match![0];
        expect(rule3Text).toMatch(/markdown\s+prose|prose.*default|default.*prose/i);
      });

      it('RULE 3 names "table for tabular" or equivalent', () => {
        const body = getArtifactExplicitRequestGate(role);
        const rule3Match = body.match(/RULE\s*3.*?(?=\*\*RULE\s*4|$)/s);
        expect(rule3Match, 'RULE 3 section must exist').not.toBeNull();
        const rule3Text = rule3Match![0];
        expect(rule3Text).toMatch(/table.*tabular|tabular.*table|table for tabular/i);
      });

      // -------------------------------------------------------------------
      // RULE 4 must name request_clarification + ambiguous
      // -------------------------------------------------------------------

      it('RULE 4 names "request_clarification" and "ambiguous"', () => {
        const body = getArtifactExplicitRequestGate(role);
        const rule4Match = body.match(/RULE\s*4.*/s);
        expect(rule4Match, 'RULE 4 section must exist').not.toBeNull();
        const rule4Text = rule4Match![0];
        expect(rule4Text).toMatch(/request_clarification/i);
        expect(rule4Text).toMatch(/ambiguous/i);
      });
    });
  }
});
