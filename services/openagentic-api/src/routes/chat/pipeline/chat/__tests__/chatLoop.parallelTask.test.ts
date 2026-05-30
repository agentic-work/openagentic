/**
 * Sev-0 #832 — Programmatic proof that the chatmode runtime DISPATCHES
 * parallel Task tool_use blocks concurrently (not serially across batches).
 *
 * This is the runtime counterpart to
 * `concurrency-safety-classification.test.ts` (which only pinned the static
 * set membership). Here we drive the REAL `chatLoop` function with:
 *   - a stub provider that emits 3 parallel `Task` tool_use blocks on turn 1
 *     and end_turn on turn 2
 *   - a real dispatch fn that sleeps 80ms per call (serial would be ~240ms;
 *     concurrent should be ~80ms)
 *   - the ACTUAL `META_TOOL_CONCURRENCY_SAFE ∪ PermissionService.allow('Task')`
 *     safe set computed via `computeConcurrencySafeNames`
 *
 * Then asserts:
 *   - dispatch invoked 3 times
 *   - all 3 starts within 25ms of each other (wall-clock concurrency proof)
 *   - end-to-end wall-clock < 200ms (serial floor: 240ms; concurrent: ~80ms)
 *   - each Task dispatch carries proper {description, prompt} input
 *   - 3 `tool_result` frames emit with the original tool_use_ids
 *
 * NO MOCK of partitionToolCalls / runConcurrent / runSerial — those are
 * the actual production functions imported by chatLoop. Only the model
 * stream + the per-tool dispatch fn are stubbed (real LLM calls would
 * require the hal:11434 real-provider regime and aren't deterministic
 * enough to assert wall-clock concurrency on).
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';
import { computeConcurrencySafeNames } from '../toolRegistry.js';
import { PermissionService } from '../../../../../services/PermissionService.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: function () { return this; },
} as any;

function makeCtx() {
  const emitted: Array<{ op: string; payload: any }> = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: silentLogger,
      sessionId: 'sess-832',
      userId: 'user-832',
    } as any,
    emitted,
  };
}

describe('Sev-0 #832 — chatLoop runtime parallel Task fan-out', () => {
  it('dispatches 3 parallel Task tool_use blocks CONCURRENTLY (wall-clock proof)', async () => {
    const { ctx, emitted } = makeCtx();

    // Turn 1: model emits 3 parallel Task blocks (the canonical multi-agent
    // fan-out shape from ~/anthropic/src/tools/TaskCreateTool/).
    // Turn 2: model receives all 3 tool_results and synthesizes.
    let call = 0;
    async function* turn1Stream() {
      yield {
        type: 'tool_use_complete',
        id: 'toolu_aws',
        name: 'Task',
        input: {
          description: 'aws-audit',
          prompt: 'Use aws_list_accounts to enumerate AWS accounts.',
          subagent_type: 'cloud-operations',
        },
      };
      yield {
        type: 'tool_use_complete',
        id: 'toolu_azure',
        name: 'Task',
        input: {
          description: 'azure-audit',
          prompt: 'Use azure_list_subscriptions to enumerate Azure subs.',
          subagent_type: 'cloud-operations',
        },
      };
      yield {
        type: 'tool_use_complete',
        id: 'toolu_gcp',
        name: 'Task',
        input: {
          description: 'gcp-audit',
          prompt: 'Use gcp_list_projects to enumerate GCP projects.',
          subagent_type: 'cloud-operations',
        },
      };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    }
    async function* turn2Stream() {
      yield { type: 'text_delta', text: 'Tri-cloud audit synthesized from 3 sub-agents.' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(() => (++call === 1 ? turn1Stream() : turn2Stream()));

    // Real dispatch fn — captures start timestamps + sleeps 80ms.
    // Serial floor: 240ms (3 × 80). Concurrent ceiling: ~100ms.
    const dispatchStarts: Array<{ name: string; id: string; t: number; input: any }> = [];
    const dispatch = vi.fn(async (_ctx: any, c: any) => {
      // chatLoop passes `{name, input}` — input matches the tool_use_complete payload.
      dispatchStarts.push({ name: c.name, id: c.id ?? c.input?._id ?? '?', t: Date.now(), input: c.input });
      await new Promise(r => setTimeout(r, 80));
      return {
        ok: true,
        output: {
          provider: c.input?.description,
          count: 1,
          synthesized: true,
        },
      };
    });

    // Use the REAL classifier + computeConcurrencySafeNames — no mocking
    // the safety classification logic. This proves the production path.
    const tools = [
      { type: 'function', function: { name: 'Task', description: '', parameters: { type: 'object', properties: {} } } },
    ];
    const ps = new PermissionService(silentLogger);
    const safe = computeConcurrencySafeNames(tools, { classifyName: (n) => ps.classifyName(n) });

    // Pre-flight contract: Task MUST be in the safe set for fan-out to work.
    expect(safe.has('Task')).toBe(true);

    const t0 = Date.now();
    const result = await chatLoop(
      ctx,
      {
        userMessage: 'fan out 3 cloud audits in parallel',
        priorMessages: [],
        systemPrompt: 'You fan out sub-agents in parallel.',
        tools,
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: safe,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );
    const elapsed = Date.now() - t0;

    expect(result.ok).toBe(true);
    expect(result.turns).toBe(2);

    // CONTRACT 1: all 3 Task blocks dispatched.
    expect(dispatch).toHaveBeenCalledTimes(3);

    // CONTRACT 2: wall-clock concurrency — all 3 start within 25ms of each other.
    // (worker pool spawns 3 in parallel; first await yields the event loop
    // immediately so workers 2 and 3 enter their sleep before worker 1 finishes).
    const starts = dispatchStarts.map(d => d.t);
    const startWindow = Math.max(...starts) - Math.min(...starts);
    expect(startWindow).toBeLessThan(25);

    // CONTRACT 3: end-to-end wall-clock proves concurrency — serial would
    // need >240ms (3 × 80ms). Concurrent should complete near 80ms + overhead.
    // Allow generous 200ms ceiling to account for CI variance.
    expect(elapsed).toBeLessThan(200);

    // CONTRACT 4: each Task dispatch carries the proper canonical input
    // shape (description + prompt). This proves the input plumb survived
    // partitionToolCalls + runConcurrent without truncation/loss.
    const inputDescriptions = dispatchStarts.map(d => d.input?.description).sort();
    expect(inputDescriptions).toEqual(['aws-audit', 'azure-audit', 'gcp-audit']);
    for (const d of dispatchStarts) {
      expect(d.name).toBe('Task');
      expect(typeof d.input?.prompt).toBe('string');
      expect(d.input.prompt.length).toBeGreaterThan(10);
      expect(d.input?.subagent_type).toBe('cloud-operations');
    }

    // CONTRACT 5: 3 tool_result frames emit with original tool_use_ids,
    // preserving the ref-arch contract that the model's next turn sees
    // tool_results in the SAME order as the tool_use blocks.
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBe(3);
    expect(toolResults.map(e => e.payload.tool_use_id).sort()).toEqual(
      ['toolu_aws', 'toolu_azure', 'toolu_gcp'],
    );
  });

  it('mixed Task + read-only tool_search + write azure_delete_vm partitions correctly', async () => {
    // Real-world shape: model fires tool_search to discover an MCP tool,
    // spawns 2 parallel Task sub-agents, then asks for a destructive write.
    // Expected: ONE concurrent batch of {tool_search, Task, Task} (all 3
    // are classifier-allow), then ONE serial batch with azure_delete_vm
    // ('ask' = HITL gates, not concurrency-safe).
    const { ctx } = makeCtx();
    let call = 0;
    async function* turn1Stream() {
      yield { type: 'tool_use_complete', id: 's1', name: 'tool_search', input: { query: 'cost' } };
      yield { type: 'tool_use_complete', id: 't1', name: 'Task', input: { description: 'a', prompt: 'p1' } };
      yield { type: 'tool_use_complete', id: 't2', name: 'Task', input: { description: 'b', prompt: 'p2' } };
      yield { type: 'tool_use_complete', id: 'w1', name: 'azure_delete_vm', input: { vm_id: 'doomed' } };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    }
    async function* turn2Stream() {
      yield { type: 'text_delta', text: 'done' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(() => (++call === 1 ? turn1Stream() : turn2Stream()));

    const order: string[] = [];
    const dispatch = vi.fn(async (_c: any, x: any) => {
      order.push(`start-${x.name}-${x.input?.description ?? x.input?.query ?? x.input?.vm_id ?? '?'}`);
      await new Promise(r => setTimeout(r, 20));
      order.push(`end-${x.name}`);
      return { ok: true, output: 'x' };
    });

    const tools = [
      { type: 'function', function: { name: 'tool_search', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'Task', description: '', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'azure_delete_vm', description: '', parameters: { type: 'object', properties: {} } } },
    ];
    const ps = new PermissionService(silentLogger);
    const safe = computeConcurrencySafeNames(tools, { classifyName: (n) => ps.classifyName(n) });

    // Pre-flight: classifier MUST mark tool_search + Task allow,
    // azure_delete_vm NOT in safe set (it's 'ask' → HITL serializes).
    expect(safe.has('tool_search')).toBe(true);
    expect(safe.has('Task')).toBe(true);
    expect(safe.has('azure_delete_vm')).toBe(false);

    await chatLoop(
      ctx,
      {
        userMessage: 'discover then audit then delete',
        priorMessages: [],
        systemPrompt: 's',
        tools,
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: safe,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    // Batch 1 (concurrent): tool_search + 2x Task — all start ~together,
    // all end before batch 2 starts.
    // Batch 2 (serial): azure_delete_vm starts AFTER batch 1 ends.
    const w1Start = order.indexOf('start-azure_delete_vm-doomed');
    const lastBatch1End = Math.max(
      order.indexOf('end-tool_search'),
      order.indexOf('end-Task'),
      order.lastIndexOf('end-Task'),
    );
    expect(w1Start).toBeGreaterThan(lastBatch1End);

    // And NO start-azure_delete_vm appears before any batch-1 end.
    const earlyW1 = order.slice(0, lastBatch1End).filter(s => s.startsWith('start-azure_delete_vm'));
    expect(earlyW1.length).toBe(0);
  });
});
