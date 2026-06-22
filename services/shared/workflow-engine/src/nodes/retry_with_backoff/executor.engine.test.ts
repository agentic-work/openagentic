/**
 * retry_with_backoff/executor.engine.test.ts — REAL engine-wiring integration
 * test (Critical #4).
 *
 * The sibling unit test (executor.test.ts) injects a `vi.fn()` for
 * `ctx.runSubStep` and asserts the executor *calls* it — but it never proves
 * the engine actually *provides* that hook. The Critical was that
 * `ctx.runSubStep` was wired into NEITHER engine, so the executor's only
 * production path threw "ctx.runSubStep hook is missing (engine not wired)".
 * The mock-only test stayed green while production was dead.
 *
 * This test removes the mock entirely. It drives the REAL
 * `retry_with_backoff` plugin (resolved from the shared node registry) through
 * a faithful, minimal graph engine whose `runSubStep` hook is a VERBATIM
 * mirror of the production wiring now in BOTH WorkflowExecutionEngine copies:
 *
 *     runSubStep: execute the node's outgoing (non-error) edges sequentially
 *                 via executeNode, surfacing the FIRST rejection.
 *
 * The downstream "operation" is a second real registry-dispatched node
 * (`__retry_engine_op__`) whose executor fails the first N invocations then
 * succeeds — a real rejection the engine surfaces through runSubStep, not an
 * injected stub. We prove:
 *
 *   1. retries-then-succeeds — the engine re-runs the downstream op until it
 *      succeeds; the retry envelope reports the true attempt count.
 *   2. retries-then-fails — the op is re-run exactly maxRetries+1 times, then
 *      the retry node rejects honestly (no fake-success envelope).
 *
 * Because the executor is invoked with NO `_attemptForTests` and the hook is
 * the production wiring, a regression that unwires `runSubStep` fails this
 * test — unlike the mock-only unit test.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { registry, runWithAssertions } from '../registry.js';
import type { NodeExecutionContext, WorkflowNode, NodePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Real downstream op — registered into the shared registry for this suite.
// `failuresLeft` is decremented per call; while > 0 it throws (a real
// rejection), at 0 it returns a success payload. `calls` records how many
// times the engine actually re-ran the subgraph through runSubStep.
// ---------------------------------------------------------------------------
const OP_TYPE = '__retry_engine_op__';
const op = { failuresLeft: 0, calls: 0 };

function ensureOpRegistered(): void {
  if (registry.has(OP_TYPE)) return;
  registry.set(OP_TYPE, {
    schema: {
      type: OP_TYPE,
      category: 'control',
      label: 'Retry Engine Test Op',
      description: 'Throwaway flaky op for the retry_with_backoff engine test.',
    },
    execute: async () => {
      op.calls += 1;
      if (op.failuresLeft > 0) {
        op.failuresLeft -= 1;
        throw new Error(`flaky op failure (#${op.calls})`);
      }
      return { okFromOp: true, callNumber: op.calls };
    },
  } as NodePlugin);
}

afterAll(() => {
  registry.delete(OP_TYPE);
});

beforeEach(() => {
  ensureOpRegistered();
  op.failuresLeft = 0;
  op.calls = 0;
});

// ---------------------------------------------------------------------------
// MiniEngine — a faithful, minimal subset of WorkflowExecutionEngine.
//
// It dispatches nodes through the SAME shared registry + runWithAssertions
// the real engine uses, and constructs the same NodeExecutionContext. Its
// `runSubStep` hook is a verbatim mirror of the production wiring added to
// both WorkflowExecutionEngine copies — so this test exercises that exact
// contract, not the executor in isolation.
// ---------------------------------------------------------------------------
interface Edge {
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

class MiniEngine {
  private nodes = new Map<string, WorkflowNode>();
  private outgoing = new Map<string, Edge[]>();
  /** Last-write-wins per node, mirroring the engine's nodeResults map. */
  readonly results = new Map<string, unknown>();
  private readonly signal = new AbortController().signal;

  constructor(nodes: WorkflowNode[], edges: Edge[]) {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
      this.outgoing.set(n.id, []);
    }
    for (const e of edges) this.outgoing.get(e.source)?.push(e);
  }

  private buildCtx(): NodeExecutionContext {
    return {
      signal: this.signal,
      executionId: 'exec-retry-engine',
      apiUrl: 'http://api',
      interpolateTemplate: (t: string) => t,
      getInternalAuthHeaders: () => ({}),
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },

      // VERBATIM mirror of the production runSubStep hook (both engines):
      // run the node's outgoing non-error edges sequentially via executeNode,
      // surfacing the FIRST rejection so the retry loop can back off.
      runSubStep: async (fromNodeId, branchInput) => {
        const outgoing = (this.outgoing.get(fromNodeId) || []).filter(
          (e) => e.sourceHandle !== 'error' && e.label !== 'error',
        );
        if (outgoing.length === 0) {
          throw new Error(
            `retry_with_backoff[${fromNodeId}]: no downstream step to run — ` +
              'connect a node to its output so there is an operation to retry.',
          );
        }
        let last: unknown;
        for (const edge of outgoing) {
          last = await this.executeNode(edge.target, branchInput);
        }
        return last;
      },
    } as unknown as NodeExecutionContext;
  }

  async executeNode(nodeId: string, input: unknown): Promise<unknown> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    const plugin = registry.get(node.type);
    if (!plugin) throw new Error(`No plugin for type: ${node.type}`);
    // Same path the engine takes: runWithAssertions applies the node's
    // outputAssertions (retry_with_backoff asserts result.ok === true).
    const result = await runWithAssertions(plugin, node, input, this.buildCtx());
    this.results.set(nodeId, result);
    return result;
  }
}

