/**
 * Sev-0 #834 / #812 follow-up — thinking blocks must render as live-
 * streaming whenever the message is in-flight AND the block is not yet
 * marked complete, regardless of whether the thinking block is the LAST
 * content block in the message.
 *
 * Bug surface (verified live in Q-loop 2026-05-14 captures): the model
 * emits a thinking block, then a tool_use, then text — by the time the
 * UI re-renders, the thinking block is no longer `contentBlocks[last]`
 * so the legacy gate `isActivelyStreaming = isStreaming && isLastBlock
 * && !block.isComplete` evaluated to FALSE, snapping the thinking block
 * to its "Thought for X.Xs" terminal header even while the model was
 * STILL producing tool args / text. Users complained twice: "COT block
 * doesn't stream live — appears as coalesced post-hoc summary."
 *
 * Fix: drop the `isLastContentBlock` constraint. The `!block.isComplete`
 * check alone is sufficient — a thinking_block_stop frame flips
 * isComplete=true; until then the block IS actively streaming even if
 * the model has moved on to other block types.
 *
 * RED: source-content assertion that the isLastContentBlock gate is
 * absent from the thinking_group render path.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'AgenticActivityStream', 'AgenticActivityStream.tsx');

describe('Sev-0 #834 — thinking blocks stream live regardless of last-block position', () => {
  const src = readFileSync(SRC, 'utf8');

  it('isActivelyStreaming for thinking_group does NOT depend on isLastContentBlock', () => {
    // The legacy gate produced post-hoc coalesced thinking. The new gate
    // must only check streaming-in-flight + block-not-complete.
    //
    // Match the thinking_group render block specifically.
    const thinkingGroupSrc = (() => {
      const start = src.indexOf("if (group.type === 'thinking_group'");
      const end = src.indexOf("if (group.type === 'agent_group'", start);
      // Fall back to a forward window if the next group isn't found.
      const stop = end !== -1 ? end : start + 2000;
      return src.slice(start, stop);
    })();

    expect(thinkingGroupSrc).toMatch(/isActivelyStreaming\s*=\s*isStreaming\s*&&\s*!block\.isComplete/);
    // Negative: the old isLastContentBlock gate must NOT be the
    // gating predicate for thinking-block active streaming.
    expect(thinkingGroupSrc).not.toMatch(/isActivelyStreaming\s*=\s*isStreaming\s*&&\s*isLastContentBlock/);
  });

  it('mentions #834 rationale near the thinking_group fix', () => {
    // Future contributors must understand WHY the gate was simplified —
    // otherwise they'll reintroduce `isLastContentBlock` thinking it's
    // a "safer" guard.
    expect(src).toMatch(/#834/);
  });
});
