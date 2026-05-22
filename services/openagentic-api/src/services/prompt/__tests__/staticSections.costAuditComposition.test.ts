/**
 * staticSections — cost-audit composition guidance (2026-05-17).
 *
 * Why this exists:
 *   The user wants the model, given a multi-cloud cost-audit prompt, to
 *   compose a mock-07-style multi-turn narrative:
 *     Turn 1: cloud_operations sub-agent → parallel cost tools → brief
 *             streaming_table + 1-paragraph synthesis + chart offer
 *     Turn 2 ("show me the chart"): ONE compose_visual sankey + caption
 *     Turn 3 ("what should I cut?"): ONE compose_app savings_grid + synthesis
 *
 *   The current prompt sections cover narrative interleave + visualization
 *   guardrails generally, but lack the SPECIFIC turn-by-turn composition
 *   contract for multi-cloud cost audits. This section codifies it.
 *
 * Contract — the section MUST contain:
 *   - Reference to cloud_operations sub-agent dispatch
 *   - "streaming_table" as the turn-1 artifact (top 5-10 deltas)
 *   - Clarifying offer phrasing ("category breakdown chart" / "specific cuts")
 *   - Anti-overcomposition: one artifact per turn
 *   - Anti-fabrication: never compose_visual / compose_app without
 *     numeric data from a prior tool_result
 *   - Mention of "sankey" (turn 2) and "savings_grid" (turn 3) slugs
 */
import { describe, it, expect } from 'vitest';
import { getCostAuditCompositionSection } from '../staticSections.js';

describe('staticSections — cost-audit composition', () => {
  it('exports getCostAuditCompositionSection', () => {
    expect(typeof getCostAuditCompositionSection).toBe('function');
  });

  it('section mentions cloud_operations sub-agent dispatch for turn 1', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toContain('cloud_operations');
    // Sub-agent must be dispatched via Task tool (not direct fan-out).
    expect(out.toLowerCase()).toMatch(/task\s+tool|sub[-_]?agent/);
  });

  it('section names streaming_table as the turn-1 artifact for top deltas', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toContain('streaming_table');
    // Top 5-10 deltas (not full bill JSON).
    expect(out).toMatch(/top\s+\d|deltas|spikes/i);
  });

  it('section offers chart + cuts as the turn-1 ending clarifier', () => {
    const out = getCostAuditCompositionSection('admin');
    // The offer phrasing: chart for visual layer, cuts for action layer.
    expect(out.toLowerCase()).toMatch(/category breakdown|chart/);
    expect(out.toLowerCase()).toMatch(/cuts?|prescriptive|specific cuts/);
  });

  it('section names sankey for turn-2 compose_visual', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toContain('sankey');
    expect(out.toLowerCase()).toContain('compose_visual');
  });

  it('section names savings_grid for turn-3 compose_app', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toContain('savings_grid');
    expect(out.toLowerCase()).toContain('compose_app');
  });

  it('section enforces anti-overcomposition: one artifact per turn', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toMatch(/one artifact per turn|one.*artifact|do not.*dump/);
  });

  it('section enforces anti-fabrication: no compose_visual/compose_app without numeric data', () => {
    const out = getCostAuditCompositionSection('admin');
    expect(out.toLowerCase()).toMatch(/fabricat|invent|never emit/);
    expect(out.toLowerCase()).toMatch(/tool_result|prior.*data|numeric/);
  });

  it('section is included in the composed system prompt for admin role', async () => {
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
        userMessage: 'cloud bill up 40% MoM across Azure/AWS/GCP',
        priorTurnCount: 0,
      },
      { memoryRecall: async () => [] },
    );
    // The section must appear in the composed system prompt so the model
    // sees it on the turn 1 dispatch decision.
    expect(out.toLowerCase()).toContain('cost-audit');
    expect(out.toLowerCase()).toContain('savings_grid');
    expect(out.toLowerCase()).toContain('sankey');
  });
});
