/**
 * select_data node executor — typed processing primitive.
 *
 * Picks (or omits) named fields by dot-path from an object or each row
 * of an array of objects. Replaces the JS-expression-only path through
 * `transform` for the common "project these columns" case.
 *
 * Inputs (node.data):
 *   - input: path-template (e.g. '{{trigger.pods}}') OR omitted to use
 *     the upstream connection's input directly. Accepts object or array.
 *   - fields: array of dot-paths to keep (or drop, see mode).
 *   - mode: 'pick' (default) — keep only listed fields.
 *           'omit' — drop listed fields, keep everything else.
 *
 * Output: same outer shape as the input (object stays object, array
 * stays array), with each row carrying only the projected fields.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveDotPath, resolveInputValue } from '../processing-utils.js';

type Mode = 'pick' | 'omit';

function setDotPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s.length > 0);
  if (segments.length === 0) return;
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!(seg in cursor) || typeof cursor[seg] !== 'object' || cursor[seg] === null) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function deleteDotPath(target: Record<string, unknown>, path: string): void {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((s) => s.length > 0);
  if (segments.length === 0) return;
  let cursor: any = target;
  for (let i = 0; i < segments.length - 1; i++) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return;
    cursor = cursor[segments[i]];
  }
  if (cursor && typeof cursor === 'object') {
    delete cursor[segments[segments.length - 1]];
  }
}

function projectOne(row: unknown, fields: string[], mode: Mode): unknown {
  if (row === null || row === undefined || typeof row !== 'object' || Array.isArray(row)) {
    return row;
  }
  if (mode === 'pick') {
    const out: Record<string, unknown> = {};
    for (const path of fields) {
      const { value, found } = resolveDotPath(row, path);
      if (found) setDotPath(out, path, value);
    }
    return out;
  }
  // omit — clone and drop listed paths
  const clone = JSON.parse(JSON.stringify(row));
  for (const path of fields) {
    deleteDotPath(clone, path);
  }
  return clone;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const rawFields = data.fields;
  const mode: Mode = data.mode === 'omit' ? 'omit' : 'pick';

  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new Error("select_data: 'fields' must be a non-empty array of dot-paths");
  }
  const fields = rawFields.map((f) => String(f)).filter((f) => f.length > 0);
  if (fields.length === 0) {
    throw new Error("select_data: 'fields' contained only empty strings");
  }

  const resolved = resolveInputValue(data.input, input, ctx);
  if (resolved === null || resolved === undefined) {
    throw new Error('select_data: input is required (resolved to null/undefined)');
  }

  ctx.logger.info(
    { nodeId: node.id, mode, fieldCount: fields.length, inputIsArray: Array.isArray(resolved) },
    '[select_data] Projecting fields',
  );

  if (Array.isArray(resolved)) {
    return resolved.map((row) => projectOne(row, fields, mode));
  }
  return projectOne(resolved, fields, mode);
}
