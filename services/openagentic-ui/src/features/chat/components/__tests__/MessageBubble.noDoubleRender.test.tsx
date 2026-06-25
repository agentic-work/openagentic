/**
 * #966 Sev-0 — assistant message body rendered TWICE in one bubble.
 *
 * Repro: prompt "Build me a complete HTML dashboard… emit raw HTML/CSS/JS
 * directly… don't use any tools" → model emits prose containing a parsed
 * artifact-canvas-tag inline (image://, artifact:html, <html, <!DOCTYPE).
 * MessageBubble:1394 then renders EnhancedMessageContent IN ADDITION TO
 * AgenticActivityStream because `hasArtifactContent === true`, producing
 * a duplicated prose + artifact-tag button + "No data to visualize"
 * empty-state wrapper.
 *
 * Fix: rip the `|| hasArtifactContent` carve-out. When AAS has text
 * blocks, AAS is authoritative — it routes artifacts to InlineVizBadge
 * / InlineAppBadge already. EnhancedMessageContent must NOT
 * double-render.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'MessageBubble.tsx');

describe('#966 MessageBubble must not double-render when AAS has text', () => {
  it('does NOT carve out hasArtifactContent in the EnhancedMessageContent guard', () => {
    const src = readFileSync(SRC, 'utf8');
    // The buggy form is `(!activityStreamHasText || hasArtifactContent)` —
    // pin the GREEN form: the guard is just `!activityStreamHasText`.
    expect(src).not.toMatch(/!activityStreamHasText\s*\|\|\s*hasArtifactContent/);
  });

  it('EnhancedMessageContent branch is gated only on !activityStreamHasText', () => {
    const src = readFileSync(SRC, 'utf8');
    // The full canonical guard for the EnhancedMessageContent block.
    expect(src).toMatch(
      /message\.content\s*&&\s*!\(isStreaming\s*&&\s*streamingContentBlocks\s*&&\s*streamingContentBlocks\.length\s*>\s*0\)\s*&&\s*!activityStreamHasText\s*&&\s*\(/
    );
  });

  it('drops the hasArtifactContent local variable (no longer needed)', () => {
    const src = readFileSync(SRC, 'utf8');
    // No reads remain; the variable should be ripped to avoid an unused-var
    // lint warning and dead-code smell.
    expect(src).not.toMatch(/const\s+hasArtifactContent\s*=/);
  });
});