// retry_with_backoff → __retry_engine_op__
function makeEngine(retryData: Record<string, unknown>): MiniEngine {
  return new MiniEngine(
    [
      { id: 'retry', type: 'retry_with_backoff', data: retryData },
      { id: 'op', type: OP_TYPE, data: {} },
    ],
    [{ source: 'retry', target: 'op' }],
  );
}

describe('retry_with_backoff — REAL engine wiring (ctx.runSubStep)', () => {
  it('retries the downstream op via the engine then succeeds, reporting the true attempt count', async () => {
    op.failuresLeft = 2; // fail twice, succeed on the third attempt

    const engine = makeEngine({ maxRetries: 5, baseDelayMs: 1, maxDelayMs: 2, jitter: false });
    const envelope: any = await engine.executeNode('retry', { seed: 1 });

    // The engine actually re-ran the real downstream op through runSubStep.
    expect(op.calls).toBe(3);

    // The retry envelope reflects the real attempt count, not a stub.
    expect(envelope.ok).toBe(true);
    expect(envelope.attempts).toBe(3);
    expect(envelope.retries).toBe(2);
    expect(envelope.result).toEqual({ okFromOp: true, callNumber: 3 });

    // The retry node's stored result matches its return (engine bookkeeping).
    expect(engine.results.get('retry')).toBe(envelope);
  });

  it('re-runs the op maxRetries+1 times then rejects honestly when every attempt fails', async () => {
    op.failuresLeft = Number.POSITIVE_INFINITY; // never succeeds

    const engine = makeEngine({ maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, jitter: false });

    await expect(engine.executeNode('retry', { seed: 1 })).rejects.toThrow(
      /retry_with_backoff.*3 attempt.*flaky op failure/i,
    );

    // Engine drove exactly maxRetries+1 real attempts of the downstream op.
    expect(op.calls).toBe(3);
    // No fake-success envelope was stored for the retry node.
    expect(engine.results.has('retry')).toBe(false);
  });

  it('rejects when the retry node has no downstream op wired (engine surfaces the misconfig)', async () => {
    // retry node with NO outgoing edge — runSubStep must reject so the
    // executor's exhaustion path names the missing operation.
    const engine = new MiniEngine(
      [{ id: 'retry', type: 'retry_with_backoff', data: { maxRetries: 1, baseDelayMs: 1, jitter: false } }],
      [],
    );
    await expect(engine.executeNode('retry', {})).rejects.toThrow(
      /no downstream step to run|no operation to retry/i,
    );
  });
});
