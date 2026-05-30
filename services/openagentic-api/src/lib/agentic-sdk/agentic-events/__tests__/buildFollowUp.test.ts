/**
 * RED contract for buildFollowUp — the canonical wire frame that drives
 * the end-of-message follow-up chip row (Sev-0 F1-6, 2026-05-17).
 *
 * Shape (matches the northstar `mocks/UX/AI/Chatmode/end-state-{01..17}.contract.json`
 * `{ type: 'follow_up', chip_count: 3 }` frame; `items` is the canonical
 * payload carrier — each string is the chip label AND the prompt sent
 * back when the user clicks it):
 *
 *   { type: 'follow_up', items: string[], ts: number }
 *
 *   - items: 0 to 5 short prompts (mocks all ship 3)
 *   - 6+ items REJECTED (builder throws)
 *   - each item must be a non-empty string
 *
 * Position invariant (asserted in chatLoop integration test below this file):
 * the `follow_up` frame is emitted AFTER the last text/tool content_block_stop
 * and BEFORE `assistant_message_stop`. See CLAUDE.md rule 8a — never coalesce
 * mid-stream.
 */
import { describe, it, expect } from 'vitest';
import { buildFollowUp } from '../builders.js';

describe('buildFollowUp — canonical follow-up chip-row builder', () => {
  it('stamps type=follow_up + ts and returns items verbatim', () => {
    const frame = buildFollowUp(
      { items: ['draft the revert PR', 'post incident update', 'open RCA template'] },
      1700000000000,
    );
    expect(frame.type).toBe('follow_up');
    expect(frame.ts).toBe(1700000000000);
    expect(frame.items).toEqual([
      'draft the revert PR',
      'post incident update',
      'open RCA template',
    ]);
  });

  it('defaults ts to Date.now() when nowOverride is omitted', () => {
    const before = Date.now();
    const frame = buildFollowUp({ items: ['a', 'b', 'c'] });
    const after = Date.now();
    expect(frame.ts).toBeGreaterThanOrEqual(before);
    expect(frame.ts).toBeLessThanOrEqual(after);
  });

  it('accepts 0-5 items', () => {
    expect(() => buildFollowUp({ items: [] })).not.toThrow();
    expect(() => buildFollowUp({ items: ['a'] })).not.toThrow();
    expect(() => buildFollowUp({ items: ['a', 'b', 'c'] })).not.toThrow();
    expect(() => buildFollowUp({ items: ['a', 'b', 'c', 'd', 'e'] })).not.toThrow();
  });

  it('rejects 6+ items', () => {
    expect(() => buildFollowUp({ items: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow(
      /items\.length/i,
    );
  });

  it('rejects empty-string or non-string items', () => {
    expect(() => buildFollowUp({ items: [''] })).toThrow();
    expect(() => buildFollowUp({ items: ['ok', '   '] })).toThrow();
    expect(() =>
      // @ts-expect-error — testing runtime rejection of non-string items
      buildFollowUp({ items: ['ok', 42] }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error — testing runtime rejection of non-array
      buildFollowUp({ items: null }),
    ).toThrow();
  });
});
