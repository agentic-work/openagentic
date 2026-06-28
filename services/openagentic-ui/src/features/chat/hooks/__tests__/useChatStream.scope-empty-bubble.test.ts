/**
 * Sev-0 2026-05-19 — scope-warning stream frames produce empty assistant bubbles.
 *
 * Root cause:
 *   In the `case 'stream':` arm of useChatStream.ts, a text ContentBlock is
 *   created for the first frame of a turn with `content: cleaned`, where
 *   `cleaned = extractAndCleanThinkingBlocks(assistantMessage).cleaned`.
 *
 *   Because the legacy `assistantMessage` accumulator was ripped in a prior
 *   phase (Phase 2 of the canonical-streaming-rip plan), `assistantMessage`
 *   is always `''`, so `cleaned` is always `''`.
 *
 *   Scope-warning/lockout responses from stream.handler.ts emit a single
 *   `stream` frame whose `content` field carries the full warning text.
 *   That content arrives in `contentDelta` (set from `safeData.content`)
 *   but never reaches the text block — which gets `content: ''` instead.
 *
 * Fix contract (source-level assertion):
 *   The text-block creation site MUST prefer `contentDelta` when
 *   `assistantMessage` is empty AND `contentDelta` is non-empty.
 *   Acceptable forms (any one satisfies the assertion):
 *     - `content: contentDelta || cleaned`
 *     - `content: cleaned !== '' ? cleaned : contentDelta`
 *     - `content: assistantMessage === '' && contentDelta ? contentDelta : cleaned`
 *   The block-update path (existing text block) has the same bug — it must
 *   also prefer contentDelta when cleaned is empty.
 *
 * This test uses source-level assertion — the established pattern for
 * useChatStream.ts (see useChatStream.sessionSwitchClears.test.ts,
 * useChatStream.canonicalReducer.test.ts) because renderHook on a 6300-LOC
 * hook with 66 useState stores requires a prohibitive mocking apparatus.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(__dirname, '..', 'useChatStream.ts'),
  'utf-8',
);

describe('useChatStream — scope-warning empty bubble fix (Sev-0 2026-05-19)', () => {
  /**
   * Locate the `case 'stream':` arm and inspect the text-block creation
   * site within it. We extract a 500-char window around the `content:` line
   * and assert it contains a contentDelta fallback.
   */

  it('text-block CREATION site uses contentDelta fallback when cleaned is empty', () => {
    // Find the text-block creation site inside the case 'stream' arm.
    // Anchor: the newTextBlock object literal with `content:` inside it.
    const anchor = src.indexOf("const newTextBlock: ContentBlock = {");
    expect(anchor, 'should find newTextBlock ContentBlock literal in useChatStream.ts').toBeGreaterThan(0);

    // Extract a 900-char window covering the object literal
    // (comment block before content: can be ~300 chars).
    const window = src.slice(anchor, anchor + 900);

    // The content property must use contentDelta as a fallback (any valid form).
    // Acceptable: `contentDelta || cleaned`, `cleaned || contentDelta`,
    //             `cleaned !== '' ? cleaned : contentDelta`,
    //             `assistantMessage === '' && contentDelta ? contentDelta : cleaned`
    const hasContentDeltaFallback =
      /content:\s*contentDelta\s*\|\|\s*cleaned/.test(window) ||
      /content:\s*cleaned\s*\|\|\s*contentDelta/.test(window) ||
      /content:\s*cleaned\s*!==\s*''\s*\?\s*cleaned\s*:\s*contentDelta/.test(window) ||
      /content:\s*assistantMessage\s*===\s*''\s*&&\s*contentDelta\s*\?\s*contentDelta\s*:\s*cleaned/.test(window) ||
      /content:\s*\(cleaned\s*\|\|\s*contentDelta\)/.test(window) ||
      /content:\s*\(contentDelta\s*\|\|\s*cleaned\)/.test(window);

    expect(
      hasContentDeltaFallback,
      `text-block creation site at offset ${anchor} must use contentDelta fallback.\n` +
      `Got:\n${window}\n\n` +
      `Expected one of:\n` +
      `  content: contentDelta || cleaned\n` +
      `  content: cleaned || contentDelta\n` +
      `  content: cleaned !== '' ? cleaned : contentDelta\n` +
      `  content: (contentDelta || cleaned)\n`
    ).toBe(true);
  });

  it('text-block UPDATE path also uses contentDelta fallback when cleaned is empty', () => {
    // Find the update path: `block.index === currentTextBlockIndexRef.current`
    // with `content: cleaned` nearby.
    const updateAnchor = src.indexOf('block.index === currentTextBlockIndexRef.current');
    expect(updateAnchor, 'should find the text-block update path').toBeGreaterThan(0);

    // Extract 400-char window covering the update map().
    const window = src.slice(updateAnchor, updateAnchor + 400);

    // Must not have bare `content: cleaned` — must use contentDelta fallback.
    const hasBareCleanedOnly = /content:\s*cleaned\b(?!\s*\|\|)(?!\s*!==)/.test(window);
    const hasContentDeltaFallback =
      /content:\s*contentDelta\s*\|\|\s*cleaned/.test(window) ||
      /content:\s*cleaned\s*\|\|\s*contentDelta/.test(window) ||
      /content:\s*cleaned\s*!==\s*''\s*\?\s*cleaned\s*:\s*contentDelta/.test(window) ||
      /content:\s*\(cleaned\s*\|\|\s*contentDelta\)/.test(window) ||
      /content:\s*\(contentDelta\s*\|\|\s*cleaned\)/.test(window);

    expect(
      !hasBareCleanedOnly || hasContentDeltaFallback,
      `text-block update path must use contentDelta fallback, not bare 'content: cleaned'.\n` +
      `Got:\n${window}`
    ).toBe(true);
  });

  it('the case stream arm still has a contentDelta variable (regression guard)', () => {
    // Ensure contentDelta variable is still present in the case 'stream' arm
    // (guard against rip that would break the fallback expression itself).
    expect(src).toMatch(/let contentDelta\s*=\s*''/);
    expect(src).toMatch(/contentDelta\s*=\s*safeData\.content/);
  });
});
