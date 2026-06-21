/**
 * flow_tool node executor — wrap a saved Flow as a callable "tool".
 *
 * Gap-analysis 2026-05-14 P0 #3. Reference: Langflow
 *   src/lfx/src/lfx/components/flow_controls/flow_tool.py
 *
 * Behavior:
 *  1. Resolve `flowId` from node.data (template-substituted).
 *  2. Map the caller's args (`input`) through `inputMapping` — each value
 *     is run through ctx.interpolateTemplate against the input scope so
 *     `{{args.X}}` references resolve. An empty `inputMapping` passes the
 *     full input through.
 *  3. Invoke the engine's `executeSubWorkflow` hook (same one sub_workflow
 *     uses) with the resolved flowId + trigger input. Identity propagation +
 *     tenant scoping live on the hook side (engine threads userId /
 *     authToken / tenantId into the recursive call; idToken is inert in OSS —
 *     local-auth only, no OBO).
 *  4. Extract a value at `outputExtract` (dot/bracket path) from the child
 *     output. Empty `outputExtract` → return the full output.
 *  5. Recursion guard: if `ctx.subFlowDepth >= maxDepth (default 3)`,
 *     reject before invocation.
 *
 * V1 scope: callable from a parent flow only. Agent dynamic-tool
 * integration (the as-tool-schema endpoint + agent-side tool catalog)
 * is V1.1.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { resolveDotPath } from '../processing-utils.js';

const DEFAULT_MAX_DEPTH = 3;

export interface FlowToolOutput {
  /** Extracted value (or full output when outputExtract is empty). */
  value: unknown;
  /** The dot-path used (empty string when full output). */
  extracted: string;
  /** The flow id that was invoked. */
  flowId: string;
  /** Optional tool name (echoed back for downstream introspection). */
  toolName: string;
  /** The raw sub-flow output. Use this when you also want fields outside outputExtract. */
  raw: unknown;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<FlowToolOutput> {
  if (ctx.signal.aborted) throw new Error('aborted');

  const data = (node.data || {}) as Record<string, unknown>;

  // 1. flowId
  const flowIdRaw = typeof data.flowId === 'string' ? data.flowId : '';
  const flowId = flowIdRaw.includes('{{')
    ? ctx.interpolateTemplate(flowIdRaw, input).trim()
    : flowIdRaw.trim();
  if (!flowId) {
    throw new Error("flow_tool: 'flowId' is required");
  }

  if (!ctx.executeSubWorkflow) {
    throw new Error(
      'flow_tool: engine executeSubWorkflow hook is not wired — workflow engine config error',
    );
  }

  // 2. Recursion guard
  const maxDepth =
    typeof data.maxDepth === 'number' && data.maxDepth > 0 ? data.maxDepth : DEFAULT_MAX_DEPTH;
  const currentDepth = typeof ctx.subFlowDepth === 'number' ? ctx.subFlowDepth : 0;
  if (currentDepth >= maxDepth) {
    throw new Error(
      `flow_tool: sub-flow recursion depth ${currentDepth} >= maxDepth ${maxDepth} — refusing to nest deeper`,
    );
  }

  // 3. inputMapping
  const subInput = buildSubInput(data.inputMapping, input, ctx);

  ctx.logger.info(
    {
      nodeId: node.id,
      flowId,
      toolName: data.toolName,
      depth: currentDepth,
      mappedInputKeys: Object.keys(subInput),
    },
    '[flow_tool] Invoking sub-flow as tool',
  );

  // 4. Invoke sub-flow
  const result = await ctx.executeSubWorkflow(flowId, subInput);
  if (!result.success) {
    throw new Error(`flow_tool: sub-flow failed: ${result.error || 'unknown error'}`);
  }

  // 5. Extract
  const outputExtract =
    typeof data.outputExtract === 'string' ? data.outputExtract.trim() : '';
  let value: unknown = result.output;
  if (outputExtract) {
    const r = resolveDotPath(result.output, outputExtract);
    value = r.found ? r.value : undefined;
  }

  ctx.logger.info(
    { nodeId: node.id, flowId, outputExtract, hasValue: value !== undefined },
    '[flow_tool] Sub-flow completed',
  );

  return {
    value,
    extracted: outputExtract,
    flowId,
    toolName: typeof data.toolName === 'string' ? data.toolName : '',
    raw: result.output,
  };
}

function buildSubInput(
  inputMapping: unknown,
  input: unknown,
  ctx: NodeExecutionContext,
): Record<string, unknown> {
  // Empty / missing mapping → pass the input through verbatim.
  if (
    !inputMapping ||
    typeof inputMapping !== 'object' ||
    Array.isArray(inputMapping) ||
    Object.keys(inputMapping as Record<string, unknown>).length === 0
  ) {
    return input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputMapping as Record<string, unknown>)) {
    if (typeof v === 'string' && v.includes('{{')) {
      out[k] = ctx.interpolateTemplate(v, input);
    } else {
      out[k] = v;
    }
  }
  return out;
}
