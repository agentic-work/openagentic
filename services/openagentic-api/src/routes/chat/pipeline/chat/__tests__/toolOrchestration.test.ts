/**
 * V3 toolOrchestration — partitionToolCalls + runConcurrent + runSerial.
 *
 * Plan §Parallel/Serial Dispatch + Test #3 + #4.
 *
 * Implements the same tool-call partition algorithm Claude Code uses —
 * splits
 * a list of tool_use blocks into batches where each batch is either
 * concurrency-safe (parallelizable) or one mutating call.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  partitionToolCalls,
  runConcurrent,
  runSerial,
} from '../toolOrchestration.js';
import type { ToolUseBlock } from '../types.js';

const block = (id: string, name: string, input: unknown = {}): ToolUseBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

const SAFE = new Set([
  'tool_search',
  'agent_search',
  'compose_visual',
  'azure_list_subscriptions',
  'aws_list_accounts',
]);

describe('partitionToolCalls', () => {
  it('groups consecutive read-only tools into one batch', () => {
    const blocks = [
      block('a', 'azure_list_subscriptions'),
      block('b', 'aws_list_accounts'),
      block('c', 'tool_search'),
    ];
    const batches = partitionToolCalls(blocks, SAFE);
    expect(batches.length).toBe(1);
    expect(batches[0].isConcurrencySafe).toBe(true);
    expect(batches[0].blocks.map(b => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('isolates a single mutating call into its own batch', () => {
    const blocks = [
      block('a', 'azure_list_subscriptions'),
      block('b', 'azure_delete_vm'), // not in SAFE
      block('c', 'aws_list_accounts'),
    ];
    const batches = partitionToolCalls(blocks, SAFE);
    expect(batches.length).toBe(3);
    expect(batches[0].isConcurrencySafe).toBe(true);
    expect(batches[1].isConcurrencySafe).toBe(false);
    expect(batches[1].blocks.length).toBe(1);
    expect(batches[1].blocks[0].id).toBe('b');
    expect(batches[2].isConcurrencySafe).toBe(true);
  });

  it('keeps adjacent mutating calls in separate batches (one-block-per-write-batch)', () => {
    const blocks = [
      block('a', 'azure_delete_vm'),
      block('b', 'aws_terminate_instance'),
    ];
    const batches = partitionToolCalls(blocks, SAFE);
    expect(batches.length).toBe(2);
    expect(batches[0].isConcurrencySafe).toBe(false);
    expect(batches[1].isConcurrencySafe).toBe(false);
  });

  it('returns empty for empty input', () => {
    expect(partitionToolCalls([], SAFE)).toEqual([]);
  });
});

describe('runConcurrent', () => {
  it('dispatches all blocks in a batch concurrently (within timing window)', async () => {
    const dispatch = vi.fn(async (_ctx: any, call: any) => {
      // Each tool sleeps 30ms — if dispatched serially, 3 tools = 90ms.
      // If concurrent, total wall-clock should be ~30ms.
      await new Promise(r => setTimeout(r, 30));
      return { ok: true, output: `done-${call.name}` };
    });
    const ctx = {} as any;
    const blocks = [
      block('a', 'tool_search'),
      block('b', 'agent_search'),
      block('c', 'compose_visual'),
    ];
    const t0 = Date.now();
    const results = await runConcurrent(ctx, blocks, dispatch as any, 5);
    const dt = Date.now() - t0;
    expect(results.length).toBe(3);
    expect(dt).toBeLessThan(80); // 90ms serial vs ~30ms parallel; allow 80ms slack
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('caps concurrency at the provided limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const dispatch = vi.fn(async (_ctx: any, _call: any) => {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise(r => setTimeout(r, 20));
      inFlight--;
      return { ok: true, output: 'x' };
    });
    const ctx = {} as any;
    const blocks = Array.from({ length: 10 }, (_, i) => block(`b${i}`, 'tool_search'));
    await runConcurrent(ctx, blocks, dispatch as any, 3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('preserves input ordering in the result array', async () => {
    const dispatch = vi.fn(async (_ctx: any, call: any) => {
      // Reverse-order delays so the callback completion order ≠ input order.
      const delay = call.name === 'tool_search' ? 30 : 5;
      await new Promise(r => setTimeout(r, delay));
      return { ok: true, output: call.name };
    });
    const ctx = {} as any;
    const blocks = [
      block('a', 'tool_search'),
      block('b', 'agent_search'),
      block('c', 'compose_visual'),
    ];
    const results = await runConcurrent(ctx, blocks, dispatch as any, 5);
    expect(results.map(r => r.toolUseId)).toEqual(['a', 'b', 'c']);
  });
});

describe('runSerial', () => {
  it('dispatches blocks one at a time, in order', async () => {
    const order: string[] = [];
    const dispatch = vi.fn(async (_ctx: any, call: any) => {
      order.push(`start-${call.name}`);
      await new Promise(r => setTimeout(r, 10));
      order.push(`end-${call.name}`);
      return { ok: true, output: 'x' };
    });
    const ctx = {} as any;
    const blocks = [
      block('a', 'azure_delete_vm'),
      block('b', 'aws_terminate_instance'),
    ];
    await runSerial(ctx, blocks, dispatch as any);
    expect(order).toEqual([
      'start-azure_delete_vm',
      'end-azure_delete_vm',
      'start-aws_terminate_instance',
      'end-aws_terminate_instance',
    ]);
  });
});
