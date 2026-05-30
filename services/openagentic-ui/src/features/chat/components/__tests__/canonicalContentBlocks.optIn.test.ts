/**
 * Step 3 consumer opt-in — ChatContainer destructures `canonicalContentBlocks`
 * from useChatStream and threads it through ChatMessages → MessageBubble.
 * ChatMessages prefers the canonical shape over the legacy `contentBlocks`
 * when it is non-empty.
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

describe('canonicalContentBlocks consumer opt-in', () => {
  it('ChatContainer destructures canonicalContentBlocks from useChatStream', () => {
    expect(containerSrc).toMatch(/canonicalContentBlocks/);
  });

  it('ChatContainer forwards canonicalContentBlocks to ChatMessages', () => {
    expect(containerSrc).toMatch(/canonicalContentBlocks=\{canonicalContentBlocks\}/);
  });

  it('ChatMessages declares canonicalContentBlocks in its props', () => {
    expect(messagesSrc).toMatch(/canonicalContentBlocks\??:\s*ContentBlock\[\]/);
  });

  it('ChatMessages prefers canonical when non-empty (pre-Hook logic visible)', () => {
    // The "prefer canonical when length>0, else fall back to legacy"
    // decision must live in ChatMessages so MessageBubble stays oblivious.
    expect(messagesSrc).toMatch(
      /canonicalContentBlocks[\s\S]{0,200}length\s*>\s*0[\s\S]{0,200}contentBlocks/,
    );
  });
});
