/**
 * Architecture gate: cloud-operations.md must contain an ATTEMPT-FIRST
 * rule. Live regression captured 2026-05-01: the cloud-operations
 * sub-agent received `azure_cost_query` / `aws_cost_summary` /
 * `gcp_query_cost_usage` in its tool array (74 azure_* tools loaded
 * in the live mcp-proxy catalog, all matched by the `azure_*` /
 * `aws_*` / `gcp_*` wildcards in the agent's frontmatter), but
 * SPECULATED that they weren't available and reported "No cost/spend
 * query tools available" without ever calling them. The fix is a
 * prompt-level rule that forbids speculation about absence — the
 * model MUST attempt each tool before reporting unavailability.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AGENT = join(__dirname, '../..', 'agents/built-in/cloud-operations.md');

describe('Architecture: cloud-operations sub-agent has ATTEMPT-FIRST rule', () => {
  it('agent file exists', () => {
    expect(existsSync(AGENT)).toBe(true);
  });

  it('contains an explicit ATTEMPT-FIRST clause forbidding speculation about tool absence', () => {
    const src = readFileSync(AGENT, 'utf8').toLowerCase();
    // Must literally tell the model to TRY before reporting absence.
    // Two anchors so reviewers can't soften this away:
    expect(src).toMatch(/attempt|must call|must try/i);
    expect(src).toMatch(/never (claim|speculate|report).+(absent|unavailable|not available)|do not report.+(absent|unavailable|not available)/i);
  });

  it('mentions the wildcard scope guarantee (tools matching azure_*/aws_*/gcp_* are in the array)', () => {
    const src = readFileSync(AGENT, 'utf8');
    // Reminds the model that wildcard-matched tools are guaranteed
    // present. This is the bridge between frontmatter + runtime.
    expect(src).toMatch(/azure_\*|aws_\*|gcp_\*/);
    expect(src).toMatch(/array|guaranteed|available|in your tool/i);
  });

  it('cost-query tools are explicitly named so the model knows the canonical path', () => {
    const src = readFileSync(AGENT, 'utf8');
    // Concrete tool names anchor the prompt — vague guidance loses,
    // explicit naming wins. (Caught 2026-05-01: model said "I don't
    // have cost tools" when azure_cost_query was right there.)
    expect(src).toMatch(/azure_cost|aws_cost|gcp_(query_cost|billing)/i);
  });
});
