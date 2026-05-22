/**
 * transform node executor.
 *
 * Two supported contracts:
 *
 *   1. Legacy typed shape (map / filter / reduce / extract):
 *        { transformType: 'map'|'filter'|'reduce'|'extract', transformExpression }
 *      Migrated from WorkflowExecutionEngine.executeTransformNode.
 *      Behavior is preserved verbatim — same sandbox, same field aliases,
 *      same fallback dot-path for extract, same error messages.
 *
 *   2. Operations shape (Phase C1):
 *        { operations: Array<{ op: 'set', target, value }> }
 *      Each op mutates a working copy of the input. The 'set' op supports
 *      `{{...}}` template values which are evaluated as JS expressions in
 *      the V8 sandbox with the current working object bound as `input`.
 *      Unknown ops throw with a clear "Unknown transform op" error so the
 *      engine marks the run as failed instead of silently passing through.
 *
 * All user expressions run inside a V8 isolate via runSandboxed().
 * No new Function() usage.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { runSandboxed } from '../../sandbox.js';

interface SetOp {
  op: 'set';
  target: string;
  value: unknown;
}

type TransformOp = SetOp | { op: string; [k: string]: unknown };

/**
 * Resolve a single `value` from an op definition. When the value is a
 * string with `{{ ... }}` interpolation markers, the inner expression
 * is evaluated in a sandbox with `input` bound to `currentInput`.
 * Otherwise the literal value is returned as-is.
 *
 * Only the FULL-template case (`"{{expr}}"` with no surrounding text) is
 * evaluated as a JS expression — string concatenation templates are
 * intentionally not supported here because the harness contract is a
 * derived field assigned a single computed value. If callers need string
 * concatenation they can use the existing `extract` transformType or the
 * `code` node.
 */
async function resolveOpValue(
  raw: unknown,
  currentInput: unknown,
): Promise<unknown> {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  // Full-template case: "{{expr}}" with nothing else. Evaluate the inner
  // expression as JS with `input` bound.
  const fullMatch = trimmed.match(/^\{\{([\s\S]+)\}\}$/);
  if (fullMatch) {
    const expr = fullMatch[1].trim();
    const result = await runSandboxed(`return (${expr});`, {
      input: currentInput,
      timeoutMs: 2000,
    });
    if (!result.ok) {
      throw new Error(`Transform set error (${result.errorType}): ${result.error}`);
    }
    return result.value;
  }
  return raw;
}

async function executeOperations(
  operations: TransformOp[],
  input: unknown,
): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> =
    input && typeof input === 'object' && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : { input };
  for (const op of operations) {
    if (!op || typeof op !== 'object') {
      throw new Error(`Unknown transform op: ${JSON.stringify(op)}`);
    }
    switch (op.op) {
      case 'set': {
        const setOp = op as SetOp;
        if (!setOp.target || typeof setOp.target !== 'string') {
          throw new Error(`Transform set op missing target field`);
        }
        base[setOp.target] = await resolveOpValue(setOp.value, base);
        break;
      }
      default:
        throw new Error(`Unknown transform op: ${op.op}`);
    }
  }
  return base;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  // Accept both field name aliases (same as legacy engine).
  const { transformType, transformExpression: _txExpr, expression: _expr, operations } =
    node.data as Record<string, any>;
  const transformExpression: string = _txExpr || _expr;

  ctx.logger.info(
    { nodeId: node.id, transformType, hasOperations: Array.isArray(operations) },
    '[transform] Executing transform node',
  );

  // Phase C1: operations[] contract takes priority when present. This is
  // the shape the UI / templates / docs reach for.
  if (Array.isArray(operations)) {
    return executeOperations(operations as TransformOp[], input);
  }

  // Always work on an array.
  const items: unknown[] = Array.isArray(input) ? input : [input];

  switch (transformType) {
    case 'map': {
      const out: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        const result = await runSandboxed(`return (${transformExpression});`, {
          input: items[i],
          globals: { item: items[i], index: i },
          timeoutMs: 2000,
        });
        if (!result.ok) {
          throw new Error(`Transform map error (${result.errorType}): ${result.error}`);
        }
        out.push(result.value);
      }
      return out;
    }

    case 'filter': {
      const out: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        const result = await runSandboxed(`return !!(${transformExpression});`, {
          input: items[i],
          globals: { item: items[i], index: i },
          timeoutMs: 2000,
        });
        if (!result.ok) {
          throw new Error(`Transform filter error (${result.errorType}): ${result.error}`);
        }
        if (result.value) out.push(items[i]);
      }
      return out;
    }

    case 'reduce': {
      let acc: unknown = null;
      for (let i = 0; i < items.length; i++) {
        const result = await runSandboxed(`return (${transformExpression});`, {
          input: items[i],
          globals: { acc, item: items[i], index: i },
          timeoutMs: 2000,
        });
        if (!result.ok) {
          throw new Error(`Transform reduce error (${result.errorType}): ${result.error}`);
        }
        acc = result.value;
      }
      return acc;
    }

    case 'extract': {
      // Extract a field from input using JS expression.
      const result = await runSandboxed(`return (${transformExpression});`, {
        input,
        timeoutMs: 2000,
      });
      if (result.ok && result.value !== null && result.value !== undefined) {
        return result.value;
      }
      // Fallback: treat as dot-path accessor (legacy compat).
      let value: any = input;
      for (const key of (transformExpression || '').split('.')) {
        value = (value as any)?.[key];
      }
      return value ?? input;
    }

    default:
      return input;
  }
}
