/**
 * #502 — ChatContainer must thread `inlineWidgetsByMessageId` from
 * the useChatStream hook into <ChatMessages />. Source-grep test
 * (mirrors the streaming-table / findings wire pattern).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatContainer.tsx');

describe('ChatContainer inline-widget wire (#502)', () => {
  it('destructures inlineWidgetsByMessageId from the chat-stream hook', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/inlineWidgetsByMessageId,/);
  });

  it('forwards inlineWidgetsByMessageId into <ChatMessages />', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/inlineWidgetsByMessageId=\{inlineWidgetsByMessageId\}/);
  });
});
