/**
 * #905 MOCK-01 + sankey verb extension.
 *
 * Mock-01 contract (mocks/UX/AI/Chatmode/end-state-01-azure-subs-rgs.contract.json):
 *   prompt   = "show me my Azure subscriptions and what's in each resource group"
 *   end-state= streaming_table + compose_visual:sankey
 *
 * Observed bug: Sonnet looks at "show me my Azure subscriptions and what's in
 * each resource group with cost sankey" and writes a markdown table instead
 * of dispatching compose_visual(template='sankey') + streaming_table.
 *
 * Root cause: artifactVerbDetector had 'flowchart' and 'graph' verbs but no
 * direct match for the noun "sankey" or for the streaming_table / cost-breakdown
 * dispatch shape — so the explicit-verb phase missed bare-noun "sankey", and
 * the model fell back to markdown.
 *
 * RED test pins:
 *   (1) bare "sankey" noun → compose_visual (with MCP >= 1)
 *   (2) "streaming-table" / "streaming table" → compose_visual force
 *   (3) "cost breakdown table" → compose_visual force
 *   (4) Mock-01 capstone prompt with "cost sankey" → force
 *   (5) bare-noun "sankey" with 0 MCP results triggers nothing (anti-fabrication)
 */
import { describe, it, expect } from 'vitest';
import { detectArtifactVerb, userMessageHasExplicitArtifactVerb } from '../artifactVerbDetector.js';

describe('#905 Mock-01 + sankey-extension verb dictionary', () => {
  it('(1) bare "sankey" noun + 1 MCP result → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'give me a sankey of azure costs by RG',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(2a) "streaming-table" verb (hyphenated) + 1 MCP → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'show me a streaming-table of my resource groups',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(2b) "streaming table" verb (space-separated) + 1 MCP → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'render a streaming table for my services',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(3) "cost breakdown table" phrase + 1 MCP → compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'give me a cost breakdown table for last month',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(4) Mock-01 capstone prompt with "cost sankey" → force compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage:
        "show me my azure subscriptions and what's in each resource group with cost sankey",
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(5) bare "sankey" + 0 MCP results → no force (anti-fabrication baseline)', () => {
    const result = detectArtifactVerb({
      userMessage: 'sankey',
      mcpToolResultsThisTurn: 0,
    });
    // explicit-verb phase requires MCP >= 1, so bare-noun "sankey" with no
    // MCP data should NOT trigger force-dispatch (model would have nothing
    // real to render).
    expect(result.shouldForce).toBe(false);
  });

  it('(6) userMessageHasExplicitArtifactVerb recognizes bare "sankey"', () => {
    // Anti-bias gate bypass — when user explicitly says "sankey", the gate
    // must let the dispatch through even if MCP data is absent.
    expect(userMessageHasExplicitArtifactVerb('sankey of my costs')).toBe(true);
    expect(userMessageHasExplicitArtifactVerb('please make me a sankey')).toBe(true);
  });

  it('(7) "streaming table" recognized by anti-bias-gate verb helper', () => {
    expect(userMessageHasExplicitArtifactVerb('show me a streaming table')).toBe(true);
    expect(userMessageHasExplicitArtifactVerb('streaming-table of pods')).toBe(true);
  });

  it('(8) "cost breakdown" alone (no "table") still hits scenario pattern path', () => {
    // Cost-breakdown was already covered by SCENARIO_PATTERNS at the cost/spend
    // anchor; this regression pins it.
    const result = detectArtifactVerb({
      userMessage: 'give me a cost breakdown for our azure subscriptions',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  // ---------------------------------------------------------------------------
  // Regression: existing verbs (render, chart, diagram) MUST still work after
  // the dictionary augmentation — the dictionary is additive only.
  // ---------------------------------------------------------------------------
  it('(R1) regression: render still triggers compose_visual', () => {
    const result = detectArtifactVerb({
      userMessage: 'render a chart of my data',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_visual');
  });

  it('(R2) regression: dashboard still triggers compose_app', () => {
    const result = detectArtifactVerb({
      userMessage: 'show me a dashboard of services',
      mcpToolResultsThisTurn: 1,
    });
    expect(result.shouldForce).toBe(true);
    expect(result.toolName).toBe('compose_app');
  });
});
