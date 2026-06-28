/**
 * blockIndex — TDD spec for task #83.
 *
 * Each turn's pipeline emits content-producing NDJSON frames (stream,
 * tool_progress, thinking_event, image, browser_exec_request, ...) and
 * stamps them with a 0-based monotonic `index`. The UI keeps Map<index,
 * ContentBlock> so blocks emitted in parallel land at their correct slot.
 *
 * Contract: a `BlockIndexer` instance is per-turn and bumps index when
 * the logical block changes. Text deltas of the same block reuse index.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BlockIndexer, type BlockKind } from '../blockIndex.js';

describe('BlockIndexer', () => {
  let idx: BlockIndexer;

  beforeEach(() => {
    idx = new BlockIndexer();
  });

  it('first delta of first block is index 0', () => {
    expect(idx.indexFor({ blockKind: 'text', blockId: 'text-0' })).toBe(0);
  });

  it('same blockId keeps the same index across deltas', () => {
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
  });

  it('new blockId bumps index', () => {
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
    expect(idx.indexFor({ blockKind: 'tool_use', blockId: 'tc1' })).toBe(1);
    expect(idx.indexFor({ blockKind: 'text', blockId: 't2' })).toBe(2);
  });

  it('interleaved blocks keep their own indices', () => {
    // Common parallel scenario: text block streams while a tool_use
    // block emits inside the same turn. Each keeps its own slot.
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
    expect(idx.indexFor({ blockKind: 'tool_use', blockId: 'tc1' })).toBe(1);
    expect(idx.indexFor({ blockKind: 'text', blockId: 't1' })).toBe(0);
    expect(idx.indexFor({ blockKind: 'tool_use', blockId: 'tc1' })).toBe(1);
  });

  it('all 6 documented BlockKinds are accepted', () => {
    const kinds: BlockKind[] = [
      'text',
      'tool_use',
      'tool_result',
      'thinking',
      'image',
      'browser_exec',
    ];
    kinds.forEach((k, i) => {
      expect(idx.indexFor({ blockKind: k, blockId: `b${i}` })).toBe(i);
    });
  });

  it('returns monotonically increasing indices across 100 distinct blocks', () => {
    const indices = Array.from({ length: 100 }, (_, i) =>
      idx.indexFor({ blockKind: 'text', blockId: `b${i}` }),
    );
    expect(indices).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('does not resurrect a closed block — closeBlock() forbids reuse', () => {
    const first = idx.indexFor({ blockKind: 'text', blockId: 't1' });
    idx.closeBlock('t1');
    const second = idx.indexFor({ blockKind: 'text', blockId: 't1' });
    // After close, even the same blockId gets a fresh index
    expect(second).toBeGreaterThan(first);
  });

  it('size() reports the total block count emitted so far', () => {
    idx.indexFor({ blockKind: 'text', blockId: 'a' });
    idx.indexFor({ blockKind: 'tool_use', blockId: 'b' });
    idx.indexFor({ blockKind: 'text', blockId: 'a' }); // same block
    expect(idx.size()).toBe(2);
  });
});
