/**
 * #807 part 2 — server-side rescue parser for inline `<compose_app ...>` and
 * `<compose_visual ...>` XML emitted as plain text by models that fail to use
 * function-call syntax. The parser extracts template + params so chatLoop can
 * re-emit them as synthetic tool_use frames and the iframes mount.
 *
 * RED tests pin the exact shapes observed live on the dev environment:
 *  - o4-mini multi-line `params={...}` JS object literal (k8s audit turn)
 *  - single-line variant
 *  - mixed compose_app + compose_visual in one body
 *  - graceful skip on malformed/incomplete patterns
 */
import { describe, it, expect } from 'vitest';
import { parseInlineComposePatterns } from '../parseInlineComposePatterns.js';

describe('parseInlineComposePatterns (#807 part 2)', () => {
  it('parses multi-line compose_app with params object literal (o4-mini shape)', () => {
    const text = `Here is the cluster topology:

<compose_app template="k8s-cluster-topology" title="agentic-dev: namespace topology" params={
  "groups": [
    {"id": "agentic-dev", "label": "agentic-dev", "items": [{"name": "api"}]}
  ]
}>

And the KPI grid:

<compose_app template="kpi_grid" params={"items": [{"label": "pods", "value": 26}]}>`;

    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(2);
    expect(results[0].toolName).toBe('compose_app');
    expect(results[0].template).toBe('k8s-cluster-topology');
    expect(results[0].params.groups[0].items[0].name).toBe('api');
    expect(results[1].template).toBe('kpi_grid');
    expect(results[1].params.items[0].value).toBe(26);
  });

  it('parses single-line compose_app', () => {
    const text = `Run this: <compose_app template="savings-grid" params={"rows":[{"name":"a","saving":10}]}>`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(results[0].template).toBe('savings-grid');
    expect(results[0].params.rows[0].saving).toBe(10);
  });

  it('parses compose_visual same shape', () => {
    const text = `<compose_visual chart_type="bar" data={"labels":["a","b"],"values":[1,2]}>`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe('compose_visual');
    expect(results[0].params.chart_type).toBe('bar');
    expect(results[0].params.data.labels).toEqual(['a', 'b']);
  });

  it('handles params with nested quotes and brackets', () => {
    const text = `<compose_app template="x" params={"k":"v}with}brackets","arr":[1,{"n":2}]}>`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(results[0].params.k).toBe('v}with}brackets');
    expect(results[0].params.arr).toEqual([1, { n: 2 }]);
  });

  it('skips malformed patterns (no closing >)', () => {
    const text = `<compose_app template="x" params={`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(0);
  });

  it('skips invalid JSON in params', () => {
    const text = `<compose_app template="x" params={not json}>`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(0);
  });

  it('returns empty for text with no compose patterns', () => {
    const text = `Just normal prose. No tags. Here are the numbers: 1, 2, 3.`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(0);
  });

  it('records source range so caller can strip the XML from displayed text', () => {
    const text = `Before. <compose_app template="x" params={"a":1}> After.`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(text.substring(results[0].start, results[0].end)).toMatch(
      /^<compose_app .*>$/,
    );
  });

  it('parses fenced-code-block variant (model wrapped in ```)', () => {
    const text =
      'Here:\n```\n<compose_app template="x" params={"a":1}>\n```\nDone.';
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(results[0].template).toBe('x');
    expect(results[0].params.a).toBe(1);
  });

  it('parses JSX double-brace `data={{...}}` syntax (Sonnet 4.6 emission #946)', () => {
    // Live user report 2026-05-19: Sonnet emitted the bedrock spend chart as
    // JSX-style `<compose_visual ... data={{ "x":[...], "y":[...] }} />`.
    // The outer `{}` is JSX interpolation; the inner is the actual object.
    // Parser must strip the outer brace pair to recover the JSON.
    const text =
      '<compose_visual caption="Top Bedrock model spend" title="AWS Bedrock Spend (Last 90 Days)" template="bar_chart" group_id="bedrock-cost-90" data={{ "x":["Claude Sonnet 4.6","Claude Opus 4.6"], "y":[631.02,335.22] }} />';
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(1);
    expect(results[0].toolName).toBe('compose_visual');
    expect(results[0].params.template).toBe('bar_chart');
    expect(results[0].params.caption).toBe('Top Bedrock model spend');
    expect(results[0].params.group_id).toBe('bedrock-cost-90');
    expect((results[0].params.data as any).x).toEqual([
      'Claude Sonnet 4.6',
      'Claude Opus 4.6',
    ]);
    expect((results[0].params.data as any).y).toEqual([631.02, 335.22]);
  });

  it('parses both compose_app and compose_visual in same body', () => {
    const text = `
<compose_app template="ka" params={"a":1}>
some prose
<compose_visual chart_type="line" data={"x":[1,2,3]}>
`;
    const results = parseInlineComposePatterns(text);
    expect(results).toHaveLength(2);
    expect(results[0].toolName).toBe('compose_app');
    expect(results[1].toolName).toBe('compose_visual');
  });
});
