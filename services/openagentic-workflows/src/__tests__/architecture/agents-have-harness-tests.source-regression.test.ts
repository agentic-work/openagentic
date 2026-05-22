/**
 * Bidirectional regression cage — every built-in agent has a harness
 * test, and every harness test maps to a real built-in agent.
 *
 * Phase E2 closer (per the harness backlog at
 * project_flows_test_harness.md). The built-in agent definitions live
 * under services/openagentic-api/src/agents/built-in/*.md as
 * frontmatter-bearing markdown files (role / description / tools /
 * model / system_prompt). The harness lives under
 * services/openagentic-workflows/test/harness/agents/<role>.test.ts.
 *
 * Why this cage matters:
 *   - Without it, adding a new built-in agent role can ship without a
 *     harness assertion covering the role + tools allow-list contract.
 *   - The reverse direction also matters: a harness test for a renamed
 *     or removed agent is asserting against a stale contract.
 *
 * Source-of-truth note: this test pins the FILENAME on both sides
 * (built-in/<role>.md ⇄ harness/agents/<role>.test.ts). The
 * frontmatter `role:` field is not the load-bearing key — the filename
 * is. Per the per-agent override audit (Task #191) the DB-side agent
 * row carries the canonical role, but for SoT-coverage purposes the
 * filename matches the role by convention and is what the cage
 * compares.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUILT_IN_DIR = resolve(
  __dirname,
  '../../../../openagentic-api/src/agents/built-in',
);
const HARNESS_DIR = resolve(__dirname, '../../../test/harness/agents');

function listAgentRoles(): string[] {
  if (!existsSync(BUILT_IN_DIR)) return [];
  return readdirSync(BUILT_IN_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

function listHarnessAgentRoles(): string[] {
  if (!existsSync(HARNESS_DIR)) return [];
  return readdirSync(HARNESS_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => f.replace(/\.test\.ts$/, ''))
    .sort();
}

describe('every built-in agent has a harness test (Phase E2 cage)', () => {
  it('every services/openagentic-api/src/agents/built-in/<role>.md has test/harness/agents/<role>.test.ts', () => {
    const agents = listAgentRoles();
    const tests = new Set(listHarnessAgentRoles());

    // Sanity: the built-in agents directory must actually exist + be non-empty.
    // If this fails, the path resolution above has drifted.
    expect(
      agents.length,
      `Phase E2: zero built-in agents found at ${BUILT_IN_DIR}. ` +
        `Either the path has drifted or built-in/ is empty.`,
    ).toBeGreaterThan(0);

    const missing = agents.filter((a) => !tests.has(a));
    expect(
      missing,
      `Phase E2: every built-in agent must have a harness test. ` +
        `Missing harness test files (add test/harness/agents/<role>.test.ts): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every harness agent test maps to a real built-in/<role>.md (no orphan tests)', () => {
    const agents = new Set(listAgentRoles());
    const tests = listHarnessAgentRoles();

    const orphans = tests.filter((t) => !agents.has(t));
    expect(
      orphans,
      `Phase E2: every agent harness test must correspond to a built-in agent .md. ` +
        `Orphan test files (remove or rename): ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
