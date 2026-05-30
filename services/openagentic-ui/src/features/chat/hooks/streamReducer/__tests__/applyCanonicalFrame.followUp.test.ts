/**
 * RED contract for applyCanonicalFrame's `follow_up` case (Sev-0 F1-6,
 * 2026-05-17).
 *
 * Wire shape (matches the chatmode end-state contracts at
 * `mocks/UX/AI/Chatmode/end-state-{01..17}.contract.json`):
 *   { type: 'follow_up', items: string[] }
 *
 * Reducer behavior:
 *   - appends a new ContentBlock of type 'follow_up' with `items: string[]`
 *     onto state.contentBlocks[]
 *   - block is isComplete=true (one-shot frame, no streaming)
 *   - empty items → no block (UI no-op)
 *   - re-emit (replace): a second follow_up frame replaces the first block
 *     rather than appending another (one chip row per turn)
 *   - closes any open thinking/text accumulators before insertion so the
 *     chip row never lands inside an open prose block (CLAUDE.md rule 8a)
 */
import { describe, it, expect } from 'vitest';
import {
  applyCanonicalFrame,
  initialFrameState,
} from '../applyCanonicalFrame';

describe('applyCanonicalFrame — follow_up case (Sev-0 F1-6)', () => {
  it('appends a follow_up ContentBlock with items[] onto contentBlocks[]', () => {
    const items = [
      'drill into prod-west-rg',
      'apply nat-endpoint terraform',
      'open RCA template',
    ];
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'follow_up',
      items,
    });
    const followUpBlocks = next.contentBlocks.filter((b) => b.type === 'follow_up');
    expect(followUpBlocks).toHaveLength(1);
    expect((followUpBlocks[0] as { items?: string[] }).items).toEqual(items);
    expect(followUpBlocks[0].isComplete).toBe(true);
  });

  it('empty items → does NOT append a block (UI no-op)', () => {
    const next = applyCanonicalFrame(initialFrameState(), {
      type: 'follow_up',
      items: [],
    });
    expect(next.contentBlocks.filter((b) => b.type === 'follow_up')).toHaveLength(0);
  });

  it('re-emitting follow_up replaces the existing chip row (one per turn)', () => {
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'follow_up',
      items: ['a', 'b', 'c'],
    });
    const s2 = applyCanonicalFrame(s1, {
      type: 'follow_up',
      items: ['x', 'y', 'z'],
    });
    const blocks = s2.contentBlocks.filter((b) => b.type === 'follow_up');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { items?: string[] }).items).toEqual(['x', 'y', 'z']);
  });

  it('closes the open text accumulator before inserting follow_up (CLAUDE.md rule 8a)', () => {
    // Open a streaming text block.
    const s1 = applyCanonicalFrame(initialFrameState(), {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'final answer' },
    });
    // Now drop in a follow_up frame.
    const s2 = applyCanonicalFrame(s1, {
      type: 'follow_up',
      items: ['a', 'b', 'c'],
    });
    const textBlock = s2.contentBlocks.find((b) => b.type === 'text');
    const followUpBlock = s2.contentBlocks.find((b) => b.type === 'follow_up');
    expect(textBlock).toBeDefined();
    expect(textBlock!.isComplete).toBe(true);
    expect(followUpBlock).toBeDefined();
    // text comes BEFORE follow_up in the array (chronological insertion).
    const textIdx = s2.contentBlocks.indexOf(textBlock!);
    const followUpIdx = s2.contentBlocks.indexOf(followUpBlock!);
    expect(followUpIdx).toBeGreaterThan(textIdx);
  });
});
