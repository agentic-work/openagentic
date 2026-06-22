/**
 * Unit test for computeToolPrefixes — the count-by-prefix tally that
 * replaced the silent-failure-prone `toolNames.slice(0, 5)` log shape.
 */
import { describe, it, expect } from 'vitest';
import { computeToolPrefixes } from '../OllamaProvider.js';

describe('computeToolPrefixes', () => {
  it('returns all-zero counts for empty / undefined input', () => {
    const empty = computeToolPrefixes([]);
    expect(empty.meta).toBe(0);
    expect(empty.azure).toBe(0);
    expect(empty.aws).toBe(0);
    expect(empty.gcp).toBe(0);
    expect(empty.k8s).toBe(0);
    expect(empty.github).toBe(0);
    expect(empty.other).toBe(0);

    const undef = computeToolPrefixes(undefined);
    expect(undef.meta).toBe(0);
  });

  it('counts all 6 meta tools by exact name match', () => {
    const tools = [
      { function: { name: 'Task' } },
      { function: { name: 'compose_visual' } },
      { function: { name: 'render_artifact' } },
      { function: { name: 'request_clarification' } },
      { function: { name: 'browser_sandbox_exec' } },
      { function: { name: 'memorize' } },
    ];
    const r = computeToolPrefixes(tools);
    expect(r.meta).toBe(6);
    expect(r.other).toBe(0);
  });

  it('counts MCP tools by their server prefix (azure_, aws_, gcp_, k8s_, github_, admin_system_)', () => {
    const tools = [
      { function: { name: 'azure_list_subscriptions' } },
      { function: { name: 'azure_cost_management_query' } },
      { function: { name: 'aws_resourcegroupstaggingapi_get_resources' } },
      { function: { name: 'gcp_compute_instances_list' } },
      { function: { name: 'k8s_list_pods' } },
      { function: { name: 'github_list_issues' } },
      { function: { name: 'admin_system_postgres_raw_query' } },
    ];
    const r = computeToolPrefixes(tools);
    expect(r.azure).toBe(2);
    expect(r.aws).toBe(1);
    expect(r.gcp).toBe(1);
    expect(r.k8s).toBe(1);
    expect(r.github).toBe(1);
    expect(r.admin_system).toBe(1);
    expect(r.other).toBe(0);
  });

  it('the smoking-gun shape: 6 meta + 30 azure tools tallies cleanly', () => {
    const tools = [
      { function: { name: 'Task' } },
      { function: { name: 'compose_visual' } },
      { function: { name: 'render_artifact' } },
      { function: { name: 'request_clarification' } },
      { function: { name: 'browser_sandbox_exec' } },
      { function: { name: 'memorize' } },
      ...Array.from({ length: 30 }, (_, i) => ({
        function: { name: `azure_resource_${i}` },
      })),
    ];
    const r = computeToolPrefixes(tools);
    expect(r.meta).toBe(6);
    expect(r.azure).toBe(30);
    expect(r.other).toBe(0);
    // Total must equal input length — no double-counting.
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    expect(total).toBe(36);
  });

  it('unknown / unrecognised prefixes flow to `other`', () => {
    const tools = [
      { function: { name: 'unknown_thing_do' } },
      { function: { name: 'foo_bar' } },
      { name: 'no_function_wrapper' }, // tools may use either shape
    ];
    const r = computeToolPrefixes(tools);
    expect(r.other).toBe(3);
    expect(r.meta).toBe(0);
  });

  it('handles malformed entries without throwing', () => {
    const tools = [
      null,
      undefined,
      {},
      { function: {} },
      { function: { name: '' } },
      { function: { name: 'Task' } },
    ];
    const r = computeToolPrefixes(tools as any);
    expect(r.meta).toBe(1);
    // Everything malformed counts as `other`.
    expect(r.other).toBe(5);
  });
});
