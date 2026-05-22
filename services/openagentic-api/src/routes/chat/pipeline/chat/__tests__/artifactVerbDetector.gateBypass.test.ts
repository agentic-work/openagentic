/**
 * #947 — anti-bias gate bypass helpers.
 *
 * Live regression: Sonnet 4.6 on "draw me an arch diagram of X" hit the
 * `compose_visual` anti-bias gate (chatLoop.ts:1118) because no MCP tool
 * had run. The gate returned the synthetic error, the model narrated it
 * inline ("the artifact gate blocked the diagram because it expects
 * numeric data from a tool call"), and the iframe disappeared post-stream.
 *
 * Fix: bypass the gate when (a) user explicitly asked OR (b) template is
 * conceptual. These tests pin both helpers' behavior.
 */
import { describe, it, expect } from 'vitest';
import {
  userMessageHasExplicitArtifactVerb,
  isConceptualTemplate,
} from '../artifactVerbDetector.js';

describe('userMessageHasExplicitArtifactVerb (#947)', () => {
  it('returns true for explicit "draw me an arch diagram" request', () => {
    expect(
      userMessageHasExplicitArtifactVerb('draw me an arch diagram of my Azure stack'),
    ).toBe(true);
  });

  it('returns true for "render the architecture"', () => {
    expect(userMessageHasExplicitArtifactVerb('render the architecture')).toBe(true);
  });

  it('returns true for "visualize this"', () => {
    expect(userMessageHasExplicitArtifactVerb('Can you visualize this?')).toBe(true);
  });

  it('returns true for "show me a chart"', () => {
    // 'chart' is in the verb list
    expect(userMessageHasExplicitArtifactVerb('show me a chart of cpu over time')).toBe(true);
  });

  it('returns true for "architecture diagram"', () => {
    expect(
      userMessageHasExplicitArtifactVerb('I want an architecture diagram of the platform'),
    ).toBe(true);
  });

  it('returns true for "dashboard"', () => {
    expect(userMessageHasExplicitArtifactVerb('build me a dashboard')).toBe(true);
  });

  it('returns false for non-artifact prompts (no fabrication concern bypass)', () => {
    expect(userMessageHasExplicitArtifactVerb('what is the weather like today')).toBe(false);
    expect(userMessageHasExplicitArtifactVerb('explain TLS handshakes')).toBe(false);
    expect(userMessageHasExplicitArtifactVerb('summarize the docs')).toBe(false);
  });

  it('returns false for empty / undefined / null', () => {
    expect(userMessageHasExplicitArtifactVerb('')).toBe(false);
    expect(userMessageHasExplicitArtifactVerb(undefined)).toBe(false);
    expect(userMessageHasExplicitArtifactVerb(null)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(userMessageHasExplicitArtifactVerb('DRAW THE DIAGRAM')).toBe(true);
    expect(userMessageHasExplicitArtifactVerb('Render This')).toBe(true);
  });

  it('uses word boundaries (no false positives on substrings)', () => {
    // 'render' is in 'rendering' but we want word-boundary
    // 'rendering' contains 'render' so it WILL match — that's fine, the user
    // saying "rendering pipeline" is still in artifact context.
    // Negative test: 'redraw' contains 'draw' at word boundary? No, 'redraw'
    // is one word — should match? Yes the verb fires inside compound words.
    // The behavior we DON'T want is matching strings like 'drawer' as a
    // false-positive for 'draw' — but that's also word-boundary OK since
    // 'drawer' has 'draw' followed by 'er', breaking the word boundary on
    // the right. So 'drawer' should NOT match.
    expect(userMessageHasExplicitArtifactVerb('open the drawer please')).toBe(false);
  });
});

describe('isConceptualTemplate (#947)', () => {
  it('returns true for arch_diagram', () => {
    expect(isConceptualTemplate({ template: 'arch_diagram' })).toBe(true);
  });

  it('returns true for reactflow_arch', () => {
    expect(isConceptualTemplate({ template: 'reactflow_arch' })).toBe(true);
  });

  it('returns true for network', () => {
    expect(isConceptualTemplate({ template: 'network' })).toBe(true);
  });

  it('returns true for mermaid / flow / sequence / erd', () => {
    expect(isConceptualTemplate({ template: 'mermaid' })).toBe(true);
    expect(isConceptualTemplate({ template: 'flow' })).toBe(true);
    expect(isConceptualTemplate({ template: 'flowchart' })).toBe(true);
    expect(isConceptualTemplate({ template: 'sequence' })).toBe(true);
    expect(isConceptualTemplate({ template: 'erd' })).toBe(true);
  });

  it('returns false for data-driven templates (sankey/bar/line/kpi_grid)', () => {
    expect(isConceptualTemplate({ template: 'sankey' })).toBe(false);
    expect(isConceptualTemplate({ template: 'bar_chart' })).toBe(false);
    expect(isConceptualTemplate({ template: 'line_chart' })).toBe(false);
    expect(isConceptualTemplate({ template: 'kpi_grid' })).toBe(false);
  });

  it('returns false for missing / invalid template field', () => {
    expect(isConceptualTemplate({})).toBe(false);
    expect(isConceptualTemplate({ template: 42 })).toBe(false);
    expect(isConceptualTemplate(null)).toBe(false);
    expect(isConceptualTemplate(undefined)).toBe(false);
    expect(isConceptualTemplate('not an object')).toBe(false);
  });
});
