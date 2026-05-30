/**
 * Sev-0 #1024 regression — outbound inline-tag strip at the stream emit
 * boundary. See stream.handler.ts `stripInlineComposeXml` for the
 * architecture rationale (the chat pipeline is fenced by the
 * `no-synthetic-xml-rescue` arch cage; the outbound emit/persistence
 * wire sits OUTSIDE the pipeline at the user-facing boundary).
 *
 * Live evidence (2026-05-23 Q1 drive on 0.7.1-b0d2227f, gpt-oss:20b on
 * "show me my Azure subscriptions and what is in each resource group"):
 * the model dispatched the artifact tool as a real tool_use (iframe
 * mounted) AND echoed a literal inline self-closing tag in the prose.
 *
 * The strip must:
 *   - delete self-closing artifact tags (`<…/>`)
 *   - delete open artifact tags (`<…>`)
 *   - handle JSON object literal attribute values (data={...}, params={...})
 *   - leave prose mentions of the literal tool name alone
 *   - return the input unchanged when no tag is present
 *   - collapse 3+ blank lines after stripping
 */
import { describe, it, expect } from 'vitest';
import { stripInlineComposeXml } from '../stream.handler.js';

describe('stripInlineComposeXml', () => {
  it('strips a self-closing compose_visual tag with JSON data attribute (Q1 live shape)', () => {
    const input = [
      'Here is your Azure resource group inventory.',
      '',
      '<compose_visual template="table" title="Azure RG Inventory" group_id="az_rg_inventory" data={"columns":["Sub","RG","Region","Count"],"rows":[["sub-prod","rg-app","eastus",12]]}/>',
      '',
      'The inventory shows 1 row.',
    ].join('\n');
    const out = stripInlineComposeXml(input);
    expect(out).not.toContain('<compose_visual');
    expect(out).not.toContain('template="table"');
    expect(out).not.toContain('"columns":["Sub"');
    expect(out).toContain('Here is your Azure resource group inventory');
    expect(out).toContain('The inventory shows 1 row');
  });

  it('strips an open (non-self-closing) compose_app tag', () => {
    const input =
      'Dashboard rendered above.\n\n<compose_app template="k8s-topology" params={"pods":26}>\n\nNotes follow.';
    const out = stripInlineComposeXml(input);
    expect(out).not.toContain('<compose_app');
    expect(out).not.toContain('k8s-topology');
    expect(out).toContain('Dashboard rendered above');
    expect(out).toContain('Notes follow');
  });

  it('strips multiple tags in one body', () => {
    const input =
      'A: <compose_visual template="bar_chart" data={"x":[1],"y":[2]}/> B: <compose_visual template="line_chart" data={"x":[3],"y":[4]}/> done.';
    const out = stripInlineComposeXml(input);
    expect(out).not.toContain('<compose_visual');
    expect(out).not.toContain('bar_chart');
    expect(out).not.toContain('line_chart');
    expect(out).toContain('A:');
    expect(out).toContain('B:');
    expect(out).toContain('done');
  });

  it('leaves prose mentioning "compose_visual" (no real tag) unchanged', () => {
    const input =
      'The compose_visual tool was dispatched; see the chart above.';
    expect(stripInlineComposeXml(input)).toBe(input);
  });

  it('returns input unchanged when no tag present', () => {
    const input = 'Plain prose with no XML.';
    expect(stripInlineComposeXml(input)).toBe(input);
  });

  it('returns empty string unchanged', () => {
    expect(stripInlineComposeXml('')).toBe('');
  });

  it('collapses 3+ blank lines after stripping', () => {
    const input =
      'Before.\n\n<compose_visual template="x" data={"a":1}/>\n\n\n\nAfter.';
    const out = stripInlineComposeXml(input);
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain('Before');
    expect(out).toContain('After');
  });

  it('is idempotent — running twice gives the same result as once', () => {
    const input =
      'A.\n<compose_visual template="bar_chart" data={"x":[1],"y":[2]}/>\nB.';
    const once = stripInlineComposeXml(input);
    const twice = stripInlineComposeXml(once);
    expect(twice).toBe(once);
  });
});
