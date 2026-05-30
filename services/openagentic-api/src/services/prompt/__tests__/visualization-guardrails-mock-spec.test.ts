/**
 * Visualization guardrails — mock-spec carve-out for relationship/flow queries.
 *
 * Background: 2026-05-17 mock-01 (azure-subs-rgs) drive — Sonnet 4.6 emitted
 * markdown table only, no compose_visual:sankey, no streaming_table.
 * The mock contract at mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.contract.json
 * REQUIRES compose_visual:sankey + streaming_table for "show me my Azure
 * subscriptions and what's in each resource group" — a multi-entity
 * hierarchical query (sub → RG → resource) where sankey is the natural
 * visualization.
 *
 * Current state: getVisualizationGuardrailsSection() forbids compose_visual
 * for ALL "show me" / "list" / "enumerate" queries — over-corrected per
 * #871 (gpt-oss:20b unsolicited chart emission on plain list query).
 *
 * Fix: KEEP the bare-"show" guardrail for SINGLE-entity flat list queries,
 * but ADD a carve-out for hierarchical/relationship/cross-entity queries
 * where the data has natural flow shape (sankey) or 2+ entity types.
 *
 * Mocks are the SoT — the contract dictates the model behavior.
 */
import { describe, it, expect } from 'vitest';
import { getVisualizationGuardrailsSection } from '../staticSections.js';

describe('Visualization guardrails — mock-spec compliance', () => {
  const body = getVisualizationGuardrailsSection('member');

  it('still forbids compose_visual on bare single-entity list queries', () => {
    // The Sev-0 #5/#6 guard for unsolicited charts on plain "list my pods" stays.
    expect(body).toMatch(/list.*pods|enumerate|single.*list/i);
  });

  it('explicitly PERMITS compose_visual:sankey for hierarchical / cross-entity queries', () => {
    // Mock-01 contract requires sankey for "subs → RGs → resources" flow.
    // The guardrail must NOT forbid this case — it should encourage it.
    expect(body).toMatch(/hierarch|flow|sankey|cross-entity|multi-entity|relationship/i);
  });

  it('mentions streaming_table as the canonical inventory rendering (not markdown)', () => {
    // Mock-01 contract expects streaming_table for the 12-row resource inventory.
    // The guardrail should name streaming_table as the table-rendering choice,
    // not just "return a markdown table".
    expect(body).toMatch(/streaming_table/i);
  });

  it('names hierarchical-flow trigger phrases (and what is in each X) as opt-in for sankey', () => {
    // Mock-01 prompt verbatim: "show me my Azure subscriptions and what's in each resource group"
    // The guardrail should explicitly call out "and what's in each" /
    // "across N levels" / "broken down by" as sankey-trigger phrases so
    // the model picks compose_visual:sankey instead of markdown.
    expect(body).toMatch(/and what.s in each|broken down|across.*level|grouped by|→/i);
  });
});
