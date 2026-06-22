/**
 * Architecture gate: TaskTool description must NOT prime the model to
 * delegate cost queries. Live regression captured 2026-05-01: the
 * HEADER+FOOTER literally included an EXAMPLE block teaching the model
 * to call `Task(subagent_type: "cloud_operations")` for "Pull cost data
 * — list my Azure subscriptions and pull cost-by-service for the last
 * 90 days". Result: every "show me my cloud spend" prompt got
 * delegated to the cloud-operations sub-agent instead of letting the
 * main agent call `azure_cost_query` / `aws_cost_summary` /
 * `gcp_query_cost_usage` directly. Over-delegation cost the user real
 * latency and broke mock-01 parity.
 *
 * This gate keeps the regression from sneaking back.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TASK_TOOL = join(__dirname, '../..', 'services/TaskTool.ts');

describe('Architecture: TaskTool description does not bias toward cost-query delegation', () => {
  it('TaskTool.ts source exists', () => {
    expect(existsSync(TASK_TOOL)).toBe(true);
  });

  it('does NOT contain the "Pull cost data" example that primed over-delegation', () => {
    const src = readFileSync(TASK_TOOL, 'utf8');
    expect(src.toLowerCase()).not.toContain('pull cost data');
    expect(src).not.toContain('cost-by-service for');
  });

  it('contains explicit anti-bias for single-list / show-me / direct-tool asks', () => {
    const src = readFileSync(TASK_TOOL, 'utf8');
    // Must explicitly tell the model NOT to delegate single-list /
    // show-me asks. The exact phrases are the lever — if they get
    // softened, this test fails.
    expect(src).toMatch(/single[- ]list|"show me"|"list "/i);
    expect(src).toMatch(/call.*tools?.*direct|direct.*tool/i);
  });

  it('replacement EXAMPLE shows multi-step audit work, not single-list cost', () => {
    const src = readFileSync(TASK_TOOL, 'utf8');
    // The example must demonstrate genuinely multi-step work to
    // model the right delegation pattern. "audit", "drift", "across N
    // accounts/subs" are the canonical multi-step signals.
    expect(src).toMatch(/audit|drift|policy|compliance|across (all|every|multiple)/i);
  });
});
