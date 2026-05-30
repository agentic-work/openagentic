/**
 * Wire-in D (#82) — UI consumer of tool_round_start / tool_round_end +
 * roundId-correlated tool_executing / tool_complete frames.
 *
 * These specs exercise the PURE reducer that lives inside useChatStream.ts
 * (exported as applyRoundFrame) so we can verify the ContentBlock tree
 * transitions without mocking the full NDJSON fetch / auth / store stack.
 *
 *   1. tool_round_start pushes a tool_round ContentBlock with roundId.
 *   2. tool_executing with matching roundId is nested into that round's
 *      children[], not appended as a top-level sibling.
 *   3. tool_round_end marks the matching round isComplete + stamps
 *      durationMs / succeeded / failed.
 *   4. tool_executing with an UNKNOWN roundId falls back to the sibling
 *      path (graceful — frame is never dropped).
 *   5. Duplicate tool_round_start with same roundId is a no-op (does not
 *      create a second tool_round block).
 */

import { describe, it, expect } from 'vitest';
import {
  applyRoundFrame,
  type ContentBlock,
  type ToolRoundBlock,
} from '../useChatStream';

const asRound = (b: ContentBlock | undefined): ToolRoundBlock => {
  if (!b || b.type !== 'tool_round') {
    throw new Error(`expected tool_round block, got ${b?.type}`);
  }
  return b as ToolRoundBlock;
};

describe('applyRoundFrame — Wire-in D (#82) roundId correlation', () => {
  it('tool_round_start pushes a tool_round ContentBlock with the emitted roundId', () => {
    const next = applyRoundFrame([], {
      type: 'tool_round_start',
      roundId: 'r-abc',
      toolCount: 2,
      toolIds: ['t1', 't2'],
      toolNames: ['kubectl_get', 'azure_list'],
      timestamp: '2026-04-23T12:00:00Z',
    });

    expect(next).toHaveLength(1);
    const round = asRound(next[0]);
    expect(round.type).toBe('tool_round');
    expect(round.roundId).toBe('r-abc');
    expect(round.toolIds).toEqual(['t1', 't2']);
    expect(round.isComplete).toBe(false);
    expect(round.children).toEqual([]);
  });

  it('tool_executing with matching roundId routes into that round block\'s children', () => {
    let blocks: ContentBlock[] = [];
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_start',
      roundId: 'r-1',
      toolCount: 2,
      toolIds: ['t1', 't2'],
      toolNames: ['a', 'b'],
      timestamp: 't0',
    });
    blocks = applyRoundFrame(blocks, {
      type: 'tool_executing',
      roundId: 'r-1',
      toolCallId: 't1',
      name: 'a',
      arguments: { x: 1 },
    });
    blocks = applyRoundFrame(blocks, {
      type: 'tool_executing',
      roundId: 'r-1',
      toolCallId: 't2',
      name: 'b',
      arguments: { y: 2 },
    });

    // Still ONE top-level block (the round), NOT three siblings.
    expect(blocks).toHaveLength(1);
    const round = asRound(blocks[0]);
    expect(round.children).toHaveLength(2);
    expect(round.children[0].type).toBe('tool_use');
    expect(round.children[0].toolName).toBe('a');
    expect(round.children[1].toolName).toBe('b');
  });

  it('tool_round_end marks the matching round isComplete + stamps durationMs/succeeded/failed', () => {
    let blocks: ContentBlock[] = [];
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_start',
      roundId: 'r-9',
      toolCount: 3,
      toolIds: ['a', 'b', 'c'],
      toolNames: ['a', 'b', 'c'],
      timestamp: 't0',
    });
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_end',
      roundId: 'r-9',
      succeeded: 2,
      failed: 1,
      durationMs: 1234,
      timestamp: 't1',
    });

    const round = asRound(blocks[0]);
    expect(round.isComplete).toBe(true);
    expect(round.durationMs).toBe(1234);
    expect(round.succeeded).toBe(2);
    expect(round.failed).toBe(1);
  });

  it('tool_executing with an UNKNOWN roundId falls back to a top-level sibling (never dropped)', () => {
    // A round is open, but this tool_executing carries a different roundId.
    let blocks: ContentBlock[] = [];
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_start',
      roundId: 'r-known',
      toolCount: 1,
      toolIds: ['t1'],
      toolNames: ['a'],
      timestamp: 't0',
    });
    blocks = applyRoundFrame(blocks, {
      type: 'tool_executing',
      roundId: 'r-orphan',
      toolCallId: 'tx',
      name: 'orphan_tool',
      arguments: {},
    });

    // One round block + one top-level tool_use sibling.
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('tool_round');
    expect(asRound(blocks[0]).children).toHaveLength(0);
    expect(blocks[1].type).toBe('tool_use');
    expect(blocks[1].toolName).toBe('orphan_tool');
  });

  it('duplicate tool_round_start with same roundId is a no-op (does not create a second block)', () => {
    let blocks: ContentBlock[] = [];
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_start',
      roundId: 'r1',
      toolCount: 2,
      toolIds: ['t1', 't2'],
      toolNames: ['a', 'b'],
      timestamp: 't0',
    });
    blocks = applyRoundFrame(blocks, {
      type: 'tool_round_start',
      roundId: 'r1',
      toolCount: 2,
      toolIds: ['t1', 't2'],
      toolNames: ['a', 'b'],
      timestamp: 't0',
    });

    // Only one tool_round block should exist for roundId 'r1'.
    const roundBlocks = blocks.filter((b) => b.type === 'tool_round');
    expect(roundBlocks).toHaveLength(1);
    expect(blocks).toHaveLength(1);
  });
});
