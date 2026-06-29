/**
 * Canonical content-block consumer wiring.
 *
 * Post-rip reality: ChatContainer drives the chat via `useChatStream` (the
 * pure-reducer engine) and destructures the canonical `contentBlocks` slice
 * from it, derives the flat assistant string via `deriveFlatMessage`, and
 * threads `contentBlocks` through to ChatMessages. ChatMessages still carries
 * the `canonicalContentBlocks` prop and prefers it over the legacy
 * `contentBlocks` when non-empty, so MessageBubble stays oblivious to which
 * shape it received.
 *
 * Project convention: arch-grep against the source (peer pattern,
 * see ChatContainer.inlineWidgetWire.test.ts). The streaming consumer
 * graph is too tangled for renderHook in isolation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const containerSrc = readFileSync(join(root, 'ChatContainer.tsx'), 'utf8');
const messagesSrc = readFileSync(join(root, 'ChatMessages.tsx'), 'utf8');

describe('canonical content-block consumer wiring', () => {
  it('ChatContainer drives chat via the useChatStream pure-reducer engine', () => {
    expect(containerSrc).toMatch(/useChatStream/);
    expect(containerSrc).toMatch(/=\s*useChatStream\(/);
  });

  it('ChatContainer destructures the canonical contentBlocks slice from useChatStream', () => {
    // The destructure block ends at `} = useChatStream({` — assert
    // `contentBlocks` is named in it.
    const idx = containerSrc.indexOf('} = useChatStream(');
    expect(idx).toBeGreaterThan(-1);
    const destructure = containerSrc.slice(Math.max(0, idx - 4000), idx);
    expect(destructure).toMatch(/\bcontentBlocks\b/);
  });

  it('ChatContainer derives the flat assistant string via deriveFlatMessage(contentBlocks)', () => {
    expect(containerSrc).toMatch(/deriveFlatMessage\(\s*contentBlocks\s*\)/);
  });

  it('ChatContainer forwards contentBlocks to ChatMessages', () => {
    expect(containerSrc).toMatch(/contentBlocks=\{contentBlocks\}/);
  });

  it('ChatMessages declares canonicalContentBlocks in its props', () => {
    expect(messagesSrc).toMatch(/canonicalContentBlocks\??:\s*ContentBlock\[\]/);
  });

  it('ChatMessages prefers canonical when non-empty (pre-render logic visible)', () => {
    // The "prefer canonical when length>0, else fall back to legacy"
    // decision must live in ChatMessages so MessageBubble stays oblivious.
    expect(messagesSrc).toMatch(
      /canonicalContentBlocks[\s\S]{0,200}length\s*>\s*0[\s\S]{0,200}contentBlocks/,
    );
  });
});
