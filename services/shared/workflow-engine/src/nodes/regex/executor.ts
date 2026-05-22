/**
 * regex node executor — typed processing primitive.
 *
 * Applies a regex pattern to a string in one of three modes:
 *   - 'match'   → { matches: [{full, groups}], count }
 *   - 'replace' → { result: string, replacedCount }
 *   - 'test'    → { matches: boolean }
 *
 * Inputs (node.data):
 *   - input: path-template or omitted to use upstream input.
 *   - pattern: regex source string (NOT including //).
 *   - flags: optional flag string ('g', 'i', 'gi', etc.).
 *   - mode: 'match' | 'replace' | 'test'.
 *   - replacement: replacement string (only used for mode='replace').
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveInputValue } from '../processing-utils.js';

type Mode = 'match' | 'replace' | 'test';

interface MatchResult {
  matches: Array<{ full: string; groups: string[] }>;
  count: number;
}
interface ReplaceResult {
  result: string;
  replacedCount: number;
}
interface TestResult {
  matches: boolean;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<MatchResult | ReplaceResult | TestResult> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const pattern = typeof data.pattern === 'string' ? data.pattern : '';
  const flags = typeof data.flags === 'string' ? data.flags : '';
  const mode: Mode = (data.mode as Mode) ?? 'match';

  if (!pattern) {
    throw new Error("regex: 'pattern' is required");
  }
  if (mode !== 'match' && mode !== 'replace' && mode !== 'test') {
    throw new Error(
      `regex: unsupported mode '${String(mode)}'. Allowed: match, replace, test`,
    );
  }

  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (err: any) {
    throw new Error(`regex: invalid pattern: ${err?.message ?? String(err)}`);
  }

  const resolved = resolveInputValue(data.input, input, ctx);
  if (typeof resolved !== 'string') {
    throw new Error(`regex: input must be a string, got ${typeof resolved}`);
  }

  ctx.logger.info(
    { nodeId: node.id, mode, hasGlobalFlag: re.global },
    '[regex] Applying pattern',
  );

  if (mode === 'test') {
    return { matches: re.test(resolved) };
  }

  if (mode === 'replace') {
    const replacement = typeof data.replacement === 'string' ? data.replacement : '';
    let replacedCount = 0;
    // Count replacements as we go — match-all returns the number of
    // distinct match positions; replace itself does the substitution.
    const result = resolved.replace(re, (...args) => {
      replacedCount += 1;
      // args = [match, ...captureGroups, offset, fullString, groups?]
      // Re-apply the standard $1/$2 substitution semantics manually to
      // honor the user's replacement string.
      const groups = args.slice(1, args.length - 2) as string[];
      return replacement.replace(/\$(\d+)/g, (_, n) => {
        const idx = Number(n) - 1;
        return groups[idx] ?? '';
      });
    });
    return { result, replacedCount };
  }

  // mode === 'match' — collect all matches with capture groups
  const matches: Array<{ full: string; groups: string[] }> = [];
  if (re.global) {
    for (const m of resolved.matchAll(re)) {
      matches.push({ full: m[0], groups: m.slice(1).map((g) => g ?? '') });
    }
  } else {
    const m = resolved.match(re);
    if (m) {
      matches.push({ full: m[0], groups: m.slice(1).map((g) => g ?? '') });
    }
  }
  return { matches, count: matches.length };
}
