/**
 * #905 Mock-01 cost-table suppression — system prompt contract.
 *
 * Observed bug: Sonnet, given a cost prompt, defaults to an inline markdown
 * table ("| col | col | ... |") instead of dispatching compose_visual:sankey
 * + streaming_table. The artifactVerbDetector force-dispatches the tool call,
 * but the model still leans on markdown as the "safe default" for tabular
 * data. The system prompt must explicitly suppress markdown tables for cost
 * / financial breakdown prompts and steer the model to compose_visual or
 * streaming_table dispatch.
 *
 * Contract:
 *   - The cost-audit composition section MUST contain a sentence that
 *     explicitly forbids inline markdown tables for cost data and points the
 *     model at compose_visual / streaming_table as the only correct shapes.
 *   - The literal phrase "MUST use compose_visual or streaming_table, NEVER
 *     inline markdown table" must appear (or the model parsed equivalent).
 */
import { describe, it, expect } from 'vitest';
import { getCostAuditCompositionSection } from '../staticSections.js';

describe('#905 cost-table suppression system prompt rule', () => {
  it('cost-audit section forbids inline markdown table for cost data', () => {
    const section = getCostAuditCompositionSection('admin');
    expect(section).toContain(
      'MUST use compose_visual or streaming_table, NEVER inline markdown table',
    );
  });

  it('cost-audit section is included in the composed admin system prompt', async () => {
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
        userMessage:
          "show me my azure subscriptions and what's in each resource group with cost sankey",
        priorTurnCount: 0,
      },
      { memoryRecall: async () => [] },
    );
    // The suppression rule must surface in the composed prompt so the model
    // sees it on every turn (no per-turn router gating).
    expect(out).toContain(
      'MUST use compose_visual or streaming_table, NEVER inline markdown table',
    );
  });

  it('cost-audit section is included in the composed member system prompt', async () => {
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
        userMessage: 'give me a cost breakdown table for last month',
        priorTurnCount: 0,
      },
      { memoryRecall: async () => [] },
    );
    expect(out).toContain(
      'MUST use compose_visual or streaming_table, NEVER inline markdown table',
    );
  });
});
