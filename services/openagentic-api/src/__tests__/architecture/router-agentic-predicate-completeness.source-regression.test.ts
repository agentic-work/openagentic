/**
 * Source-regression: every TaskType ending in '-agentic' must appear in
 * SmartModelRouter.ts's `classifiedAgentic` predicate. If it doesn't, the
 * classifier returns the right capability profile but the router silently
 * applies the weak chat-pool FCA floor — which is what let gpt-oss:20b
 * win Q4/Q6/Q7 on 2026-05-13 despite the architecture-design-agentic
 * profile naming FCA 0.90.
 *
 * Pinned to grep both files. No model literals.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('arch — every -agentic TaskType is in SmartModelRouter classifiedAgentic predicate', () => {
  it('classifyTaskType TaskType union ⊆ classifiedAgentic comparator set', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const classifierSrc = fs.readFileSync(
      path.join(repoRoot, 'src/services/router/PromptClassifier.ts'),
      'utf8',
    );
    const routerSrc = fs.readFileSync(
      path.join(repoRoot, 'src/services/SmartModelRouter.ts'),
      'utf8',
    );

    // Extract every literal `'<word>-agentic'` from the TaskType union.
    const unionTypes = new Set<string>();
    const unionRe = /'([\w-]+-agentic)'/g;
    let m: RegExpExecArray | null;
    while ((m = unionRe.exec(classifierSrc)) !== null) unionTypes.add(m[1]);

    expect(unionTypes.size).toBeGreaterThan(0);

    // Extract literal `'<word>-agentic'` from the classifiedAgentic block.
    const routerBlock = routerSrc.split('const classifiedAgentic =')[1] ?? '';
    const guarded = routerBlock.split(';')[0] ?? '';

    const routerSet = new Set<string>();
    let r: RegExpExecArray | null;
    while ((r = unionRe.exec(guarded)) !== null) routerSet.add(r[1]);

    const missing = [...unionTypes].filter((t) => !routerSet.has(t));
    expect(missing, `classifiedAgentic is missing TaskType(s): ${missing.join(', ')}`).toEqual([]);
  });
});
