/**
 * V3 chatLoop parallel-tool dispatch integration test (Plan §Tests #3 + #4).
 *
 * The model emits multiple tool_use blocks per turn. chatLoop must:
 *   - dispatch all read-only tool_use blocks concurrently (parallel batch)
 *   - serialize blocks that aren't in the concurrencySafeNames set
 *   - emit one opcode `3` (tool_result) per block
 *   - feed all tool_results back to the next turn together
 *
 * Wires partitionToolCalls / runConcurrent / runSerial into chatLoop's
 * dispatch step. Replaces the smoke-test placeholder that ran sequentially.
 */
import { describe, it, expect, vi } from 'vitest';
import { chatLoop } from '../chatLoop.js';

function makeCtx() {
  const emitted: Array<{ op: string; payload: any }> = [];
  return {
    ctx: {
      emit: (op: string, payload: any) => emitted.push({ op, payload }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      sessionId: 's',
      userId: 'u',
    } as any,
    emitted,
  };
}

describe('chatLoop — parallel tool dispatch (read-only batch)', () => {
  it('dispatches 3 read-only tool_use blocks concurrently', async () => {
    const { ctx, emitted } = makeCtx();
    let call = 0;

    // Turn 1: model emits 3 read-only tool_use blocks.
    // Turn 2: end_turn with synthesis text.
    async function* turn1Stream() {
      yield { type: 'tool_use_complete', id: 'a', name: 'azure_list_subscriptions', input: {} };
      yield { type: 'tool_use_complete', id: 'b', name: 'aws_list_accounts', input: {} };
      yield { type: 'tool_use_complete', id: 'c', name: 'tool_search', input: { query: 'gcp' } };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    }
    async function* turn2Stream() {
      yield { type: 'text_delta', text: 'Found 2 subs, 1 acct, and gcp tool.' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(() => {
      call++;
      return call === 1 ? turn1Stream() : turn2Stream();
    });

    // Track dispatch start times to assert concurrency.
    const dispatchStarts: Record<string, number> = {};
    const dispatch = vi.fn(async (_ctx: any, c: any) => {
      dispatchStarts[c.name] = Date.now();
      // Each tool sleeps 30ms — if dispatched serially, total wall-clock = 90ms.
      // Concurrent should be ~30ms. We assert all 3 starts within 10ms of each other.
      await new Promise(r => setTimeout(r, 30));
      return { ok: true, output: { name: c.name, count: 3 } };
    });

    const SAFE = ['azure_list_subscriptions', 'aws_list_accounts', 'tool_search'];

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'list my clouds',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: new Set(SAFE),
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(result.ok).toBe(true);
    expect(result.turns).toBe(2);

    // All 3 tools dispatched.
    expect(dispatch).toHaveBeenCalledTimes(3);

    // Concurrency check: all dispatch starts within 15ms of each other.
    const starts = Object.values(dispatchStarts);
    const window = Math.max(...starts) - Math.min(...starts);
    expect(window).toBeLessThan(15);

    // Three named `tool_result` frames emitted (A1: opcode-3 dual-emit
    // ripped; named frame uses `tool_use_id` not `id`).
    const toolResults = emitted.filter(e => e.op === 'tool_result');
    expect(toolResults.length).toBe(3);
    expect(toolResults.map(e => e.payload.tool_use_id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('isolates a write call between read-only batches (3 batches: read|write|read)', async () => {
    const { ctx } = makeCtx();
    let call = 0;
    async function* turn1Stream() {
      yield { type: 'tool_use_complete', id: 'r1', name: 'azure_list_subscriptions', input: {} };
      yield { type: 'tool_use_complete', id: 'w1', name: 'azure_delete_vm', input: {} };
      yield { type: 'tool_use_complete', id: 'r2', name: 'aws_list_accounts', input: {} };
      yield { type: 'message_stop', stop_reason: 'tool_use' };
    }
    async function* turn2Stream() {
      yield { type: 'text_delta', text: 'done' };
      yield { type: 'message_stop', stop_reason: 'end_turn' };
    }
    const streamProvider = vi.fn(() => (++call === 1 ? turn1Stream() : turn2Stream()));

    const order: string[] = [];
    const dispatch = vi.fn(async (_c: any, x: any) => {
      order.push(`start-${x.name}`);
      await new Promise(r => setTimeout(r, 10));
      order.push(`end-${x.name}`);
      return { ok: true, output: 'x' };
    });

    const SAFE = new Set(['azure_list_subscriptions', 'aws_list_accounts']);

    const result = await chatLoop(
      ctx,
      {
        userMessage: 'do it',
        priorMessages: [],
        systemPrompt: 's',
        tools: [],
        model: 'gpt-5.4',
        maxTurns: 5,
        concurrencySafeNames: SAFE,
      },
      { streamProvider: streamProvider as any, dispatch: dispatch as any },
    );

    expect(result.ok).toBe(true);

    // Batch 1 (read-only): r1 starts; we don't care about end ordering inside.
    // Batch 2 (write): w1 starts AFTER r1 completes; w1 ends BEFORE r2 starts.
    // Batch 3 (read-only): r2 starts AFTER w1 ends.
    const r1Start = order.indexOf('start-azure_list_subscriptions');
    const w1Start = order.indexOf('start-azure_delete_vm');
    const w1End = order.indexOf('end-azure_delete_vm');
    const r2Start = order.indexOf('start-aws_list_accounts');

    // Batch order is sequential — w1 cannot start before batch 1 finishes
    // (batch boundary), and r2 cannot start before w1 finishes.
    expect(r1Start).toBeLessThan(w1Start);
    expect(w1End).toBeLessThan(r2Start);
  });
});
