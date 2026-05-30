/**
 * switch node executor — schema-driven plugin shape (Task #45).
 *
 * Owns BOTH evaluation and routing:
 *   1. Resolve the expression template, evaluate it in a sandbox.
 *   2. Find the matching case (or default fallback) by string-equality.
 *   3. Read outgoing edges via ctx.getOutgoingEdges and pick the edge whose
 *      sourceHandle / label matches the selected case's value or label.
 *   4. Hand follow/skip target ids to ctx.routeBranches, which the engine
 *      wires to notifySkippedBranch (per skip) + executeNode (per follow).
 *
 * Continues to call notifySkippedBranch for unchosen branches via the
 * routeBranches hook — preserving the W1 / W4 switch→merge fix from commit
 * 1601b7a2.
 *
 * Result shape (consumed by outputAssertions in schema.json):
 *   {
 *     switchValue: string              // stringified expression value
 *     matched: string                  // case label, case value, or 'none'
 *     evaluatedExpression: unknown     // raw sandboxed return value
 *     selectedCase?: { value, label? } // for diagnostics
 *     input: unknown                   // pass-through for downstream nodes
 *   }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { runSandboxed } from '../../sandbox.js';

export interface SwitchResult {
  switchValue: string;
  matched: string;
  evaluatedExpression: unknown;
  selectedCase?: { value: string; label?: string };
  input: unknown;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<SwitchResult> {
  const { expression, cases = [] } = node.data as Record<string, any>;
  const resolvedExpr = ctx.interpolateTemplate(expression || '', input);

  ctx.logger.info(
    { nodeId: node.id, expression: resolvedExpr, caseCount: (cases as any[]).length },
    '[switch] Executing switch node',
  );

  // Evaluate the expression in a V8 isolate.
  let evaluatedExpression: unknown;
  let switchValue: string;
  const sandboxResult = await runSandboxed(`return (${resolvedExpr});`, {
    input,
    timeoutMs: 2000,
  });
  if (sandboxResult.ok) {
    evaluatedExpression = sandboxResult.value;
    switchValue = String(sandboxResult.value);
  } else {
    evaluatedExpression = resolvedExpr;
    switchValue = resolvedExpr;
  }

  // Find matching case.
  const caseList = cases as Array<{ value: string; label?: string }>;
  const matchedCase = caseList.find(c => String(c.value) === switchValue);
  const defaultCase = caseList.find(c => c.value === 'default');
  const selectedCase = matchedCase || defaultCase;

  const matched = selectedCase?.label || selectedCase?.value || 'none';

  // Decide which edge(s) to follow vs skip.
  const outgoing = ctx.getOutgoingEdges ? ctx.getOutgoingEdges(node.id) : [];
  const follow: string[] = [];
  const skip: string[] = [];

  if (outgoing.length > 0) {
    if (selectedCase) {
      const targetEdge = outgoing.find(
        e => e.sourceHandle === selectedCase.value || e.sourceHandle === selectedCase.label,
      );
      const chosen = targetEdge ?? (outgoing.length === 1 ? outgoing[0] : undefined);
      if (chosen) {
        follow.push(chosen.target);
        for (const edge of outgoing) {
          if (edge.target !== chosen.target) skip.push(edge.target);
        }
      } else {
        // No edge matched the selected case AND multiple edges exist — skip all.
        for (const edge of outgoing) skip.push(edge.target);
      }
    } else {
      // No case matched, no default → skip every outgoing edge so downstream
      // merges don't hang.
      for (const edge of outgoing) skip.push(edge.target);
    }
  }

  if (ctx.routeBranches && (follow.length > 0 || skip.length > 0)) {
    await ctx.routeBranches(node.id, { follow, skip }, input);
  }

  return {
    switchValue,
    matched,
    evaluatedExpression,
    selectedCase,
    input,
  };
}
