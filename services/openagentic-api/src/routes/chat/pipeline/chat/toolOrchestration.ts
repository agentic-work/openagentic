/**
 * V3 tool orchestration — partitionToolCalls + runConcurrent + runSerial.
 *
 * Ported from <claude-code-src>/services/tools/toolOrchestration.ts:91.
 *
 * The model emits multiple tool_use blocks per turn; this module decides
 * which can run in parallel (read-only) and which must run alone (writes).
 * Adjacent read-only blocks coalesce into one batch; every mutating block
 * gets its own batch.
 *
 * Concurrency cap: 5 (multi-tenant safer than Claude Code's 10).
 *
 * Plan §Parallel/Serial Dispatch.
 */
import type { RunCtx, ToolDispatchResult, ToolUseBlock } from './types.js';

export interface Batch {
  isConcurrencySafe: boolean;
  blocks: ToolUseBlock[];
}

export interface RunResult {
  toolUseId: string;
  name: string;
  result: ToolDispatchResult;
}

export type DispatchFn = (
  ctx: RunCtx,
  call: { name: string; input: unknown },
) => Promise<ToolDispatchResult>;

/**
 * Split tool_use blocks into batches:
 *   - run of consecutive concurrency-safe tools  → one parallel batch
 *   - any non-safe tool                          → its own serial batch
 *
 * `concurrencySafeNames` is the SoT for which tool names are safe; the
 * toolRegistry computes it from `PermissionService.classifyName()`
 * (allow = safe; deny/ask = serial). See architecture test #17.
 */
export function partitionToolCalls(
  blocks: ReadonlyArray<ToolUseBlock>,
  concurrencySafeNames: ReadonlySet<string>,
): Batch[] {
  const batches: Batch[] = [];
  for (const block of blocks) {
    const safe = concurrencySafeNames.has(block.name);
    const last = batches[batches.length - 1];
    if (safe && last?.isConcurrencySafe) {
      last.blocks.push(block);
    } else {
      batches.push({ isConcurrencySafe: safe, blocks: [block] });
    }
  }
  return batches;
}

/**
 * Run blocks in parallel with a max-concurrency cap. Result order matches
 * input order regardless of completion order (Promise.all preserves index).
 */
export async function runConcurrent(
  ctx: RunCtx,
  blocks: ReadonlyArray<ToolUseBlock>,
  dispatch: DispatchFn,
  concurrency: number,
): Promise<RunResult[]> {
  const results: RunResult[] = new Array(blocks.length);
  let cursor = 0;

  // Worker pool: spawn `concurrency` workers, each pulls the next index.
  const workers = Array.from(
    { length: Math.min(concurrency, blocks.length) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= blocks.length) return;
        const block = blocks[idx];
        const result = await dispatch(ctx, { name: block.name, input: block.input });
        results[idx] = { toolUseId: block.id, name: block.name, result };
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Run blocks one at a time, awaiting each before the next starts.
 */
export async function runSerial(
  ctx: RunCtx,
  blocks: ReadonlyArray<ToolUseBlock>,
  dispatch: DispatchFn,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const block of blocks) {
    const result = await dispatch(ctx, { name: block.name, input: block.input });
    results.push({ toolUseId: block.id, name: block.name, result });
  }
  return results;
}
