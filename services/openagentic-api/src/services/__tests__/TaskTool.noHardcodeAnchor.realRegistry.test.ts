/**
 * Sev-1 #837 — TaskTool description must NOT anchor the model to a single
 * subagent_type. Real-data harness — uses the LIVE BuiltInAgentRegistry
 * (all 8 .md files on disk), NO mocks. Per
 * feedback_real_provider_testing_regime_chatmode_pivot.md and the
 * "no synthetic chunks" rule, this exercise the actual registry loader.
 *
 * Pre-fix state (commit b745f8c6): TaskTool.ts FOOTER hardcoded a single
 * canonical example with `subagent_type: "cloud_operations"`. Every Task
 * tool_use the model emitted resolved to cloud_operations regardless of
 * the work domain — 3 sub_agent_started frames captured 2026-05-14, all
 * role=cloud_operations, even for prompts that matched data-query /
 * validation / code-execution better. The single named example dominates
 * the model's pick (anchor bias).
 *
 * Post-fix contract:
 *   1. Description must NOT name a single subagent_type as the canonical example.
 *   2. Description MUST teach the discovery path: agent_search first → pick from
 *      results → Task with that name.
 *   3. Description MUST contain AT LEAST 2 distinct example subagent_type
 *      values OR zero hardcoded names (placeholder only).
 *   4. AVAILABLE list MUST be dynamic — every registered agent appears.
 *
 * E2E counterpart: curl /api/chat/stream with a multi-domain prompt
 * ("audit Azure spend; validate last deploy; find drift in our IaC")
 * and assert sub_agent_started frame `role` distribution > 1 distinct
 * value — i.e., the model picked DIFFERENT agents for different domains.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TASK_TOOL, buildTaskToolDescription } from '../TaskTool.js';
import {
  initializeAgentRegistry,
  getBuiltInAgents,
  resetBuiltInAgentRegistry,
} from '../BuiltInAgentRegistry.js';
import path from 'node:path';

// Pin the contract on the static schema description.
describe('Sev-1 #837 — TaskTool static description must not anchor on cloud_operations', () => {
  const desc = TASK_TOOL.function.description;

  it('does NOT contain a hardcoded `subagent_type: "cloud_operations"` example', () => {
    // The single named example is the anchor — kill it.
    // We allow `cloud_operations` to appear elsewhere (e.g. discovery hint or
    // multi-example list) but NOT as a `subagent_type: "..."` literal in
    // EXAMPLE block.
    const hardcodedExample = /subagent_type:\s*["']cloud_operations["']/;
    expect(desc).not.toMatch(hardcodedExample);
  });

  it('teaches the agent_search → Task discovery pattern (not a static enum)', () => {
    expect(desc.toLowerCase()).toContain('agent_search');
  });

  it('either uses a placeholder OR shows 2+ distinct subagent_type values in examples', () => {
    // Capture all `subagent_type: "..."` literals in examples.
    const matches = [...desc.matchAll(/subagent_type:\s*["']([a-z0-9_-]+)["']/gi)].map(m => m[1]);
    if (matches.length === 0) {
      // Acceptable: description leaves subagent_type unset in examples and
      // points the model at agent_search to fill it in.
      return;
    }
    const unique = new Set(matches);
    // 2+ distinct values OR a placeholder like <from-agent-search>.
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});

// Real-data harness — load the actual registry from disk, build the
// description, assert all 8 agents flow through.
describe('Sev-1 #837 — buildTaskToolDescription uses the live registry (no mocks)', () => {
  // Load the real markdown files from src/agents/built-in/ once for this suite.
  const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'agents', 'built-in');

  beforeAll(async () => {
    resetBuiltInAgentRegistry();
    await initializeAgentRegistry(AGENTS_DIR);
  });

  it('renders every BuiltInAgentRegistry entry into the AVAILABLE list', async () => {
    const agents = getBuiltInAgents();
    expect(agents.length).toBeGreaterThanOrEqual(8);

    const desc = await buildTaskToolDescription(
      agents.map(a => ({ agent_type: a.agent_type, display_name: a.display_name, description: a.description })),
    );

    // Every agent_type must be discoverable in the rendered description.
    for (const agent of agents) {
      expect(desc).toContain(agent.agent_type);
    }
  });

  it('does NOT inject `cloud_operations` as the only example even when registry has it', async () => {
    const agents = getBuiltInAgents();
    // Loader converts hyphens to underscores (cloud-operations.md → cloud_operations)
    // OR keeps the hyphen. Accept either form.
    expect(agents.some(a => /cloud[-_]operations/.test(a.agent_type))).toBe(true);

    const desc = await buildTaskToolDescription(
      agents.map(a => ({ agent_type: a.agent_type, display_name: a.display_name, description: a.description })),
    );

    const hardcodedExample = /subagent_type:\s*["']cloud_operations["']/;
    expect(desc).not.toMatch(hardcodedExample);
  });

  it('description references agent_search as the discovery primitive', async () => {
    const agents = getBuiltInAgents();
    const desc = await buildTaskToolDescription(
      agents.map(a => ({ agent_type: a.agent_type, display_name: a.display_name, description: a.description })),
    );
    expect(desc.toLowerCase()).toContain('agent_search');
  });

  it('description shows 2+ distinct example types OR none — never anchored on one', async () => {
    const agents = getBuiltInAgents();
    const desc = await buildTaskToolDescription(
      agents.map(a => ({ agent_type: a.agent_type, display_name: a.display_name, description: a.description })),
    );
    const matches = [...desc.matchAll(/subagent_type:\s*["']([a-z0-9_-]+)["']/gi)].map(m => m[1]);
    if (matches.length === 0) return;
    expect(new Set(matches).size).toBeGreaterThanOrEqual(2);
  });
});
