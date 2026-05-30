/**
 * parallel node executor — schema-driven plugin shape (Task #45).
 *
 * Owns fan-out via the `ctx.fanOutBranches` hook. The engine wires the hook
 * to `Promise.allSettled` over `executeNode(edge.target, input)` for each
 * outgoing edge — so the existing fan-out / fan-in semantics are preserved.
 * The executor wraps that with a uniform result shape that downstream
 * outputAssertions can validate.
 *
 * Result shape (consumed by outputAssertions in schema.json):
 *   {
 *     branches: [{ targetId, status, value? | error? }]
 *     successRate: number      // 0..1, fraction of branches that fulfilled
 *     allSucceeded: boolean
 *     branchCount: number
 *   }
 *
 * Note: race / waitForAll mode + per-branch timeout used to live in the
 * legacy `executeParallelNode` engine method. With the schema-driven path,
 * the engine's fanOutBranches implementation is the single owner of
 * Promise.allSettled fan-out — race-mode is intentionally dropped because
 * (a) it was never used in saved flows and (b) it's a semantics mismatch
 * with `successRate` / outputAssertions. Timeout-per-branch can be
 * re-introduced as an engine-side wrap when a real workflow needs it.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

export interface ParallelBranchResult {
  targetId: string;
  status: 'fulfilled' | 'rejected';
  value?: unknown;
  error?: string;
}

export interface ParallelResult {
  branches: ParallelBranchResult[];
  branchCount: number;
  successRate: number;
  allSucceeded: boolean;
  /**
   * Echo of the configured threshold (defaults to 0.5). Surfaced in the
   * result so the schema's outputAssertion can compare against it without
   * needing access to node.data.
   */
  minSuccessRate: number;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<ParallelResult> {
  const data = (node.data || {}) as Record<string, any>;
  const minSuccessRate =
    typeof data.minSuccessRate === 'number' ? data.minSuccessRate : 0.5;

  ctx.logger.info(
    { nodeId: node.id, minSuccessRate },
    '[parallel] Fanning out to all outgoing edges',
  );

  if (!ctx.fanOutBranches) {
    throw new Error(
      '[parallel] ctx.fanOutBranches hook is required — engine is not wired correctly',
    );
  }

  const settled = await ctx.fanOutBranches(node.id, input);

  const branches: ParallelBranchResult[] = settled.map(b => ({
    targetId: b.targetId,
    status: b.status,
    value: b.status === 'fulfilled' ? b.value : undefined,
    error: b.status === 'rejected' ? b.reason : undefined,
  }));

  const fulfilled = branches.filter(b => b.status === 'fulfilled').length;
  const successRate = branches.length > 0 ? fulfilled / branches.length : 0;
  const allSucceeded = branches.length > 0 && fulfilled === branches.length;

  return {
    branches,
    branchCount: branches.length,
    successRate,
    allSucceeded,
    minSuccessRate,
  };
}
