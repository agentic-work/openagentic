/**
 * iterateOver — concurrency honored (H10 engine wire-up guard).
 *
 * The map_reduce executor calls
 *   ctx.iterateOver(nodeId, items, itemVariable, input, concurrency)
 * and reports `concurrency` in MapReduceResult. The engine's iterateOver
 * impl previously accepted only 4 params and ran items strictly
 * sequentially in a for-loop — the 5th `concurrency` arg was silently
 * dropped, so a 10-way fan-out actually ran 1-at-a-time. That made both
 * the `iterateOver?` type's `concurrency?` and `MapReduceResult.concurrency`
 * dishonest about runtime behaviour.
 *
 * This guard pins the honest contract on the engine source so a refactor
 * can't silently re-drop it. We assert the impl signature accepts a 5th
 * `concurrency` param, derives a bounded `limit` from it, and fans out with
 * a `Promise.all` worker window (not just the sequential for-loop). It
 * lives in the source-regression suite because that suite reads the engine
 * as text and does NOT pull the engine's full import chain — the behavioural
 * engine-import test class is pre-existing-red in this repo (unresolved
 * `@openagentic/workflow-engine/*` subpath aliases under vitest).
 *
 * The actual fan-out behaviour (peak in-flight <= limit, input-order
 * preservation, concurrency=1 stays sequential) is exercised end-to-end by
 * the shared executor test (map_reduce/executor.test.ts), which verifies the
 * `concurrency` arg is passed through to iterateOver.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ENGINE = join(
  REPO_ROOT,
  'services/openagentic-workflows/src/services/WorkflowExecutionEngine.ts',
);

describe('iterateOver — concurrency honored (H10)', () => {
  const text = readFileSync(ENGINE, 'utf8');

  it('iterateOver impl accepts a 5th `concurrency` parameter', () => {
    // `concurrency` carries an optional `?: number` annotation (the prior
    // four params are implicitly typed via the NodeExecutionContext hook
    // shape), so the regex tolerates an inline type after the name.
    expect(text).toMatch(
      /iterateOver:\s*async\s*\(\s*fromNodeId\s*,\s*items\s*,\s*itemVariable\s*,\s*baseInput\s*,\s*concurrency\??\s*(?::\s*[^),]+)?\s*\)/,
    );
  });

  it('derives a bounded limit from `concurrency` (not ignored)', () => {
    // A `limit` is computed from the concurrency arg — guards against the
    // param being declared-but-unused.
    expect(text).toMatch(/const\s+limit\s*=[\s\S]*concurrency/);
  });

  it('fans out with a Promise.all worker window when limit > 1', () => {
    // The honest fan-out path: bounded parallel workers, not a bare
    // sequential for-loop over every item.
    expect(text).toMatch(/await\s+Promise\.all\(\s*Array\.from\(\s*\{\s*length:\s*limit\s*\}/);
  });

  it('preserves input order via an index-keyed result slot, not push-on-completion', () => {
    // perItem is index-addressed so the flattened output is in input order
    // regardless of which worker finishes first.
    expect(text).toMatch(/perItem\[i\]\s*=/);
    expect(text).toMatch(/return\s+perItem\.flat\(\)/);
  });

  it('keeps a sequential fast-path for concurrency=1 (loop default)', () => {
    expect(text).toMatch(/if\s*\(\s*limit\s*===\s*1\s*\)/);
  });
});
