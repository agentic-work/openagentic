/**
 * Bidirectional regression cage — every registered node type has a
 * harness test, and every harness test maps to a real registered node.
 *
 * Phase E1 closer (per the harness backlog at
 * project_flows_test_harness.md). The harness lives under
 * test/harness/primitives/<type>.test.ts. The node plugin registry is
 * the source of truth at services/shared/workflow-engine/src/nodes/
 * (one folder per type, registered in registry.ts).
 *
 * Why this cage matters:
 *   - Without it, adding a new node type (new folder + register() call)
 *     ships uncovered to production. The cage forces a harness test in
 *     the same commit as the new node.
 *   - The reverse direction also matters: a harness test for a
 *     deleted/renamed node type means the test is asserting against a
 *     stale contract that nobody runs.
 *
 * Implementation note:
 *   We read the canonical list of node types from the node folder
 *   layout (every subdirectory under services/shared/workflow-engine/
 *   src/nodes/ except `__tests__` is a registered node type). This
 *   matches the registry.ts static-import pattern exactly — adding a
 *   folder without registering it would surface a regression elsewhere
 *   (the registry's own arch tests), so we don't need to re-parse
 *   registry.ts here.
 *
 * Streaming/oboRouting/typedEvents siblings:
 *   Some node types have multiple harness test files (e.g.
 *   `llm_completion.test.ts` + `llm_completion.streaming.test.ts`).
 *   The cage strips the secondary suffix before matching against the
 *   node folder name.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NODES_DIR = resolve(__dirname, '../../../../shared/workflow-engine/src/nodes');
const HARNESS_DIR = resolve(__dirname, '../../../test/harness/primitives');

/** Sub-directory names under nodes/ that are NOT registered node types. */
const NON_NODE_DIRS: ReadonlySet<string> = new Set(['__tests__']);

function listNodeTypes(): string[] {
  return readdirSync(NODES_DIR)
    .filter((entry) => !NON_NODE_DIRS.has(entry))
    .filter((entry) => {
      const full = join(NODES_DIR, entry);
      return statSync(full).isDirectory();
    })
    .sort();
}

function listHarnessNodeTypes(): string[] {
  const files = readdirSync(HARNESS_DIR).filter((f) => f.endsWith('.test.ts'));
  // Strip `.test.ts` and any `.streaming` / `.oboRouting` / `.typedEvents`
  // qualifier before matching against the node folder name.
  const types = new Set<string>();
  for (const f of files) {
    const base = f.replace(/\.test\.ts$/, '');
    const root = base.replace(/\.(streaming|oboRouting|typedEvents)$/, '');
    types.add(root);
  }
  return Array.from(types).sort();
}

describe('every registered Flows node has a harness test (Phase E1 cage)', () => {
  it('every node folder under shared/workflow-engine/src/nodes/ has test/harness/primitives/<type>.test.ts', () => {
    const nodes = listNodeTypes();
    const tests = new Set(listHarnessNodeTypes());

    const missing = nodes.filter((n) => !tests.has(n));
    expect(
      missing,
      `Phase E1: every node type must have a harness test. ` +
        `Missing harness test files (add test/harness/primitives/<type>.test.ts): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every harness test file maps to a real node folder (no orphan tests)', () => {
    const nodes = new Set(listNodeTypes());
    const tests = listHarnessNodeTypes();

    const orphans = tests.filter((t) => !nodes.has(t));
    expect(
      orphans,
      `Phase E1: every harness test must correspond to a registered node type. ` +
        `Orphan test files (remove or rename): ${orphans.join(', ')}`,
    ).toEqual([]);
  });
});
