/**
 * Dual-SoT render-seam regression (A+++ High: "computed but never rendered").
 *
 * The streaming hook exposes BOTH the imperatively-built `contentBlocks` AND the
 * pure-reducer `canonicalContentBlocks` (applyCanonicalFrame SoT). ChatMessages
 * already prefers `canonicalContentBlocks` when non-empty, but ChatContainer
 * historically only passed `contentBlocks`, so the canonical reducer was
 * computed every frame yet never rendered live — two accumulators kept in sync
 * "only by hope".
 *
 * ChatContainer is too tangled to renderHook in isolation, so — matching the
 * project convention used by `useChatStream.canonicalReducer.test.ts` — this
 * pins the wiring at the source level: ChatContainer MUST destructure
 * `canonicalContentBlocks` from the hook AND forward it to <ChatMessages/>.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'ChatContainer.tsx'), 'utf8');

describe('ChatContainer — canonical content blocks are wired to the render path', () => {
  it('destructures canonicalContentBlocks from the streaming hook', () => {
    expect(src).toMatch(/canonicalContentBlocks\s*,/);
  });

  it('forwards canonicalContentBlocks to <ChatMessages/> (so the pure reducer renders live)', () => {
    expect(src).toMatch(/canonicalContentBlocks=\{canonicalContentBlocks\}/);
  });

  it('no longer launders messages through a `messages as any as ChatMessage[]` double-cast', () => {
    expect(src).not.toMatch(/messages\s+as\s+any\s+as\s+ChatMessage\[\]/);
  });

  it('uses the typed store→ChatMessage adapter instead of an inline cast', () => {
    expect(src).toMatch(/storeMessagesToChatMessages/);
  });

  it('reads file preview URLs via the typed FileWithPreview field (no `(file as any).previewUrl`)', () => {
    expect(src).not.toMatch(/\(file\s+as\s+any\)\.previewUrl/);
    expect(src).not.toMatch(/\(fileToRemove\s+as\s+any\)\.previewUrl/);
  });
});
