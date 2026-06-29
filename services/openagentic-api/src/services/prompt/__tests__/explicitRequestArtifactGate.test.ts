/**
 * Sev-0 #928 — explicit-request artifact gate (2026-05-17).
 *
 * User direction verbatim (2026-05-17 PM):
 *   "we also need to harden up the system/dynamic prompts so the agent does
 *    NOT do/create shit the user didnt explicitly ask for in their prompts-
 *    e.g. creating cost, images, diagrams and shit that they didnt ask for
 *    is wasting money on tokens- if the agent has qualifying questions is
 *    should ALWAYS ask the user before creating shit that costs tokens."
 *
 * Token cost is the load-bearing concern. compose_app HTML/CSS payloads
 * can be 5-10K output tokens; Bedrock charges per output token. The
 * artifact set MUST equal the user-requested set, never model-expanded.
 *
 * Rule:
 *   - Capstone-style prompts ("decision matrix, interactive diagrams,
 *     architecture diagrams") → emit those artifacts one-shot (this is
 *     correct per feedback_chatmode_one_shot_mock_fidelity_over_deferred_pacing).
 *   - Simple-list prompts ("list my Azure subs") → NO compose_visual,
 *     NO compose_app, NO render_artifact. Streaming_table or prose only.
 *   - Ambiguous prompts ("analyze X", "look at Y", "our bill is up") →
 *     call request_clarification BEFORE generating any tokens-cost artifact.
 *   - Default output: markdown prose. Visuals are opt-in.
 *
 * What this test asserts:
 *   1. A NEW static section `getArtifactExplicitRequestGate()` exists.
 *   2. It enumerates the explicit-request trigger phrases the model can
 *      pattern-match on (≥10 triggers).
 *   3. It tells the model to call request_clarification when ambiguous
 *      BEFORE emitting any visual/artifact.
 *   4. It calls out the token-cost (5-10K output tokens) as the why.
 *   5. The section appears in the composed system prompt for both admin
 *      and member roles via `getSystemPromptForRole`.
 *   6. `getCostAuditCompositionSection` is gated behind an explicit-request
 *      lexical signal — i.e. the section instructs the model to apply the
 *      composition contract ONLY when the user explicitly asks for the
 *      visual layers (chart / diagram / matrix / show / breakdown).
 *
 * Real-model gate (deferred): we don't have a `realProviderHarness` in
 * this repo. Per CLAUDE.md guidance, this test asserts on prompt-string
 * contents AND on tool-description content. The downstream wire harness
 * captured via WIRE_CAPTURE_ENABLED=true is the live-drive gate.
 */
import { describe, it, expect } from 'vitest';

