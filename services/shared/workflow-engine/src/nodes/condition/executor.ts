/**
 * condition node executor — schema-driven plugin shape (Task #45).
 *
 * Owns BOTH evaluation and routing:
 *   1. Resolve template variables and evaluate the JS expression in a sandbox.
 *   2. Read the node's outgoing edges via ctx.getOutgoingEdges.
 *   3. Decide which targets to follow (matching label/sourceHandle, or
 *      position-based truthy/falsy fallback) and which to skip.
 *   4. Hand the decision to ctx.routeBranches, which the engine wires to
 *      notifySkippedBranch (per skip target) + executeNode (per follow target).
 *
 * The legacy WorkflowExecutionEngine.executeConditionNode previously owned
 * the routing because it depended on outgoingEdges + executeNode +
 * notifySkippedBranch directly. After Task #45 those are surfaced via the
 * NodeExecutionContext hooks, so this executor is the single source of truth
 * for condition behavior.
 *
 * Result shape (consumed by outputAssertions in schema.json):
 *   {
 *     matched: string                  // 'true' | 'false' | edge-label | 'none'
 *     evaluatedExpression: unknown     // the sandboxed expression's return value
 *     condition: string | undefined    // raw expression for debugging
 *   }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { runSandboxed } from '../../sandbox.js';

export interface ConditionResult {
  matched: string;
  evaluatedExpression: unknown;
  condition?: string;
}

/**
 * Coerce an interpolated string back to a primitive so condition expressions
 * keep their natural JS semantics once the value is a named global: a numeric
 * string becomes a number (so `input.value > {{x}}` and `{{x}} === 5` work),
 * 'true'/'false' become booleans, everything else stays a string.
 */
function coercePrimitive(v: string): unknown {
  const t = v.trim();
  if (t !== '' && /^-?\d+(?:\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  return v;
}

async function evaluateExpression(
  condition: string | undefined,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (!condition) return false;
  try {
    // Bind every {{...}} reference to a NAMED GLOBAL (a real JS value) rather
    // than splicing the resolved text into the expression source. A prior LLM
    // node's output is frequently multi-line and quote-bearing; inlining it
    // produced invalid JS like `Severity: "CRITICAL"....includes('critical')`
    // → sandbox parse error → the executor silently returned FALSE and routed
    // critical findings down the "clean" branch (the live flow-7 Code-Review
    // bug). Ported from the legacy WorkflowExecutionEngine.evaluateCondition,
    // which resolved {{steps.X}} to named vars for exactly this reason.
    const globals: Record<string, unknown> = {};
    let idx = 0;
    let hadTemplate = false;
    const rewritten = condition.replace(/\{\{[^}]+\}\}/g, (token) => {
      hadTemplate = true;
      const name = `__cv${idx++}`;
      globals[name] = coercePrimitive(ctx.interpolateTemplate(token, input));
      return name;
    });

    if (hadTemplate) {
      const sandboxed = await runSandboxed(`return (${rewritten});`, {
        input,
        globals,
        timeoutMs: 2000,
      });
      if (sandboxed.ok) return sandboxed.value;

      // Legacy compat: a non-JS condition that interpolates to a 'yes'/'no'
      // sentinel rather than a JS expression.
      const flat = ctx.interpolateTemplate(condition, input);
      if (typeof flat === 'string') {
        const lower = flat.toLowerCase().trim();
        if (lower === 'true' || lower === 'yes') return true;
        if (lower === 'false' || lower === 'no' || lower === '') return false;
      }
      return false;
    }

    // No templates → evaluate the raw expression with `input` available.
    const sandboxed = await runSandboxed(`return (${condition});`, {
      input,
      timeoutMs: 2000,
    });
    if (sandboxed.ok) return sandboxed.value;
    return false;
  } catch {
    return false;
  }
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<ConditionResult> {
  const data = node.data as Record<string, any>;
  const condition: string | undefined = data.condition || data.expression;

  ctx.logger.info(
    { nodeId: node.id, condition },
    '[condition] Evaluating condition node',
  );

  const evaluatedExpression = await evaluateExpression(condition, input, ctx);
  const resultStr = String(evaluatedExpression).toLowerCase();
  const isTruthy =
    evaluatedExpression === true ||
    evaluatedExpression === 'true' ||
    (typeof evaluatedExpression === 'number' && evaluatedExpression > 0);
  const isFalsy =
    evaluatedExpression === false ||
    evaluatedExpression === 'false' ||
    evaluatedExpression === 0 ||
    evaluatedExpression === null ||
    evaluatedExpression === undefined;

  const matched = isTruthy ? 'true' : isFalsy ? 'false' : resultStr;

  // Read the node's outgoing edges; without the hook (or no edges) we still
  // produce a result the assertions can inspect.
  const outgoing = ctx.getOutgoingEdges ? ctx.getOutgoingEdges(node.id) : [];

  const follow: string[] = [];
  const skip: string[] = [];

  if (outgoing.length === 1) {
    // Single outgoing edge → always follow it.
    follow.push(outgoing[0].target);
  } else if (outgoing.length > 1) {
    for (const edge of outgoing) {
      const edgeLabel = (edge.label || '').toLowerCase().trim();
      const handle = edge.sourceHandle
        ? edge.sourceHandle.toLowerCase().trim()
        : undefined;

      // Phase C2: when an edge has an explicit sourceHandle, that handle is
      // authoritative — it MUST equal the matched result. Without this
      // short-circuit, label-based heuristics (specifically the
      // `edgeLabel === ''` clause in the truthy branch) would let the
      // false-branch edge piggy-back on the truthy path, because
      // sourceHandle-only edges have no `label` set and edgeLabel
      // collapses to ''.
      let shouldFollow: boolean;
      if (handle !== undefined && handle !== '') {
        shouldFollow = handle === resultStr;
      } else {
        shouldFollow =
          edgeLabel === resultStr ||
          (isTruthy && (edgeLabel === 'true' || edgeLabel === 'yes' || edgeLabel === '')) ||
          (isFalsy && (edgeLabel === 'false' || edgeLabel === 'no'));
      }
      if (shouldFollow) {
        follow.push(edge.target);
      } else {
        skip.push(edge.target);
      }
    }

    // Position-based fallback when no edge label matched: truthy → first edge,
    // falsy → second edge. Mirrors the legacy executeConditionNode behavior.
    if (follow.length === 0) {
      const targetIdx = isTruthy ? 0 : 1;
      const targetEdge = outgoing[Math.min(targetIdx, outgoing.length - 1)];
      follow.push(targetEdge.target);
      // Rebuild skip list excluding the chosen target.
      skip.length = 0;
      for (const edge of outgoing) {
        if (edge.target !== targetEdge.target) skip.push(edge.target);
      }
    }
  }

  if (ctx.routeBranches && (follow.length > 0 || skip.length > 0)) {
    await ctx.routeBranches(node.id, { follow, skip }, input);
  }

  return {
    matched,
    evaluatedExpression,
    condition,
  };
}
