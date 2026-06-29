/**
 * parse_json node executor — typed processing primitive.
 *
 * Parses a JSON string into a structured object. The most common use is
 * "LLM returned a JSON body but it's a string; parse it before
 * downstream nodes consume it" — without writing JS in transform.
 *
 * Inputs (node.data):
 *   - input: path-template or omitted to use upstream input directly.
 *   - onError: how to surface a parse failure
 *       - 'fail'         (default) — throw → engine emits node_error
 *       - 'null'         — return { parsed: null, parseError: <msg> }
 *       - 'empty_object' — return { parsed: {}, parseError: <msg> }
 *
 * Output: { parsed: <object>, parseError: string | null }
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveInputValue } from '../processing-utils.js';

type OnError = 'fail' | 'null' | 'empty_object';

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<{ parsed: unknown; parseError: string | null }> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = node.data as Record<string, unknown>;
  const onError: OnError = (data.onError as OnError) ?? 'fail';

  const resolved = resolveInputValue(data.input, input, ctx);

  // resolveInputValue may already have produced a parsed object/array when
  // it spotted JSON-looking braces. Honor that — re-stringifying just to
  // re-parse is wasteful and breaks the contract.
  if (resolved !== null && typeof resolved === 'object') {
    ctx.logger.info(
      { nodeId: node.id, sourceWasAlreadyParsed: true },
      '[parse_json] Input was already an object — passing through',
    );
    return { parsed: resolved, parseError: null };
  }

  if (typeof resolved !== 'string') {
    const msg = `parse_json: input must be a string, got ${typeof resolved}`;
    if (onError === 'fail') throw new Error(msg);
    return {
      parsed: onError === 'empty_object' ? {} : null,
      parseError: msg,
    };
  }

  try {
    const parsed = JSON.parse(resolved);
    ctx.logger.info(
      { nodeId: node.id, ok: true },
      '[parse_json] Parsed JSON string',
    );
    return { parsed, parseError: null };
  } catch (err: any) {
    const msg = `parse_json: ${err?.message ?? String(err)}`;
    ctx.logger.warn(
      { nodeId: node.id, err: msg, onError },
      '[parse_json] Parse failed',
    );
    if (onError === 'fail') throw new Error(msg);
    return {
      parsed: onError === 'empty_object' ? {} : null,
      parseError: msg,
    };
  }
}