describe('Sev-0 #928 — explicit-request artifact gate', () => {
  describe('staticSections — getArtifactExplicitRequestGate()', () => {
    it('exports getArtifactExplicitRequestGate', async () => {
      const mod = await import('../staticSections.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (mod as any).getArtifactExplicitRequestGate;
      expect(typeof fn).toBe('function');
    });

    it('section names the artifact tools it gates (compose_app, compose_visual, render_artifact)', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin');
      expect(out).toContain('compose_app');
      expect(out).toContain('compose_visual');
      expect(out).toContain('render_artifact');
    });

    it('section lists at least 10 explicit-request trigger phrases', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin').toLowerCase();
      // Trigger phrases the model can pattern-match on.
      const triggers = [
        'chart',
        'diagram',
        'matrix',
        'visualization',
        'sankey',
        'graph',
        'render',
        'app',
        'dashboard',
        'plot',
      ];
      const hits = triggers.filter((t) => out.includes(t));
      expect(
        hits.length,
        `gate must list ≥10 explicit-request triggers; got ${hits.length}/${triggers.length}`,
      ).toBeGreaterThanOrEqual(10);
    });

    it('section instructs request_clarification BEFORE emitting any artifact when ambiguous', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin').toLowerCase();
      expect(out).toContain('request_clarification');
      // Must say BEFORE / first / ahead-of-emit shape.
      expect(out).toMatch(/before\s+emit|before\s+(?:any\s+)?artifact|first|ahead/);
      // Must reference "ambiguous" framing.
      expect(out).toMatch(/ambiguous|unclear|uncertain|in doubt/);
    });

    it('section explains the token-cost rationale (5-10K tokens / wastes / cost)', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin').toLowerCase();
      // The "why" — token cost is real, wastes output tokens.
      expect(out).toMatch(/token|cost|waste/);
    });

    it('section states markdown prose is the DEFAULT, visuals are opt-in', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin').toLowerCase();
      expect(out).toMatch(/default|prose|markdown/);
      expect(out).toMatch(/opt[\s-]?in|explicit|only\s+when|never\s+(?:proactive|expand)/);
    });

    /**
     * #905 GREEN gate — compound-prompt rule.
     *
     * Live-reproduced on `0.7.1-20850988` via scripts/harness/t1-real.ts
     * (Haiku 4.5 + Sonnet 4.6 both regressed): prompt "Show me my Azure
     * subscriptions and resource groups. Render a sankey diagram of resource
     * distribution by subscription." did NOT trigger compose_visual. The
     * model parsed "show me" as a simple-list prompt (RULE 3) and ignored
     * the "render a sankey diagram" trigger.
     *
     * Fix: explicit-ask MUST dominate simple-list. The gate text must
     * communicate that an artifact verb in the same prompt wins, even when
     * the surrounding language reads like a list.
     */
    it('explicit-ask wins over simple-list framing in compound prompts (#905)', async () => {
      const { getArtifactExplicitRequestGate } = await import('../staticSections.js');
      const out = getArtifactExplicitRequestGate('admin').toLowerCase();
      // The gate must explicitly state explicit-ask precedence.
      expect(out).toMatch(/explicit(?:-ask)?\s+wins|same\s+turn|emit\s+the\s+named\s+artifact/);
      // It must call out that "show me X and render Y" → emit Y, not markdown table.
      expect(out).toMatch(/show\s+me|and\s+render|surrounding\s+language|sounds\s+like\s+a\s+list/);
      // The named-artifact list must include sankey + render (the #905 prompt).
      expect(out).toContain('sankey');
      expect(out).toContain('render');
    });
  });

  describe('getSystemPromptForRole — gate is wired into composed prompt', () => {
    it('admin role composed prompt contains the explicit-request gate', async () => {
      const { getSystemPromptForRole } = await import('../getSystemPromptForRole.js');
      const { __clearPromptCache } = await import('../RoleKeyedSystemPrompt.js');
      __clearPromptCache();
      const out = await getSystemPromptForRole(
        'admin',
        {
          userId: 'u',
          sessionId: 's',
          tenantId: 't',
          modelInUse: 'm',
          userMessage: 'list my azure subscriptions',
          priorTurnCount: 0,
        },
        { memoryRecall: async () => [] },
      );
      // The new section must appear in the composed prompt so the model
      // sees the gate on EVERY turn before deciding to emit an artifact.
      expect(out).toContain('compose_app');
      expect(out).toContain('compose_visual');
      expect(out).toMatch(/explicit(?:ly)?\s+request|only\s+when\s+(?:the\s+)?user/i);
    });

    it('member role composed prompt contains the explicit-request gate', async () => {
      const { getSystemPromptForRole } = await import('../getSystemPromptForRole.js');
      const { __clearPromptCache } = await import('../RoleKeyedSystemPrompt.js');
      __clearPromptCache();
      const out = await getSystemPromptForRole(
        'member',
        {
          userId: 'u',
          sessionId: 's',
          tenantId: 't',
          modelInUse: 'm',
          userMessage: 'what are my pods',
          priorTurnCount: 0,
        },
        { memoryRecall: async () => [] },
      );
      expect(out).toContain('compose_app');
      expect(out).toContain('compose_visual');
      expect(out).toMatch(/explicit(?:ly)?\s+request|only\s+when\s+(?:the\s+)?user/i);
    });
  });

  describe('cost-audit composition — gated behind explicit-request lexical signal', () => {
    it('getCostAuditCompositionSection mentions explicit-request gating phrase', async () => {
      const { getCostAuditCompositionSection } = await import('../staticSections.js');
      const out = getCostAuditCompositionSection('admin').toLowerCase();
      // The contract must self-gate on whether the user explicitly asked
      // for the visual layers — not fire reflexively on every cost prompt.
      expect(out).toMatch(/explicit(?:ly)?|only\s+when|ask(?:s|ed)\s+for|request(?:s|ed)/);
      // Must reference the visual lexical signal (chart / diagram / breakdown / show).
      expect(out).toMatch(/chart|diagram|breakdown|show|visual/);
    });

    it('cost-audit contract is NOT applied on prose-only follow-ups (anti-overcomposition still holds)', async () => {
      const { getCostAuditCompositionSection } = await import('../staticSections.js');
      const out = getCostAuditCompositionSection('admin').toLowerCase();
      // The original anti-overcomposition + anti-fabrication clauses must
      // remain — they enforce ONE artifact per turn and ban speculative
      // compose_visual on numeric-data-free turns.
      expect(out).toMatch(/one artifact per turn|do not.*dump|one.*artifact/);
      expect(out).toMatch(/never emit|fabricat|invent|tool_result/);
    });
  });

  describe('tool descriptions carry the "ONLY when explicitly requested" prefix', () => {
    it('compose_visual description begins with explicit-request gating language', async () => {
      const { COMPOSE_VISUAL_TOOL } = await import('../../ComposeVisualTool.js');
      const desc = COMPOSE_VISUAL_TOOL.function.description;
      // First 400 chars must carry the explicit-request gate prefix.
      const head = desc.slice(0, 400).toLowerCase();
      expect(head).toMatch(/only\s+when\s+(?:the\s+)?user\s+explicit|user\s+explicitly\s+request/);
      expect(head).toMatch(/never\s+emit\s+proactive|do\s+not\s+emit\s+proactive|never\s+proactive/);
    });

    it('compose_app description begins with explicit-request gating language', async () => {
      const { COMPOSE_APP_TOOL } = await import('../../ComposeAppTool.js');
      const desc = COMPOSE_APP_TOOL.function.description;
      const head = desc.slice(0, 400).toLowerCase();
      expect(head).toMatch(/only\s+when\s+(?:the\s+)?user\s+explicit|user\s+explicitly\s+request/);
      expect(head).toMatch(/never\s+emit\s+proactive|do\s+not\s+emit\s+proactive|never\s+proactive/);
    });

    it('render_artifact description begins with explicit-request gating language', async () => {
      const { RENDER_ARTIFACT_TOOL } = await import('../../RenderArtifactTool.js');
      const desc = RENDER_ARTIFACT_TOOL.function.description;
      const head = desc.slice(0, 400).toLowerCase();
      expect(head).toMatch(/only\s+when\s+(?:the\s+)?user\s+explicit|user\s+explicitly\s+request/);
      expect(head).toMatch(/never\s+emit\s+proactive|do\s+not\s+emit\s+proactive|never\s+proactive/);
    });

    it('request_clarification description biases toward "use BEFORE artifacts when scope ambiguous"', async () => {
      const { REQUEST_CLARIFICATION_TOOL } = await import('../../RequestClarificationTool.js');
      const desc = REQUEST_CLARIFICATION_TOOL.function.description.toLowerCase();
      // The new biasing copy: this is the default when artifact scope is
      // ambiguous, not the last-resort it used to be framed as.
      expect(desc).toMatch(/before\s+emit|before\s+(?:any\s+)?artifact|before\s+(?:any\s+)?visual/);
      expect(desc).toMatch(/ambiguous|unclear/);
    });
  });
});
